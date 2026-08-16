/**
 * Application configuration.
 *
 * Loads once at boot, validates every value at the process boundary and freezes
 * the result so no module can mutate configuration at runtime.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cloudflare Workers expose a virtual file system whose /tmp contents are scoped
// to a single request, so durable writes are impossible there. Bundling for the
// edge also erases `import.meta.url`, hence the guarded project-root lookup.
const isEdgeRuntime = globalThis.navigator?.userAgent === 'Cloudflare-Workers';

export const PROJECT_ROOT = import.meta.url
  ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  : '/';

const ANALYZER_MODES = Object.freeze(['demo', 'azure']);
const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);
const PERSISTENCE_MODES = Object.freeze(['file', 'memory']);
const BYTES_PER_MB = 1024 * 1024;

const DEFAULTS = Object.freeze({
  PORT: 8080,
  MAX_UPLOAD_MB: 100,
  MAX_PAGES_PER_DOCUMENT: 2000,
  PIPELINE_CONCURRENCY: 3,
  REVIEW_CONFIDENCE_THRESHOLD: 0.8,
  AZURE_DOCINT_MODEL_ID: 'prebuilt-layout',
  AZURE_DOCINT_API_VERSION: '2024-11-30'
});

/** @returns {string} trimmed value or the fallback when unset/blank. */
function readString(key, fallback = '') {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return fallback;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function readBoolean(key, fallback = false) {
  const raw = readString(key);
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function readNumber(key, fallback, { min, max }) {
  const raw = readString(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `Invalid configuration: ${key}="${raw}" must be a number between ${min} and ${max}.`
    );
  }
  return parsed;
}

function readEnum(key, allowed, fallback) {
  const raw = readString(key, fallback).toLowerCase();
  if (!allowed.includes(raw)) {
    throw new Error(
      `Invalid configuration: ${key}="${raw}" must be one of ${allowed.join(', ')}.`
    );
  }
  return raw;
}

function readList(key) {
  return readString(key)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const analyzerMode = readEnum('ANALYZER_MODE', ANALYZER_MODES, 'demo');
const azureEndpoint = readString('AZURE_DOCINT_ENDPOINT').replace(/\/+$/, '');
const azureKey = readString('AZURE_DOCINT_KEY');
const azureUseManagedIdentity = readBoolean('AZURE_DOCINT_USE_MANAGED_IDENTITY', false);

if (analyzerMode === 'azure') {
  if (!azureEndpoint) {
    throw new Error('ANALYZER_MODE=azure requires AZURE_DOCINT_ENDPOINT to be set.');
  }
  if (!azureKey && !azureUseManagedIdentity) {
    throw new Error(
      'ANALYZER_MODE=azure requires AZURE_DOCINT_KEY or AZURE_DOCINT_USE_MANAGED_IDENTITY=true.'
    );
  }
  if (!/^https:\/\//i.test(azureEndpoint)) {
    throw new Error('AZURE_DOCINT_ENDPOINT must be an https:// URL.');
  }
}

const dataDir = path.resolve(PROJECT_ROOT, readString('DATA_DIR', './data'));
const maxUploadMb = readNumber('MAX_UPLOAD_MB', DEFAULTS.MAX_UPLOAD_MB, { min: 1, max: 500 });

const persistence = readEnum('PERSISTENCE', PERSISTENCE_MODES, isEdgeRuntime ? 'memory' : 'file');

export const config = Object.freeze({
  env: readString('NODE_ENV', 'development'),
  port: readNumber('PORT', DEFAULTS.PORT, { min: 1, max: 65535 }),
  logLevel: readEnum('LOG_LEVEL', LOG_LEVELS, 'info'),
  runtime: isEdgeRuntime ? 'edge' : 'node',
  persistence,
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),

  analyzer: Object.freeze({
    mode: analyzerMode,
    endpoint: azureEndpoint,
    apiKey: azureKey,
    useManagedIdentity: azureUseManagedIdentity,
    modelId: readString('AZURE_DOCINT_MODEL_ID', DEFAULTS.AZURE_DOCINT_MODEL_ID),
    apiVersion: readString('AZURE_DOCINT_API_VERSION', DEFAULTS.AZURE_DOCINT_API_VERSION)
  }),

  limits: Object.freeze({
    maxUploadBytes: maxUploadMb * BYTES_PER_MB,
    maxUploadMb,
    maxPagesPerDocument: readNumber('MAX_PAGES_PER_DOCUMENT', DEFAULTS.MAX_PAGES_PER_DOCUMENT, {
      min: 1,
      max: 10000
    }),
    maxFilesPerRequest: 25,
    pipelineConcurrency: readNumber('PIPELINE_CONCURRENCY', DEFAULTS.PIPELINE_CONCURRENCY, {
      min: 1,
      max: 16
    })
  }),

  quality: Object.freeze({
    reviewConfidenceThreshold: readNumber(
      'REVIEW_CONFIDENCE_THRESHOLD',
      DEFAULTS.REVIEW_CONFIDENCE_THRESHOLD,
      { min: 0, max: 1 }
    )
  }),

  security: Object.freeze({
    apiKey: readString('API_KEY'),
    corsAllowedOrigins: Object.freeze(readList('CORS_ALLOWED_ORIGINS')),
    // Per-client budgets, tunable per deployment: a busy tenant behind a
    // single egress IP needs a higher ceiling than a local demo.
    rateLimit: Object.freeze({
      apiPerMinute: readNumber('RATE_LIMIT_API_PER_MINUTE', 600, { min: 10, max: 100000 }),
      uploadPerMinute: readNumber('RATE_LIMIT_UPLOAD_PER_MINUTE', 60, { min: 1, max: 10000 })
    })
  })
});

export const ALLOWED_MIME_TYPES = Object.freeze({
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/tiff': ['.tif', '.tiff'],
  'image/bmp': ['.bmp'],
  'image/heif': ['.heif'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx']
});

export const ALLOWED_EXTENSIONS = Object.freeze(
  Object.values(ALLOWED_MIME_TYPES).flat()
);
