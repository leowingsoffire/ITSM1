/**
 * Identity: accounts, workspace memberships, sessions and workspace API keys.
 *
 * Roles are per workspace: `admin` manages the workspace (settings, members,
 * API keys, webhooks, destructive actions) and `user` operates it (ingest,
 * review, correct, decide). A platform administrator, seeded from
 * ADMIN_EMAIL / ADMIN_PASSWORD, can administer every workspace.
 *
 * Built on Node's crypto only (scrypt, SHA-256, CSPRNG), so the edge build
 * gains no new dependencies.
 */
import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config/index.js';
import { Role } from '../domain/settings.js';
import { AppError, ErrorCode, badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { displayIp } from '../lib/format.js';
import { logger } from '../lib/logger.js';
import { DEFAULT_TENANT_ID } from '../lib/tenantContext.js';
import { getTenant, listTenants, tenantIsActive } from './tenant.service.js';
import { identity, loadIdentity, persistIdentity } from './identity.store.js';

const scryptAsync = promisify(scrypt);

export const SESSION_COOKIE = 'vgc_session';
export const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 200;
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 20;
const MAX_ACTIVE_KEYS_PER_WORKSPACE = 25;
const API_KEY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const API_KEY_PATTERN = /^vgc_([a-f0-9]{12})_([A-Za-z0-9_-]{32})$/;
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const SHARED_WORKSPACE_NAME = 'Shared workspace';

export const ROLES = Object.freeze([Role.ADMIN, Role.USER]);

let timingDecoyHash = null;

const nowIso = () => new Date().toISOString();
const sessionTtlMs = () => config.security.sessionTtlHours * 60 * 60 * 1000;

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export function normaliseEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isValidEmail(value) {
  return value.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cleanName(value, fallback) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
  return name || fallback;
}

function assertRole(role) {
  if (!ROLES.includes(role)) throw badRequest(`"role" must be one of ${ROLES.join(', ')}.`);
  return role;
}

/** Length-based policy (NIST SP 800-63B): long passphrases beat composition rules. */
export function validatePassword(password, { email } = {}) {
  if (typeof password !== 'string' || password.length === 0) throw badRequest('A password is required.');
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw badRequest(`Passwords must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw badRequest(`Passwords must be ${PASSWORD_MAX_LENGTH} characters or fewer.`);
  }
  if (email && password.trim().toLowerCase() === email) {
    throw badRequest('Choose a password that is different from your email address.');
  }
  if (/^(.)\1+$/.test(password) || /^(?:0123456789|1234567890|password\d*|qwertyuiop)$/i.test(password)) {
    throw badRequest('That password is too easy to guess. Choose a longer, less predictable one.');
  }
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(String(password), salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const derived = await scryptAsync(String(password ?? ''), parts[1], 64);
  const expected = Buffer.from(parts[2], 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** A 16-character one-time password without look-alike characters. */
export function generateTemporaryPassword() {
  let output = '';
  for (let index = 0; index < 16; index += 1) output += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  return output;
}

function invalidCredentials() {
  return unauthorized('The email or password is incorrect.');
}

/* ── Directory ───────────────────────────────────────────────────────────── */

export function findUserByEmail(email) {
  const target = normaliseEmail(email);
  if (!target) return null;
  for (const user of identity.users.values()) if (user.email === target) return user;
  return null;
}

export function getUser(userId) {
  return identity.users.get(userId) ?? null;
}

export function userCount() {
  return identity.users.size;
}

function newUser({ email, name, passwordHash, platformAdmin = false, mustChangePassword = false, memberships = [] }) {
  const at = nowIso();
  return {
    id: randomUUID(),
    email,
    name: cleanName(name, email.split('@')[0]),
    passwordHash,
    platformAdmin,
    mustChangePassword,
    memberships,
    status: 'active',
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    lastTenantId: memberships[0]?.tenantId ?? null,
    passwordChangedAt: at,
    createdAt: at,
    updatedAt: at
  };
}

/** @returns {'admin'|'user'|null} the user's role in the workspace, or null without access (archived workspaces grant none). */
export function roleIn(user, tenantId) {
  if (!user || user.status !== 'active') return null;
  const id = tenantId || DEFAULT_TENANT_ID;
  if (!tenantIsActive(id)) return null;
  const membership = user.memberships?.find((entry) => entry.tenantId === id);
  if (membership) return membership.role;
  return user.platformAdmin ? Role.ADMIN : null;
}

function workspaceName(tenantId) {
  if (tenantId === DEFAULT_TENANT_ID) return SHARED_WORKSPACE_NAME;
  try {
    return getTenant(tenantId).companyName || tenantId;
  } catch {
    return tenantId;
  }
}

/** Every workspace the user can open, with their role in each. */
export function workspacesFor(user) {
  const ids = new Set((user.memberships ?? []).map((entry) => entry.tenantId));
  if (user.platformAdmin) {
    ids.add(DEFAULT_TENANT_ID);
    for (const tenant of listTenants()) ids.add(tenant.id);
  }
  return [...ids]
    .filter((id) => tenantIsActive(id))
    .map((id) => ({ id, name: workspaceName(id), role: roleIn(user, id) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function pickWorkspace(user, preferred) {
  if (preferred && roleIn(user, preferred)) return preferred;
  if (user.lastTenantId && roleIn(user, user.lastTenantId)) return user.lastTenantId;
  // Someone's own workspaces come first. Platform administrators who belong
  // to none start in the shared workspace, never in an arbitrary client's.
  const memberOf = new Set((user.memberships ?? []).map((entry) => entry.tenantId));
  const own = workspacesFor(user).find((workspace) => workspace.role && memberOf.has(workspace.id));
  if (own) return own.id;
  return roleIn(user, DEFAULT_TENANT_ID) ? DEFAULT_TENANT_ID : null;
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    platformAdmin: Boolean(user.platformAdmin),
    mustChangePassword: Boolean(user.mustChangePassword),
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt
  };
}

/** The payload the SPA boots from: who, which workspace, what role, where else. */
export function sessionView(user, session) {
  return {
    authenticated: true,
    user: publicUser(user),
    workspace: { id: session.tenantId, name: workspaceName(session.tenantId), role: roleIn(user, session.tenantId) },
    workspaces: workspacesFor(user),
    session: { id: session.publicId, createdAt: session.createdAt, expiresAt: session.expiresAt }
  };
}

/* ── Bootstrap ───────────────────────────────────────────────────────────── */

export async function initialiseIdentity() {
  await loadIdentity();
  timingDecoyHash = await hashPassword(randomBytes(16).toString('hex'));
  await seedPlatformAdminFromEnvironment();
}

/**
 * Creates the platform administrator named by ADMIN_EMAIL on first boot.
 * ADMIN_PASSWORD is only used to create the account; afterwards the password
 * is managed in the app, and later boots never overwrite it.
 */
async function seedPlatformAdminFromEnvironment() {
  const email = normaliseEmail(process.env.ADMIN_EMAIL);
  if (!email) return;
  if (!isValidEmail(email)) {
    logger.warn('ADMIN_EMAIL is not a valid email address — platform administrator not seeded.');
    return;
  }
  const existing = findUserByEmail(email);
  if (existing) {
    if (!existing.platformAdmin) {
      existing.platformAdmin = true;
      existing.updatedAt = nowIso();
      await persistIdentity('users');
      logger.info('Existing account promoted to platform administrator from environment.', { email });
    }
    return;
  }
  const password = String(process.env.ADMIN_PASSWORD ?? '');
  try {
    validatePassword(password, { email });
  } catch (error) {
    logger.warn('ADMIN_PASSWORD is missing or too weak — platform administrator not seeded.', { reason: error.message });
    return;
  }
  const user = newUser({
    email,
    name: process.env.ADMIN_NAME || 'Platform administrator',
    passwordHash: await hashPassword(password),
    platformAdmin: true
  });
  identity.users.set(user.id, user);
  await persistIdentity('users');
  logger.info('Platform administrator seeded from environment.', { email });
}

export function authOptions() {
  const noAccounts = identity.users.size === 0;
  return {
    setupRequired: noAccounts && config.env !== 'production',
    awaitingAdministrator: noAccounts && config.env === 'production',
    selfSignup: config.security.selfSignup,
    passwordMinLength: PASSWORD_MIN_LENGTH
  };
}

/** First-run setup: the very first account becomes the platform administrator. */
export async function setupFirstAdministrator({ email, password, name }, meta) {
  if (identity.users.size > 0) throw conflict('Setup has already been completed. Sign in instead.');
  if (config.env === 'production') {
    throw forbidden('First-run setup is disabled in production. Configure ADMIN_EMAIL and ADMIN_PASSWORD.');
  }
  const cleanEmail = normaliseEmail(email);
  if (!isValidEmail(cleanEmail)) throw badRequest('Enter a valid email address.');
  validatePassword(password, { email: cleanEmail });
  const passwordHash = await hashPassword(password);
  // Re-check after the async hash so two racing setup requests cannot both win.
  if (identity.users.size > 0) throw conflict('Setup has already been completed. Sign in instead.');
  const user = newUser({ email: cleanEmail, name, passwordHash, platformAdmin: true });
  identity.users.set(user.id, user);
  await persistIdentity('users');
  logger.info('First-run setup created the platform administrator.', { email: cleanEmail });
  return createSession(user, DEFAULT_TENANT_ID, meta);
}

/* ── Sign-in & sessions ──────────────────────────────────────────────────── */

export async function login({ email, password, tenantId }, meta = {}) {
  const user = findUserByEmail(email);
  if (!user) {
    // Spend the same scrypt time as a real check so response timing does not
    // reveal which email addresses have accounts.
    timingDecoyHash ??= await hashPassword(randomBytes(16).toString('hex'));
    await verifyPassword(password, timingDecoyHash);
    throw invalidCredentials();
  }
  if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
    const minutes = Math.ceil((Date.parse(user.lockedUntil) - Date.now()) / 60000);
    throw new AppError({
      code: ErrorCode.RATE_LIMITED,
      status: 429,
      message: `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
    });
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    user.failedLoginCount = (user.failedLoginCount ?? 0) + 1;
    if (user.failedLoginCount >= MAX_FAILED_LOGINS) {
      user.failedLoginCount = 0;
      user.lockedUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
      logger.warn('Account locked after repeated failed sign-ins.', { userId: user.id });
    }
    await persistIdentity('users');
    throw invalidCredentials();
  }
  if (user.status !== 'active') throw forbidden('This account has been disabled. Contact your workspace administrator.');

  const workspace = pickWorkspace(user, tenantId);
  if (!workspace) {
    throw forbidden('Your account is not a member of any active workspace. Ask a workspace administrator to add you.');
  }
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.lastLoginAt = nowIso();
  return createSession(user, workspace, meta);
}

export async function createSession(user, tenantId, { ip, userAgent } = {}) {
  const token = randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  const session = {
    id: sha256(token),
    publicId: randomUUID(),
    userId: user.id,
    tenantId,
    createdAt: new Date(createdAt).toISOString(),
    lastSeenAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + sessionTtlMs()).toISOString(),
    ip: displayIp(ip),
    userAgent: userAgent ? String(userAgent).slice(0, 200) : null
  };
  identity.sessions.set(session.id, session);

  const mine = [...identity.sessions.values()]
    .filter((entry) => entry.userId === user.id)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  for (const stale of mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS_PER_USER))) identity.sessions.delete(stale.id);

  user.lastTenantId = tenantId;
  user.updatedAt = nowIso();
  await Promise.all([persistIdentity('sessions'), persistIdentity('users')]);
  return { token, session, user };
}

/**
 * Keeps a session in a workspace its user can open. When that workspace was
 * archived or the person lost access to it, the session moves to another of
 * their workspaces, or ends when none is left. Changes memory only; the caller
 * persists.
 * @returns {'kept'|'moved'|'ended'}
 */
function settleSessionWorkspace(session, user) {
  if (user && roleIn(user, session.tenantId)) return 'kept';
  const next = user ? pickWorkspace(user) : null;
  if (next) {
    session.tenantId = next;
    return 'moved';
  }
  identity.sessions.delete(session.id);
  return 'ended';
}

/** @returns {{session: object, user: object}|null} the live session for a cookie token. */
export function resolveSession(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const session = identity.sessions.get(sha256(token));
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    identity.sessions.delete(session.id);
    persistIdentity('sessions');
    return null;
  }
  const user = identity.users.get(session.userId);
  if (!user || user.status !== 'active') return null;
  // Archiving a workspace settles its sessions straight away. This catches any
  // left behind (say the process stopped between the two writes), so a session
  // never stays stuck in a workspace its user can no longer open.
  const from = session.tenantId;
  const settled = settleSessionWorkspace(session, user);
  if (settled !== 'kept') {
    logger.warn('A session was left in a workspace its user can no longer open.', { userId: user.id, from, outcome: settled });
    persistIdentity('sessions');
    if (settled === 'ended') return null;
  }
  if (Date.now() - Date.parse(session.lastSeenAt) > SESSION_TOUCH_INTERVAL_MS) {
    session.lastSeenAt = nowIso();
    persistIdentity('sessions');
  }
  return { session, user };
}

export async function revokeSessionByToken(token) {
  const id = typeof token === 'string' ? sha256(token) : null;
  if (id && identity.sessions.delete(id)) await persistIdentity('sessions');
}

function revokeWhere(predicate) {
  let removed = 0;
  for (const [id, session] of identity.sessions) {
    if (predicate(session)) {
      identity.sessions.delete(id);
      removed += 1;
    }
  }
  if (removed > 0) persistIdentity('sessions');
  return removed;
}

/**
 * After a workspace is archived, moves every session that was working in it
 * to another workspace its user can still open, and ends the sessions of
 * people who have nowhere else to go.
 * @returns {Promise<{moved: number, ended: number}>}
 */
export async function rehomeWorkspaceSessions(tenantId) {
  const tally = { moved: 0, ended: 0 };
  for (const session of [...identity.sessions.values()]) {
    if (session.tenantId !== tenantId) continue;
    const outcome = settleSessionWorkspace(session, identity.users.get(session.userId));
    if (outcome !== 'kept') tally[outcome] += 1;
  }
  if (tally.moved + tally.ended > 0) await persistIdentity('sessions');
  return tally;
}

/** @returns {Map<string, {members: number, administrators: number}>} active accounts per workspace. */
export function workspaceMemberCounts() {
  const counts = new Map();
  for (const user of identity.users.values()) {
    if (user.status !== 'active') continue;
    for (const membership of user.memberships ?? []) {
      const tally = counts.get(membership.tenantId) ?? { members: 0, administrators: 0 };
      tally.members += 1;
      if (membership.role === Role.ADMIN) tally.administrators += 1;
      counts.set(membership.tenantId, tally);
    }
  }
  return counts;
}

export function listUserSessions(user, currentSessionId) {
  return [...identity.sessions.values()]
    .filter((session) => session.userId === user.id && Date.parse(session.expiresAt) > Date.now())
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
    .map((session) => ({
      id: session.publicId,
      workspace: { id: session.tenantId, name: workspaceName(session.tenantId) },
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      ip: session.ip,
      userAgent: session.userAgent,
      current: session.id === currentSessionId
    }));
}

export function revokeUserSession(user, publicId) {
  const removed = revokeWhere((session) => session.userId === user.id && session.publicId === publicId);
  if (removed === 0) throw notFound('That session was not found or has already ended.');
}

export function revokeOtherSessions(user, currentSessionId) {
  return revokeWhere((session) => session.userId === user.id && session.id !== currentSessionId);
}

export async function switchWorkspace(user, session, tenantId) {
  if (!roleIn(user, tenantId)) throw forbidden('You are not a member of that workspace.');
  session.tenantId = tenantId;
  user.lastTenantId = tenantId;
  user.updatedAt = nowIso();
  await Promise.all([persistIdentity('sessions'), persistIdentity('users')]);
}

export async function changePassword(user, session, { currentPassword, newPassword }) {
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    // 400 rather than 401: the session is valid, only the confirmation failed.
    throw badRequest('Your current password is incorrect.');
  }
  validatePassword(newPassword, { email: user.email });
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw badRequest('Choose a new password that is different from the current one.');
  }
  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  user.passwordChangedAt = nowIso();
  user.updatedAt = user.passwordChangedAt;
  await persistIdentity('users');
  // Anyone holding an older session (e.g. a stolen cookie) is signed out.
  revokeOtherSessions(user, session.id);
}

/* ── Workspace onboarding ────────────────────────────────────────────────── */

/** Validates a self-service signup before any workspace is provisioned. */
export function assertNewAccount({ email, password }) {
  const cleanEmail = normaliseEmail(email);
  if (!isValidEmail(cleanEmail)) throw badRequest('Enter a valid work email for the administrator account.');
  if (findUserByEmail(cleanEmail)) {
    throw conflict('An account with this email already exists. Sign in, then create the workspace from the account menu.');
  }
  validatePassword(password, { email: cleanEmail });
  return cleanEmail;
}

/** Creates the administrator account for a freshly provisioned workspace. */
export async function createWorkspaceOwner(tenantId, { email, password, name }) {
  const cleanEmail = assertNewAccount({ email, password });
  const user = newUser({
    email: cleanEmail,
    name,
    passwordHash: await hashPassword(password),
    memberships: [{ tenantId, role: Role.ADMIN, addedAt: nowIso(), addedBy: cleanEmail }]
  });
  identity.users.set(user.id, user);
  await persistIdentity('users');
  return user;
}

export async function grantMembership(user, tenantId, role, addedBy) {
  if (!user.memberships.some((entry) => entry.tenantId === tenantId)) {
    user.memberships.push({ tenantId, role: assertRole(role), addedAt: nowIso(), addedBy });
    user.updatedAt = nowIso();
    await persistIdentity('users');
  }
}

/* ── Members (workspace administration) ──────────────────────────────────── */

function memberView(user, tenantId) {
  const membership = user.memberships.find((entry) => entry.tenantId === tenantId);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: membership?.role ?? null,
    platformAdmin: Boolean(user.platformAdmin),
    status: user.status,
    mustChangePassword: Boolean(user.mustChangePassword),
    locked: Boolean(user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()),
    addedAt: membership?.addedAt ?? null,
    addedBy: membership?.addedBy ?? null,
    lastLoginAt: user.lastLoginAt ?? null
  };
}

function membersOf(tenantId) {
  return [...identity.users.values()].filter((user) => user.memberships.some((entry) => entry.tenantId === tenantId));
}

export function listMembers(tenantId) {
  return membersOf(tenantId)
    .map((user) => memberView(user, tenantId))
    .sort((left, right) => (left.role === right.role ? left.email.localeCompare(right.email) : left.role === Role.ADMIN ? -1 : 1));
}

function requireMember(tenantId, userId) {
  const user = identity.users.get(userId);
  if (!user || !user.memberships.some((entry) => entry.tenantId === tenantId)) {
    throw notFound('That person is not a member of this workspace.');
  }
  return user;
}

/**
 * Refuses to leave a workspace without an administrator of its own, which
 * would lock its people out of managing it. Platform administrators are exempt:
 * they keep administrator access to every workspace, so nothing is locked out
 * when they act — and workspaces that predate member management have no
 * explicit administrator at all, so the guard would otherwise make promoting
 * someone there irreversible.
 */
function assertKeepsAnAdministrator(tenantId, excludedUserId, { actorIsPlatformAdmin = false } = {}) {
  if (actorIsPlatformAdmin) return;
  const remaining = membersOf(tenantId).filter(
    (user) =>
      user.id !== excludedUserId &&
      user.status === 'active' &&
      user.memberships.some((entry) => entry.tenantId === tenantId && entry.role === Role.ADMIN)
  );
  if (remaining.length === 0) {
    throw conflict('A workspace must keep at least one administrator. Promote someone else first.');
  }
}

/**
 * Adds someone to the workspace. Existing accounts simply gain a membership;
 * new accounts get a one-time password that must be changed at first sign-in.
 */
export async function addMember(tenantId, { email, name, role }, actor) {
  const cleanEmail = normaliseEmail(email);
  if (!isValidEmail(cleanEmail)) throw badRequest('Enter a valid email address.');
  const memberRole = assertRole(role ?? Role.USER);
  let user = findUserByEmail(cleanEmail);
  let temporaryPassword = null;
  const membership = { tenantId, role: memberRole, addedAt: nowIso(), addedBy: actor };

  if (user) {
    if (user.memberships.some((entry) => entry.tenantId === tenantId)) {
      throw conflict(`${cleanEmail} is already a member of this workspace.`);
    }
    user.memberships.push(membership);
    user.updatedAt = nowIso();
  } else {
    temporaryPassword = generateTemporaryPassword();
    user = newUser({
      email: cleanEmail,
      name,
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      memberships: [membership]
    });
    identity.users.set(user.id, user);
  }
  await persistIdentity('users');
  return { member: memberView(user, tenantId), temporaryPassword, created: temporaryPassword !== null };
}

export async function updateMemberRole(tenantId, userId, role, { actorIsPlatformAdmin = false } = {}) {
  const nextRole = assertRole(role);
  const user = requireMember(tenantId, userId);
  const membership = user.memberships.find((entry) => entry.tenantId === tenantId);
  if (membership.role === nextRole) return memberView(user, tenantId);
  if (membership.role === Role.ADMIN) assertKeepsAnAdministrator(tenantId, userId, { actorIsPlatformAdmin });
  membership.role = nextRole;
  user.updatedAt = nowIso();
  await persistIdentity('users');
  return memberView(user, tenantId);
}

export async function removeMember(tenantId, userId, { actorIsPlatformAdmin = false } = {}) {
  const user = requireMember(tenantId, userId);
  const membership = user.memberships.find((entry) => entry.tenantId === tenantId);
  if (membership.role === Role.ADMIN) assertKeepsAnAdministrator(tenantId, userId, { actorIsPlatformAdmin });
  user.memberships = user.memberships.filter((entry) => entry.tenantId !== tenantId);
  user.updatedAt = nowIso();
  if (user.lastTenantId === tenantId) user.lastTenantId = user.memberships[0]?.tenantId ?? null;
  await persistIdentity('users');
  // Sessions opened on this workspace end immediately; others are untouched.
  revokeWhere((session) => session.userId === userId && session.tenantId === tenantId);
  return { removed: true, email: user.email };
}

/**
 * Issues a one-time password. A workspace administrator may only reset
 * accounts that belong solely to their workspace — otherwise the admin of one
 * client workspace could take over a person's access to another.
 */
export async function resetMemberPassword(tenantId, userId, { actorIsPlatformAdmin = false } = {}) {
  const user = requireMember(tenantId, userId);
  const confined = user.memberships.every((entry) => entry.tenantId === tenantId) && !user.platformAdmin;
  if (!confined && !actorIsPlatformAdmin) {
    throw forbidden('This person also belongs to other workspaces. Ask them to change their password, or contact the platform administrator.');
  }
  const temporaryPassword = generateTemporaryPassword();
  user.passwordHash = await hashPassword(temporaryPassword);
  user.mustChangePassword = true;
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.passwordChangedAt = nowIso();
  user.updatedAt = user.passwordChangedAt;
  await persistIdentity('users');
  revokeWhere((session) => session.userId === userId);
  return { temporaryPassword, email: user.email };
}

/* ── Workspace API keys ──────────────────────────────────────────────────── */

function publicApiKey(record) {
  return {
    id: record.id,
    name: record.name,
    role: record.role,
    preview: record.preview,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
    revokedBy: record.revokedBy ?? null
  };
}

export function listApiKeys(tenantId) {
  return [...identity.apiKeys.values()]
    .filter((record) => record.tenantId === tenantId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map(publicApiKey);
}

/** @returns {{apiKey: object, key: string}} — the plaintext key is returned exactly once. */
export async function createApiKey(tenantId, { name, role }, actor) {
  const label = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (label.length < 2 || label.length > 60) throw badRequest('Give the key a name between 2 and 60 characters.');
  const keyRole = assertRole(role ?? Role.USER);
  const active = [...identity.apiKeys.values()].filter((record) => record.tenantId === tenantId && !record.revokedAt);
  if (active.length >= MAX_ACTIVE_KEYS_PER_WORKSPACE) {
    throw conflict(`A workspace can have at most ${MAX_ACTIVE_KEYS_PER_WORKSPACE} active API keys. Revoke an unused key first.`);
  }
  let id;
  do id = randomBytes(6).toString('hex');
  while (identity.apiKeys.has(id));
  const secret = randomBytes(24).toString('base64url');
  const key = `vgc_${id}_${secret}`;
  const record = {
    id,
    tenantId,
    name: label,
    role: keyRole,
    hash: sha256(key),
    preview: `vgc_${id}_…${secret.slice(-4)}`,
    createdAt: nowIso(),
    createdBy: actor,
    lastUsedAt: null,
    revokedAt: null
  };
  identity.apiKeys.set(id, record);
  await persistIdentity('apiKeys');
  return { apiKey: publicApiKey(record), key };
}

export async function revokeApiKey(tenantId, id, actor) {
  const record = identity.apiKeys.get(id);
  if (!record || record.tenantId !== tenantId) throw notFound('API key not found.');
  if (!record.revokedAt) {
    record.revokedAt = nowIso();
    record.revokedBy = actor;
    await persistIdentity('apiKeys');
  }
  return publicApiKey(record);
}

/** @returns {object|null} the active key record for a presented `x-api-key`. */
export function resolveApiKey(presented) {
  const match = API_KEY_PATTERN.exec(String(presented ?? ''));
  if (!match) return null;
  const record = identity.apiKeys.get(match[1]);
  if (!record || record.revokedAt || !tenantIsActive(record.tenantId)) return null;
  const expected = Buffer.from(record.hash, 'hex');
  const actual = Buffer.from(sha256(presented), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (!record.lastUsedAt || Date.now() - Date.parse(record.lastUsedAt) > API_KEY_TOUCH_INTERVAL_MS) {
    record.lastUsedAt = nowIso();
    persistIdentity('apiKeys');
  }
  return record;
}
