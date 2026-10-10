/**
 * Authentication middleware: resolves who is calling, and guards routes by role.
 *
 * A request is authenticated by exactly one of the following:
 * - `x-api-key`: a workspace API key (bound to one workspace, with its own role),
 *   or the platform-wide `API_KEY`, which acts as a service principal.
 * - The `vgc_session` cookie: an HttpOnly session bound to the active workspace.
 * - Tests only: `NODE_ENV=test` together with `VGC_TEST_AUTH_BYPASS=1`, so the legacy
 *   API suites can drive routes with `x-user-role` / `x-user-operator` headers.
 *   This path cannot run in production, because both variables are required.
 *
 * Authorisation is per workspace. `tenantContext` resolves the workspace and asks
 * `roleFor()` for the caller's role there, so a session for workspace A that sends
 * `x-tenant-id: B` is refused unless the user is also a member of B.
 */
import { config } from '../config/index.js';
import { Role } from '../domain/settings.js';
import { AppError, ErrorCode, forbidden, unauthorized } from '../lib/errors.js';
import { SESSION_COOKIE, resolveApiKey, resolveSession, roleIn } from '../services/identity.service.js';

const OPEN_GET_PATHS = new Set(['/health', '/config', '/requirements']);
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function readCookie(request, name) {
  const header = request.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function sessionCookie(token, { clear = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : config.security.sessionTtlHours * 3600}`
  ];
  if (config.env === 'production') parts.push('Secure');
  return parts.join('; ');
}

function keysMatch(provided, expected) {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

export function testBypassEnabled() {
  return config.env === 'test' && process.env.VGC_TEST_AUTH_BYPASS === '1';
}

/**
 * Cookie-authenticated writes must come from our own pages. SameSite=Lax already
 * withholds the cookie from cross-site subrequests; this is defence in depth
 * using Fetch Metadata, falling back to the Origin header.
 */
function isCrossSiteWrite(request) {
  if (!UNSAFE_METHODS.has(request.method)) return false;
  const site = request.get('sec-fetch-site');
  if (site) return site === 'cross-site' || site === 'same-site';
  const origin = request.get('origin');
  if (!origin) return false;
  if (config.security.corsAllowedOrigins.includes(origin)) return false;
  try {
    const originHost = new URL(origin).host;
    const hosts = [request.get('host'), request.get('x-forwarded-host')].filter(Boolean).map((value) => value.split(',')[0].trim());
    return !hosts.includes(originHost);
  } catch {
    return true;
  }
}

/** Resolves `request.principal`. Never rejects anonymous callers; `requirePrincipal` does. */
export function authenticate(request, response, next) {
  const presentedKey = request.get('x-api-key');
  if (presentedKey) {
    if (config.security.apiKey && keysMatch(presentedKey, config.security.apiKey)) {
      request.principal = { type: 'service', id: 'platform-api-key', email: 'service:platform-api-key', name: 'Platform API key', platformAdmin: true };
      return next();
    }
    const record = resolveApiKey(presentedKey);
    if (!record) return next(unauthorized('The API key is invalid or has been revoked.'));
    request.principal = {
      type: 'api-key',
      id: record.id,
      email: `api-key:${record.name}`,
      name: record.name,
      tenantId: record.tenantId,
      role: record.role,
      platformAdmin: false
    };
    return next();
  }

  const token = readCookie(request, SESSION_COOKIE);
  const resolved = token ? resolveSession(token) : null;
  if (resolved) {
    if (isCrossSiteWrite(request)) return next(forbidden('Cross-site requests are not allowed.'));
    const { session, user } = resolved;
    request.principal = {
      type: 'user',
      id: user.id,
      email: user.email,
      name: user.name,
      platformAdmin: Boolean(user.platformAdmin),
      mustChangePassword: Boolean(user.mustChangePassword),
      tenantId: session.tenantId
    };
    // Non-enumerable: the record holds the password hash and must never be
    // serialised into a log line or a response by accident.
    Object.defineProperty(request.principal, 'userRecord', { value: user, enumerable: false });
    request.user = user;
    request.authSession = session;
    request.sessionToken = token;
    return next();
  }

  if (testBypassEnabled()) {
    const role = String(request.get('x-user-role') ?? '').toLowerCase() === Role.USER ? Role.USER : Role.ADMIN;
    request.principal = {
      type: 'test',
      id: 'test-runner',
      email: String(request.get('x-user-operator') ?? '').slice(0, 120) || 'test-runner@example.com',
      name: 'Test runner',
      role,
      platformAdmin: false
    };
  }
  return next();
}

/** @returns {'admin'|'user'|null} the principal's role in a workspace. */
export function roleFor(principal, tenantId) {
  if (!principal) return null;
  switch (principal.type) {
    case 'service':
      return Role.ADMIN;
    case 'test':
      return principal.role;
    case 'api-key':
      return principal.tenantId === tenantId ? principal.role : null;
    case 'user':
      return roleIn(principal.userRecord ?? null, tenantId);
    default:
      return null;
  }
}

/** Rejects anonymous callers, except for read-only capability discovery. */
export function requirePrincipal(request, response, next) {
  const principal = request.principal;
  if (principal) {
    if (principal.mustChangePassword) {
      return next(
        new AppError({
          code: ErrorCode.FORBIDDEN,
          status: 403,
          message: 'Change your temporary password to continue.',
          meta: { reason: 'PASSWORD_CHANGE_REQUIRED' }
        })
      );
    }
    return next();
  }
  if ((request.method === 'GET' || request.method === 'HEAD') && OPEN_GET_PATHS.has(request.path)) return next();
  return next(unauthorized('Sign in to continue.'));
}

/** Requires the workspace administrator role (resolved by `tenantContext`). */
export function requireAdmin(request, response, next) {
  if (request.role === Role.ADMIN) return next();
  return next(forbidden('Only workspace administrators can do this.'));
}

/**
 * Identity management (members, API keys) also requires a person, not a
 * machine key: an admin API key must not be able to mint more keys or
 * escalate access.
 */
export function requireInteractiveAdmin(request, response, next) {
  if (request.principal?.type === 'api-key') {
    return next(forbidden('API keys cannot manage workspace members or keys. Sign in as an administrator.'));
  }
  return requireAdmin(request, response, next);
}

/** Platform-wide operations (the workspace lifecycle) need a signed-in platform administrator. */
export function requirePlatformAdmin(request, response, next) {
  if (request.principal?.type === 'user' && request.principal.platformAdmin) return next();
  return next(forbidden('Only platform administrators can do this.'));
}
