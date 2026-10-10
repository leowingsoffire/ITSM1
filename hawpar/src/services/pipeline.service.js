/**
 * Processing pipeline.
 *
 * A bounded-concurrency worker pool. Each document is handed to the agent mesh
 * (see services/agents/orchestrator.service.js), which runs eleven specialists in
 * dependency waves. The pipeline itself owns queueing, persistence and the
 * six-stage progress contract (ingest → analyse → classify → extract → validate →
 * score) that the live progress UI streams over SSE.
 */
import { EventEmitter } from 'node:events';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { currentTenantId, runWithTenant } from '../lib/tenantContext.js';
import { getUpload } from './blob.service.js';
import { runOrchestration } from './agents/orchestrator.service.js';
import { selectModelForType } from './cost.service.js';
import { claimJob, durableBacklog, persistJob, recoverJobs } from './queue.service.js';
import {
  DocumentStatus,
  appendAudit,
  getDocument,
  toSummary,
  updateDocument
} from './store.service.js';

export const pipelineEvents = new EventEmitter();
pipelineEvents.setMaxListeners(64);

const STAGES = Object.freeze(['ingest', 'analyse', 'classify', 'extract', 'validate', 'score']);
const MAX_STORED_PAGES = 400;
const MAX_RETAINED_RUNS = 200;

/** @type {Array<{documentId: string, correlationId: string}>} */
const queue = [];
/** @type {Array<object>} Rolling window of completed agent runs for the mesh console. */
const runHistory = [];
let activeWorkers = 0;
let processedCount = 0;
let failedCount = 0;
let agentStepCount = 0;

function emit(event, payload) {
  pipelineEvents.emit('event', { event, at: new Date().toISOString(), tenantId: currentTenantId(), ...payload });
}

function newStages() {
  return STAGES.map((name) => ({ name, status: 'pending', durationMs: null, detail: null }));
}

function markStage(stages, name, status, detail, durationMs) {
  return stages.map((stage) =>
    stage.name === name
      ? { ...stage, status, detail: detail ?? stage.detail, durationMs: durationMs ?? stage.durationMs }
      : stage
  );
}

/**
 * Enqueues a document for processing. The job is first appended to the
 * durable queue log so a restart between accept (202) and worker pickup
 * cannot silently drop it; the file is claimed when a worker starts.
 * Awaited by ingestion so `waitForIdle()` in tests sees the job.
 * @param {string} documentId
 * @param {string} correlationId
 */
export async function enqueue(documentId, correlationId) {
  const tenantId = currentTenantId();
  const jobId = await persistJob(tenantId, { documentId, correlationId });
  queue.push({ documentId, correlationId, tenantId, jobId });
  emit('queued', { documentId, queueDepth: queue.length });
  drain();
}

/** Tenants already recovered this boot — recovery must run once, not per request. */
const recoveredTenants = new Set();

/**
 * Replays durable jobs left behind by a previous process. Runs once per
 * tenant per boot; later calls are no-ops so per-request store loads cannot
 * duplicate the in-memory queue.
 */
export async function recoverPendingJobs() {
  const tenantId = currentTenantId();
  if (recoveredTenants.has(tenantId)) return 0;
  recoveredTenants.add(tenantId);
  const recovered = await recoverJobs(tenantId);
  for (const job of recovered) {
    queue.push({ documentId: job.documentId, correlationId: job.correlationId, tenantId, jobId: job.jobId });
  }
  if (recovered.length > 0) {
    emit('recovered', { count: recovered.length, queueDepth: queue.length });
    drain();
  }
  return recovered.length;
}

function drain() {
  while (activeWorkers < config.limits.pipelineConcurrency && queue.length > 0) {
    const job = queue.shift();
    activeWorkers += 1;
    // Jobs may belong to another tenant (recovered after boot); bind the
    // tenant context so store/blob writes land in the right workspace.
    runWithTenant(job.tenantId ?? currentTenantId(), () =>
      processDocument(job)
        .catch((error) => {
          logger.error('Unhandled pipeline failure.', { documentId: job.documentId, error });
        })
        .finally(() => {
          activeWorkers -= 1;
          drain();
        })
    );
  }
}

async function readUpload(record) {
  try {
    return await getUpload(record.storagePath);
  } catch (error) {
    throw new Error(`Uploaded file could not be read from ${record.storagePath}: ${error.code ?? error.message}`);
  }
}

/** Trims very large documents down to a storable footprint while keeping full text. */
function limitPages(pages) {
  if (pages.length <= MAX_STORED_PAGES) return { pages, truncated: false };
  return { pages: pages.slice(0, MAX_STORED_PAGES), truncated: true };
}

function rememberRun(run, summary) {
  runHistory.unshift({
    id: run.id,
    documentId: run.documentId,
    fileName: summary.fileName,
    typeName: summary.typeName,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    agentCount: run.agentCount,
    waveCount: run.waveCount,
    parallelism: run.parallelism,
    disposition: run.disposition?.outcome ?? null,
    consensus: run.consensus?.agreement ?? null,
    findingCounts: run.findingCounts
  });
  if (runHistory.length > MAX_RETAINED_RUNS) runHistory.length = MAX_RETAINED_RUNS;
}

async function processDocument({ documentId, correlationId, tenantId, jobId }) {
  // Claiming removes the durable job file so a second boot cannot replay a
  // job that is already running. Crash *during* processing still replays —
  // by design (at-least-once) — the document status shows it as processing.
  await claimJob(tenantId ?? currentTenantId(), jobId);
  const scopedLogger = logger.child({ correlationId, documentId });
  const startedAt = Date.now();
  let stages = markStage(newStages(), 'ingest', 'running');

  const initial = await updateDocument(documentId, (record) => ({
    ...record,
    status: DocumentStatus.PROCESSING,
    startedAt: new Date().toISOString(),
    stages
  }));
  emit('progress', { documentId, stage: 'ingest', summary: toSummary(initial) });

  /** @type {Array<object>} */
  const liveSteps = [];

  try {
    const record = getDocument(documentId);
    const buffer = await readUpload(record);

    const result = await runOrchestration({
      record,
      buffer,
      correlationId,
      onStage: async (stage, status, detail, durationMs) => {
        stages = markStage(stages, stage, status, detail, durationMs);
        // Persisting on every stage transition is what makes a mid-flight reload
        // show the same progress the SSE stream is pushing.
        await patch(documentId, { stages });
        emit('progress', { documentId, stage, stageStatus: status, detail: detail ?? null });
      },
      onAgent: (step) => {
        if (step.status !== 'running') {
          liveSteps.push(step);
          agentStepCount += 1;
        }
        emit('agent', {
          documentId,
          runId: step.runId,
          agentId: step.agentId,
          agentName: step.agentName,
          status: step.status,
          wave: step.wave,
          summary: step.summary ?? null,
          confidence: step.confidence ?? null,
          durationMs: step.durationMs ?? null
        });
      }
    });

    const { analysis, classification, type, fields, validation, accuracy, run } = result;
    const { pages, truncated } = limitPages(analysis.pages);
    const durationMs = Date.now() - startedAt;
    const needsReview = result.needsReview;

    const completed = await updateDocument(documentId, (current) => {
      const withAudit = appendAudit(current, {
        actor: 'agent-mesh',
        action: needsReview ? 'routed-to-review' : 'auto-approved',
        detail: `Classified as ${type.name}; ${validation.errorCount} validation error(s); ${
          fields.filter((field) => field.status !== 'accepted').length
        } field(s) below threshold; accuracy ${(accuracy.accuracyScore * 100).toFixed(1)}%.`
      });
      return {
        ...withAudit,
        status: needsReview ? DocumentStatus.NEEDS_REVIEW : DocumentStatus.COMPLETED,
        completedAt: new Date().toISOString(),
        durationMs,
        engine: analysis.engine,
        modelId: analysis.modelId,
        recommendedModel: selectModelForType(classification.typeId),
        fallbackReason: analysis.fallbackReason ?? null,
        pageCount: analysis.pageCount,
        pagesTruncated: truncated,
        classification: {
          typeId: classification.typeId,
          typeName: type.name,
          businessUnit: type.businessUnit,
          process: type.process,
          confidence: classification.confidence,
          evidence: classification.evidence,
          alternatives: classification.alternatives
        },
        fields,
        validation,
        accuracy,
        reconciliation: result.reconciliation ?? null,
        compliance: result.compliance ?? null,
        workflow: result.workflow ?? null,
        agentRun: run,
        azure: {
          engine: analysis.engine,
          modelId: analysis.modelId,
          plannedModelId: analysis.plannedModelId ?? analysis.modelId,
          apiVersion: analysis.apiVersion ?? null,
          addOns: analysis.addOns ?? [],
          queryFields: analysis.queryFields ?? [],
          documentFields: analysis.documentFields ?? [],
          keyValuePairs: (analysis.keyValuePairs ?? []).slice(0, 60),
          barcodes: analysis.barcodes ?? [],
          formulas: (analysis.formulas ?? []).slice(0, 40),
          selectionMarks: (analysis.selectionMarks ?? []).slice(0, 60)
        },
        quality: {
          averageOcrConfidence: analysis.ocr.averageConfidence,
          lowConfidenceLines: analysis.ocr.lowConfidenceLines,
          wordCount: analysis.ocr.wordCount,
          degradedPages: analysis.ocr.degradedPages,
          handwrittenRatio: analysis.handwrittenRatio,
          languages: analysis.languages
        },
        tables: analysis.tables,
        pages,
        fullText: analysis.fullText,
        cost: result.cost,
        stages,
        error: null
      };
    });

    processedCount += 1;
    const summary = toSummary(completed);
    rememberRun(run, summary);
    scopedLogger.info('Document processed.', {
      typeId: classification.typeId,
      pageCount: analysis.pageCount,
      durationMs,
      accuracyScore: accuracy.accuracyScore,
      needsReview
    });
    emit('completed', { documentId, summary, runId: run.id });
  } catch (error) {
    failedCount += 1;
    scopedLogger.error('Document processing failed.', { error });
    const failed = await updateDocument(documentId, (current) => {
      const withAudit = appendAudit(current, {
        actor: 'agent-mesh',
        action: 'failed',
        detail: error.message
      });
      return {
        ...withAudit,
        status: DocumentStatus.FAILED,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        error: {
          message: error.message,
          code: error.code ?? 'PIPELINE_ERROR',
          agentId: error.agentId ?? null
        },
        agentRun: error.agentRun ?? current.agentRun ?? null,
        stages: stages.map((stage) => (stage.status === 'running' ? { ...stage, status: 'failed' } : stage))
      };
    });
    if (error.agentRun) rememberRun(error.agentRun, toSummary(failed));
    emit('failed', { documentId, summary: toSummary(failed) });
  }
}

async function patch(documentId, changes) {
  await updateDocument(documentId, (record) => ({ ...record, ...changes }));
}

export function getPipelineStatus() {
  return {
    queueDepth: queue.length,
    durableBacklog: durableBacklog(currentTenantId()),
    activeWorkers,
    concurrency: config.limits.pipelineConcurrency,
    processedCount,
    failedCount,
    engine: config.analyzer.mode,
    agentStepCount,
    runCount: runHistory.length
  };
}

/**
 * Rolling window of recent agent runs, newest first.
 * @param {number} [limit]
 */
export function listAgentRuns(limit = 40) {
  return runHistory.slice(0, Math.max(1, Math.min(limit, MAX_RETAINED_RUNS)));
}

/**
 * Rebuilds the run history from already-processed records.
 *
 * The history is an in-process rolling window, so a runtime that hydrates
 * documents from a snapshot instead of processing them (the edge build) would
 * otherwise start with an empty orchestration console. The runs replayed here
 * are the genuine ones captured on each record when it was analysed.
 *
 * @param {object[]} records
 * @returns {number} how many runs were restored
 */
export function hydrateRunHistory(records = []) {
  runHistory.length = 0;
  const restorable = records
    .filter((record) => record?.agentRun?.id)
    .sort((a, b) => String(b.agentRun.startedAt ?? '').localeCompare(String(a.agentRun.startedAt ?? '')));

  for (const record of restorable.slice(0, MAX_RETAINED_RUNS).reverse()) {
    rememberRun(record.agentRun, {
      fileName: record.fileName,
      typeName: record.classification?.typeName ?? null
    });
  }
  return runHistory.length;
}

/** Test helper — waits until the queue and all workers are idle. */
export function waitForIdle({ timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (queue.length === 0 && activeWorkers === 0) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Pipeline did not become idle before the timeout.'));
      return setTimeout(check, 50);
    };
    check();
  });
}
