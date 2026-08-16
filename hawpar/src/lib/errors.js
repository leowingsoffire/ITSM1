/**
 * Typed application errors with stable, machine-readable error codes.
 * Every error carries an HTTP status so the error middleware never has to guess.
 */

export const ErrorCode = Object.freeze({
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  PAGE_LIMIT_EXCEEDED: 'PAGE_LIMIT_EXCEEDED',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  ANALYZER_FAILED: 'ANALYZER_FAILED',
  ANALYZER_TIMEOUT: 'ANALYZER_TIMEOUT',
  ANALYZER_THROTTLED: 'ANALYZER_THROTTLED',
  STORAGE_FAILED: 'STORAGE_FAILED',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL'
});

export class AppError extends Error {
  /**
   * @param {object} input
   * @param {string} input.code    One of {@link ErrorCode}.
   * @param {string} input.message Human readable, safe to surface to the caller.
   * @param {object} [input.meta]  Structured detail (never contains secrets).
   */
  constructor({ code, message, status = 500, meta = {}, cause }) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.meta = meta;
    this.isOperational = true;
    Error.captureStackTrace?.(this, AppError);
  }

  toJSON() {
    return { code: this.code, message: this.message, ...this.meta };
  }
}

export const badRequest = (message, meta) =>
  new AppError({ code: ErrorCode.VALIDATION_FAILED, message, status: 400, meta });

export const notFound = (message, meta) =>
  new AppError({ code: ErrorCode.NOT_FOUND, message, status: 404, meta });

export const unauthorized = (message = 'Missing or invalid API key.') =>
  new AppError({ code: ErrorCode.UNAUTHORIZED, message, status: 401 });

export const forbidden = (message = 'You do not have permission to perform this action.', meta) =>
  new AppError({ code: ErrorCode.FORBIDDEN, message, status: 403, meta });

export const conflict = (message, meta) =>
  new AppError({ code: ErrorCode.CONFLICT, message, status: 409, meta });

export const rateLimited = (message = 'Too many requests. Please retry shortly.') =>
  new AppError({ code: ErrorCode.RATE_LIMITED, message, status: 429 });

export const analyzerFailed = (message, meta, cause) =>
  new AppError({ code: ErrorCode.ANALYZER_FAILED, message, status: 502, meta, cause });
