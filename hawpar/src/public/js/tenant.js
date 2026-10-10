/**
 * The workspace this browser tab is working in.
 *
 * The value is a selector, never a credential: the server checks the signed-in
 * user's membership of the named workspace on every request. It lives in
 * sessionStorage (one value per tab) so two tabs can work in two different
 * workspaces at once without overwriting each other.
 */
const TAB_WORKSPACE_KEY = 'vgc.tab-workspace';

// Client-side identity from the pre-authentication releases. Clearing it once
// stops stale values from being sent or displayed.
const LEGACY_LOCAL_KEYS = ['vgc.tenant-id', 'vgc.tenant-meta', 'vgc.workspace-choice'];
const LEGACY_SESSION_KEYS = ['vgc.session-user', 'vgc.demo-role'];

let activeTenantId = null;

/** @returns {string|null} the workspace this tab is working in. */
export function getTenantId() {
  return activeTenantId;
}

/** @returns {string|null} the workspace this tab used before a reload. */
export function rememberedTenantId() {
  try {
    return sessionStorage.getItem(TAB_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

/** @param {string|null} tenantId */
export function setTenantId(tenantId) {
  activeTenantId = tenantId || null;
  try {
    if (activeTenantId) sessionStorage.setItem(TAB_WORKSPACE_KEY, activeTenantId);
    else sessionStorage.removeItem(TAB_WORKSPACE_KEY);
  } catch {
    /* storage unavailable: the tab falls back to the session's workspace on reload */
  }
}

export function forgetLegacyIdentity() {
  try {
    for (const key of LEGACY_LOCAL_KEYS) localStorage.removeItem(key);
    for (const key of LEGACY_SESSION_KEYS) sessionStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Adds the tab's workspace to a same-origin API URL. Links and EventSource
 * cannot send the x-tenant-id header, so they name the workspace in the query.
 * @param {string} url
 * @returns {string}
 */
export function withTenant(url) {
  if (!activeTenantId || typeof url !== 'string' || !url.startsWith('/api/')) return url;
  const parsed = new URL(url, location.origin);
  parsed.searchParams.set('tenantId', activeTenantId);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
