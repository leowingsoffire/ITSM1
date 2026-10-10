/**
 * The signed-in user's role in the tab's workspace, for showing or hiding
 * controls. The server enforces every permission independently.
 */
import { currentRole } from './session.js';

export const Role = Object.freeze({ ADMIN: 'admin', USER: 'user' });

/** @returns {'admin'|'user'} */
export function getRole() {
  return currentRole() === Role.ADMIN ? Role.ADMIN : Role.USER;
}

export function isAdmin() {
  return getRole() === Role.ADMIN;
}
