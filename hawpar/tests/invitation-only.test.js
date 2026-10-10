/**
 * Invitation-only deployments (SELF_SIGNUP=false): nobody can sign up, and
 * only platform administrators may provision new workspaces — an invited
 * operator must not be able to spin up workspaces of their own.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import './helpers/isolation.js';

// Configuration is frozen on first import, so the overrides come first. A
// private data directory keeps this suite's identity store apart from the
// accounts other suites create in the shared temporary one.
process.env.DATA_DIR = path.join(process.env.DATA_DIR ?? '', 'invitation-only');
process.env.SELF_SIGNUP = 'false';
process.env.VGC_TEST_AUTH_BYPASS = '';
process.env.RATE_LIMIT_AUTH_PER_MINUTE = '500';

const { createApp } = await import('../src/app.js');
const { initialiseTenantRegistry } = await import('../src/services/tenant.service.js');
const { initialiseIdentity } = await import('../src/services/identity.service.js');
const { initialiseStore } = await import('../src/services/store.service.js');

const PLATFORM_ADMIN = { email: 'platform@invite-only.example', password: 'Invite-Only-Admin-1', name: 'Platform Admin' };

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

async function call(method, route, { cookie, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

const state = {};

describe('invitation-only deployment', () => {
  test('should_advertise_that_signup_is_closed', async () => {
    const setup = await call('POST', '/auth/setup', { body: PLATFORM_ADMIN });
    assert.equal(setup.status, 201, JSON.stringify(setup.json));
    state.adminCookie = setup.cookie;
    const session = await call('GET', '/auth/session');
    assert.equal(session.json.options.selfSignup, false);
  });

  test('should_refuse_anonymous_signup', async () => {
    const result = await call('POST', '/onboarding', {
      body: { companyName: 'Walk-in Ltd', businessType: 'Logistics & Supply Chain', account: { email: 'walkin@example.com', password: 'Walk-In-Pass-123', name: 'Walk In' } }
    });
    assert.equal(result.status, 403);
  });

  test('should_refuse_workspace_creation_by_an_invited_operator', async () => {
    const added = await call('POST', '/admin/members', { cookie: state.adminCookie, body: { email: 'invited@example.com', role: 'user' } });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const login = await call('POST', '/auth/login', { body: { email: 'invited@example.com', password: added.json.temporaryPassword } });
    assert.equal(login.status, 200);
    const changed = await call('POST', '/auth/password', {
      cookie: login.cookie,
      body: { currentPassword: added.json.temporaryPassword, newPassword: 'Invited-Chosen-Pass-1' }
    });
    assert.equal(changed.status, 200);

    const result = await call('POST', '/onboarding', {
      cookie: login.cookie,
      body: { companyName: 'Side Project Ltd', businessType: 'Logistics & Supply Chain' }
    });
    assert.equal(result.status, 403);
    assert.match(result.json.error.message, /platform administrators/);
    const workspaces = await call('GET', '/auth/session', { cookie: state.adminCookie });
    assert.ok(!workspaces.json.workspaces.some((workspace) => workspace.name === 'Side Project Ltd'), 'nothing may be provisioned');
  });

  test('should_let_a_platform_administrator_provision_a_workspace', async () => {
    const result = await call('POST', '/onboarding', {
      cookie: state.adminCookie,
      body: { companyName: 'Provisioned Client Ltd', businessType: 'Logistics & Supply Chain' }
    });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    assert.equal(result.json.session.workspace.name, 'Provisioned Client Ltd');
    assert.equal(result.json.session.workspace.role, 'admin');
  });
});
