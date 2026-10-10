/**
 * Ingestion service.
 *
 * The single entry point into the platform for every document, whether it
 * arrives from a browser upload or from the built-in sample library. Performs
 * defence-in-depth validation (extension, declared MIME type and magic bytes)
 * before anything touches disk or the analyser.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, config } from '../config/index.js';
import { AppError, ErrorCode, badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { putUpload } from './blob.service.js';
import { createDocument } from './store.service.js';
import { enqueue } from './pipeline.service.js';

/** Magic byte signatures keyed by a readable format name. */
const SIGNATURES = Object.freeze([
  { format: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46], extensions: ['.pdf'] },
  { format: 'png', bytes: [0x89, 0x50, 0x4e, 0x47], extensions: ['.png'] },
  { format: 'jpeg', bytes: [0xff, 0xd8, 0xff], extensions: ['.jpg', '.jpeg'] },
  { format: 'tiff-le', bytes: [0x49, 0x49, 0x2a, 0x00], extensions: ['.tif', '.tiff'] },
  { format: 'tiff-be', bytes: [0x4d, 0x4d, 0x00, 0x2a], extensions: ['.tif', '.tiff'] },
  { format: 'bmp', bytes: [0x42, 0x4d], extensions: ['.bmp'] },
  { format: 'zip-ooxml', bytes: [0x50, 0x4b, 0x03, 0x04], extensions: ['.docx', '.xlsx', '.pptx'] }
]);

const HEIF_BRAND_OFFSET = 4;
const MAX_FILENAME_LENGTH = 180;

function matchesSignature(buffer, signature) {
  if (buffer.length < signature.bytes.length) return false;
  return signature.bytes.every((byte, index) => buffer[index] === byte);
}

function detectFormat(buffer) {
  const matched = SIGNATURES.filter((signature) => matchesSignature(buffer, signature));
  if (matched.length > 0) return matched;
  // HEIF/HEIC carries its brand at offset 4 ("ftypheic", "ftypmif1", ...).
  if (buffer.length > 12 && buffer.subarray(HEIF_BRAND_OFFSET, HEIF_BRAND_OFFSET + 4).toString('latin1') === 'ftyp') {
    return [{ format: 'heif', bytes: [], extensions: ['.heif'] }];
  }
  return [];
}

/** Strips path traversal and control characters from a client-supplied name. */
export function sanitiseFileName(fileName) {
  const base = path.basename(String(fileName ?? 'document'));
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = cleaned.length > 0 ? cleaned : 'document';
  return safe.length > MAX_FILENAME_LENGTH
    ? `${safe.slice(0, MAX_FILENAME_LENGTH - path.extname(safe).length)}${path.extname(safe)}`
    : safe;
}

/**
 * @param {object} input
 * @param {Buffer} input.buffer
 * @param {string} input.fileName
 * @param {string} input.mimeType
 */
export function validateUpload({ buffer, fileName, mimeType }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw badRequest('The uploaded file is empty.', { fileName });
  }
  if (buffer.length > config.limits.maxUploadBytes) {
    throw new AppError({
      code: ErrorCode.FILE_TOO_LARGE,
      message: `"${fileName}" is larger than the ${config.limits.maxUploadMb} MB limit.`,
      status: 413,
      meta: { fileName, sizeBytes: buffer.length }
    });
  }

  const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new AppError({
      code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      message: `"${extension || 'unknown'}" is not a supported file type.`,
      status: 415,
      meta: { fileName, allowed: ALLOWED_EXTENSIONS }
    });
  }

  const declaredExtensions = ALLOWED_MIME_TYPES[mimeType];
  if (declaredExtensions && !declaredExtensions.includes(extension)) {
    throw badRequest(`The declared content type "${mimeType}" does not match the "${extension}" extension.`, {
      fileName
    });
  }

  const detected = detectFormat(buffer);
  if (detected.length === 0) {
    throw new AppError({
      code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      message: `"${fileName}" does not have a recognised document signature and was rejected.`,
      status: 415,
      meta: { fileName }
    });
  }
  if (!detected.some((signature) => signature.extensions.includes(extension))) {
    throw badRequest(
      `"${fileName}" contents (${detected[0].format}) do not match its "${extension}" extension.`,
      { fileName }
    );
  }

  return { extension, detectedFormat: detected[0].format };
}

/**
 * Validates, stores and queues a document.
 * @param {object} input
 * @param {Buffer} input.buffer
 * @param {string} input.fileName
 * @param {string} input.mimeType
 * @param {string} input.batchId
 * @param {string} input.correlationId
 * @param {string} [input.submittedBy]
 */
export async function ingestDocument({ buffer, fileName, mimeType, batchId, correlationId, submittedBy }) {
  const safeName = sanitiseFileName(fileName);
  const { extension } = validateUpload({ buffer, fileName: safeName, mimeType });

  const checksum = createHash('sha256').update(buffer).digest('hex');
  const storagePath = await putUpload(buffer, extension);

  const record = await createDocument({
    batchId,
    fileName: safeName,
    fileSize: buffer.length,
    mimeType,
    checksum,
    storagePath,
    submittedBy
  });

  logger.child({ correlationId }).info('Document ingested.', {
    documentId: record.id,
    fileName: safeName,
    sizeBytes: buffer.length,
    checksum: checksum.slice(0, 12)
  });

  await enqueue(record.id, correlationId);
  return record;
}
