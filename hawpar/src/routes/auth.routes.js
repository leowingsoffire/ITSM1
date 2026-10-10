/**
 * Auth API: session bootstrap, sign-in/out, first-run setup, password change,
 * workspace switching and personal session management.
 *
 * Mounted before the session guard, so each handler checks its own
 * preconditions. Sign-in and setup sit behind the stricter `auth` rate limit,
 * in addition to the per-account lockout in identity.service.js.
 */
import express from 'express';
import { badRequest, unauthorized } from '../lib/errors.js';
import { rateLimit } from '../middleware/index.js';
import { sessionCookie } from '../middleware/auth.js';
import { recordActivity } from '../services/activity.service.js';
import {
  authOptions,
  changePassword,
  findUserByEmail,
  listUserSessions,
  login,
  revokeOtherSessions,
  revokeSessionByToken,
  revokeUserSession,
  sessionView,
  setupFirstAdministrator,
  switchWorkspace
} from '../services/identity.service.js';
import { asyncHandler } from './asyncHandler.js';

const router = express.Router();

function requestMeta(request) {
  return { ip: request.ip, userAgent: request.get('user-agent') };
}

function requireUserSession(request) {
  if (request.principal?.type !== 'user' || !request.authSession) throw unauthorized('Sign in to continue.');
  return { user: request.user, session: request.authSession };
}

function logActivity(tenantId, request, action, extra = {}) {
  if (!tenantId) return;
  recordActivity(tenantId, {
    actor: extra.actor ?? request.principal?.email ?? 'anonymous',
    action,
    target: extra.target,
    detail: extra.detail,
    ip: request.ip,
    correlationId: request.correlationId
  }).catch(() => {});
}

/** GET /api/auth/session — always 200; tells the SPA whether to show sign-in, setup or the app. */
router.get('/auth/session', (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.principal?.type === 'user' && request.authSession) {
    response.json({ ...sessionView(request.user, request.authSession), options: authOptions() });
    return;
  }
  response.json({ authenticated: false, options: authOptions() });
});

/** GET /api/auth/me — the signed-in user, or 401. */
router.get('/auth/me', (request, response, next) => {
  try {
    const { user, session } = requireUserSession(request);
    response.setHeader('Cache-Control', 'no-store');
    response.json(sessionView(user, session));
  } catch (error) {
    next(error);
  }
});

router.post(
  '/auth/login',
  rateLimit('auth'),
  asyncHandler(async (request, response) => {
    const email = request.body?.email;
    const password = request.body?.password;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      throw badRequest('Enter your email and password.');
    }
    try {
      const { token, session, user } = await login(
        { email, password, tenantId: typeof request.body?.tenantId === 'string' ? request.body.tenantId : undefined },
        requestMeta(request)
      );
      response.setHeader('Set-Cookie', sessionCookie(token));
      logActivity(session.tenantId, request, 'auth.login', { actor: user.email, detail: 'Signed in.' });
      response.json(sessionView(user, session));
    } catch (error) {
      const known = findUserByEmail(email);
      if (known?.lastTenantId) {
        logActivity(known.lastTenantId, request, 'auth.login_failed', { actor: known.email, detail: error.message });
      }
      throw error;
    }
  })
);

router.post(
  '/auth/setup',
  rateLimit('auth'),
  asyncHandler(async (request, response) => {
    const { token, session, user } = await setupFirstAdministrator(
      { email: request.body?.email, password: request.body?.password, name: request.body?.name },
      requestMeta(request)
    );
    response.setHeader('Set-Cookie', sessionCookie(token));
    logActivity(session.tenantId, request, 'auth.setup', { actor: user.email, detail: 'Platform administrator created at first run.' });
    response.status(201).json(sessionView(user, session));
  })
);

router.post(
  '/auth/logout',
  asyncHandler(async (request, response) => {
    if (request.sessionToken) {
      logActivity(request.authSession?.tenantId, request, 'auth.logout', { detail: 'Signed out.' });
      await revokeSessionByToken(request.sessionToken);
    }
    response.setHeader('Set-Cookie', sessionCookie('', { clear: true }));
    response.json({ ok: true });
  })
);

router.post(
  '/auth/password',
  rateLimit('auth'),
  asyncHandler(async (request, response) => {
    const { user, session } = requireUserSession(request);
    await changePassword(user, session, {
      currentPassword: request.body?.currentPassword,
      newPassword: request.body?.newPassword
    });
    logActivity(session.tenantId, request, 'auth.password_changed', { detail: 'Password changed; other sessions signed out.' });
    response.json(sessionView(user, session));
  })
);

router.post(
  '/auth/workspace',
  asyncHandler(async (request, response) => {
    const { user, session } = requireUserSession(request);
    const tenantId = String(request.body?.tenantId ?? '').trim();
    if (!tenantId) throw badRequest('"tenantId" is required.');
    await switchWorkspace(user, session, tenantId);
    logActivity(tenantId, request, 'auth.workspace_opened', { detail: 'Opened this workspace.' });
    response.json(sessionView(user, session));
  })
);

router.get('/auth/sessions', (request, response, next) => {
  try {
    const { user, session } = requireUserSession(request);
    response.json({ items: listUserSessions(user, session.id) });
  } catch (error) {
    next(error);
  }
});

router.delete('/auth/sessions/:id', (request, response, next) => {
  try {
    const { user } = requireUserSession(request);
    revokeUserSession(user, request.params.id);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/sessions/revoke-others', (request, response, next) => {
  try {
    const { user, session } = requireUserSession(request);
    const revoked = revokeOtherSessions(user, session.id);
    logActivity(session.tenantId, request, 'auth.sessions_revoked', { detail: `Signed out ${revoked} other session(s).` });
    response.json({ revoked });
  } catch (error) {
    next(error);
  }
});

export default router;
