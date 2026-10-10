/**
 * Reproduces a real customer signing up through the actual sign-in screen and
 * onboarding wizard (not the useIsolatedWorkspace shortcut) — company, industry,
 * administrator account, review — then exercises ingest → workflow → export so
 * any errors a genuine new customer would hit are caught.
 *
 * Signup creates a real workspace and account, so against anything but a local
 * server it runs only when E2E_ALLOW_SIGNUP=1.
 */
import { chromium } from 'playwright-core';
import { CHROMIUM_EXE, settleUi } from './lib/e2e-session.mjs';

const BASE = (process.env.E2E_BASE ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE);
if (!LOCAL && process.env.E2E_ALLOW_SIGNUP !== '1') {
  console.log('SKIP  signup creates a real workspace and account; set E2E_ALLOW_SIGNUP=1 to run it against a remote server.');
  process.exit(0);
}
const RUN = Date.now().toString(36);
const COMPANY = `VGC ${RUN}`;
const OWNER = { name: 'Test Onboarder', email: `onboarding.${RUN}@vgc.test`, password: `Onboard-${RUN}-Pass!` };

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROMIUM_EXE, headless: true });
const consoleErrors = [];
const pageErrors = [];
const badResponses = [];

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => pageErrors.push(err.message));
page.on('response', (response) => {
  if (response.status() >= 400 && !response.url().includes('/api/onboarding/')) {
    badResponses.push(`${response.status()} ${response.url()}`);
  }
});

try {
  // A visitor without a session starts at the sign-in screen.
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#auth-create-workspace', { timeout: 15000 });
  ok('a new visitor is offered self-service signup on the sign-in screen', true);
  await page.click('#auth-create-workspace');

  const wizard = await page.waitForSelector('.onboard', { timeout: 10000 }).catch(() => null);
  ok('onboarding wizard opens for a brand-new visitor', Boolean(wizard));
  if (!wizard) throw new Error('Wizard never appeared — aborting.');

  // Step 1: company profile
  await page.waitForSelector('#ob-company-name', { timeout: 10000 });
  await page.fill('#ob-company-name', COMPANY);
  await page.waitForFunction(() => document.querySelector('#ob-country')?.options.length > 1, null, { timeout: 10000 });
  await page.selectOption('#ob-country', 'Singapore');
  await page.click('.onboard-actions .btn--primary');

  // Step 2: business type & size
  await page.waitForSelector('#ob-business-type', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#ob-business-type')?.options.length > 1, null, { timeout: 10000 });
  const typeOptions = await page.$$eval('#ob-business-type option', (opts) => opts.map((o) => o.value).filter(Boolean));
  ok('business type options are populated', typeOptions.length > 0, `${typeOptions.length} option(s)`);
  await page.selectOption('#ob-business-type', typeOptions[0]);
  await page.click('.onboard-actions .btn--primary');

  // Step 3: the administrator account
  await page.waitForSelector('#ob-account-email', { timeout: 10000 });
  await page.fill('#ob-account-name', OWNER.name);
  await page.fill('#ob-account-email', OWNER.email);
  await page.fill('#ob-account-password', OWNER.password);
  await page.fill('#ob-account-confirm', OWNER.password);
  await page.click('.onboard-actions .btn--primary');

  // Step 4: review & create
  await page.waitForSelector('.onboard-summary', { timeout: 10000 });
  const summaryText = await page.$eval('.onboard-summary', (n) => n.textContent);
  ok('review step shows the company and the administrator account', summaryText.includes(COMPANY) && summaryText.includes(OWNER.email), summaryText.slice(0, 120));

  await page.click('#onboard-create');
  await page.waitForSelector('.onboard', { state: 'detached', timeout: 20000 }).catch((e) => {
    throw new Error(`Workspace creation never completed: ${e.message}`);
  });
  ok('workspace creation completes and the wizard closes', true);

  await page.waitForSelector('#view-root div.view', { timeout: 15000 });
  ok('lands inside the app shell after onboarding, already signed in', (await page.$('.auth')) === null);

  const session = await page.evaluate(async () => (await fetch('/api/auth/session')).json());
  ok(
    'the new account administers the new workspace',
    session.user?.email === OWNER.email && session.workspace?.name === COMPANY && session.workspace?.role === 'admin',
    `${session.user?.email} · ${session.workspace?.name} · ${session.workspace?.role}`
  );
  const tabWorkspace = await page.evaluate(() => sessionStorage.getItem('vgc.tab-workspace'));
  ok('the tab is pinned to the new workspace', tabWorkspace === session.workspace?.id, String(tabWorkspace));

  // Dashboard should reflect the new (empty) tenant, not demo data.
  await settleUi(page, 'dashboard');
  const dashboardText = await page.$eval('#view-root div.view', (n) => n.textContent);
  ok('dashboard renders for the new tenant without crashing', dashboardText.length > 50, `${dashboardText.length} chars`);

  // Ingest: run a sample document as a first real action.
  await page.evaluate(() => { location.hash = '#/ingest'; });
  await settleUi(page, 'ingest');
  const sampleButtons = await page.$$('button:has-text("Process")');
  ok('ingest page lists sample documents to process', sampleButtons.length > 0, `${sampleButtons.length} sample(s)`);

  if (sampleButtons.length > 0) {
    await sampleButtons[0].click();
    await page.waitForTimeout(1500);
    const toastText = await page.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
    ok('processing a sample document shows a confirmation toast', toastText.length > 0, toastText);

    // Poll for the document to reach a terminal state.
    const deadline = Date.now() + 60000;
    let terminal = false;
    let lastStatus = '';
    while (Date.now() < deadline && !terminal) {
      await page.waitForTimeout(2000);
      const listing = await page.evaluate(async () => {
        const tenantId = sessionStorage.getItem('vgc.tab-workspace');
        const res = await fetch('/api/documents?pageSize=1&sort=uploadedAt:desc', {
          headers: tenantId ? { 'x-tenant-id': tenantId } : {}
        });
        return res.json();
      });
      lastStatus = listing.items?.[0]?.status ?? '';
      if (['completed', 'needs-review', 'approved', 'rejected', 'failed'].includes(lastStatus)) terminal = true;
    }
    ok('sample document reaches a terminal status for the new tenant', terminal, `status=${lastStatus}`);

    if (terminal && lastStatus !== 'failed') {
      const docId = await page.evaluate(async () => {
        const tenantId = sessionStorage.getItem('vgc.tab-workspace');
        const res = await fetch('/api/documents?pageSize=1&sort=uploadedAt:desc', {
          headers: tenantId ? { 'x-tenant-id': tenantId } : {}
        });
        const body = await res.json();
        return body.items?.[0]?.id;
      });
      await page.evaluate((id) => { location.hash = `#/documents/${id}`; }, docId);
      await settleUi(page, 'document-detail');
      const detailLength = await page.$eval('#view-root div.view', (n) => n.textContent.trim().length);
      ok('new tenant document detail page renders', detailLength > 100, `${detailLength} chars`);

      // Export to Excel — the core deliverable the user cares about.
      const exportResp = await page.evaluate(async (id) => {
        const tenantId = sessionStorage.getItem('vgc.tab-workspace');
        const res = await fetch(`/api/documents/${encodeURIComponent(id)}/export.xlsx`, {
          headers: tenantId ? { 'x-tenant-id': tenantId } : {}
        });
        return { status: res.status, type: res.headers.get('content-type'), len: (await res.arrayBuffer()).byteLength };
      }, docId);
      ok(
        'exporting the document to Excel succeeds',
        exportResp.status === 200 && exportResp.len > 0,
        `status=${exportResp.status} bytes=${exportResp.len} type=${exportResp.type}`
      );
    }
  }

  // Settings should reflect the company name entered during onboarding, not "VGC" demo defaults left over.
  await page.evaluate(() => { location.hash = '#/settings'; });
  await settleUi(page, 'settings');
  await page.waitForSelector('#set-company-name', { timeout: 10000 }).catch(() => {});
  const companyField = await page.$eval('#set-company-name', (n) => n.value).catch(() => null);
  ok('settings reflect the onboarded company name', companyField === COMPANY, String(companyField));
} catch (error) {
  ok('onboarding journey completed without throwing', false, error.message);
} finally {
  ok('no uncaught page errors during onboarding', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
  ok('no console errors during onboarding', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  ok('no failed network requests during onboarding', badResponses.length === 0, badResponses.slice(0, 5).join(' | '));
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(1);
}
