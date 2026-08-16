/**
 * Structured JSON logger.
 *
 * Emits one JSON object per line so Azure App Service / Application Insights can
 * index the fields directly. Sensitive keys are redacted before serialisation.
 */
import { config } from '../config/index.js';

const LEVEL_WEIGHT = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

const REDACTED = '[redacted]';
const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|apikey|api_key|authorization|credential|connectionstring|ssn|nric)/i;

const MAX_STRING_LENGTH = 2000;

/**
 * Recursively removes sensitive values and truncates oversized strings.
 * @param {unknown} value
 * @param {number} depth
 */
function sanitise(value, depth = 0) {
  if (depth > 6) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitise(item, depth + 1));

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitise(item, depth + 1);
  }
  return output;
}

function write(level, message, context) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[config.logLevel]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: 'vgc-ocr-intelligence',
    ...sanitise(context ?? {})
  };

  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = Object.freeze({
  debug: (message, context) => write('debug', message, context),
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context),
  /**
   * Returns a logger that automatically attaches the given context (e.g. correlationId).
   * @param {Record<string, unknown>} boundContext
   */
  child(boundContext) {
    return Object.freeze({
      debug: (message, context) => write('debug', message, { ...boundContext, ...context }),
      info: (message, context) => write('info', message, { ...boundContext, ...context }),
      warn: (message, context) => write('warn', message, { ...boundContext, ...context }),
      error: (message, context) => write('error', message, { ...boundContext, ...context }),
      child: (extra) => logger.child({ ...boundContext, ...extra })
    });
  }
});
