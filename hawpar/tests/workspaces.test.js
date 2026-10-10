/**
 * Workspace lifecycle: platform administrators can archive a workspace to
 * close it to everyone (people, sessions and API keys) without losing any of
 * its data, and restore it later exactly as it was.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import './helpers/isolation.js';

// A private data directory keeps this suite's accounts apart from other suites.
process.env.DATA_DIR = path.join(process.env.DATA_DIR ?? '', 'workspace-lifecycle');
process.env.VGC_TEST_AUTH_BYPASS = '';
process.env.RATE_LIMIT_AUTH_PER_MINUTE = '500';

const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config/index.js');
const { initialiseTenantRegistry, setTenantStatus } = await import('../src/services/tenant.service.js');
const { initialiseIdentity } = await import('../src/services/identity.service.js');
const { flushIdentityWrites } = await import('../src/services/identity.store.js');
const { initialiseStore } = await import('../src/services/store.service.js');
const { generateSamplePdf } = await import('../src/services/sample.service.js');
const { waitForIdle } = await import('../src/services/pipeline.service.js');

const PLATFORM_ADMIN = { email: 'platform@lifecycle.example', password: 'Lifecycle-Admin-1', name: 'Platform Admin' };
const OWNER_A = { email: 'owner@retiring.example', password: 'Retiring-Owner-1', name: 'Retiring Owner' };
const OWNER_B = { email: 'owner@keeper.example', password: 'Keeper-Owner-Pass-1', name: 'Keeper Owner' };
const SHARED = { email: 'analyst@shared.example', password: 'Shared-Analyst-1' };

let server;
let baseUrl;

before(async () => {
  await initialiseTenantRegistry();
  await initialiseIdentity();
  await initialiseStore();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function call(method, route, { cookie, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

async function signUp(companyName, account) {
  const result = await call('POST', '/onboarding', { body: { companyName, businessType: 'Professional Services', account } });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return { id: result.json.tenant.id, cookie: result.cookie };
}

const state = {};

describe('workspace lifecycle', () => {
  test('should_prepare_two_workspaces_with_a_shared_member', async () => {
    const setup = await call('POST', '/auth/setup', { body: PLATFORM_ADMIN });
    assert.equal(setup.status, 201, JSON.stringify(setup.json));
    state.adminCookie = setup.cookie;

    const retiring = await signUp('Retiring Ventures', OWNER_A);
    const keeper = await signUp('Keeper Holdings', OWNER_B);
    Object.assign(state, { retiringId: retiring.id, ownerACookie: retiring.cookie, keeperId: keeper.id, ownerBCookie: keeper.cookie });

    const invited = await call('POST', '/admin/members', { cookie: state.ownerACookie, body: { email: SHARED.email, role: 'user' } });
    assert.equal(invited.status, 201, JSON.stringify(invited.json));
    const alsoInB = await call('POST', '/admin/members', { cookie: state.ownerBCookie, body: { email: SHARED.email, role: 'user' } });
    assert.equal(alsoInB.status, 201, JSON.stringify(alsoInB.json));
    const firstLogin = await call('POST', '/auth/login', { body: { email: SHARED.email, password: invited.json.temporaryPassword, tenantId: state.retiringId } });
    assert.equal(firstLogin.json.workspace.id, state.retiringId);
    const changed = await call('POST', '/auth/password', {
      cookie: firstLogin.cookie,
      body: { currentPassword: invited.json.temporaryPassword, newPassword: SHARED.password }
    });
    assert.equal(changed.status, 200);
    state.sharedCookie = firstLogin.cookie;

    const key = await call('POST', '/admin/api-keys', { cookie: state.ownerACookie, body: { name: 'ERP connector', role: 'user' } });
    assert.equal(key.status, 201);
    state.retiringKey = key.json.key;

    const { buffer, mimeType } = await generateSamplePdf('supplier_invoice', 'lifecycle-test');
    const form = new FormData();
    form.append('files', new Blob([buffer], { type: mimeType }), 'retiring-invoice.pdf');
    const upload = await fetch(`${baseUrl}/documents`, { method: 'POST', body: form, headers: { Cookie: state.ownerACookie } });
    assert.equal(upload.status, 202);
    state.documentId = (await upload.json()).accepted[0].id;
    await waitForIdle();
  });

  test('should_list_every_workspace_with_its_members_for_a_platform_administrator', async () => {
    const result = await call('GET', '/admin/workspaces', { cookie: state.adminCookie });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    const retiring = result.json.items.find((item) => item.id === state.retiringId);
    assert.equal(retiring.name, 'Retiring Ventures');
    assert.equal(retiring.status, 'active');
    assert.equal(retiring.members, 2);
    assert.equal(retiring.administrators, 1);
    assert.equal(result.json.current, 'default');
  });

  test('should_keep_the_lifecycle_away_from_workspace_administrators_and_api_keys', async () => {
    assert.equal((await call('GET', '/admin/workspaces', { cookie: state.ownerBCookie })).status, 403);
    assert.equal((await call('POST', `/admin/workspaces/${state.retiringId}/archive`, { cookie: state.ownerBCookie })).status, 403);
    assert.equal((await call('GET', '/admin/workspaces', { headers: { 'x-api-key': state.retiringKey } })).status, 403);
  });

  test('should_refuse_to_archive_the_shared_the_current_or_an_unknown_workspace', async () => {
    assert.equal((await call('POST', '/admin/workspaces/default/archive', { cookie: state.adminCookie, headers: { 'x-tenant-id': state.keeperId } })).status, 400);
    const current = await call('POST', `/admin/workspaces/${state.retiringId}/archive`, { cookie: state.adminCookie, headers: { 'x-tenant-id': state.retiringId } });
    assert.equal(current.status, 400);
    assert.match(current.json.error.message, /Switch to another workspace/);
    assert.equal((await call('POST', '/admin/workspaces/no-such-workspace/archive', { cookie: state.adminCookie })).status, 404);
  });

  test('should_archive_a_workspace_and_move_or_end_the_sessions_working_in_it', async () => {
    const result = await call('POST', `/admin/workspaces/${state.retiringId}/archive`, { cookie: state.adminCookie });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.workspace.status, 'archived');
    assert.equal(result.json.workspace.archivedBy, PLATFORM_ADMIN.email);
    assert.ok(result.json.workspace.archivedAt);
    assert.deepEqual(result.json.sessions, { moved: 1, ended: 1 });

    const shared = await call('GET', '/auth/session', { cookie: state.sharedCookie });
    assert.equal(shared.json.authenticated, true, 'a member of another workspace stays signed in');
    assert.equal(shared.json.workspace.id, state.keeperId);
    assert.ok(!shared.json.workspaces.some((workspace) => workspace.id === state.retiringId));

    assert.equal((await call('GET', '/auth/me', { cookie: state.ownerACookie })).status, 401, 'a member with nowhere else to go is signed out');
    const relogin = await call('POST', '/auth/login', { body: OWNER_A });
    assert.equal(relogin.status, 403);
    assert.match(relogin.json.error.message, /any active workspace/);
  });

  test('should_close_an_archived_workspace_to_people_and_api_keys', async () => {
    const pinned = await call('GET', '/documents', { cookie: state.sharedCookie, headers: { 'x-tenant-id': state.retiringId } });
    assert.equal(pinned.status, 403);
    assert.equal(pinned.json.error.reason, 'WORKSPACE_ARCHIVED');

    const admin = await call('GET', '/documents', { cookie: state.adminCookie, headers: { 'x-tenant-id': state.retiringId } });
    assert.equal(admin.status, 403, 'platform administrators must restore it first');
    const adminSession = await call('GET', '/auth/session', { cookie: state.adminCookie });
    assert.ok(!adminSession.json.workspaces.some((workspace) => workspace.id === state.retiringId));

    assert.equal((await call('GET', '/documents', { headers: { 'x-api-key': state.retiringKey } })).status, 401);
    assert.equal((await call('POST', '/auth/workspace', { cookie: state.sharedCookie, body: { tenantId: state.retiringId } })).status, 403);
    assert.equal((await call('POST', `/admin/workspaces/${state.retiringId}/archive`, { cookie: state.adminCookie })).status, 409);
  });

  test('should_restore_a_workspace_with_its_documents_keys_and_history', async () => {
    const result = await call('POST', `/admin/workspaces/${state.retiringId}/restore`, { cookie: state.adminCookie });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.workspace.status, 'active');
    assert.equal(result.json.workspace.archivedAt, null);
    assert.equal((await call('POST', `/admin/workspaces/${state.retiringId}/restore`, { cookie: state.adminCookie })).status, 409);

    const login = await call('POST', '/auth/login', { body: OWNER_A });
    assert.equal(login.status, 200);
    assert.equal(login.json.workspace.id, state.retiringId);

    const documents = await call('GET', '/documents', { headers: { 'x-api-key': state.retiringKey } });
    assert.equal(documents.status, 200, 'the API key works again');
    assert.ok(documents.json.items.some((item) => item.id === state.documentId), 'documents survive archiving');

    const activity = await call('GET', '/admin/activity?action=workspace.', { cookie: login.cookie });
    const actions = activity.json.items.map((entry) => entry.action);
    assert.deepEqual(actions.slice(0, 2), ['workspace.restored', 'workspace.archived']);
    assert.ok(actions.includes('workspace.created'));
    assert.equal(activity.json.items[0].actor, PLATFORM_ADMIN.email);

    const keeperActivity = await call('GET', '/admin/activity?action=workspace.', { cookie: state.ownerBCookie });
    assert.ok(
      !keeperActivity.json.items.some((entry) => entry.target === 'Retiring Ventures'),
      "another workspace's log never names the archived client"
    );
  });

  test('should_settle_sessions_left_in_an_archived_workspace_the_next_time_they_are_used', async () => {
    // As if the process stopped between archiving the workspace and moving
    // its sessions: the registry says archived, the sessions still point at it.
    const owner = await call('POST', '/auth/login', { body: OWNER_A });
    assert.equal(owner.json.workspace.id, state.retiringId);
    const shared = await call('POST', '/auth/login', { body: { ...SHARED, tenantId: state.retiringId } });
    assert.equal(shared.json.workspace.id, state.retiringId);
    await setTenantStatus(state.retiringId, 'archived', { by: PLATFORM_ADMIN.email });

    try {
      const session = await call('GET', '/auth/session', { cookie: shared.cookie });
      assert.equal(session.json.authenticated, true);
      assert.equal(session.json.workspace.id, state.keeperId, 'moved to a workspace they can still open');
      assert.equal(session.json.workspace.role, 'user');
      assert.equal((await call('GET', '/documents', { cookie: shared.cookie })).status, 200, 'and can work there straight away');
      assert.equal((await call('GET', '/auth/me', { cookie: owner.cookie })).status, 401, 'nowhere else to go: signed out');

      await flushIdentityWrites();
      const stored = JSON.parse(await fs.readFile(path.join(config.dataDir, 'identity', 'sessions.json'), 'utf8'));
      assert.equal(stored.find((entry) => entry.publicId === shared.json.session.id)?.tenantId, state.keeperId, 'the move is saved');
      assert.ok(!stored.some((entry) => entry.publicId === owner.json.session.id), 'the ended session is gone from disk');
    } finally {
      await setTenantStatus(state.retiringId, 'active', { by: PLATFORM_ADMIN.email });
    }
  });

  test('should_start_a_platform_administrator_without_memberships_in_the_shared_workspace', async () => {
    const switched = await call('POST', '/auth/workspace', { cookie: state.adminCookie, body: { tenantId: state.keeperId } });
    assert.equal(switched.status, 200, JSON.stringify(switched.json));
    // With their last workspace gone, they fall back to the shared workspace,
    // not whichever client workspace happens to sort first.
    await setTenantStatus(state.keeperId, 'archived', { by: PLATFORM_ADMIN.email });
    try {
      const login = await call('POST', '/auth/login', { body: { email: PLATFORM_ADMIN.email, password: PLATFORM_ADMIN.password } });
      assert.equal(login.status, 200, JSON.stringify(login.json));
      assert.equal(login.json.workspace.id, 'default');
      assert.ok(login.json.workspaces.some((workspace) => workspace.id === state.retiringId), 'client workspaces stay one switch away');
    } finally {
      await setTenantStatus(state.keeperId, 'active', { by: PLATFORM_ADMIN.email });
    }
  });
});
