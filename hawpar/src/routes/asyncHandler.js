/**
 * Wraps an async Express handler so rejected promises reach the error middleware.
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<unknown>} handler
 */
export const asyncHandler = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};
