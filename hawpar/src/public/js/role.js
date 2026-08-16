/**
 * Client-declared role for the demo Settings module.
 *
 * There is no real multi-user identity system in this workspace (see the
 * warning at the top of `login.js`) — the whole platform is a single-tenant
 * demo behind a passphrase gate. To demonstrate role-based editability without
 * fabricating a full auth system, the visitor picks a role at the login gate
 * (Administrator or Standard User) and it is carried on every request as the
 * `x-user-role` header. The server (`settings.routes.js` /
 * `settings.service.js`) is the actual enforcement point — this module only
 * drives what the UI shows/hides.
 */

const ROLE_KEY = 'vgc.demo-role';
export const Role = Object.freeze({ ADMIN: 'admin', USER: 'user' });

/** @returns {'admin'|'user'} the active role, defaulting to Administrator for the demo. */
export function getRole() {
  try {
    const stored = sessionStorage.getItem(ROLE_KEY);
    return stored === Role.USER ? Role.USER : Role.ADMIN;
  } catch {
    return Role.ADMIN;
  }
}

/** @param {'admin'|'user'} role */
export function setRole(role) {
  try {
    sessionStorage.setItem(ROLE_KEY, role === Role.USER ? Role.USER : Role.ADMIN);
  } catch {
    /* storage unavailable — role simply won't persist across reloads */
  }
}

export function isAdmin() {
  return getRole() === Role.ADMIN;
}
