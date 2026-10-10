/**
 * The signed-in session, as reported by GET /api/auth/session.
 *
 * Display and navigation decisions read from here; every permission is still
 * enforced by the server, which derives identity from the session cookie.
 */
import { api } from './api.js';
import { getTenantId, rememberedTenantId, setTenantId } from './tenant.js';

let current = null;

/**
 * Loads the session and picks the tab's workspace: the one this tab used
 * before a reload when the user can still open it, otherwise the session's.
 * Never one missing from the list (archived, or access removed).
 * @returns {Promise<object>} the session view
 */
export async function loadSession() {
  current = await api.session();
  if (current.authenticated) {
    const available = new Set(current.workspaces.map((workspace) => workspace.id));
    const choice = [rememberedTenantId(), current.workspace?.id].find((id) => id && available.has(id));
    setTenantId(choice ?? current.workspaces[0]?.id ?? current.workspace.id);
  } else {
    setTenantId(null);
  }
  return current;
}

/** @returns {object|null} the last loaded session view. */
export function sessionView() {
  return current;
}

/** @returns {object|null} `{ id, email, name, platformAdmin, ... }` */
export function currentUser() {
  return current?.authenticated ? current.user : null;
}

/** @returns {Array<{id: string, name: string, role: string}>} */
export function availableWorkspaces() {
  return current?.authenticated ? current.workspaces : [];
}

/** @returns {{id: string, name: string, role: string}|null} the workspace this tab is working in. */
export function currentWorkspace() {
  if (!current?.authenticated) return null;
  const id = getTenantId();
  return current.workspaces.find((workspace) => workspace.id === id) ?? current.workspace;
}

/** @returns {'admin'|'user'|null} */
export function currentRole() {
  return currentWorkspace()?.role ?? null;
}

/** @returns {object} `{ setupRequired, awaitingAdministrator, selfSignup, passwordMinLength }` */
export function authOptions() {
  return current?.options ?? { setupRequired: false, awaitingAdministrator: false, selfSignup: false, passwordMinLength: 10 };
}

/** Initials for the avatar button. */
export function initialsFor(user) {
  const source = (user?.name || user?.email || '').trim();
  if (!source) return '?';
  const words = source.includes('@') ? [source[0]] : source.split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words.at(-1)[0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}
