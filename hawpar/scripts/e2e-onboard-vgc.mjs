/**
 * Reproduces a real customer onboarding "VGC" through the actual wizard UI
 * (not the useIsolatedWorkspace shortcut), then exercises ingest → workflow →
 * export so any errors a genuine new customer would hit are caught.
 */
import { chromium } from 'playwright-core';
import { ARTIFACT_DIR, CHROMIUM_EXE, settleUi } from './lib/e2e-session.mjs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:8080';

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
  // Fresh visitor — no localStorage tenant id set, so the onboarding wizard must show.
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });

  const wizard = await page.waitForSelector('.onboard', { timeout: 10000 }).catch(() => null);
  ok('onboarding wizard appears for a brand-new visitor', Boolean(wizard));
  if (!wizard) throw new Error('Wizard never appeared — aborting.');

  // Step 1: company profile
  await page.waitForSelector('#ob-company-name', { timeout: 10000 });
  await page.fill('#ob-company-name', 'VGC');
  await page.fill('#ob-contact-name', 'Test Onboarder');
  await page.fill('#ob-contact-email', 'onboarding@vgc.test');
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

  // Step 3: review & create
  await page.waitForSelector('.onboard-summary', { timeout: 10000 });
  const summaryText = await page.$eval('.onboard-summary', (n) => n.textContent);
  ok('review step shows the entered company name', summaryText.includes('VGC'), summaryText.slice(0, 80));

  await page.click('button:has-text("Create my workspace")');
  await page.waitForSelector('.onboard', { state: 'detached', timeout: 20000 }).catch((e) => {
    throw new Error(`Workspace creation never completed: ${e.message}`);
  });
  ok('workspace creation completes and the wizard closes', true);

  // Now the passphrase gate (or straight into the app, depending on flow).
  const authGate = await page.waitForSelector('#auth-passphrase', { timeout: 8000 }).catch(() => null);
  if (authGate) {
    await page.fill('#auth-passphrase', 'vgc');
    await page.click('button.auth__submit', { force: true });
    await page.waitForSelector('.auth', { state: 'detached', timeout: 15000 });
  }
  await page.waitForSelector('div.view', { timeout: 15000 });
  ok('lands inside the app shell after onboarding', true);

  const tenantMeta = await page.evaluate(() => localStorage.getItem('vgc.tenant-meta'));
  ok('tenant metadata persisted to localStorage', Boolean(tenantMeta), tenantMeta ?? '');

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
        const tenantId = localStorage.getItem('vgc.tenant-id');
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
        const tenantId = localStorage.getItem('vgc.tenant-id');
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
        const tenantId = localStorage.getItem('vgc.tenant-id');
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
  ok('settings reflect the onboarded company name', companyField ? companyField.includes('VGC') : false, String(companyField));
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
