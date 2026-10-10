/**
 * Identity, administration and integrations — end to end in a real browser.
 *
 * Journeys: sign-in validation; an administrator adds an operator, who must
 * replace the one-time password before entering; roles take effect at once and
 * are enforced by the server; API keys authenticate server-to-server calls and
 * die on revocation; webhooks deliver HMAC-signed events (a test event and a
 * real pipeline event) to a receiver; the activity log filters and exports;
 * signed-in devices and password changes; workspace creation and switching;
 * self-service signup; a platform administrator archives a workspace (its
 * owner is signed out, a tab working in it moves on) and restores it; sign-out.
 * Layout is checked at desktop, tablet and mobile sizes, and every page must
 * finish without console or network errors.
 *
 * Run: node scripts/e2e-identity.mjs
 *   E2E_BASE                                server under test (default http://127.0.0.1:8080)
 *   E2E_EMAIL/E2E_PASSWORD (or ADMIN_*)     a platform administrator
 *
 * Journeys that create workspaces or deliver webhooks run only against a local
 * server (which must be started with WEBHOOK_ALLOW_PRIVATE_TARGETS=1 so it may
 * call the suite's receiver); other bases get the non-destructive checks.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { CHROMIUM_EXE, artifact, credentials } from './lib/e2e-session.mjs';

const BASE = (process.env.E2E_BASE ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE);
const RUN = Date.now().toString(36);
const ADMIN = credentials();

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 }
};

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ''}`);
}

/* ── Webhook receiver ────────────────────────────────────────────────────── */

const received = [];
const receiver = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    received.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8'), at: Date.now() });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"received":true}');
  });
});
await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const RECEIVER_URL = `http://127.0.0.1:${receiver.address().port}/vgc-hook`;

function verifySignature(delivery, secret) {
  const header = String(delivery.headers['x-vgc-signature'] ?? '');
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  if (!parts.t || !parts.v1) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${delivery.body}`).digest('hex');
  return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

async function waitFor(predicate, timeout = 15000, interval = 200) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return null;
}

/* ── Browser sessions with error hygiene ─────────────────────────────────── */

const browser = await chromium.launch({ executablePath: CHROMIUM_EXE, headless: true });
const sessions = [];

/**
 * A browser context that records page errors, console errors and failed
 * requests. `expect(pattern)` whitelists a failure the suite causes on purpose.
 */
async function openSession(label, viewport) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const session = { label, context, page, viewport, expected: [], pageErrors: [], consoleErrors: [], badResponses: [] };
  const isExpected = (text) => session.expected.some((pattern) => pattern.test(text));
  page.on('pageerror', (error) => session.pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = `${message.text()} @ ${message.location()?.url ?? ''}`;
    if (!isExpected(text)) session.consoleErrors.push(text);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const text = `${response.status()} ${response.request().method()} ${response.url()}`;
    if (!isExpected(text)) session.badResponses.push(text);
  });
  session.expect = (pattern) => session.expected.push(pattern);
  sessions.push(session);
  return session;
}

async function signInThroughUi(page, { email, password }) {
  await page.waitForSelector('#auth-email', { timeout: 15000 });
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', password);
  await page.click('button.auth__submit');
}

async function waitForShell(page) {
  await page.waitForSelector('.auth', { state: 'detached', timeout: 20000 });
  await page.waitForSelector('#view-root div.view', { timeout: 20000 });
}

async function go(page, hash, readySelector) {
  await page.evaluate((target) => {
    location.hash = target;
  }, hash);
  if (readySelector) await page.waitForSelector(readySelector, { timeout: 15000 });
}

/**
 * Runs an action that reloads the page and waits for the new document. The app
 * often sets the hash before reloading, which a navigation wait can mistake for
 * the reload itself.
 */
async function reloadAfter(page, action) {
  const loaded = page.waitForEvent('load', { timeout: 20000 });
  await action();
  await loaded;
  await waitForShell(page);
}

async function openMenu(page) {
  const open = await page.$('.account-menu:not([hidden])');
  if (!open) await page.click('#sign-out');
  await page.waitForSelector('.account-menu:not([hidden])', { timeout: 8000 });
}

async function menuText(page) {
  await openMenu(page);
  const text = await page.$eval('.account-menu', (node) => node.innerText);
  await page.keyboard.press('Escape');
  return text;
}

const openDialog = 'dialog.modal[open]';

async function confirm(page) {
  await page.waitForSelector('dialog.confirm-dialog[open]', { timeout: 8000 });
  await page.click('dialog.confirm-dialog[open] .confirm-dialog__actions button:last-child');
  await page.waitForSelector('dialog.confirm-dialog', { state: 'detached', timeout: 8000 });
}

/** Reads the one-time secret from the reveal dialog and acknowledges it. */
async function takeSecret(page) {
  await page.waitForSelector(`${openDialog} .secret-reveal__value`, { timeout: 15000 });
  const secret = await page.inputValue(`${openDialog} .secret-reveal__value`);
  await page.click(`${openDialog} .modal__footer .btn--primary`);
  await page.waitForSelector('dialog.modal', { state: 'detached', timeout: 8000 });
  return secret;
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function layoutCheck(session, name) {
  const { page, viewport } = session;
  await page.screenshot({ path: artifact(`identity-${name}-${viewport.width}.png`) });
  ok(`${name} fits the ${viewport.width}px viewport without horizontal scrolling`, await noHorizontalOverflow(page));
}

const rowFor = (page, text) => page.locator('#view-root tbody tr', { hasText: text });

try {
  /* ── 1. Sign-in validation (desktop) ────────────────────────────────────── */
  const admin = await openSession('administrator', VIEWPORTS.desktop);
  const { page } = admin;
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#auth-email', { timeout: 15000 });
  const signInText = await page.$eval('.auth__card', (node) => node.innerText);
  ok('sign-in screen renders cleanly', /Sign in/i.test(signInText) && !/\bnull\b|\bundefined\b/.test(signInText), signInText.replace(/\s+/g, ' ').slice(0, 120));
  await layoutCheck(admin, 'sign-in');

  await page.click('button.auth__submit');
  const emptyError = await page.textContent('.auth__error').catch(() => '');
  ok('sign-in asks for an email address before calling the server', /email/i.test(emptyError), emptyError);

  admin.expect(/401 POST .*\/api\/auth\/login/);
  admin.expect(/status of 401.*@ .*\/api\/auth\/login/);
  // Locally the real address exercises the known-account path; elsewhere an
  // unknown address keeps a real account from collecting a lockout strike.
  // The server answers both the same way.
  const probeEmail = LOCAL ? ADMIN.email : `nobody.${RUN}@example.invalid`;
  await signInThroughUi(page, { email: probeEmail, password: `wrong-${RUN}-password` });
  const wrongError = await page
    .waitForFunction(() => document.querySelector('.auth__error')?.textContent ?? '', null, { timeout: 10000 })
    .then((handle) => handle.jsonValue())
    .catch(() => '');
  ok('a wrong password is rejected with a clear message', /incorrect/i.test(wrongError), wrongError);

  await page.click('.auth-field--secret .auth-field__reveal');
  const revealedType = await page.getAttribute('#auth-password', 'type');
  await page.click('.auth-field--secret .auth-field__reveal');
  const hiddenType = await page.getAttribute('#auth-password', 'type');
  ok('the password can be shown and hidden', revealedType === 'text' && hiddenType === 'password', `${revealedType} → ${hiddenType}`);

  await signInThroughUi(page, ADMIN);
  await waitForShell(page);
  ok('a valid sign-in opens the workspace', true);

  /* ── 2. Shell and account menu ──────────────────────────────────────────── */
  const initials = (await page.textContent('#sign-out')).trim();
  ok('the avatar shows the signed-in person\'s initials', /^[A-Z0-9]{1,2}$/.test(initials), initials);
  ok('administrators see Administration in the navigation', !(await page.$eval('#nav-admin', (node) => node.hidden)));

  await openMenu(page);
  const accountText = await page.$eval('.account-menu', (node) => node.innerText);
  ok(
    'the account menu shows who is signed in, their role and workspace',
    accountText.includes(ADMIN.email) && /Administrator/.test(accountText) && /Workspace/i.test(accountText) && !/\bnull\b/.test(accountText),
    accountText.replace(/\s+/g, ' ').slice(0, 160)
  );
  await page.screenshot({ path: artifact('identity-account-menu-1440.png') });
  const firstItem = await page.evaluate(() => document.activeElement?.id ?? '');
  await page.keyboard.press('ArrowDown');
  const secondItem = await page.evaluate(() => document.activeElement?.id ?? '');
  ok('the account menu is keyboard navigable', firstItem && secondItem && firstItem !== secondItem, `${firstItem} → ${secondItem}`);
  await page.keyboard.press('Escape');
  const menuClosed = await page.$eval('.account-menu', (node) => node.hidden);
  const focusBack = await page.evaluate(() => document.activeElement?.id);
  ok('Escape closes the menu and returns focus to the avatar', menuClosed && focusBack === 'sign-out', `hidden=${menuClosed} focus=${focusBack}`);

  /* ── 3. Members: add an operator ────────────────────────────────────────── */
  if (LOCAL) {
    // Start in the Shared workspace, where the platform administrator has
    // access without being a listed member, so the operator added below
    // becomes its only administrator. Other suites leave this account in
    // whichever workspace they used last.
    await openMenu(page);
    const sharedSwitch = page.locator('.account-menu [id^="switch-"]', { hasText: 'Shared workspace' });
    if ((await sharedSwitch.count()) === 1) {
      await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => null), sharedSwitch.click()]);
      await waitForShell(page);
    } else {
      await page.keyboard.press('Escape');
    }
  }
  await go(page, '#/admin/members', '#admin-add-member');
  await page.waitForSelector('#view-root .table-wrap, #view-root .table-empty', { timeout: 15000 });
  await layoutCheck(admin, 'admin-members');

  await page.click('#admin-add-member');
  await page.waitForSelector(openDialog);
  await page.fill(`${openDialog} input[type=email]`, 'not-an-email');
  await page.click(`${openDialog} button[type=submit]`);
  const memberError = await page.textContent(`${openDialog} .field__error`);
  ok('the add-member form validates the email address', /valid email/i.test(memberError), memberError);

  const operatorEmail = `operator.${RUN}@e2e.vgc.test`;
  await page.fill(`${openDialog} input[type=email]`, operatorEmail);
  await page.fill(`${openDialog} input[type=text]`, 'Oscar Operator');
  await page.click(`${openDialog} button[type=submit]`);
  await page.waitForSelector(`${openDialog} .secret-reveal__value`, { timeout: 15000 });
  await page.keyboard.press('Escape');
  const stillOpen = Boolean(await page.$(`${openDialog} .secret-reveal__value`));
  ok('a one-time secret cannot be dismissed by accident', stillOpen);
  const temporaryPassword = await takeSecret(page);
  ok('a one-time password is issued for a new member', temporaryPassword.length >= 12, `${temporaryPassword.length} characters`);
  await rowFor(page, operatorEmail).first().waitFor({ timeout: 10000 });
  const operatorRow = await rowFor(page, operatorEmail).first().innerText();
  ok('the new member is listed as an operator awaiting a new password', /Awaiting new password/i.test(operatorRow), operatorRow.replace(/\s+/g, ' '));

  /* ── 4. The operator signs in on a phone ────────────────────────────────── */
  const operator = await openSession('operator', VIEWPORTS.mobile);
  const op = operator.page;
  await op.goto(BASE, { waitUntil: 'load' });
  await layoutCheck(operator, 'sign-in');
  await signInThroughUi(op, { email: operatorEmail, password: temporaryPassword });
  const forced = await op.waitForSelector('#pw-new', { timeout: 15000 }).catch(() => null);
  ok('a one-time password must be replaced before entering the workspace', Boolean(forced));
  await layoutCheck(operator, 'forced-password-change');

  const operatorPassword = `Operator-${RUN}-Pass!`;
  await op.fill('#pw-current', temporaryPassword);
  await op.fill('#pw-new', operatorPassword);
  await op.fill('#pw-confirm', `${operatorPassword}x`);
  await op.click('form.auth__form button[type=submit]');
  const mismatch = await op.textContent('.auth__error').catch(() => '');
  ok('mismatched new passwords are caught', /do not match/i.test(mismatch), mismatch);
  await op.fill('#pw-confirm', operatorPassword);
  await op.click('form.auth__form button[type=submit]');
  await waitForShell(op);
  ok('the operator enters the workspace after choosing a password', true);
  ok('operators do not see Administration in the navigation', await op.$eval('#nav-admin', (node) => node.hidden));

  await go(op, '#/admin', '#view-root .empty-state, #view-root .empty');
  const deniedText = await op.$eval('#view-root', (node) => node.innerText);
  ok('the administration route tells operators it is for administrators', /Administrators only/i.test(deniedText), deniedText.replace(/\s+/g, ' ').slice(0, 100));
  await layoutCheck(operator, 'admin-denied');
  const operatorProbe = await operator.context.request.get(`${BASE}/api/admin/members`);
  ok('the server refuses member administration to operators', operatorProbe.status() === 403, `HTTP ${operatorProbe.status()}`);

  /* ── 5. Roles take effect immediately ───────────────────────────────────── */
  await go(page, '#/admin/api-keys', '#admin-create-key');
  await go(page, '#/admin/members', '#admin-add-member');
  const roleSelect = page.locator(`select[aria-label="Role for ${operatorEmail}"]`);
  await roleSelect.waitFor({ timeout: 10000 });
  ok('the operator\'s new password clears the pending badge', !/Awaiting new password/i.test(await rowFor(page, operatorEmail).first().innerText()));
  await roleSelect.selectOption('admin');
  await confirm(page);
  await waitFor(async () => (await roleSelect.inputValue().catch(() => '')) === 'admin' && !(await roleSelect.isDisabled().catch(() => true)), 10000);
  const promotedProbe = await operator.context.request.get(`${BASE}/api/admin/members`);
  ok('promotion to administrator takes effect immediately', promotedProbe.status() === 200, `HTTP ${promotedProbe.status()}`);
  // Whether the operator is now the workspace's only administrator depends on
  // who else is listed there, so read that from the server first.
  const otherAdmins = await page.evaluate(async (email) => {
    const tenantId = sessionStorage.getItem('vgc.tab-workspace');
    const response = await fetch('/api/admin/members', { headers: tenantId ? { 'x-tenant-id': tenantId } : {} });
    const { items } = await response.json();
    return items.filter((member) => member.role === 'admin' && member.status === 'active' && member.email !== email).length;
  }, operatorEmail);
  if (LOCAL) ok('in the Shared workspace the promoted operator is the only listed administrator', otherAdmins === 0, `${otherAdmins} other administrators`);
  await roleSelect.selectOption('user');
  const soleAdminWarning = await page
    .waitForSelector('dialog.confirm-dialog[open]', { timeout: otherAdmins === 0 ? 8000 : 1500 })
    .then((node) => node.innerText())
    .catch(() => '');
  if (otherAdmins === 0) {
    ok('demoting the only administrator asks for confirmation first', /only administrator/i.test(soleAdminWarning), soleAdminWarning.replace(/\s+/g, ' ').slice(0, 140));
  } else {
    ok('demoting one of several administrators needs no extra confirmation', soleAdminWarning === '', soleAdminWarning.replace(/\s+/g, ' ').slice(0, 140));
  }
  if (soleAdminWarning) await confirm(page);
  await waitFor(async () => (await roleSelect.inputValue().catch(() => '')) === 'user' && !(await roleSelect.isDisabled().catch(() => true)), 10000);
  const demotedProbe = await operator.context.request.get(`${BASE}/api/admin/members`);
  ok('demotion back to operator takes effect immediately', demotedProbe.status() === 403, `HTTP ${demotedProbe.status()}`);

  /* ── 6. API keys ─────────────────────────────────────────────────────────── */
  await go(page, '#/admin/api-keys', '#admin-create-key');
  await page.click('#admin-create-key');
  await page.waitForSelector(openDialog);
  await page.click(`${openDialog} button[type=submit]`);
  const keyError = await page.textContent(`${openDialog} .field__error`);
  ok('an API key needs a name', /name/i.test(keyError), keyError);
  const keyName = `E2E integration ${RUN}`;
  await page.fill(`${openDialog} input[type=text]`, keyName);
  await page.click(`${openDialog} button[type=submit]`);
  await page.waitForSelector(`${openDialog} .admin-snippet`, { timeout: 15000 });
  const apiKey = await takeSecret(page);
  ok('a new API key is revealed once', apiKey.length >= 24, `${apiKey.length} characters`);
  await rowFor(page, keyName).first().waitFor({ timeout: 10000 });

  const withKey = (path) => fetch(`${BASE}${path}`, { headers: { 'x-api-key': apiKey } });
  const keyRead = await withKey('/api/documents');
  ok('the API key authenticates a server-to-server request', keyRead.status === 200, `HTTP ${keyRead.status}`);
  const keyAdmin = await withKey('/api/admin/members');
  ok('an operator API key cannot administer the workspace', keyAdmin.status === 403, `HTTP ${keyAdmin.status}`);
  await rowFor(page, keyName).first().locator('button', { hasText: 'Revoke' }).click();
  await confirm(page);
  await waitFor(async () => /Revoked/.test(await rowFor(page, keyName).first().innerText().catch(() => '')), 10000);
  const keyRevoked = await withKey('/api/documents');
  ok('a revoked API key is rejected immediately', keyRevoked.status === 401, `HTTP ${keyRevoked.status}`);
  await layoutCheck(admin, 'admin-api-keys');

  /* ── 7. Webhooks ─────────────────────────────────────────────────────────── */
  await go(page, '#/admin/webhooks', '#admin-add-webhook');
  await page.waitForSelector('#view-root .webhook-list, #view-root .empty-state, #view-root .empty', { timeout: 15000 });
  await page.click('#admin-add-webhook');
  await page.waitForSelector(`${openDialog} .webhook-events`);
  await page.click(`${openDialog} button[type=submit]`);
  const urlError = await page.textContent(`${openDialog} .field__error`);
  ok('a webhook needs an endpoint URL', /URL/i.test(urlError), urlError);
  await page.fill(`${openDialog} input[type=url]`, LOCAL ? RECEIVER_URL : 'https://hooks.example.com/vgc');
  for (const box of await page.$$(`${openDialog} .webhook-events input[type=checkbox]`)) await box.uncheck();
  await page.click(`${openDialog} button[type=submit]`);
  const eventsError = await page.textContent(`${openDialog} .field__error`);
  ok('a webhook needs at least one event', /at least one event/i.test(eventsError), eventsError);
  await page.screenshot({ path: artifact('identity-webhook-form-1440.png') });

  if (LOCAL) {
    for (const box of await page.$$(`${openDialog} .webhook-events input[type=checkbox]`)) await box.check();
    await page.fill(`${openDialog} input[type=text]`, 'E2E receiver');
    await page.click(`${openDialog} button[type=submit]`);
    const signingSecret = await takeSecret(page);
    ok('a webhook signing secret is revealed once', /^whsec_/.test(signingSecret), signingSecret.slice(0, 10));
    const hookCard = page.locator('.webhook-card', { hasText: RECEIVER_URL });
    await hookCard.waitFor({ timeout: 10000 });

    const before = received.length;
    await hookCard.locator('button', { hasText: 'Send test' }).click();
    const testDelivery = await waitFor(() => received.slice(before).find((entry) => entry.headers['x-vgc-event'] === 'webhook.test'));
    ok('“Send test” delivers to the endpoint', Boolean(testDelivery));
    ok('the delivery carries a valid HMAC-SHA256 signature', testDelivery && verifySignature(testDelivery, signingSecret));
    await waitFor(async () => /delivered/i.test(await hookCard.innerText().catch(() => '')), 10000);
    ok('the card reports the last delivery', /Last: delivered/i.test(await hookCard.innerText()));

    const samples = await (await admin.context.request.get(`${BASE}/api/samples`)).json();
    const sampleId = samples.items?.[0]?.id;
    const run = await admin.context.request.post(`${BASE}/api/samples/run`, { data: { sampleIds: [sampleId] } });
    const pipelineEvent = await waitFor(
      () => received.find((entry) => ['document.processed', 'document.review_required'].includes(entry.headers['x-vgc-event'])),
      60000,
      500
    );
    ok('a real pipeline run notifies the webhook', run.ok() && Boolean(pipelineEvent), pipelineEvent?.headers['x-vgc-event'] ?? `run HTTP ${run.status()}`);
    let pipelineBody = null;
    try {
      pipelineBody = JSON.parse(pipelineEvent?.body ?? 'null');
    } catch {
      pipelineBody = null;
    }
    ok(
      'the pipeline event is signed and describes the document',
      pipelineEvent && verifySignature(pipelineEvent, signingSecret) && JSON.stringify(pipelineBody).includes('doc_'),
      JSON.stringify(pipelineBody)?.slice(0, 160)
    );

    await hookCard.locator('button', { hasText: 'Deliveries' }).click();
    await page.waitForSelector(`${openDialog} .webhook-deliveries table`, { timeout: 15000 });
    const deliveriesText = await page.$eval(`${openDialog} .webhook-deliveries`, (node) => node.innerText);
    ok('the delivery log lists successful deliveries', /Delivered/.test(deliveriesText) && /webhook\.test/.test(deliveriesText));
    await page.screenshot({ path: artifact('identity-webhook-deliveries-1440.png') });
    await page.click(`${openDialog} .modal__close`);
    await page.waitForSelector('dialog.modal', { state: 'detached' });

    await hookCard.locator('button', { hasText: 'Pause' }).click();
    await waitFor(async () => /Paused/.test(await hookCard.innerText().catch(() => '')), 10000);
    ok('a webhook can be paused', /Paused/.test(await hookCard.innerText()));
    await layoutCheck(admin, 'admin-webhooks');
    await hookCard.locator('button', { hasText: 'Delete' }).click();
    await confirm(page);
    await hookCard.waitFor({ state: 'detached', timeout: 10000 });
    ok('a webhook can be deleted', true);
  } else {
    await page.click(`${openDialog} .modal__close`);
    console.log('SKIP  webhook delivery journeys need a local server (E2E_BASE is remote)');
  }

  /* ── 8. Activity log ─────────────────────────────────────────────────────── */
  await go(page, '#/admin/activity', '#activity-export');
  await page.waitForSelector('#view-root .admin-panel .table-wrap', { timeout: 15000 });
  const activityText = await page.$eval('#view-root .admin-panel', (node) => node.innerText);
  ok(
    'the activity log records sign-ins, membership and API key changes',
    ['auth.login', 'member.added', 'api_key.created', 'api_key.revoked'].every((action) => activityText.includes(action)),
    activityText.replace(/\s+/g, ' ').slice(0, 160)
  );
  await page.selectOption('#view-root .admin-filters select', 'member.');
  await waitFor(async () => {
    const actions = await page.$$eval('#view-root tbody code.admin-code', (nodes) => nodes.map((node) => node.textContent));
    return actions.length > 0 && actions.every((action) => action.startsWith('member.'));
  }, 10000);
  const memberActions = await page.$$eval('#view-root tbody code.admin-code', (nodes) => nodes.map((node) => node.textContent));
  ok('the activity log filters by category', memberActions.length > 0 && memberActions.every((action) => action.startsWith('member.')), memberActions.join(', '));
  await page.fill('#view-root .admin-filters input[type=search] >> nth=1', operatorEmail);
  await waitFor(async () => {
    const rows = await page.$$eval('#view-root tbody tr', (nodes) => nodes.map((node) => node.innerText));
    return rows.length > 0 && rows.every((row) => row.includes(operatorEmail));
  }, 10000);
  const searchRows = await page.$$eval('#view-root tbody tr', (nodes) => nodes.map((node) => node.innerText));
  ok('the activity log searches targets and details', searchRows.length > 0 && searchRows.every((row) => row.includes(operatorEmail)), `${searchRows.length} row(s)`);

  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#activity-export')]);
  const csv = fs.readFileSync(await download.path(), 'utf8');
  ok(
    'the activity log exports the filtered rows to CSV',
    csv.startsWith('\uFEFFat,actor,action,target,detail,ip,correlationId') && csv.includes(operatorEmail),
    `${download.suggestedFilename()} · ${csv.split(/\r\n/).length - 1} row(s)`
  );
  await layoutCheck(admin, 'admin-activity');

  // A burst of confirmations must not bury the page or the Copilot button.
  await page.evaluate(async () => {
    const { toast } = await import('/js/util.js');
    for (let index = 1; index <= 6; index += 1) toast(`Burst confirmation ${index}`, 'success');
  });
  await page.waitForTimeout(400);
  const toastLayout = await page.evaluate(() => {
    const toasts = [...document.querySelectorAll('#toast-stack .toast')];
    const fab = document.querySelector('.copilot-fab')?.getBoundingClientRect();
    const overlapsFab = Boolean(fab) && toasts.some((node) => {
      const box = node.getBoundingClientRect();
      return box.left < fab.right && box.right > fab.left && box.top < fab.bottom && box.bottom > fab.top;
    });
    const offscreen = toasts.some((node) => {
      const box = node.getBoundingClientRect();
      return box.left < 0 || box.right > window.innerWidth || box.top < 0;
    });
    const newest = toasts.at(-1)?.textContent ?? '';
    toasts.forEach((node) => node.remove());
    return { count: toasts.length, overlapsFab, offscreen, newest };
  });
  ok(
    'a burst of toasts keeps the three newest, clear of the Copilot button',
    toastLayout.count === 3 && !toastLayout.overlapsFab && !toastLayout.offscreen && toastLayout.newest === 'Burst confirmation 6',
    JSON.stringify(toastLayout)
  );

  /* ── 9. Learning memory ──────────────────────────────────────────────────── */
  await go(page, '#/admin/learning', '#learning-clear');
  await page.waitForSelector('#view-root .admin-kpis', { timeout: 15000 });
  const learningKpis = await page.$$eval('#view-root .admin-kpis .kpi', (nodes) => nodes.length);
  ok('learning memory shows its statistics', learningKpis >= 3, `${learningKpis} KPI(s)`);
  await layoutCheck(admin, 'admin-learning');

  /* ── 10. The operator's own account (mobile) ────────────────────────────── */
  await go(op, '#/dashboard', '#view-root div.view');
  await openMenu(op);
  await layoutCheck(operator, 'account-menu');
  await op.click('#menu-sessions');
  await op.waitForSelector(`${openDialog} .session-list__item`, { timeout: 15000 });
  const currentDevice = await op.$(`${openDialog} .session-list__item.is-current`);
  ok('signed-in devices lists this device', Boolean(currentDevice));
  await layoutCheck(operator, 'signed-in-devices');
  await op.click(`${openDialog} .modal__close`);
  await op.waitForSelector('dialog.modal', { state: 'detached' });

  await openMenu(op);
  await op.click('#menu-change-password');
  await op.waitForSelector(`${openDialog} #pw-current`);
  const newOperatorPassword = `${operatorPassword}-2`;
  await op.fill('#pw-current', operatorPassword);
  await op.fill('#pw-new', newOperatorPassword);
  await op.fill('#pw-confirm', newOperatorPassword);
  await op.click(`${openDialog} form.auth__form button[type=submit]`);
  await op.waitForSelector('dialog.modal', { state: 'detached', timeout: 10000 });
  const verifyContext = await browser.newContext();
  const oldLogin = await verifyContext.request.post(`${BASE}/api/auth/login`, { data: { email: operatorEmail, password: operatorPassword } });
  const newLogin = await verifyContext.request.post(`${BASE}/api/auth/login`, { data: { email: operatorEmail, password: newOperatorPassword } });
  ok('a member can change their own password', oldLogin.status() === 401 && newLogin.ok(), `old ${oldLogin.status()} · new ${newLogin.status()}`);
  await verifyContext.close();

  /* ── 11. Removing a member revokes access ───────────────────────────────── */
  // Park the operator's tab first: its live connections would otherwise log
  // the (correct) refusals that follow as page errors.
  await op.goto('about:blank');
  await go(page, '#/admin/members', '#admin-add-member');
  await rowFor(page, operatorEmail).first().locator('button', { hasText: 'Remove' }).click();
  await confirm(page);
  await rowFor(page, operatorEmail).first().waitFor({ state: 'detached', timeout: 10000 });
  ok('an administrator can remove a member', true);
  const removedProbe = await operator.context.request.get(`${BASE}/api/documents`);
  ok('a removed member loses access immediately', [401, 403].includes(removedProbe.status()), `HTTP ${removedProbe.status()}`);

  /* ── 12. Workspaces: create one and switch back (local only) ────────────── */
  if (LOCAL) {
    const branchName = `E2E Branch ${RUN}`;
    await openMenu(page);
    await page.click('#menu-create-workspace');
    await page.waitForSelector('#ob-company-name');
    ok('a signed-in creator is not asked for a new account', !(await page.$('#ob-account-email')));
    await page.fill('#ob-company-name', branchName);
    await page.click('.onboard-actions .btn--primary');
    await page.waitForSelector('#ob-business-type');
    await page.selectOption('#ob-business-type', { index: 1 });
    await page.click('.onboard-actions .btn--primary');
    await page.waitForSelector('#onboard-create');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => null), page.click('#onboard-create')]);
    await waitForShell(page);
    const branchMenu = await menuText(page);
    ok('a new workspace opens with its creator as administrator', branchMenu.includes(branchName) && /Administrator/.test(branchMenu), branchMenu.replace(/\s+/g, ' ').slice(0, 160));

    await openMenu(page);
    const switchTarget = page.locator('.account-menu [id^="switch-"]', { hasText: 'Shared workspace' });
    ok('other workspaces are offered in the account menu', (await switchTarget.count()) === 1);
    await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => null), switchTarget.click()]);
    await waitForShell(page);
    const sharedMenu = await menuText(page);
    ok('switching workspace changes the active workspace', /Workspace\s*Shared workspace/i.test(sharedMenu), sharedMenu.replace(/\s+/g, ' ').slice(0, 120));
  }

  /* ── 13. Self-service signup on a tablet (local only) ───────────────────── */
  if (LOCAL) {
    const visitor = await openSession('self-signup', VIEWPORTS.tablet);
    const vp = visitor.page;
    await vp.goto(BASE, { waitUntil: 'load' });
    await vp.waitForSelector('#auth-create-workspace', { timeout: 15000 });
    await layoutCheck(visitor, 'sign-in');
    await vp.click('#auth-create-workspace');
    await vp.waitForSelector('#ob-company-name');
    await vp.click('#onboard-cancel');
    await vp.waitForSelector('#auth-email', { state: 'visible', timeout: 10000 });
    ok('signup can be cancelled back to sign-in', true);

    const companyName = `E2E Signup ${RUN}`;
    const ownerEmail = `owner.${RUN}@e2e.vgc.test`;
    await vp.click('#auth-create-workspace');
    await vp.waitForSelector('#ob-company-name');
    await vp.fill('#ob-company-name', companyName);
    await vp.click('.onboard-actions .btn--primary');
    await vp.selectOption('#ob-business-type', { index: 1 });
    await vp.click('.onboard-actions .btn--primary');
    await vp.waitForSelector('#ob-account-email');
    await layoutCheck(visitor, 'signup-account-step');
    await vp.fill('#ob-account-name', 'Wendy Owner');
    await vp.fill('#ob-account-email', ownerEmail);
    await vp.fill('#ob-account-password', 'short');
    await vp.fill('#ob-account-confirm', 'short');
    await vp.click('.onboard-actions .btn--primary');
    const shortError = await vp.textContent('.onboard-error');
    ok('signup enforces the password policy', /at least/i.test(shortError), shortError);
    const ownerPassword = `Owner-${RUN}-Pass!`;
    await vp.fill('#ob-account-password', ownerPassword);
    await vp.fill('#ob-account-confirm', ownerPassword);
    await vp.click('.onboard-actions .btn--primary');
    await vp.waitForSelector('#onboard-create');
    const review = await vp.$eval('.onboard-card', (node) => node.innerText);
    ok('the review step echoes the workspace and account', review.includes(companyName) && review.includes(ownerEmail), review.replace(/\s+/g, ' ').slice(0, 160));
    await vp.click('#onboard-create');
    await waitForShell(vp);
    const ownerMenu = await menuText(vp);
    ok('self-service signup lands the owner in their new workspace as administrator', ownerMenu.includes(companyName) && /Administrator/.test(ownerMenu), ownerMenu.replace(/\s+/g, ' ').slice(0, 160));
    await go(vp, '#/admin/members', '#admin-add-member');
    await rowFor(vp, ownerEmail).first().waitFor({ timeout: 10000 });
    ok('the owner is listed as the workspace administrator', /\(you\)/.test(await rowFor(vp, ownerEmail).first().innerText()));
    await layoutCheck(visitor, 'admin-members');

    /* ── 13b. A platform administrator archives and restores it ───────────── */
    const signupId = await vp.evaluate(() => sessionStorage.getItem('vgc.tab-workspace'));
    // While archived, the owner's session ends and their sign-in is refused.
    visitor.expect(/40[13] (GET|POST) .*\/api\//);
    visitor.expect(/status of 40[13]/);

    // A second administrator tab, on a phone, working in that workspace.
    const phone = await openSession('archived-tab', VIEWPORTS.mobile);
    const pp = phone.page;
    phone.expect(/403 (GET|POST) .*\/api\//);
    phone.expect(/status of 403/);
    phone.expect(/EventSource/i);
    await pp.goto(BASE, { waitUntil: 'load' });
    await signInThroughUi(pp, ADMIN);
    await waitForShell(pp);
    await openMenu(pp);
    await reloadAfter(pp, () => pp.click(`#switch-${signupId}`));
    await go(pp, '#/admin/workspaces', `#archive-${signupId}`);
    ok('the workspace a tab is working in cannot be archived from that tab', await pp.isDisabled(`#archive-${signupId}`));
    await layoutCheck(phone, 'admin-workspaces');

    await go(page, '#/admin/workspaces', '#workspace-search');
    await rowFor(page, companyName).first().waitFor({ timeout: 10000 });
    await layoutCheck(admin, 'admin-workspaces');
    await page.fill('#workspace-search', companyName);
    await page.waitForFunction(() => document.querySelectorAll('#view-root tbody tr').length === 1, null, { timeout: 5000 }).catch(() => {});
    ok('workspaces can be searched', (await page.locator('#view-root tbody tr').count()) === 1 && (await rowFor(page, companyName).count()) === 1);
    await page.click(`#archive-${signupId}`);
    const archiveQuestion = await page.waitForSelector('dialog.confirm-dialog[open]').then((node) => node.innerText());
    ok('archiving explains what happens to members, keys and data', /API keys stop working/.test(archiveQuestion) && /restore/i.test(archiveQuestion), archiveQuestion.replace(/\s+/g, ' ').slice(0, 160));
    await confirm(page);
    const archivedToast = await page.locator('#toast-stack .toast', { hasText: 'was archived' }).first().innerText({ timeout: 10000 }).catch(() => '');
    ok('archiving reports the sessions it moved and ended', /1 session moved to another workspace, 1 signed out/.test(archivedToast), archivedToast);
    await page.waitForFunction((name) => ![...document.querySelectorAll('#view-root tbody tr')].some((row) => row.innerText.includes(name)), companyName, { timeout: 10000 }).catch(() => {});
    ok('an archived workspace leaves the active list', (await rowFor(page, companyName).count()) === 0);
    await page.selectOption('#workspace-status', 'archived');
    await page.waitForSelector(`#restore-${signupId}`, { timeout: 10000 });
    ok('the archived list shows it with a restore action', /Archived/.test(await rowFor(page, companyName).first().innerText()));
    ok('the account menu no longer offers the archived workspace', !(await menuText(page)).includes(companyName));

    await go(pp, '#/documents');
    await pp.waitForSelector(`${openDialog} #workspace-archived-continue`, { timeout: 15000 });
    ok('a tab working in the archived workspace is told so', /has been archived/.test(await pp.textContent(openDialog)));
    ok('the failures that follow are not also reported as errors', (await pp.locator('#toast-stack .toast--error').count()) === 0);
    await layoutCheck(phone, 'workspace-archived');
    await reloadAfter(pp, () => pp.click('#workspace-archived-continue'));
    const movedMenu = await menuText(pp);
    ok('that tab continues in another workspace', !movedMenu.includes(companyName) && /Workspace/i.test(movedMenu), movedMenu.replace(/\s+/g, ' ').slice(0, 240));
    await openMenu(pp);
    await reloadAfter(pp, () => pp.locator('.account-menu [id^="switch-"]', { hasText: 'Shared workspace' }).click());
    ok('from there it switches workspaces as usual', /Workspace\s*Shared workspace/i.test(await menuText(pp)));

    await go(vp, '#/documents');
    await vp.waitForSelector('#auth-email', { state: 'visible', timeout: 20000 });
    ok("the owner's session ends when their only workspace is archived", true);
    await signInThroughUi(vp, { email: ownerEmail, password: ownerPassword });
    const refused = await vp
      .waitForFunction(() => document.querySelector('.auth__error')?.textContent ?? '', null, { timeout: 10000 })
      .then((handle) => handle.jsonValue())
      .catch(() => '');
    ok('sign-in explains that no active workspace is left', /any active workspace/.test(refused), refused);

    await page.click(`#restore-${signupId}`);
    await confirm(page);
    const restoredToast = await page.locator('#toast-stack .toast', { hasText: 'was restored' }).first().innerText({ timeout: 10000 }).catch(() => '');
    ok('restoring is confirmed', restoredToast.includes(companyName), restoredToast);
    await page.selectOption('#workspace-status', 'active');
    await rowFor(page, companyName).first().waitFor({ timeout: 10000 });
    ok('the restored workspace is active again', /Active/.test(await rowFor(page, companyName).first().innerText()));
    await reloadAfter(vp, () => signInThroughUi(vp, { email: ownerEmail, password: ownerPassword }));
    ok('the owner can sign in to the restored workspace', (await menuText(vp)).includes(companyName));
  }

  /* ── 14. Sign out ────────────────────────────────────────────────────────── */
  await openMenu(page);
  await page.click('#menu-sign-out');
  await page.waitForSelector('#auth-email', { timeout: 20000 });
  const afterSignOut = await (await admin.context.request.get(`${BASE}/api/auth/session`)).json();
  ok('signing out ends the session on the server', afterSignOut.authenticated === false);
} catch (error) {
  ok('identity journeys completed without throwing', false, error.stack ?? error.message);
  for (const session of sessions) {
    await session.page.screenshot({ path: artifact(`identity-failure-${session.label}.png`) }).catch(() => {});
  }
}

for (const session of sessions) {
  ok(`no uncaught page errors (${session.label})`, session.pageErrors.length === 0, session.pageErrors.slice(0, 3).join(' | '));
  ok(`no console errors (${session.label})`, session.consoleErrors.length === 0, session.consoleErrors.slice(0, 3).join(' | '));
  ok(`no failed requests (${session.label})`, session.badResponses.length === 0, session.badResponses.slice(0, 3).join(' | '));
}

await browser.close();
receiver.close();

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} identity checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
