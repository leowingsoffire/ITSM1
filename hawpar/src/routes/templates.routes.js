/**
 * Template Studio API: train a custom zonal extraction template from a
 * sample document, optionally paired with the customer's own Excel layout,
 * then run it against new documents and export a workbook that matches that
 * layout exactly.
 */
import express from 'express';
import multer from 'multer';
import { config } from '../config/index.js';
import { badRequest } from '../lib/errors.js';
import { readXlsxTemplate } from '../lib/xlsxReader.js';
import { rateLimit } from '../middleware/index.js';
import { analyzeDocument } from '../services/analyzers/index.js';
import { exportTemplateRunWorkbook } from '../services/export.service.js';
import { currentTenantId, runWithTenant } from '../lib/tenantContext.js';
import {
  cachePreview,
  createRun,
  createTemplate,
  deleteTemplate,
  ensureTemplateStoreLoaded,
  extractTemplateFields,
  getPreview,
  getRun,
  getTemplate,
  listRuns,
  listTemplates,
  updateTemplate
} from '../services/templates.service.js';
import { MAX_RUN_FILES_PER_REQUEST } from '../domain/customTemplates.js';
import { asyncHandler } from './asyncHandler.js';

const router = express.Router();

router.use(asyncHandler(async (request, response, next) => {
  await ensureTemplateStoreLoaded();
  next();
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.maxUploadBytes, files: MAX_RUN_FILES_PER_REQUEST, fields: 20 }
});

/**
 * Multer's busboy-based multipart parsing consumes the request as a stream,
 * which can lose Node's AsyncLocalStorage continuation by the time its
 * callback fires (a known stream/ALS interaction quirk). `request.tenantId`
 * was set synchronously by the tenant middleware before any of that stream
 * processing began, so it is always correct — re-enter the tenant context
 * from it here so every multer route can keep relying on `currentTenantId()`
 * deeper in the service layer.
 */
function reaffirmTenantContext(request, response, next) {
  runWithTenant(request.tenantId, next);
}

function templateSummary(template) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    sourceFileName: template.sourceFileName,
    pageCount: template.pageCount,
    fieldCount: template.regions.length,
    hasExcelTemplate: Boolean(template.excelTemplate),
    runCount: template.runCount ?? 0,
    lastRunAt: template.lastRunAt,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

/** POST /api/templates/preview — analyze an uploaded sample so the customer can draw regions on it. */
router.post(
  '/preview',
  rateLimit('upload'),
  upload.single('file'),
  reaffirmTenantContext,
  asyncHandler(async (request, response) => {
    if (!request.file) throw badRequest('Attach a sample document using the "file" field.');

    const analysis = await analyzeDocument({
      buffer: request.file.buffer,
      fileName: request.file.originalname,
      contentType: request.file.mimetype,
      correlationId: request.correlationId
    });

    const preview = cachePreview({
      tenantId: currentTenantId(),
      fileName: request.file.originalname,
      mimeType: request.file.mimetype,
      analysis
    });

    response.status(201).json(preview);
  })
);

/** GET /api/templates/preview/:previewId — re-fetch cached OCR while the wizard tab stays open. */
router.get(
  '/preview/:previewId',
  asyncHandler(async (request, response) => {
    response.json(getPreview(request.params.previewId, currentTenantId()));
  })
);

/** POST /api/templates/excel-template — parse a customer's Excel layout into mappable columns. */
router.post(
  '/excel-template',
  rateLimit('upload'),
  upload.single('file'),
  reaffirmTenantContext,
  asyncHandler(async (request, response) => {
    if (!request.file) throw badRequest('Attach an Excel file using the "file" field.');
    if (!/\.xlsx$/i.test(request.file.originalname)) {
      throw badRequest('The requirement/format template must be an .xlsx file.');
    }

    const parsed = readXlsxTemplate(request.file.buffer);
    response.status(201).json({ fileName: request.file.originalname, ...parsed });
  })
);

/** POST /api/templates — save a trained template. */
router.post(
  '/',
  asyncHandler(async (request, response) => {
    const template = createTemplate({
      name: request.body?.name,
      description: request.body?.description,
      previewId: request.body?.previewId,
      regions: request.body?.regions,
      excelTemplate: request.body?.excelTemplate ?? null
    });
    response.status(201).json(template);
  })
);

/** GET /api/templates — list templates for the current workspace. */
router.get(
  '/',
  asyncHandler(async (request, response) => {
    response.json({ items: listTemplates().map(templateSummary) });
  })
);

/** GET /api/templates/:id — full template (regions + excel mapping). */
router.get(
  '/:id',
  asyncHandler(async (request, response) => {
    response.json(getTemplate(request.params.id));
  })
);

/** PATCH /api/templates/:id — edit regions / mapping / metadata. */
router.patch(
  '/:id',
  asyncHandler(async (request, response) => {
    const updated = updateTemplate(request.params.id, {
      name: request.body?.name,
      description: request.body?.description,
      regions: request.body?.regions,
      excelTemplate: request.body?.excelTemplate
    });
    response.json(updated);
  })
);

/** DELETE /api/templates/:id */
router.delete(
  '/:id',
  asyncHandler(async (request, response) => {
    response.json(await deleteTemplate(request.params.id));
  })
);

/** POST /api/templates/:id/run — apply the template to one or more new documents. */
router.post(
  '/:id/run',
  rateLimit('upload'),
  upload.array('files', MAX_RUN_FILES_PER_REQUEST),
  reaffirmTenantContext,
  asyncHandler(async (request, response) => {
    const template = getTemplate(request.params.id);
    const files = request.files ?? [];
    if (files.length === 0) throw badRequest('Attach at least one document using the "files" field.');

    const documents = [];
    for (const file of files) {
      const analysis = await analyzeDocument({
        buffer: file.buffer,
        fileName: file.originalname,
        contentType: file.mimetype,
        correlationId: request.correlationId
      });
      const fields = extractTemplateFields(template, analysis);
      documents.push({
        fileName: file.originalname,
        mimeType: file.mimetype,
        pageCount: analysis.pages?.length ?? 0,
        engine: analysis.engine,
        processedAt: new Date().toISOString(),
        fields
      });
    }

    const run = createRun({ templateId: template.id, documents });
    response.status(201).json(run);
  })
);

/** GET /api/templates/:id/runs — run history. */
router.get(
  '/:id/runs',
  asyncHandler(async (request, response) => {
    getTemplate(request.params.id); // 404s if the template doesn't exist
    response.json({
      items: listRuns(request.params.id).map((run) => ({
        id: run.id,
        createdAt: run.createdAt,
        documentCount: run.documents.length
      }))
    });
  })
);

/** GET /api/templates/:id/runs/:runId — full run detail (per-document field values). */
router.get(
  '/:id/runs/:runId',
  asyncHandler(async (request, response) => {
    getTemplate(request.params.id);
    response.json(getRun(request.params.runId));
  })
);

/** GET /api/templates/:id/runs/:runId/export.xlsx — workbook matching the customer's Excel template. */
router.get(
  '/:id/runs/:runId/export.xlsx',
  asyncHandler(async (request, response) => {
    const template = getTemplate(request.params.id);
    const run = getRun(request.params.runId);
    const { buffer, fileName, contentType } = exportTemplateRunWorkbook(template, run);
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(buffer);
  })
);

export default router;
