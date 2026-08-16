/**
 * Client-side workspace (tenant) identity.
 *
 * Mirrors the demo-grade realism of `role.js`/`login.js`: there is still no
 * real user/session backend. What this adds is a *workspace* identifier —
 * returned by `POST /api/onboarding` when a customer completes the wizard —
 * persisted in `localStorage` (survives across tabs/reloads, unlike the
 * passphrase gate's `sessionStorage`) and sent on every API call as
 * `x-tenant-id` so the server can keep that customer's company profile,
 * branding and processed documents isolated from everyone else's.
 *
 * No header is sent at all until a workspace has been created, which keeps
 * the original single-tenant demo experience (and every existing API call)
 * unchanged for visitors who skip onboarding entirely.
 */
const TENANT_KEY = 'vgc.tenant-id';
const TENANT_META_KEY = 'vgc.tenant-meta';
const WORKSPACE_CHOICE_KEY = 'vgc.workspace-choice';

/** @returns {string|null} the active workspace id, or null when none has been created yet. */
export function getTenantId() {
  try {
    return localStorage.getItem(TENANT_KEY) || null;
  } catch {
    return null;
  }
}

/** @returns {object|null} cached `{ companyName, businessType }` for the active workspace. */
export function getTenantMeta() {
  try {
    const raw = localStorage.getItem(TENANT_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** @param {string} tenantId @param {object} [meta] */
export function setTenant(tenantId, meta) {
  try {
    localStorage.setItem(TENANT_KEY, tenantId);
    if (meta) localStorage.setItem(TENANT_META_KEY, JSON.stringify(meta));
  } catch {
    /* storage unavailable — the workspace simply won't persist across reloads */
  }
}

export function clearTenant() {
  try {
    localStorage.removeItem(TENANT_KEY);
    localStorage.removeItem(TENANT_META_KEY);
    localStorage.removeItem(WORKSPACE_CHOICE_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function hasTenant() {
  return Boolean(getTenantId());
}

/**
 * Records that the visitor deliberately chose the shared demo workspace over
 * creating their own. Without this, declining the wizard is forgotten on the
 * next load and the visitor is asked to onboard again on every single reload.
 */
export function rememberSharedWorkspace() {
  try {
    localStorage.setItem(WORKSPACE_CHOICE_KEY, 'shared');
  } catch {
    /* storage unavailable — the wizard will simply be offered again */
  }
}

/** @returns {boolean} true once the visitor has either created or declined a workspace. */
export function hasWorkspaceChoice() {
  if (hasTenant()) return true;
  try {
    return localStorage.getItem(WORKSPACE_CHOICE_KEY) === 'shared';
  } catch {
    return false;
  }
}

/** @returns {string} a human label for the active workspace, for display in the UI. */
export function workspaceLabel() {
  return getTenantMeta()?.companyName || 'Shared demo workspace';
}
