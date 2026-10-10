/**
 * Onboarding API: the customer-facing wizard's backend.
 *
 * `POST /api/onboarding` provisions a new, isolated workspace:
 * - Signed-in users create an additional workspace. They become its
 *   administrator and their session switches to it.
 * - Visitors (self-service signup, when `SELF_SIGNUP` is enabled) must supply the
 *   administrator `account`. It is validated before anything is provisioned,
 *   and a signed-in session cookie is returned with the new workspace.
 * - Service principals (the platform `API_KEY`) may provision a workspace without
 *   an account, for automated tenant set-up. Members are then added via the API.
 *
 * Runs before the session guard and `tenantContext` in `app.js`: there is no
 * workspace to resolve yet, which is the point of this endpoint.
 */
import express from 'express';
import { config } from '../config/index.js';
import { COUNTRY_TIMEZONES, Role } from '../domain/settings.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { runWithTenant } from '../lib/tenantContext.js';
import { rateLimit } from '../middleware/index.js';
import { sessionCookie } from '../middleware/auth.js';
import { recordActivity } from '../services/activity.service.js';
import {
  assertNewAccount,
  createSession,
  createWorkspaceOwner,
  grantMembership,
  sessionView,
  switchWorkspace
} from '../services/identity.service.js';
import { seedTenantSettings } from '../services/settings.service.js';
import { BUSINESS_TYPES, createTenant } from '../services/tenant.service.js';
import { asyncHandler } from './asyncHandler.js';

const router = express.Router();

router.get('/onboarding/business-types', (request, response) => {
  response.json({ items: BUSINESS_TYPES });
});

router.get('/onboarding/countries', (request, response) => {
  response.json({ items: Object.keys(COUNTRY_TIMEZONES) });
});

function readAccount(body) {
  const account = body.account;
  if (!account || typeof account !== 'object') return null;
  return {
    email: typeof account.email === 'string' ? account.email : '',
    name: typeof account.name === 'string' ? account.name : '',
    password: typeof account.password === 'string' ? account.password : ''
  };
}

router.post(
  '/onboarding',
  rateLimit('auth'),
  asyncHandler(async (request, response) => {
    const body = request.body ?? {};
    const companyName = String(body.companyName ?? '').trim();
    if (!companyName) throw badRequest('"companyName" is required.');
    if (companyName.length > 120) throw badRequest('"companyName" must be 120 characters or fewer.');

    const principal = request.principal;
    if (principal?.type === 'api-key') throw forbidden('Workspace API keys cannot create workspaces.');

    const signedInUser = principal?.type === 'user' ? request.user : null;
    const account = signedInUser ? null : readAccount(body);
    // On an invitation-only deployment, provisioning stays with the platform team.
    if (signedInUser && !principal.platformAdmin && !config.security.selfSignup) {
      throw forbidden('Creating workspaces is limited to platform administrators on this deployment.');
    }
    if (!signedInUser) {
      if (!principal && !config.security.selfSignup) {
        throw forbidden('Self-service signup is turned off. Ask your administrator for an invitation.');
      }
      if (!principal && !account) {
        throw badRequest('Create the administrator account for the workspace: "account.email" and "account.password" are required.');
      }
      // Validate before provisioning so a bad password does not leave an orphan workspace.
      if (account) assertNewAccount(account);
    }

    const tenant = await createTenant({
      companyName,
      businessType: body.businessType,
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      country: body.country,
      companySize: body.companySize
    });

    // Seeding writes the tenant's settings.json, which must happen with the
    // new tenant bound to the async context so it lands in the right
    // per-workspace path rather than the caller's.
    await runWithTenant(tenant.id, () =>
      seedTenantSettings(tenant.id, {
        name: companyName,
        address: { country: tenant.country ?? 'Singapore' }
      })
    );

    let view = null;
    let actor = principal?.email ?? 'self-signup';
    if (signedInUser) {
      await grantMembership(signedInUser, tenant.id, Role.ADMIN, signedInUser.email);
      await switchWorkspace(signedInUser, request.authSession, tenant.id);
      view = sessionView(signedInUser, request.authSession);
    } else if (account) {
      const owner = await createWorkspaceOwner(tenant.id, account);
      const { token, session } = await createSession(owner, tenant.id, { ip: request.ip, userAgent: request.get('user-agent') });
      response.setHeader('Set-Cookie', sessionCookie(token));
      view = sessionView(owner, session);
      actor = owner.email;
    }

    await recordActivity(tenant.id, {
      actor,
      action: 'workspace.created',
      target: companyName,
      detail: view ? `Administrator: ${view.user.email}` : 'Provisioned by a service principal without an administrator account.',
      ip: request.ip,
      correlationId: request.correlationId
    });

    response.status(201).json({ tenant, session: view });
  })
);

export default router;
