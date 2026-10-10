/**
 * Workspace administration API: members and roles, API keys, webhooks, the
 * activity log and the self-learning memory, plus the workspace lifecycle
 * (list, archive, restore) for platform administrators.
 *
 * Mounted after `tenantContext`, so `request.tenantId` and `request.role` are
 * already verified for the caller. Every workspace route manages the caller's
 * current workspace only. Member and API-key management needs an interactive
 * administrator: an API key must not be able to mint keys or grant access.
 */
import express from 'express';
import { roleLabel } from '../domain/settings.js';
import { badRequest } from '../lib/errors.js';
import { requireAdmin, requireInteractiveAdmin, requirePlatformAdmin } from '../middleware/auth.js';
import { auditRequest, listActivity } from '../services/activity.service.js';
import {
  ROLES,
  addMember,
  createApiKey,
  listApiKeys,
  listMembers,
  rehomeWorkspaceSessions,
  removeMember,
  resetMemberPassword,
  revokeApiKey,
  updateMemberRole,
  workspaceMemberCounts
} from '../services/identity.service.js';
import { clearMemory, memoryStats } from '../services/learning.service.js';
import { TenantStatus, listTenants, setTenantStatus } from '../services/tenant.service.js';
import {
  WEBHOOK_EVENTS,
  createWebhook,
  deleteWebhook,
  listDeliveries,
  listWebhooks,
  rotateWebhookSecret,
  sendTestEvent,
  updateWebhook
} from '../services/webhooks.service.js';
import { asyncHandler } from './asyncHandler.js';

const router = express.Router();

/* ── Members ─────────────────────────────────────────────────────────────── */

router.get('/admin/members', requireAdmin, (request, response) => {
  response.json({ items: listMembers(request.tenantId), roles: ROLES });
});

router.post(
  '/admin/members',
  requireInteractiveAdmin,
  asyncHandler(async (request, response) => {
    const result = await addMember(
      request.tenantId,
      { email: request.body?.email, name: request.body?.name, role: request.body?.role },
      request.actor
    );
    await auditRequest(request, 'member.added', {
      target: result.member.email,
      detail: `Role: ${roleLabel(result.member.role)}${result.created ? ' · new account with a one-time password' : ' · existing account'}`
    });
    response.setHeader('Cache-Control', 'no-store');
    response.status(201).json(result);
  })
);

router.patch(
  '/admin/members/:userId',
  requireInteractiveAdmin,
  asyncHandler(async (request, response) => {
    const role = request.body?.role;
    if (!role) throw badRequest('"role" is required.');
    const member = await updateMemberRole(request.tenantId, request.params.userId, role, {
      actorIsPlatformAdmin: Boolean(request.principal?.platformAdmin)
    });
    await auditRequest(request, 'member.role_changed', { target: member.email, detail: `Role: ${roleLabel(member.role)}` });
    response.json({ member });
  })
);

router.delete(
  '/admin/members/:userId',
  requireInteractiveAdmin,
  asyncHandler(async (request, response) => {
    const result = await removeMember(request.tenantId, request.params.userId, {
      actorIsPlatformAdmin: Boolean(request.principal?.platformAdmin)
    });
    await auditRequest(request, 'member.removed', { target: result.email });
    response.json(result);
  })
);

router.post(
  '/admin/members/:userId/reset-password',
  requireInteractiveAdmin,
  asyncHandler(async (request, response) => {
    const result = await resetMemberPassword(request.tenantId, request.params.userId, {
      actorIsPlatformAdmin: Boolean(request.principal?.platformAdmin)
    });
    await auditRequest(request, 'member.password_reset', { target: result.email, detail: 'One-time password issued; sessions signed out.' });
    response.setHeader('Cache-Control', 'no-store');
    response.json(result);
  })
);

/* ── API keys ────────────────────────────────────────────────────────────── */

router.get('/admin/api-keys', requireInteractiveAdmin, (request, response) => {
  response.json({ items: listApiKeys(request.tenantId), roles: ROLES });
});

router.post(
  '/admin/api-keys',
  requireInteractiveAdmin,
  asyncHandler(async (request, response) => {
    const result = await createApiKey(request.tenantId, { name: request.body?.name, role: request.body?.role }, request.actor);
    await auditRequest(request, 'api_key.created', { target: result.apiKey.name, detail: `Role: ${roleLabel(result.apiKey.role)} · ${result.apiKey.preview}` });
    response.setHeader('Cache-Control', 'no-store');
    response.status(201).json(result);
  })
);

router.delete(
  '/admin/api-keys/:id',
  requireInteractiveAdmin,
  asyncHandler(async (request, response) => {
    const apiKey = await revokeApiKey(request.tenantId, request.params.id, request.actor);
    await auditRequest(request, 'api_key.revoked', { target: apiKey.name, detail: apiKey.preview });
    response.json({ apiKey });
  })
);

/* ── Webhooks ────────────────────────────────────────────────────────────── */

router.get(
  '/admin/webhooks',
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json({ items: await listWebhooks(request.tenantId), events: WEBHOOK_EVENTS });
  })
);

router.post(
  '/admin/webhooks',
  requireAdmin,
  asyncHandler(async (request, response) => {
    const result = await createWebhook(
      request.tenantId,
      { url: request.body?.url, events: request.body?.events, description: request.body?.description },
      request.actor
    );
    await auditRequest(request, 'webhook.created', { target: result.webhook.url, detail: `Events: ${result.webhook.events.join(', ')}` });
    response.setHeader('Cache-Control', 'no-store');
    response.status(201).json(result);
  })
);

router.patch(
  '/admin/webhooks/:id',
  requireAdmin,
  asyncHandler(async (request, response) => {
    const body = request.body ?? {};
    const webhook = await updateWebhook(request.tenantId, request.params.id, {
      url: body.url,
      events: body.events,
      description: body.description,
      active: body.active
    });
    await auditRequest(request, 'webhook.updated', {
      target: webhook.url,
      detail: `${webhook.active ? 'Active' : 'Paused'} · Events: ${webhook.events.join(', ')}`
    });
    response.json({ webhook });
  })
);

router.delete(
  '/admin/webhooks/:id',
  requireAdmin,
  asyncHandler(async (request, response) => {
    const existing = (await listWebhooks(request.tenantId)).find((hook) => hook.id === request.params.id);
    const result = await deleteWebhook(request.tenantId, request.params.id);
    await auditRequest(request, 'webhook.deleted', { target: existing?.url ?? request.params.id });
    response.json(result);
  })
);

router.post(
  '/admin/webhooks/:id/rotate-secret',
  requireAdmin,
  asyncHandler(async (request, response) => {
    const result = await rotateWebhookSecret(request.tenantId, request.params.id);
    await auditRequest(request, 'webhook.secret_rotated', { target: result.webhook.url });
    response.setHeader('Cache-Control', 'no-store');
    response.json(result);
  })
);

router.post(
  '/admin/webhooks/:id/test',
  requireAdmin,
  asyncHandler(async (request, response) => {
    const delivery = await sendTestEvent(request.tenantId, request.params.id);
    response.json({ delivery });
  })
);

router.get(
  '/admin/webhooks/:id/deliveries',
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json({ items: await listDeliveries(request.tenantId, { webhookId: request.params.id, limit: request.query.limit }) });
  })
);

/* ── Activity log ────────────────────────────────────────────────────────── */

router.get(
  '/admin/activity',
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(
      await listActivity(request.tenantId, {
        limit: request.query.limit,
        before: request.query.before,
        action: request.query.action,
        actor: request.query.actor,
        q: request.query.q
      })
    );
  })
);

/* ── Self-learning memory ────────────────────────────────────────────────── */

router.get(
  '/learning/memory',
  asyncHandler(async (request, response) => {
    const recent = Math.min(Math.max(Number(request.query.recent) || 25, 1), 100);
    response.json(await memoryStats({ recent }));
  })
);

router.delete(
  '/learning/memory',
  requireAdmin,
  asyncHandler(async (request, response) => {
    const result = await clearMemory();
    await auditRequest(request, 'learning.memory_cleared', { detail: `Forgot ${result.removed} correction(s).` });
    response.json(result);
  })
);

/* ── Workspaces (platform administrators) ────────────────────────────────── */

function describeWorkspace(tenant, counts) {
  const tally = counts.get(tenant.id) ?? { members: 0, administrators: 0 };
  return {
    id: tenant.id,
    name: tenant.companyName || tenant.id,
    businessType: tenant.businessType ?? null,
    contactName: tenant.contactName ?? null,
    contactEmail: tenant.contactEmail ?? null,
    country: tenant.country ?? null,
    createdAt: tenant.createdAt ?? null,
    status: tenant.status === TenantStatus.ARCHIVED ? TenantStatus.ARCHIVED : TenantStatus.ACTIVE,
    archivedAt: tenant.archivedAt ?? null,
    archivedBy: tenant.archivedBy ?? null,
    members: tally.members,
    administrators: tally.administrators
  };
}

router.get('/admin/workspaces', requirePlatformAdmin, (request, response) => {
  const counts = workspaceMemberCounts();
  response.setHeader('Cache-Control', 'no-store');
  response.json({ items: listTenants().map((tenant) => describeWorkspace(tenant, counts)), current: request.tenantId });
});

router.post(
  '/admin/workspaces/:id/archive',
  requirePlatformAdmin,
  asyncHandler(async (request, response) => {
    const { id } = request.params;
    if (id === request.tenantId) throw badRequest('Switch to another workspace before archiving the one you are working in.');
    const tenant = await setTenantStatus(id, TenantStatus.ARCHIVED, { by: request.principal.email });
    const sessions = await rehomeWorkspaceSessions(id);
    // Logged in the archived workspace itself, so another client's name never
    // appears in the activity log of the workspace the administrator is in.
    await auditRequest(request, 'workspace.archived', {
      tenantId: id,
      target: tenant.companyName,
      detail: `Signed-in sessions: ${sessions.moved} moved to another workspace, ${sessions.ended} ended.`
    });
    response.json({ workspace: describeWorkspace(tenant, workspaceMemberCounts()), sessions });
  })
);

router.post(
  '/admin/workspaces/:id/restore',
  requirePlatformAdmin,
  asyncHandler(async (request, response) => {
    const tenant = await setTenantStatus(request.params.id, TenantStatus.ACTIVE, { by: request.principal.email });
    await auditRequest(request, 'workspace.restored', { tenantId: tenant.id, target: tenant.companyName });
    response.json({ workspace: describeWorkspace(tenant, workspaceMemberCounts()) });
  })
);

export default router;
