/**
 * Platform API: health, capability discovery, analytics, search, samples,
 * cost modelling, exports and the live event stream.
 */
import express from 'express';
import { ALLOWED_EXTENSIONS, config } from '../config/index.js';
import { DOCUMENT_TYPES, RULE_CATALOGUE } from '../domain/documentTypes.js';
import { badRequest } from '../lib/errors.js';
import { buildDashboard, buildReviewQueue } from '../services/analytics.service.js';
import { PRICE_BOOK, REFERENCE_PROFILE, projectMonthlyCost } from '../services/cost.service.js';
import {
  REQUIREMENTS,
  exportCorpusCsv,
  exportCorpusWorkbook,
  exportRequirementsWorkbook,
  exportClaimsWorkbook,
  exportClaimWorkbook
} from '../services/export.service.js';
import { ingestDocument } from '../services/ingestion.service.js';
import { getPipelineStatus, pipelineEvents } from '../services/pipeline.service.js';
import { SAMPLE_LIBRARY, generateSamplePdf, getSample } from '../services/sample.service.js';
import { clearAll, createBatch, ensureTenantStoreLoaded, searchFullText, toSummary } from '../services/store.service.js';
import { listClaims, getClaim, claimsOverview } from '../services/claims.service.js';
import { ensureTenantSettingsLoaded, getSettingsRaw } from '../services/settings.service.js';
import { asyncHandler } from './asyncHandler.js';

const router = express.Router();

router.use(asyncHandler(async (request, response, next) => {
  await Promise.all([ensureTenantStoreLoaded(), ensureTenantSettingsLoaded()]);
  next();
}));

const HEARTBEAT_INTERVAL_MS = 20000;
const MAX_SAMPLES_PER_REQUEST = 12;

router.get('/health', (request, response) => {
  response.json({
    status: 'healthy',
    version: '1.0.0',
    engine: config.analyzer.mode,
    uptimeSeconds: Math.round(process.uptime()),
    pipeline: getPipelineStatus(),
    timestamp: new Date().toISOString()
  });
});

/** Capability discovery consumed by the SPA on boot. */
router.get('/config', (request, response) => {
  const settings = getSettingsRaw();
  response.json({
    application: {
      name: settings.branding.appName,
      customer: settings.company.name,
      version: '1.0.0',
      environment: config.env,
      logoDataUrl: settings.branding.logoDataUrl
    },
    analyzer: {
      mode: config.analyzer.mode,
      modelId: config.analyzer.mode === 'azure' ? config.analyzer.modelId : 'demo-layout-v1',
      apiVersion: config.analyzer.mode === 'azure' ? config.analyzer.apiVersion : 'local',
      endpointConfigured: Boolean(config.analyzer.endpoint),
      authentication: config.analyzer.apiKey
        ? 'resource-key'
        : config.analyzer.useManagedIdentity
          ? 'managed-identity'
          : 'none'
    },
    limits: {
      maxUploadMb: config.limits.maxUploadMb,
      maxPagesPerDocument: config.limits.maxPagesPerDocument,
      maxFilesPerRequest: config.limits.maxFilesPerRequest,
      pipelineConcurrency: config.limits.pipelineConcurrency,
      allowedExtensions: ALLOWED_EXTENSIONS
    },
    quality: { reviewConfidenceThreshold: config.quality.reviewConfidenceThreshold },
    cost: (() => {
      // The signed-off run-rate, surfaced on first paint so the shell can show
      // the budget without waiting for the Cost & Value screen to be opened.
      const projection = projectMonthlyCost();
      return {
        budgetSgd: projection.budgetSgd,
        totalMonthlySgd: projection.totalMonthlySgd,
        totalMonthlyUsd: projection.totalMonthlyUsd,
        budgetVarianceSgd: projection.budgetVarianceSgd,
        budgetVariancePercent: projection.budgetVariancePercent,
        withinBudget: projection.withinBudget,
        annualSgd: projection.annualSgd,
        costPerDocumentSgd: projection.costPerDocumentSgd,
        region: projection.region
      };
    })(),
    documentTypes: DOCUMENT_TYPES.filter((type) => type.id !== 'unclassified').map((type) => ({
      id: type.id,
      name: type.name,
      businessUnit: type.businessUnit,
      process: type.process,
      icon: type.icon,
      fieldCount: type.fields.length,
      ruleCount: type.rules.length,
      typicalPages: type.typicalPages
    })),
    rules: RULE_CATALOGUE,
    samples: SAMPLE_LIBRARY
  });
});

router.get('/pipeline/status', (request, response) => {
  response.json(getPipelineStatus());
});

router.get(
  '/analytics/dashboard',
  asyncHandler(async (request, response) => {
    response.json(buildDashboard());
  })
);

router.get(
  '/analytics/review-queue',
  asyncHandler(async (request, response) => {
    const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
    response.json(buildReviewQueue({ limit }));
  })
);

router.get(
  '/search',
  asyncHandler(async (request, response) => {
    response.json(searchFullText(request.query.q));
  })
);

router.get('/requirements', (request, response) => {
  response.json({
    total: REQUIREMENTS.length,
    items: REQUIREMENTS.map((requirement, index) => ({
      ref: `REQ-${String(index + 1).padStart(3, '0')}`,
      ...requirement
    }))
  });
});

router.get('/cost/pricebook', (request, response) => {
  response.json(PRICE_BOOK);
});

router.post(
  '/cost/estimate',
  asyncHandler(async (request, response) => {
    const body = request.body ?? {};
    const numeric = (key, fallback, max) => {
      if (body[key] === undefined) return fallback;
      const value = Number(body[key]);
      if (!Number.isFinite(value) || value < 0 || value > max) {
        throw badRequest(`"${key}" must be a number between 0 and ${max}.`);
      }
      return value;
    };

    // Anything the caller omits falls back to the signed-off reference profile,
    // so an empty body returns the agreed monthly run-rate.
    response.json(
      projectMonthlyCost({
        documentsPerMonth: numeric('documentsPerMonth', REFERENCE_PROFILE.documentsPerMonth, 5000000),
        averagePages: numeric('averagePages', REFERENCE_PROFILE.averagePages, 2000),
        appServiceSku: Object.keys(PRICE_BOOK.appService).includes(body.appServiceSku)
          ? body.appServiceSku
          : REFERENCE_PROFILE.appServiceSku,
        appServiceInstances: numeric('appServiceInstances', REFERENCE_PROFILE.appServiceInstances, 20),
        storageGb: numeric('storageGb', REFERENCE_PROFILE.storageGb, 100000),
        logGb: numeric('logGb', REFERENCE_PROFILE.logGb, 10000),
        privateEndpoints: numeric('privateEndpoints', REFERENCE_PROFILE.privateEndpoints, 30),
        adaptiveRouting: body.adaptiveRouting !== false,
        layoutSharePercent: numeric('layoutSharePercent', REFERENCE_PROFILE.layoutSharePercent, 100)
      })
    );
  })
);

router.get('/samples', (request, response) => {
  response.json({ items: SAMPLE_LIBRARY });
});

/** POST /api/samples/run — generate real PDFs and push them through ingestion. */
router.post(
  '/samples/run',
  asyncHandler(async (request, response) => {
    const requested = Array.isArray(request.body?.sampleIds) ? request.body.sampleIds : [];
    const selected = requested.length > 0
      ? requested.slice(0, MAX_SAMPLES_PER_REQUEST).map(getSample).filter(Boolean)
      : SAMPLE_LIBRARY;

    if (selected.length === 0) throw badRequest('No valid sample identifiers were supplied.');

    const batch = createBatch({ label: 'VGC sample document pack', submittedBy: 'demo.user@vgc.com' });
    const accepted = [];

    for (const sample of selected) {
      const seed = `${sample.id}:${request.body?.seed ?? 'vgc-demo'}`;
      const { buffer, mimeType } = await generateSamplePdf(sample.typeId, seed);
      const record = await ingestDocument({
        buffer,
        fileName: sample.fileName,
        mimeType,
        batchId: batch.id,
        correlationId: request.correlationId,
        submittedBy: 'demo.user@vgc.com'
      });
      accepted.push(toSummary(record));
    }

    response.status(202).json({
      batchId: batch.id,
      batchLabel: batch.label,
      acceptedCount: accepted.length,
      rejectedCount: 0,
      accepted,
      rejected: []
    });
  })
);

/** GET /api/samples/:id/download — download the generated PDF itself. */
router.get(
  '/samples/:id/download',
  asyncHandler(async (request, response) => {
    const sample = getSample(request.params.id);
    if (!sample) throw badRequest(`Unknown sample "${request.params.id}".`);
    const { buffer } = await generateSamplePdf(sample.typeId, `${sample.id}:vgc-demo`);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${sample.fileName}"`);
    response.send(buffer);
  })
);

router.get(
  '/export/documents.xlsx',
  asyncHandler(async (request, response) => {
    const { buffer, fileName, contentType } = exportCorpusWorkbook();
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(buffer);
  })
);

router.get(
  '/export/fields.csv',
  asyncHandler(async (request, response) => {
    const { body, fileName, contentType } = exportCorpusCsv();
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(body);
  })
);

router.get(
  '/export/requirements.xlsx',
  asyncHandler(async (request, response) => {
    const { buffer, fileName, contentType } = exportRequirementsWorkbook();
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(buffer);
  })
);

// ── Marketing (A&P) claim reconciliation ────────────────────────────────────
router.get(
  '/claims',
  asyncHandler(async (request, response) => {
    response.json({ overview: claimsOverview(), items: listClaims() });
  })
);

router.get(
  '/claims/export.xlsx',
  asyncHandler(async (request, response) => {
    const { buffer, fileName, contentType } = exportClaimsWorkbook();
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(buffer);
  })
);

router.get(
  '/claims/:id/export.xlsx',
  asyncHandler(async (request, response) => {
    const result = exportClaimWorkbook(request.params.id);
    if (!result) {
      response.status(404).json({ error: 'Claim not found' });
      return;
    }
    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    response.send(result.buffer);
  })
);

router.get(
  '/claims/:id',
  asyncHandler(async (request, response) => {
    const claim = getClaim(request.params.id);
    if (!claim) {
      response.status(404).json({ error: 'Claim not found' });
      return;
    }
    response.json(claim);
  })
);

router.delete(
  '/admin/reset',
  asyncHandler(async (request, response) => {
    response.json(await clearAll());
  })
);

/** GET /api/events — server-sent events for live pipeline progress. */
router.get('/events', (request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  response.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

  const onEvent = (payload) => {
    response.write(`event: pipeline\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  pipelineEvents.on('event', onEvent);

  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), HEARTBEAT_INTERVAL_MS);

  request.on('close', () => {
    clearInterval(heartbeat);
    pipelineEvents.off('event', onEvent);
    response.end();
  });
});

export default router;
