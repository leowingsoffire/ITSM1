/**
 * Per-request tenant context.
 *
 * Uses Node's AsyncLocalStorage so every service can ask "which workspace is
 * this call for?" without threading a tenantId parameter through every
 * function signature in the codebase. The HTTP layer (see
 * `middleware/index.js` → `tenantContext`) is the only place that reads the
 * `x-tenant-id` header; everything downstream just calls `currentTenantId()`.
 *
 * The reserved id `"default"` is intentional: it is the original,
 * un-namespaced workspace this app shipped with (paths like `data/settings.json`,
 * `data/documents/`), so requests that don't send a tenant header (existing
 * tests, curl scripts, the pre-onboarding demo flow) behave exactly as before.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export const DEFAULT_TENANT_ID = 'default';

const storage = new AsyncLocalStorage();

/** @returns {string} the tenant id for the request in flight, or the default workspace. */
export function currentTenantId() {
  return storage.getStore()?.tenantId ?? DEFAULT_TENANT_ID;
}

/**
 * Runs `fn` with the given tenant id bound to the async context.
 * @template T
 * @param {string} tenantId
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithTenant(tenantId, fn) {
  return storage.run({ tenantId: tenantId || DEFAULT_TENANT_ID }, fn);
}
