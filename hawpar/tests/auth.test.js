/**
 * Identity and access tests: the production guard, first-run setup, sign-in
 * and lockout, self-service signup, workspace isolation, members and roles,
 * forced password change, workspace API keys, CSRF defence and the activity log.
 *
 * Runs with the test bypass switched OFF, so the real session guard is
 * exercised even under `npm test`, which sets VGC_TEST_AUTH_BYPASS=1 for the
 * legacy suites.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import './helpers/isolation.js';

process.env.VGC_TEST_AUTH_BYPASS = '';
// Generous auth limit: this suite signs in many times within a minute.
process.env.RATE_LIMIT_AUTH_PER_MINUTE = '500';

const { createApp } = await import('../src/app.js');
const { initialiseTenantRegistry } = await import('../src/services/tenant.service.js');
const { initialiseIdentity } = await import('../src/services/identity.service.js');
const { initialiseStore } = await import('../src/services/store.service.js');
const { generateSamplePdf } = await import('../src/services/sample.service.js');
const { waitForIdle } = await import('../src/services/pipeline.service.js');

const PLATFORM_ADMIN = { email: 'platform.admin@example.com', password: 'Platform-Admin-2024!', name: 'Platform Admin' };
const OWNER = { email: 'owner@acme.example', password: 'Acme-Owner-Pass-1', name: 'Acme Owner' };

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

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';')[0] ?? null;
}

async function call(method, path, { cookie, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json, cookie: cookieFrom(response), headers: response.headers };
}

async function signIn(email, password, extra = {}) {
  const result = await call('POST', '/auth/login', { body: { email, password, ...extra } });
  assert.equal(result.status, 200, `sign-in failed for ${email}: ${JSON.stringify(result.json)}`);
  assert.ok(result.cookie, 'sign-in must set the session cookie');
  return result;
}

const state = {};

describe('production guard', () => {
  test('should_reject_data_routes_without_a_session', async () => {
    assert.equal((await call('GET', '/documents')).status, 401);
    assert.equal((await call('GET', '/settings')).status, 401);
    assert.equal((await call('POST', '/samples/run', { body: {} })).status, 401);
  });

  test('should_keep_capability_discovery_open_for_the_sign_in_screen', async () => {
    assert.equal((await call('GET', '/health')).status, 200);
    assert.equal((await call('GET', '/config')).status, 200);
  });

  test('should_ignore_legacy_role_headers_when_the_bypass_is_off', async () => {
    const result = await call('GET', '/documents', { headers: { 'x-user-role': 'admin', 'x-user-operator': 'spoof@example.com' } });
    assert.equal(result.status, 401);
  });

  test('should_offer_first_run_setup_while_no_account_exists', async () => {
    const result = await call('GET', '/auth/session');
    assert.equal(result.status, 200);
    assert.equal(result.json.authenticated, false);
    assert.equal(result.json.options.setupRequired, true);
    assert.equal(result.json.options.passwordMinLength, 10);
  });
});

describe('first-run setup and sign-in', () => {
  test('should_reject_a_weak_setup_password', async () => {
    const result = await call('POST', '/auth/setup', { body: { email: PLATFORM_ADMIN.email, password: 'short' } });
    assert.equal(result.status, 400);
  });

  test('should_create_the_platform_administrator_and_sign_them_in', async () => {
    const result = await call('POST', '/auth/setup', { body: PLATFORM_ADMIN });
    assert.equal(result.status, 201);
    assert.ok(result.cookie);
    assert.match(result.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(result.headers.get('set-cookie'), /SameSite=Lax/i);
    assert.equal(result.json.user.platformAdmin, true);
    assert.equal(result.json.workspace.id, 'default');
    assert.equal(result.json.workspace.role, 'admin');
    assert.equal(result.json.user.passwordHash, undefined, 'the password hash must never be serialised');
    state.adminCookie = result.cookie;
  });

  test('should_refuse_a_second_setup', async () => {
    const result = await call('POST', '/auth/setup', { body: { email: 'other@example.com', password: 'Another-Long-Pass-1' } });
    assert.equal(result.status, 409);
  });

  test('should_serve_data_routes_to_the_signed_in_administrator', async () => {
    const me = await call('GET', '/auth/me', { cookie: state.adminCookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, PLATFORM_ADMIN.email);
    assert.equal((await call('GET', '/documents', { cookie: state.adminCookie })).status, 200);
  });

  test('should_answer_wrong_passwords_and_unknown_emails_identically', async () => {
    const wrong = await call('POST', '/auth/login', { body: { email: PLATFORM_ADMIN.email, password: 'Not-The-Password-1' } });
    const unknown = await call('POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'Not-The-Password-1' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.json.error.message, unknown.json.error.message);
  });

  test('should_sign_in_case_insensitively_and_list_the_session', async () => {
    const result = await signIn(PLATFORM_ADMIN.email.toUpperCase(), PLATFORM_ADMIN.password);
    const sessions = await call('GET', '/auth/sessions', { cookie: result.cookie });
    assert.equal(sessions.status, 200);
    assert.ok(sessions.json.items.length >= 2);
    assert.equal(sessions.json.items.filter((item) => item.current).length, 1);
    state.secondAdminCookie = result.cookie;
  });
});

describe('self-service signup and workspace isolation', () => {
  test('should_require_an_administrator_account_for_anonymous_signup', async () => {
    const result = await call('POST', '/onboarding', { body: { companyName: 'No Account Ltd', businessType: 'Healthcare & Life Sciences' } });
    assert.equal(result.status, 400);
  });

  test('should_not_provision_a_workspace_when_the_account_is_invalid', async () => {
    const result = await call('POST', '/onboarding', {
      body: { companyName: 'Weak Password Ltd', businessType: 'Healthcare & Life Sciences', account: { email: 'weak@example.com', password: 'short' } }
    });
    assert.equal(result.status, 400);
    const sessionList = await call('GET', '/auth/session', { cookie: state.adminCookie });
    assert.ok(!sessionList.json.workspaces.some((workspace) => workspace.name === 'Weak Password Ltd'));
  });

  test('should_create_the_workspace_and_its_administrator_and_sign_them_in', async () => {
    const result = await call('POST', '/onboarding', {
      body: {
        companyName: 'Acme Holdings',
        businessType: 'Logistics & Supply Chain',
        contactName: OWNER.name,
        contactEmail: OWNER.email,
        country: 'Singapore',
        account: OWNER
      }
    });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    assert.ok(result.cookie);
    assert.equal(result.json.session.workspace.id, result.json.tenant.id);
    assert.equal(result.json.session.workspace.role, 'admin');
    assert.equal(result.json.session.user.platformAdmin, false);
    state.acmeId = result.json.tenant.id;
    state.ownerCookie = result.cookie;
    state.ownerId = result.json.session.user.id;
  });

  test('should_reject_signup_with_an_email_that_already_has_an_account', async () => {
    const result = await call('POST', '/onboarding', {
      body: { companyName: 'Duplicate Co', businessType: 'Healthcare & Life Sciences', account: OWNER }
    });
    assert.equal(result.status, 409);
  });

  test('should_keep_each_workspace_documents_private', async () => {
    const { buffer, mimeType } = await generateSamplePdf('supplier_invoice', 'isolation-test');
    const form = new FormData();
    form.append('files', new Blob([buffer], { type: mimeType }), 'acme-invoice.pdf');
    const upload = await fetch(`${baseUrl}/documents`, { method: 'POST', body: form, headers: { Cookie: state.ownerCookie } });
    assert.equal(upload.status, 202);
    const uploaded = (await upload.json()).accepted[0];
    assert.equal(uploaded.status !== undefined, true);
    await waitForIdle();
    state.acmeDocumentId = uploaded.id;

    const ownerList = await call('GET', '/documents', { cookie: state.ownerCookie });
    assert.ok(ownerList.json.items.some((item) => item.id === uploaded.id), 'the upload must land in the uploader\'s workspace');

    const sharedList = await call('GET', '/documents', { cookie: state.adminCookie });
    assert.ok(!sharedList.json.items.some((item) => item.id === uploaded.id), 'another workspace must not see it');

    const record = await call('GET', `/documents/${uploaded.id}`, { cookie: state.ownerCookie });
    assert.equal(record.json.audit[0].action, 'uploaded');
    assert.equal(record.json.audit[0].actor, OWNER.email, 'the upload is attributed to the signed-in uploader');
  });

  test('should_refuse_a_workspace_the_caller_is_not_a_member_of', async () => {
    const result = await call('GET', '/documents', { cookie: state.ownerCookie, headers: { 'x-tenant-id': 'default' } });
    assert.equal(result.status, 403);
    const stream = await call('GET', '/documents?tenantId=default', { cookie: state.ownerCookie });
    assert.equal(stream.status, 403);
  });

  test('should_let_a_platform_administrator_open_any_workspace', async () => {
    const result = await call('GET', '/documents', { cookie: state.adminCookie, headers: { 'x-tenant-id': state.acmeId } });
    assert.equal(result.status, 200);
    assert.ok(result.json.items.some((item) => item.id === state.acmeDocumentId));
  });

  test('should_switch_the_session_workspace', async () => {
    const switched = await call('POST', '/auth/workspace', { cookie: state.secondAdminCookie, body: { tenantId: state.acmeId } });
    assert.equal(switched.status, 200);
    assert.equal(switched.json.workspace.id, state.acmeId);
    const list = await call('GET', '/documents', { cookie: state.secondAdminCookie });
    assert.ok(list.json.items.some((item) => item.id === state.acmeDocumentId));
    const denied = await call('POST', '/auth/workspace', { cookie: state.ownerCookie, body: { tenantId: 'default' } });
    assert.equal(denied.status, 403);
  });
});

describe('members, roles and forced password change', () => {
  test('should_add_a_member_with_a_one_time_password', async () => {
    const result = await call('POST', '/admin/members', {
      cookie: state.ownerCookie,
      body: { email: 'Clerk@Acme.example', name: 'Acme Clerk', role: 'user' }
    });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    assert.equal(result.json.created, true);
    assert.equal(result.json.member.email, 'clerk@acme.example');
    assert.equal(result.json.member.role, 'user');
    assert.equal(result.json.temporaryPassword.length, 16);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    state.clerkId = result.json.member.id;
    state.clerkTemp = result.json.temporaryPassword;
  });

  test('should_reject_adding_the_same_member_twice', async () => {
    const result = await call('POST', '/admin/members', { cookie: state.ownerCookie, body: { email: 'clerk@acme.example', role: 'user' } });
    assert.equal(result.status, 409);
  });

  test('should_require_a_password_change_before_anything_else', async () => {
    const login = await signIn('clerk@acme.example', state.clerkTemp);
    assert.equal(login.json.user.mustChangePassword, true);
    const blocked = await call('GET', '/documents', { cookie: login.cookie });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error.reason, 'PASSWORD_CHANGE_REQUIRED');

    const wrongCurrent = await call('POST', '/auth/password', {
      cookie: login.cookie,
      body: { currentPassword: 'not-it-at-all', newPassword: 'Clerk-Chosen-Pass-1' }
    });
    assert.equal(wrongCurrent.status, 400);

    const changed = await call('POST', '/auth/password', {
      cookie: login.cookie,
      body: { currentPassword: state.clerkTemp, newPassword: 'Clerk-Chosen-Pass-1' }
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.json.user.mustChangePassword, false);
    assert.equal((await call('GET', '/documents', { cookie: login.cookie })).status, 200);
    state.clerkCookie = login.cookie;
  });

  test('should_keep_operators_out_of_administration', async () => {
    assert.equal((await call('GET', '/admin/members', { cookie: state.clerkCookie })).status, 403);
    assert.equal((await call('GET', '/admin/api-keys', { cookie: state.clerkCookie })).status, 403);
    assert.equal((await call('GET', '/admin/activity', { cookie: state.clerkCookie })).status, 403);
    assert.equal((await call('DELETE', '/admin/reset', { cookie: state.clerkCookie })).status, 403);
    assert.equal((await call('DELETE', '/learning/memory', { cookie: state.clerkCookie })).status, 403);
    const settings = await call('GET', '/settings', { cookie: state.clerkCookie });
    assert.equal(settings.json.role, 'user');
    assert.equal(settings.json.editable, false);
  });

  test('should_attribute_actions_to_the_signed_in_operator', async () => {
    const decision = await call('POST', `/documents/${state.acmeDocumentId}/decision`, {
      cookie: state.clerkCookie,
      body: { decision: 'approve', actor: 'forged@example.com' }
    });
    assert.equal(decision.status, 200, JSON.stringify(decision.json));
    assert.equal(decision.json.audit.at(-1).actor, 'clerk@acme.example');
  });

  test('should_protect_the_last_administrator', async () => {
    const demote = await call('PATCH', `/admin/members/${state.ownerId}`, { cookie: state.ownerCookie, body: { role: 'user' } });
    assert.equal(demote.status, 409);
    const remove = await call('DELETE', `/admin/members/${state.ownerId}`, { cookie: state.ownerCookie });
    assert.equal(remove.status, 409);
  });

  test('should_let_a_platform_administrator_change_the_last_administrator', async () => {
    // The Shared workspace has no explicit administrator: platform administrators run it.
    const added = await call('POST', '/admin/members', { cookie: state.adminCookie, body: { email: 'deputy@example.com', role: 'admin' } });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const deputyId = added.json.member.id;
    const demote = await call('PATCH', `/admin/members/${deputyId}`, { cookie: state.adminCookie, body: { role: 'user' } });
    assert.equal(demote.status, 200, 'a platform administrator keeps access, so nobody is locked out');
    assert.equal(demote.json.member.role, 'user');
    const promote = await call('PATCH', `/admin/members/${deputyId}`, { cookie: state.adminCookie, body: { role: 'admin' } });
    assert.equal(promote.status, 200);
    const remove = await call('DELETE', `/admin/members/${deputyId}`, { cookie: state.adminCookie });
    assert.equal(remove.status, 200);
    const members = await call('GET', '/admin/members', { cookie: state.adminCookie });
    assert.ok(!members.json.items.some((member) => member.id === deputyId));
  });

  test('should_promote_and_demote_a_member', async () => {
    const promote = await call('PATCH', `/admin/members/${state.clerkId}`, { cookie: state.ownerCookie, body: { role: 'admin' } });
    assert.equal(promote.status, 200);
    assert.equal(promote.json.member.role, 'admin');
    assert.equal((await call('GET', '/admin/members', { cookie: state.clerkCookie })).status, 200, 'the new role applies immediately');
    const demote = await call('PATCH', `/admin/members/${state.clerkId}`, { cookie: state.ownerCookie, body: { role: 'user' } });
    assert.equal(demote.json.member.role, 'user');
    assert.equal((await call('GET', '/admin/members', { cookie: state.clerkCookie })).status, 403);
  });

  test('should_reset_a_member_password_and_end_their_sessions', async () => {
    const reset = await call('POST', `/admin/members/${state.clerkId}/reset-password`, { cookie: state.ownerCookie });
    assert.equal(reset.status, 200);
    assert.equal(reset.json.temporaryPassword.length, 16);
    assert.equal((await call('GET', '/auth/me', { cookie: state.clerkCookie })).status, 401);
    const relogin = await signIn('clerk@acme.example', reset.json.temporaryPassword);
    assert.equal(relogin.json.user.mustChangePassword, true);
  });

  test('should_not_let_a_workspace_admin_reset_an_account_shared_with_another_workspace', async () => {
    const shared = await call('POST', '/admin/members', { cookie: state.adminCookie, body: { email: OWNER.email, role: 'user' } });
    assert.equal(shared.status, 201);
    assert.equal(shared.json.created, false, 'an existing account gains a membership, no new password');
    assert.equal(shared.json.temporaryPassword, null);
    const sharedOwner = await call('POST', `/admin/members/${state.ownerId}/reset-password`, { cookie: state.ownerCookie });
    assert.equal(sharedOwner.status, 403);
  });

  test('should_remove_a_member_and_revoke_their_workspace_access', async () => {
    const removed = await call('DELETE', `/admin/members/${state.ownerId}`, { cookie: state.adminCookie, headers: { 'x-tenant-id': 'default' } });
    assert.equal(removed.status, 200);
    const denied = await call('GET', '/documents', { cookie: state.ownerCookie, headers: { 'x-tenant-id': 'default' } });
    assert.equal(denied.status, 403);
    assert.equal((await call('GET', '/documents', { cookie: state.ownerCookie })).status, 200, 'their own workspace is untouched');
  });
});

describe('workspace API keys', () => {
  test('should_issue_a_key_once_and_store_only_a_preview', async () => {
    const created = await call('POST', '/admin/api-keys', { cookie: state.ownerCookie, body: { name: 'ERP connector', role: 'user' } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.match(created.json.key, /^vgc_[a-f0-9]{12}_[A-Za-z0-9_-]{32}$/);
    state.apiKey = created.json.key;
    state.apiKeyId = created.json.apiKey.id;
    const list = await call('GET', '/admin/api-keys', { cookie: state.ownerCookie });
    assert.equal(list.json.items.length, 1);
    assert.equal(list.json.items[0].key, undefined);
    // The secret is base64url and may itself contain "_", so take everything after the id.
    const secret = state.apiKey.slice('vgc_'.length + 12 + 1);
    assert.equal(secret.length, 32);
    assert.ok(!JSON.stringify(list.json).includes(secret));
  });

  test('should_authenticate_machine_calls_in_its_own_workspace_only', async () => {
    const list = await call('GET', '/documents', { headers: { 'x-api-key': state.apiKey } });
    assert.equal(list.status, 200);
    assert.ok(list.json.items.some((item) => item.id === state.acmeDocumentId));
    const crossTenant = await call('GET', '/documents', { headers: { 'x-api-key': state.apiKey, 'x-tenant-id': 'default' } });
    assert.equal(crossTenant.status, 403);
  });

  test('should_not_let_an_api_key_manage_keys_or_members', async () => {
    const adminKey = await call('POST', '/admin/api-keys', { cookie: state.ownerCookie, body: { name: 'Automation admin', role: 'admin' } });
    assert.equal(adminKey.status, 201);
    const mint = await call('POST', '/admin/api-keys', { headers: { 'x-api-key': adminKey.json.key }, body: { name: 'escalation', role: 'admin' } });
    assert.equal(mint.status, 403);
    const invite = await call('POST', '/admin/members', { headers: { 'x-api-key': adminKey.json.key }, body: { email: 'x@acme.example' } });
    assert.equal(invite.status, 403);
    const workspaces = await call('POST', '/onboarding', {
      headers: { 'x-api-key': adminKey.json.key },
      body: { companyName: 'Key Created Co', businessType: 'Healthcare & Life Sciences' }
    });
    assert.equal(workspaces.status, 403);
  });

  test('should_reject_an_invalid_or_revoked_key', async () => {
    assert.equal((await call('GET', '/documents', { headers: { 'x-api-key': 'vgc_000000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } })).status, 401);
    const revoked = await call('DELETE', `/admin/api-keys/${state.apiKeyId}`, { cookie: state.ownerCookie });
    assert.equal(revoked.status, 200);
    assert.ok(revoked.json.apiKey.revokedAt);
    assert.equal((await call('GET', '/documents', { headers: { 'x-api-key': state.apiKey } })).status, 401);
  });
});

describe('sessions, CSRF defence and the activity log', () => {
  test('should_refuse_cross_site_writes_that_carry_the_session_cookie', async () => {
    const crossSite = await call('POST', '/samples/run', {
      cookie: state.ownerCookie,
      body: { sampleIds: ['inv-001'] },
      headers: { 'Sec-Fetch-Site': 'cross-site' }
    });
    assert.equal(crossSite.status, 403);
    const foreignOrigin = await call('PATCH', '/settings', {
      cookie: state.ownerCookie,
      body: { company: { name: 'Hijacked' } },
      headers: { Origin: 'https://evil.example' }
    });
    assert.equal(foreignOrigin.status, 403);
  });

  test('should_sign_out_other_sessions_after_a_password_change', async () => {
    const other = await signIn(OWNER.email, OWNER.password);
    const changed = await call('POST', '/auth/password', {
      cookie: state.ownerCookie,
      body: { currentPassword: OWNER.password, newPassword: 'Acme-Owner-Pass-2' }
    });
    assert.equal(changed.status, 200);
    assert.equal((await call('GET', '/auth/me', { cookie: other.cookie })).status, 401);
    assert.equal((await call('GET', '/auth/me', { cookie: state.ownerCookie })).status, 200);
    OWNER.password = 'Acme-Owner-Pass-2';
  });

  test('should_lock_an_account_after_repeated_failures', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await call('POST', '/auth/login', { body: { email: OWNER.email, password: `Wrong-Password-${attempt}` } });
      assert.equal(failed.status, 401);
    }
    const locked = await call('POST', '/auth/login', { body: { email: OWNER.email, password: OWNER.password } });
    assert.equal(locked.status, 429);
  });

  test('should_record_an_attributable_activity_log', async () => {
    const activity = await call('GET', '/admin/activity?limit=200', { cookie: state.ownerCookie });
    assert.equal(activity.status, 200);
    const actions = activity.json.items.map((entry) => entry.action);
    for (const expected of ['workspace.created', 'member.added', 'member.role_changed', 'member.password_reset', 'api_key.created', 'api_key.revoked', 'document.uploaded', 'document.approved', 'auth.login_failed']) {
      assert.ok(actions.includes(expected), `missing ${expected} in ${actions.join(', ')}`);
    }
    const added = activity.json.items.find((entry) => entry.action === 'member.added');
    assert.equal(added.actor, OWNER.email);
    for (const entry of activity.json.items.filter((item) => /^(member\.added|member\.role_changed|api_key\.created)$/.test(item.action))) {
      assert.match(entry.detail, /^Role: (Administrator|Operator)\b/, `roles are shown by name, not id: ${entry.detail}`);
    }
    const filtered = await call('GET', '/admin/activity?action=member.', { cookie: state.ownerCookie });
    assert.ok(filtered.json.items.every((entry) => entry.action.startsWith('member.')));
    const shared = await call('GET', '/admin/activity', { cookie: state.adminCookie, headers: { 'x-tenant-id': 'default' } });
    assert.ok(!shared.json.items.some((entry) => entry.action === 'api_key.created'), 'activity is per workspace');
  });

  test('should_end_the_session_on_sign_out', async () => {
    const logout = await call('POST', '/auth/logout', { cookie: state.ownerCookie });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await call('GET', '/documents', { cookie: state.ownerCookie })).status, 401);
  });
});
