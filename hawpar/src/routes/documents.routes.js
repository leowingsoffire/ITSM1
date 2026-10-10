/**
 * Document lifecycle API: upload, inspect, correct, decide, export and delete.
 */
import express from 'express';
import multer from 'multer';
import { config } from '../config/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { bindTenantContext, rateLimit } from '../middleware/index.js';
import { auditRequest } from '../services/activity.service.js';
import { applyManualCorrection } from '../services/extraction.service.js';
import { exportDocumentWorkbook } from '../services/export.service.js';
import { ingestDocument } from '../services/ingestion.service.js';
import { recordCorrection } from '../services/learning.service.js';
import { validateDocument } from '../services/validation.service.js';
import { dispatchDocumentEvent, dispatchEvent } from '../services/webhooks.service.js';
import {
  DocumentStatus,
  appendAudit,
  createBatch,
  deleteDocument,
  ensureTenantStoreLoaded,
  getDocument,
  listBatches,
  listDocuments,
  toSummary,
  updateDocument
} from '../services/store.service.js';
import { asyncHandler } from './asyncHandler.js';

const router = express.Router();

router.use(asyncHandler(async (request, response, next) => {
  await ensureTenantStoreLoaded();
  next();
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.limits.maxUploadBytes,
    files: config.limits.maxFilesPerRequest,
    fields: 10,
    parts: config.limits.maxFilesPerRequest + 10
  }
});

const DECISIONS = Object.freeze({
  approve: DocumentStatus.APPROVED,
  reject: DocumentStatus.REJECTED
});

const MAX_VALUE_LENGTH = 500;

/**
 * Who is acting: always the authenticated principal resolved by the auth
 * middleware, never a client-supplied field, so the audit trail cannot be
 * forged by editing a request body.
 */
function readActor(request) {
  return request.actor ?? 'system';
}

/** POST /api/documents — multi-file upload. */
router.post(
  '/',
  rateLimit('upload'),
  upload.array('files', config.limits.maxFilesPerRequest),
  bindTenantContext,
  asyncHandler(async (request, response) => {
    const files = request.files ?? [];
    if (files.length === 0) {
      throw badRequest('No files were supplied. Attach at least one file using the "files" field.');
    }

    const batch = createBatch({
      label: typeof request.body?.label === 'string' ? request.body.label.slice(0, 120) : undefined,
      submittedBy: readActor(request)
    });

    const accepted = [];
    const rejected = [];

    for (const file of files) {
      try {
        const record = await ingestDocument({
          buffer: file.buffer,
          fileName: file.originalname,
          mimeType: file.mimetype,
          batchId: batch.id,
          correlationId: request.correlationId,
          submittedBy: batch.submittedBy
        });
        accepted.push(toSummary(record));
      } catch (error) {
        rejected.push({
          fileName: file.originalname,
          code: error.code ?? 'VALIDATION_FAILED',
          message: error.message
        });
      }
    }

    if (accepted.length === 0) {
      return response.status(400).json({
        error: { code: 'VALIDATION_FAILED', message: 'Every file was rejected.', rejected }
      });
    }

    auditRequest(request, 'document.uploaded', {
      target: batch.id,
      detail: `Uploaded ${accepted.length} file(s)${rejected.length ? `; ${rejected.length} rejected` : ''}: ${accepted.map((item) => item.fileName).join(', ')}`
    });

    return response.status(202).json({
      batchId: batch.id,
      batchLabel: batch.label,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      accepted,
      rejected
    });
  })
);

/** GET /api/documents — filtered listing. */
router.get(
  '/',
  asyncHandler(async (request, response) => {
    response.json(
      listDocuments({
        status: request.query.status,
        typeId: request.query.typeId,
        businessUnit: request.query.businessUnit,
        batchId: request.query.batchId,
        search: request.query.q,
        page: request.query.page,
        pageSize: request.query.pageSize,
        sort: request.query.sort
      })
    );
  })
);

/** GET /api/documents/batches — batch roll-up. */
router.get(
  '/batches',
  asyncHandler(async (request, response) => {
    response.json({ items: listBatches() });
  })
);

/** GET /api/documents/:id — full record without the heavy page payload. */
router.get(
  '/:id',
  asyncHandler(async (request, response) => {
    const record = getDocument(request.params.id);
    const { pages, fullText, ...rest } = record;
    response.json({
      ...rest,
      summary: toSummary(record),
      textLength: fullText.length,
      pageIndex: pages.map((page) => ({
        pageNumber: page.pageNumber,
        lineCount: page.lines.length,
        quality: page.quality,
        angle: page.angle
      }))
    });
  })
);

/** GET /api/documents/:id/pages/:pageNumber — OCR overlay data for the viewer. */
router.get(
  '/:id/pages/:pageNumber',
  asyncHandler(async (request, response) => {
    const record = getDocument(request.params.id);
    const pageNumber = Number(request.params.pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw badRequest('Page number must be a positive integer.');
    }
    const page = record.pages.find((candidate) => candidate.pageNumber === pageNumber);
    if (!page) throw notFound(`Page ${pageNumber} is not available for this document.`);

    response.json({
      documentId: record.id,
      fileName: record.fileName,
      pageCount: record.pageCount,
      page,
      fieldAnchors: record.fields
        .filter((field) => field.pageNumber === pageNumber && field.box)
        .map((field) => ({ key: field.key, label: field.label, box: field.box, status: field.status })),
      tables: record.tables.filter((table) => table.pageNumber === pageNumber)
    });
  })
);

/** PATCH /api/documents/:id/fields/:fieldKey — human correction (also teaches the self-learning memory). */
router.patch(
  '/:id/fields/:fieldKey',
  asyncHandler(async (request, response) => {
    const record = getDocument(request.params.id);
    const field = record.fields.find((candidate) => candidate.key === request.params.fieldKey);
    if (!field) throw notFound(`Field "${request.params.fieldKey}" is not part of this document.`);

    const rawValue = request.body?.value;
    if (rawValue !== null && typeof rawValue !== 'string' && typeof rawValue !== 'number') {
      throw badRequest('"value" must be a string, number or null.');
    }
    if (typeof rawValue === 'string' && rawValue.length > MAX_VALUE_LENGTH) {
      throw badRequest(`"value" must be ${MAX_VALUE_LENGTH} characters or fewer.`);
    }

    const actor = readActor(request);
    const corrected = applyManualCorrection(field, rawValue);

    const updated = await updateDocument(record.id, (current) => {
      const fields = current.fields.map((candidate) => (candidate.key === corrected.key ? corrected : candidate));
      const validation = validateDocument({
        typeId: current.classification?.typeId ?? 'unclassified',
        fields,
        analysis: { tables: current.tables, pages: current.pages, fullText: current.fullText }
      });
      const withAudit = appendAudit(current, {
        actor,
        action: 'field-corrected',
        detail: `${field.label}: "${field.rawValue ?? '(empty)'}" → "${corrected.rawValue ?? '(empty)'}"`
      });
      return { ...withAudit, fields, validation };
    });

    // Fire-and-forget: the correction teaches future extractions even if the
    // memory write fails, the correction itself is already persisted above.
    recordCorrection({
      typeId: updated.classification?.typeId ?? 'unclassified',
      fieldKey: field.key,
      label: field.label,
      fromValue: field.rawValue,
      toValue: corrected.rawValue
    }).catch(() => {});
    auditRequest(request, 'document.field_corrected', {
      target: `${record.fileName} (${record.id})`,
      detail: `${field.label}: "${field.rawValue ?? '(empty)'}" → "${corrected.rawValue ?? '(empty)'}"`
    });

    response.json({ field: corrected, validation: updated.validation, summary: toSummary(updated) });
  })
);

/** POST /api/documents/:id/decision — approve or reject after review. */
router.post(
  '/:id/decision',
  asyncHandler(async (request, response) => {
    const record = getDocument(request.params.id);
    const decision = String(request.body?.decision ?? '').toLowerCase();
    const nextStatus = DECISIONS[decision];
    if (!nextStatus) throw badRequest('"decision" must be either "approve" or "reject".');
    if (record.status === DocumentStatus.FAILED) {
      throw conflict('A failed document cannot be approved or rejected. Re-upload the file instead.');
    }

    const actor = readActor(request);
    const note = String(request.body?.note ?? '').slice(0, 300);

    const updated = await updateDocument(record.id, (current) => {
      const withAudit = appendAudit(current, {
        actor,
        action: decision === 'approve' ? 'approved' : 'rejected',
        detail: note || `Document ${decision}d after human review.`
      });
      return { ...withAudit, status: nextStatus };
    });

    auditRequest(request, decision === 'approve' ? 'document.approved' : 'document.rejected', {
      target: `${record.fileName} (${record.id})`,
      detail: note || null
    });
    dispatchDocumentEvent(request.tenantId, decision === 'approve' ? 'document.approved' : 'document.rejected', record.id);

    response.json({ summary: toSummary(updated), status: updated.status, audit: updated.audit.slice(-5) });
  })
);

/** GET /api/documents/:id/export.xlsx */
router.get(
  '/:id/export.xlsx',
  asyncHandler(async (request, response) => {
    const record = getDocument(request.params.id);
    const { buffer, fileName, contentType } = exportDocumentWorkbook(record);
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(buffer);
  })
);

/** GET /api/documents/:id/text — plain text rendition. */
router.get(
  '/:id/text',
  asyncHandler(async (request, response) => {
    const record = getDocument(request.params.id);
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.send(record.fullText);
  })
);

/** DELETE /api/documents/:id */
router.delete(
  '/:id',
  asyncHandler(async (request, response) => {
    const record = getDocument(request.params.id);
    // Build the payload before deletion: receivers learn what was removed.
    const deletedEvent = { documentId: record.id, fileName: record.fileName, status: record.status };
    const result = await deleteDocument(request.params.id);
    auditRequest(request, 'document.deleted', { target: `${record.fileName} (${record.id})` });
    dispatchEvent(request.tenantId, 'document.deleted', deletedEvent).catch(() => {});
    response.json(result);
  })
);

export default router;
