/**
 * Intelligence API: the agent mesh, workflow engine, accuracy assurance and the
 * Azure Document Intelligence console.
 */
import express from 'express';
import { AGENTS, agentTopology, executionWaves, getAgent } from '../domain/agents.js';
import { WORKFLOW_DEFINITIONS, WORKFLOW_ROLES } from '../domain/workflows.js';
import { AZURE_ADD_ONS, AZURE_MODELS } from '../domain/azureModels.js';
import { badRequest, notFound } from '../lib/errors.js';
import { benchmarkCorpus, buildCalibration } from '../services/accuracy.service.js';
import { integrationProfile, modelCatalogue, probeService } from '../services/azure.service.js';
import { listAgentRuns } from '../services/pipeline.service.js';
import { auditRequest } from '../services/activity.service.js';
import { DocumentStatus, ensureTenantStoreLoaded, getDocument, listAllDocuments } from '../services/store.service.js';
import { dispatchDocumentEvent } from '../services/webhooks.service.js';
import {
  applyWorkflowAction,
  getWorkflow,
  listWorkflows,
  workflowOverview
} from '../services/workflow.service.js';
import { asyncHandler } from './asyncHandler.js';

const router = express.Router();

router.use(asyncHandler(async (request, response, next) => {
  await ensureTenantStoreLoaded();
  next();
}));

/* ── Agent mesh ──────────────────────────────────────────────────────────── */

router.get('/agents', (request, response) => {
  const waves = executionWaves();
  response.json({
    total: AGENTS.length,
    waveCount: waves.length,
    parallelism: Number((AGENTS.length / waves.length).toFixed(2)),
    agents: AGENTS,
    waves: waves.map((wave, index) => ({ index: index + 1, agentIds: wave })),
    topology: agentTopology()
  });
});

router.get('/agents/topology', (request, response) => {
  response.json(agentTopology());
});

router.get('/agents/runs', (request, response) => {
  const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 40));
  const runs = listAgentRuns(limit);
  const durations = runs.map((run) => run.durationMs).filter((value) => Number.isFinite(value));
  response.json({
    total: runs.length,
    averageDurationMs:
      durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    straightThroughCount: runs.filter((run) => run.disposition === 'straight-through').length,
    failedCount: runs.filter((run) => run.status === 'failed').length,
    items: runs
  });
});

router.get(
  '/agents/:agentId',
  asyncHandler(async (request, response) => {
    const agent = getAgent(request.params.agentId);
    if (!agent) throw notFound(`Unknown agent "${request.params.agentId}".`);

    // Recent evidence for this specific agent, drawn from persisted runs.
    const recent = listAllDocuments()
      .filter((record) => record.agentRun)
      .slice(0, 40)
      .flatMap((record) =>
        (record.agentRun.steps ?? [])
          .filter((step) => step.agentId === agent.id)
          .map((step) => ({
            documentId: record.id,
            fileName: record.fileName,
            typeName: record.classification?.typeName ?? 'Unclassified',
            at: step.startedAt,
            status: step.status,
            durationMs: step.durationMs,
            confidence: step.confidence,
            summary: step.summary,
            findings: step.findings
          }))
      )
      .slice(0, 25);

    const confidences = recent.map((entry) => entry.confidence).filter((value) => Number.isFinite(value));

    response.json({
      agent,
      dependents: AGENTS.filter((candidate) => candidate.dependsOn.includes(agent.id)).map((candidate) => candidate.id),
      executions: recent.length,
      averageConfidence:
        confidences.length > 0
          ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(4))
          : null,
      recent
    });
  })
);

router.get(
  '/documents/:id/agent-run',
  asyncHandler(async (request, response) => {
    const record = getDocument(request.params.id);
    if (!record.agentRun) throw notFound(`Document ${request.params.id} has no agent run yet.`);
    response.json({
      documentId: record.id,
      fileName: record.fileName,
      typeName: record.classification?.typeName ?? 'Unclassified',
      run: record.agentRun
    });
  })
);

/* ── Workflows ───────────────────────────────────────────────────────────── */

router.get('/workflows/definitions', (request, response) => {
  response.json({
    total: WORKFLOW_DEFINITIONS.length,
    roles: WORKFLOW_ROLES,
    items: WORKFLOW_DEFINITIONS
  });
});

router.get('/workflows/overview', (request, response) => {
  response.json(workflowOverview());
});

router.get(
  '/workflows',
  asyncHandler(async (request, response) => {
    response.json(
      listWorkflows({
        status: request.query.status,
        definitionId: request.query.definitionId,
        priority: request.query.priority,
        assignee: request.query.assignee,
        slaState: request.query.slaState,
        search: request.query.search,
        sort: request.query.sort,
        page: request.query.page,
        pageSize: request.query.pageSize
      })
    );
  })
);

router.get(
  '/workflows/:documentId',
  asyncHandler(async (request, response) => {
    response.json(getWorkflow(request.params.documentId));
  })
);

router.post(
  '/workflows/:documentId/actions',
  asyncHandler(async (request, response) => {
    const body = request.body ?? {};
    if (!body.action) throw badRequest('"action" is required.');
    const before = getDocument(request.params.documentId).status;
    // The actor is the authenticated principal, never a client-supplied field.
    const result = await applyWorkflowAction(request.params.documentId, {
      action: body.action,
      actor: request.actor,
      note: body.note,
      assignee: body.assignee
    });
    const action = String(body.action).toLowerCase();
    auditRequest(request, `workflow.${action}`, {
      target: `${result.workflow.definitionName ?? 'Workflow'} (${request.params.documentId})`,
      detail: [body.note, body.assignee ? `Assignee: ${body.assignee}` : null].filter(Boolean).join(' · ') || null
    });
    if (result.documentStatus !== before && [DocumentStatus.APPROVED, DocumentStatus.REJECTED].includes(result.documentStatus)) {
      dispatchDocumentEvent(
        request.tenantId,
        result.documentStatus === DocumentStatus.APPROVED ? 'document.approved' : 'document.rejected',
        request.params.documentId
      );
    }
    response.json(result);
  })
);

/* ── Accuracy assurance ──────────────────────────────────────────────────── */

router.get('/accuracy/benchmark', (request, response) => {
  response.json(benchmarkCorpus(listAllDocuments()));
});

router.get('/accuracy/calibration', (request, response) => {
  response.json(buildCalibration(listAllDocuments()));
});

router.get(
  '/documents/:id/accuracy',
  asyncHandler(async (request, response) => {
    const record = getDocument(request.params.id);
    if (!record.accuracy) throw notFound(`Document ${request.params.id} has not been scored for accuracy yet.`);
    response.json({
      documentId: record.id,
      fileName: record.fileName,
      typeName: record.classification?.typeName ?? 'Unclassified',
      accuracy: record.accuracy,
      reconciliation: record.reconciliation ?? null,
      compliance: record.compliance ?? null
    });
  })
);

/* ── Azure Document Intelligence console ─────────────────────────────────── */

router.get('/azure/profile', (request, response) => {
  response.json(integrationProfile());
});

router.get('/azure/models', (request, response) => {
  response.json(modelCatalogue());
});

router.get(
  '/azure/status',
  asyncHandler(async (request, response) => {
    const force = String(request.query.refresh ?? '') === 'true';
    const probe = await probeService({ force });
    response.json({
      profile: integrationProfile(),
      probe,
      modelCount: AZURE_MODELS.length,
      addOnCount: AZURE_ADD_ONS.length
    });
  })
);

export default router;
