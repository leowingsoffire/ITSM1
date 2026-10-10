/**
 * Cross-cutting HTTP middleware: correlation IDs, security headers, API key
 * authentication, rate limiting and the terminal error handler.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { AppError, ErrorCode, forbidden, rateLimited } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../lib/tenantContext.js';
import { tenantExists } from '../services/tenant.service.js';
import { roleFor } from './auth.js';

const CORRELATION_HEADER = 'x-correlation-id';
const TENANT_HEADER = 'x-tenant-id';
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_SWEEP_MS = 120000;

export function correlationId(request, response, next) {
  const incoming = request.get(CORRELATION_HEADER);
  const isSafe = typeof incoming === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(incoming);
  request.correlationId = isSafe ? incoming : randomUUID();
  request.logger = logger.child({ correlationId: request.correlationId });
  response.setHeader(CORRELATION_HEADER, request.correlationId);
  next();
}

/**
 * Resolves the requesting workspace ("tenant") and binds it to the async
 * context for the rest of the request so every service call downstream is
 * scoped to that workspace without threading the id through every signature.
 *
 * The workspace is chosen from, in order: the `x-tenant-id` header, a
 * `?tenantId=` query parameter on GET requests (EventSource streams and
 * download links cannot set headers), and the session's active workspace.
 * The choice is only a selector: the caller must hold a role in the workspace
 * (see `roleFor`) or the request is refused, so a session for one company can
 * never read another's data by changing the header. Workspace API keys are
 * pinned to their own workspace.
 *
 * Unknown tenant ids are rejected outright (404) rather than silently falling
 * back to the shared default workspace.
 */
export function tenantContext(request, response, next) {
  const principal = request.principal;
  const headerTenant = request.get(TENANT_HEADER)?.trim();
  const queryTenant =
    request.method === 'GET' && typeof request.query?.tenantId === 'string' ? request.query.tenantId.trim() : '';
  const requested = headerTenant || queryTenant;

  let tenantId;
  if (!principal) {
    // Only the open discovery endpoints get here anonymously; they always
    // describe the shared workspace so no tenant's branding leaks.
    tenantId = DEFAULT_TENANT_ID;
  } else if (principal.type === 'api-key') {
    if (requested && requested !== principal.tenantId) {
      return next(forbidden('This API key belongs to a different workspace.'));
    }
    tenantId = principal.tenantId;
  } else {
    tenantId = requested || principal.tenantId || DEFAULT_TENANT_ID;
  }

  if (!tenantExists(tenantId)) {
    return next(
      new AppError({
        code: ErrorCode.NOT_FOUND,
        message: `Workspace "${tenantId}" was not found. It may not have finished onboarding yet.`,
        status: 404,
        meta: { tenantId }
      })
    );
  }

  if (principal) {
    const role = roleFor(principal, tenantId);
    if (!role) return next(forbidden('You are not a member of this workspace.', { tenantId }));
    request.role = role;
    request.actor = principal.email;
  }

  request.tenantId = tenantId;
  response.setHeader('x-tenant-id', tenantId);
  return runWithTenant(tenantId, next);
}

/**
 * Multer's busboy-based multipart parsing consumes the request as a stream,
 * which can lose Node's AsyncLocalStorage continuation by the time its
 * callback fires. `request.tenantId` was set synchronously by `tenantContext`
 * before that, so re-enter the workspace context from it after every
 * multipart parser. Without this, an upload could be stored in the default
 * workspace instead of the caller's.
 */
export function bindTenantContext(request, response, next) {
  if (!request.tenantId) return next();
  return runWithTenant(request.tenantId, next);
}

export function securityHeaders(request, response, next) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  if (request.secure) {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export function cors(request, response, next) {
  const origin = request.get('origin');
  if (origin && config.security.corsAllowedOrigins.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'content-type, x-api-key, x-correlation-id, x-tenant-id');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  return next();
}

const rateBuckets = new Map();
let lastSweep = 0;

/**
 * Drops expired buckets. Swept opportunistically on request rather than from a
 * background timer, which serverless runtimes forbid at module scope.
 */
function sweepRateBuckets(now) {
  if (now - lastSweep < RATE_LIMIT_SWEEP_MS) return;
  lastSweep = now;
  const cutoff = now - RATE_LIMIT_SWEEP_MS;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.windowStart < cutoff) rateBuckets.delete(key);
  }
}

/** @param {'api'|'upload'|'auth'} scope */
export function rateLimit(scope = 'api') {
  const limits = config.security.rateLimit;
  const maximum = scope === 'upload' ? limits.uploadPerMinute : scope === 'auth' ? limits.authPerMinute : limits.apiPerMinute;
  return (request, response, next) => {
    const identity = `${scope}:${request.ip ?? 'unknown'}`;
    const now = Date.now();
    sweepRateBuckets(now);
    const bucket = rateBuckets.get(identity);

    if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateBuckets.set(identity, { windowStart: now, count: 1 });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > maximum) {
      response.setHeader('Retry-After', Math.ceil((RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart)) / 1000));
      return next(rateLimited());
    }
    return next();
  };
}

export function requestLogger(request, response, next) {
  const startedAt = Date.now();
  response.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const level = response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info';
    request.logger[level]('http_request', {
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs
    });
  });
  next();
}

export function notFoundHandler(request, response, next) {
  next(
    new AppError({
      code: ErrorCode.NOT_FOUND,
      message: `No route matches ${request.method} ${request.path}.`,
      status: 404
    })
  );
}

/* eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity. */
export function errorHandler(error, request, response, next) {
  const isAppError = error instanceof AppError;
  const status = isAppError ? error.status : mapUnknownError(error);
  const code = isAppError ? error.code : mapUnknownCode(error);

  const payload = {
    error: {
      code,
      message: isAppError || status < 500 ? error.message : 'An unexpected error occurred. Please retry.',
      correlationId: request.correlationId,
      ...(isAppError ? error.meta : {})
    }
  };

  if (status >= 500) {
    request.logger?.error('Unhandled request failure.', { path: request.path, error });
  } else {
    request.logger?.warn('Request rejected.', { path: request.path, code, message: error.message });
  }

  if (response.headersSent) return next(error);
  return response.status(status).json(payload);
}

function mapUnknownError(error) {
  if (error?.code === 'LIMIT_FILE_SIZE') return 413;
  if (error?.code === 'LIMIT_FILE_COUNT' || error?.code === 'LIMIT_UNEXPECTED_FILE') return 400;
  if (error instanceof SyntaxError && 'body' in error) return 400;
  return 500;
}

function mapUnknownCode(error) {
  if (error?.code === 'LIMIT_FILE_SIZE') return ErrorCode.FILE_TOO_LARGE;
  if (error?.code === 'LIMIT_FILE_COUNT' || error?.code === 'LIMIT_UNEXPECTED_FILE') {
    return ErrorCode.VALIDATION_FAILED;
  }
  if (error instanceof SyntaxError && 'body' in error) return ErrorCode.VALIDATION_FAILED;
  return ErrorCode.INTERNAL;
}
