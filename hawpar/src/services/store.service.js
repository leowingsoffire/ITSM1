/**
 * Document repository.
 *
 * Prototype-grade persistence: an in-memory index backed by one JSON file per
 * document on disk. The public surface is intentionally repository-shaped so it
 * can be swapped for Azure Blob Storage + Cosmos DB without touching callers.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { AppError, ErrorCode, notFound } from '../lib/errors.js';
import { atomicWriteFile } from '../lib/atomicWrite.js';
import { logger } from '../lib/logger.js';
import { currentTenantId, DEFAULT_TENANT_ID } from '../lib/tenantContext.js';
import { tenantDataDir, tenantUploadDir } from './tenant.service.js';
import { clearUploads, removeUpload } from './blob.service.js';

export const DocumentStatus = Object.freeze({
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  NEEDS_REVIEW: 'needs-review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  FAILED: 'failed'
});

const MAX_RETAINED_DOCUMENTS = 500;
const DOCUMENTS_DIRECTORY = 'documents';

/** @type {Map<string, Map<string, object>>} documents Map keyed by tenant id */
const documentsByTenant = new Map();
/** @type {Map<string, Map<string, object>>} batches Map keyed by tenant id */
const batchesByTenant = new Map();
/** @type {Set<string>} tenants whose document store has been loaded from disk at least once */
const loadedTenants = new Set();

let writeChain = Promise.resolve();

/** Edge runtimes have no durable file system, so the in-memory index is the store. */
const usesDisk = () => config.persistence === 'file';

/** @returns {Map<string, object>} the current tenant's in-memory document index. */
function documents() {
  const tenantId = currentTenantId();
  let map = documentsByTenant.get(tenantId);
  if (!map) {
    map = new Map();
    documentsByTenant.set(tenantId, map);
  }
  return map;
}

/** @returns {Map<string, object>} the current tenant's in-memory batch index. */
function batches() {
  const tenantId = currentTenantId();
  let map = batchesByTenant.get(tenantId);
  if (!map) {
    map = new Map();
    batchesByTenant.set(tenantId, map);
  }
  return map;
}

function documentsPath(tenantId = currentTenantId()) {
  return path.join(tenantDataDir(tenantId), DOCUMENTS_DIRECTORY);
}

function filePathFor(documentId, tenantId = currentTenantId()) {
  return path.join(documentsPath(tenantId), `${documentId}.json`);
}

async function ensureDirectories(tenantId = currentTenantId()) {
  if (!usesDisk()) return;
  await fs.mkdir(documentsPath(tenantId), { recursive: true });
  await fs.mkdir(tenantUploadDir(tenantId), { recursive: true });
}

/** Serialises writes so concurrent pipeline workers never interleave file writes. */
function queueWrite(task) {
  if (!usesDisk()) return writeChain;
  writeChain = writeChain.then(task).catch((error) => {
    logger.error('Failed to persist document state.', { error });
  });
  return writeChain;
}

async function persist(record, tenantId = currentTenantId()) {
  return queueWrite(async () => {
    await atomicWriteFile(filePathFor(record.id, tenantId), JSON.stringify(record), 'utf8');
  });
}

function evictIfNeeded() {
  const index = documents();
  if (index.size <= MAX_RETAINED_DOCUMENTS) return;
  const sorted = [...index.values()].sort(
    (left, right) => new Date(left.uploadedAt) - new Date(right.uploadedAt)
  );
  const excess = index.size - MAX_RETAINED_DOCUMENTS;
  const tenantId = currentTenantId();
  for (let entryIndex = 0; entryIndex < excess; entryIndex += 1) {
    const victim = sorted[entryIndex];
    index.delete(victim.id);
    queueWrite(() => fs.rm(filePathFor(victim.id, tenantId), { force: true }));
  }
}

/**
 * Loads a tenant's document store from disk into memory on first access
 * within this process — mirrors `initialiseStore()` but per-workspace and
 * lazy, so a tenant created after boot (via onboarding) doesn't need a
 * server restart before its (empty) store is usable.
 */
async function ensureTenantLoaded(tenantId) {
  if (loadedTenants.has(tenantId)) return;
  loadedTenants.add(tenantId);
  if (tenantId === DEFAULT_TENANT_ID) return; // loaded eagerly by initialiseStore()
  await ensureDirectories(tenantId);
  if (!usesDisk()) return;

  let entries = [];
  try {
    entries = await fs.readdir(documentsPath(tenantId));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const index = documents();
  const batchIndex = batches();
  for (const entry of entries.filter((name) => name.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(path.join(documentsPath(tenantId), entry), 'utf8');
      const record = JSON.parse(raw);
      if (!record?.id) continue;
      index.set(record.id, record);
      if (record.batchId) {
        const existing = batchIndex.get(record.batchId) ?? {
          id: record.batchId,
          createdAt: record.uploadedAt ?? new Date().toISOString(),
          documentIds: []
        };
        if (!existing.documentIds.includes(record.id)) existing.documentIds.push(record.id);
        batchIndex.set(record.batchId, existing);
      }
    } catch (error) {
      logger.warn('Skipping unreadable document file.', { entry, error });
    }
  }
}

/**
 * Ensures the current request's tenant document store is loaded. Must be
 * awaited by route handlers before any of the synchronous accessors below on
 * a non-default tenant the first time it's touched in this process.
 */
export async function ensureTenantStoreLoaded() {
  await ensureTenantLoaded(currentTenantId());
  // Late-bound to avoid a store↔pipeline import cycle; recovery is idempotent
  // per boot because `recoverJobs()` resets the pending list first.
  const { recoverPendingJobs } = await import('./pipeline.service.js');
  await recoverPendingJobs();
}

export async function initialiseStore() {
  loadedTenants.add(DEFAULT_TENANT_ID);
  await ensureDirectories(DEFAULT_TENANT_ID);
  let entries = [];
  if (usesDisk()) {
    try {
      entries = await fs.readdir(documentsPath(DEFAULT_TENANT_ID));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const index = documentsByTenant.get(DEFAULT_TENANT_ID) ?? new Map();
  documentsByTenant.set(DEFAULT_TENANT_ID, index);
  const batchIndex = batchesByTenant.get(DEFAULT_TENANT_ID) ?? new Map();
  batchesByTenant.set(DEFAULT_TENANT_ID, batchIndex);

  for (const entry of entries.filter((name) => name.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(path.join(documentsPath(DEFAULT_TENANT_ID), entry), 'utf8');
      const record = JSON.parse(raw);
      if (!record?.id) continue;
      index.set(record.id, record);
      if (record.batchId) {
        const existing = batchIndex.get(record.batchId) ?? {
          id: record.batchId,
          createdAt: record.uploadedAt ?? new Date().toISOString(),
          documentIds: []
        };
        if (!existing.documentIds.includes(record.id)) existing.documentIds.push(record.id);
        batchIndex.set(record.batchId, existing);
      }
    } catch (error) {
      logger.warn('Skipping unreadable document file.', { entry, error });
    }
  }

  logger.info('Document store initialised.', {
    documentCount: index.size,
    persistence: config.persistence,
    dataDir: usesDisk() ? config.dataDir : null
  });
}

/**
 * Loads a pre-built corpus into the store. Used by the edge deployment, where
 * generating the sample pack on every cold start would be prohibitively slow.
 * @param {{ batch?: object, documents?: object[] }} snapshot
 */
export function hydrateStore(snapshot) {
  const records = Array.isArray(snapshot?.documents) ? snapshot.documents : [];
  if (records.length === 0) return { loaded: 0 };

  if (snapshot.batch?.id) batches().set(snapshot.batch.id, { ...snapshot.batch });

  for (const record of records) {
    if (!record?.id) continue;
    documents().set(record.id, record);
    if (record.batchId) registerBatchDocument(record.batchId, record.id, record.uploadedAt);
  }

  logger.info('Document store hydrated from snapshot.', { documentCount: documents().size });
  return { loaded: documents().size };
}

function registerBatchDocument(batchId, documentId, uploadedAt) {
  const batchIndex = batches();
  const existing = batchIndex.get(batchId) ?? {
    id: batchId,
    createdAt: uploadedAt ?? new Date().toISOString(),
    documentIds: []
  };
  if (!existing.documentIds.includes(documentId)) existing.documentIds.push(documentId);
  batchIndex.set(batchId, existing);
}

export function createBatch({ label, submittedBy }) {
  const batch = {
    id: `batch_${randomUUID()}`,
    label: label ?? `Batch ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    submittedBy: submittedBy ?? 'system',
    createdAt: new Date().toISOString(),
    documentIds: []
  };
  batches().set(batch.id, batch);
  return batch;
}

/** @returns {object} newly created document record. */
export async function createDocument(input) {
  const now = new Date().toISOString();
  const record = {
    id: `doc_${randomUUID()}`,
    batchId: input.batchId,
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: input.mimeType,
    checksum: input.checksum,
    storagePath: input.storagePath ?? null,
    status: DocumentStatus.QUEUED,
    uploadedAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    engine: null,
    modelId: null,
    pageCount: null,
    classification: null,
    fields: [],
    validation: null,
    quality: null,
    tables: [],
    pages: [],
    fullText: '',
    cost: null,
    slaSecondsSaved: null,
    error: null,
    audit: [
      {
        at: now,
        actor: input.submittedBy ?? 'system',
        action: 'uploaded',
        detail: `${input.fileName} (${(input.fileSize / 1024).toFixed(1)} KB) queued for analysis.`
      }
    ]
  };

  documents().set(record.id, record);
  registerBatchDocument(record.batchId, record.id, now);
  evictIfNeeded();
  await persist(record);
  return record;
}

export function getDocument(documentId) {
  const record = documents().get(documentId);
  if (!record) throw notFound(`Document ${documentId} was not found.`, { documentId });
  return record;
}

export function tryGetDocument(documentId) {
  return documents().get(documentId) ?? null;
}

export async function updateDocument(documentId, mutate) {
  const record = getDocument(documentId);
  const updated = mutate({ ...record });
  updated.updatedAt = new Date().toISOString();
  documents().set(documentId, updated);
  await persist(updated);
  return updated;
}

export function appendAudit(record, { actor, action, detail }) {
  const audit = [...(record.audit ?? []), { at: new Date().toISOString(), actor, action, detail }];
  return { ...record, audit };
}

export function listBatches() {
  return [...batches().values()]
    .map((batch) => {
      const items = batch.documentIds.map((id) => documents().get(id)).filter(Boolean);
      return {
        ...batch,
        documentCount: items.length,
        completed: items.filter((item) =>
          [DocumentStatus.COMPLETED, DocumentStatus.APPROVED, DocumentStatus.NEEDS_REVIEW].includes(item.status)
        ).length,
        failed: items.filter((item) => item.status === DocumentStatus.FAILED).length,
        pageCount: items.reduce((sum, item) => sum + (item.pageCount ?? 0), 0)
      };
    })
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

/** Lightweight projection used by list views — never returns page/OCR payloads. */
export function toSummary(record) {
  return {
    id: record.id,
    batchId: record.batchId,
    fileName: record.fileName,
    fileSize: record.fileSize,
    mimeType: record.mimeType,
    status: record.status,
    uploadedAt: record.uploadedAt,
    completedAt: record.completedAt,
    durationMs: record.durationMs,
    engine: record.engine,
    pageCount: record.pageCount,
    typeId: record.classification?.typeId ?? null,
    typeName: record.classification?.typeName ?? null,
    businessUnit: record.classification?.businessUnit ?? null,
    process: record.classification?.process ?? null,
    classificationConfidence: record.classification?.confidence ?? null,
    fieldCount: record.fields.length,
    reviewFieldCount: record.fields.filter((field) => field.status !== 'accepted').length,
    averageFieldConfidence: averageFieldConfidence(record.fields),
    validationErrors: record.validation?.errorCount ?? 0,
    validationWarnings: record.validation?.warningCount ?? 0,
    ocrConfidence: record.quality?.averageOcrConfidence ?? null,
    accuracyScore: record.accuracy?.accuracyScore ?? null,
    calibratedConfidence: record.accuracy?.calibratedConfidence ?? null,
    riskLevel: record.accuracy?.riskLevel ?? null,
    straightThrough: record.accuracy?.straightThroughEligible ?? null,
    workflowId: record.workflow?.id ?? null,
    workflowName: record.workflow?.definitionName ?? null,
    workflowStatus: record.workflow?.status ?? null,
    workflowStep: record.workflow?.currentStepName ?? null,
    assignee: record.workflow?.assignee ?? null,
    priority: record.workflow?.priority ?? null,
    slaDueAt: record.workflow?.slaDueAt ?? null,
    agentRunId: record.agentRun?.id ?? null,
    estimatedCostUsd: record.cost?.modelledUsd ?? record.cost?.estimatedUsd ?? null,
    error: record.error
  };
}

export function averageFieldConfidence(fields) {
  const scored = fields.filter((field) => field.confidence > 0);
  if (scored.length === 0) return null;
  return Number((scored.reduce((sum, field) => sum + field.confidence, 0) / scored.length).toFixed(4));
}

/**
 * Filtered, paginated document listing.
 * @param {object} query
 */
export function listDocuments(query = {}) {
  const {
    status,
    typeId,
    businessUnit,
    batchId,
    search,
    page = 1,
    pageSize = 25,
    sort = 'uploadedAt:desc'
  } = query;

  const needle = String(search ?? '').trim().toLowerCase();
  let items = [...documents().values()];

  if (status) items = items.filter((item) => item.status === status);
  if (typeId) items = items.filter((item) => item.classification?.typeId === typeId);
  if (businessUnit) items = items.filter((item) => item.classification?.businessUnit === businessUnit);
  if (batchId) items = items.filter((item) => item.batchId === batchId);
  if (needle) {
    items = items.filter(
      (item) =>
        item.fileName.toLowerCase().includes(needle) ||
        (item.classification?.typeName ?? '').toLowerCase().includes(needle) ||
        item.fields.some((field) => String(field.rawValue ?? '').toLowerCase().includes(needle))
    );
  }

  const [sortField, sortDirection] = String(sort).split(':');
  const direction = sortDirection === 'asc' ? 1 : -1;
  items.sort((left, right) => {
    const leftValue = left[sortField] ?? '';
    const rightValue = right[sortField] ?? '';
    if (leftValue === rightValue) return 0;
    return leftValue > rightValue ? direction : -direction;
  });

  const safePageSize = Math.min(200, Math.max(1, Number(pageSize) || 25));
  const safePage = Math.max(1, Number(page) || 1);
  const start = (safePage - 1) * safePageSize;

  return {
    total: items.length,
    page: safePage,
    pageSize: safePageSize,
    items: items.slice(start, start + safePageSize).map(toSummary)
  };
}

export function listAllDocuments() {
  return [...documents().values()];
}

/**
 * Full-text search across processed documents.
 * @param {string} term
 * @param {number} limit
 */
export function searchFullText(term, limit = 40) {
  const needle = String(term ?? '').trim().toLowerCase();
  if (needle.length < 2) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Search term must be at least 2 characters.',
      status: 400
    });
  }

  const results = [];
  for (const record of documents().values()) {
    if (!record.fullText) continue;
    const haystack = record.fullText.toLowerCase();
    let index = haystack.indexOf(needle);
    if (index < 0) continue;

    const hits = [];
    let occurrences = 0;
    while (index >= 0 && hits.length < 5) {
      occurrences += 1;
      const start = Math.max(0, index - 70);
      const end = Math.min(record.fullText.length, index + needle.length + 70);
      hits.push({
        snippet: record.fullText.slice(start, end).replace(/\s+/g, ' ').trim(),
        pageNumber: pageForOffset(record, index)
      });
      index = haystack.indexOf(needle, index + needle.length);
    }
    while (index >= 0) {
      occurrences += 1;
      index = haystack.indexOf(needle, index + needle.length);
    }

    results.push({
      documentId: record.id,
      fileName: record.fileName,
      typeName: record.classification?.typeName ?? 'Unclassified',
      businessUnit: record.classification?.businessUnit ?? null,
      pageCount: record.pageCount,
      occurrences,
      hits
    });
  }

  results.sort((left, right) => right.occurrences - left.occurrences);
  return { term, total: results.length, results: results.slice(0, limit) };
}

function pageForOffset(record, offset) {
  let cursor = 0;
  for (const page of record.pages ?? []) {
    const pageLength = page.lines.reduce((sum, line) => sum + line.content.length + 1, 0);
    if (offset < cursor + pageLength) return page.pageNumber;
    cursor += pageLength;
  }
  return 1;
}

export async function deleteDocument(documentId) {
  const record = getDocument(documentId);
  documents().delete(documentId);
  const batch = batches().get(record.batchId);
  if (batch) batch.documentIds = batch.documentIds.filter((id) => id !== documentId);
  await queueWrite(() => fs.rm(filePathFor(documentId), { force: true }));
  await removeUpload(record.storagePath);
  return { id: documentId, deleted: true };
}

export async function clearAll() {
  const index = documents();
  const ids = [...index.keys()];
  index.clear();
  batches().clear();
  clearUploads();
  await queueWrite(async () => {
    await Promise.all(ids.map((id) => fs.rm(filePathFor(id), { force: true })));
  });
  return { deleted: ids.length };
}

export async function flushPendingWrites() {
  await writeChain;
}
