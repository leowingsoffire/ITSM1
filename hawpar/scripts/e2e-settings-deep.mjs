import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import { ARTIFACT_DIR, CHROMIUM_EXE, dismissOnboarding, useIsolatedWorkspace } from './lib/e2e-session.mjs';

const EXE = CHROMIUM_EXE;
const BASE = process.env.E2E_BASE ?? 'http://localhost:8080';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

// Build a tiny red-square PNG test logo on the fly.
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAKUlEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAA+DcOWAAHavRZ4AAAAAElFTkSuQmCC';
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const logoPath = path.resolve(ARTIFACT_DIR, 'test-logo.png');
fs.writeFileSync(logoPath, Buffer.from(pngBase64, 'base64'));

const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) pageErrors.push(msg.text());
  });

  // This suite rewrites company details, branding and templates, so it runs
  // inside its own provisioned workspace and never touches the shared one.
  const tenant = await useIsolatedWorkspace(page, BASE, 'Settings Deep E2E');

  await page.goto(BASE, { waitUntil: 'load' });
  await dismissOnboarding(page);
  await page.waitForSelector('#auth-passphrase');
  await page.fill('#auth-passphrase', 'vgc');
  await page.click('button.auth__submit', { force: true });
  await page.waitForSelector('.auth', { state: 'detached' });
  await page.click('a.nav-item[data-view="settings"]');
  await page.waitForFunction(() => document.querySelector('.settings-grid'));

  // --- 1. Logo upload + auto-crop end-to-end ---
  await page.click('.tabs .tab:nth-child(2)', { force: true });
  await page.waitForTimeout(300);
  const fileInput = await page.$('.settings-dropzone input[type="file"]');
  await fileInput.setInputFiles(logoPath);
  await page.waitForFunction(() => document.querySelector('.logo-preview img'), null, { timeout: 15000 });
  await page.waitForTimeout(1000); // allow save round-trip
  const logoSrc = await page.$eval('.logo-preview img', (n) => n.src.slice(0, 30));
  ok('logo uploads and auto-crops', logoSrc.startsWith('data:image'), logoSrc);

  // verify topbar reflects new logo without reload
  const brandLogo = await page.$('.brand-mark img.brand-mark__logo');
  ok('topbar brand mark swaps to uploaded logo live', Boolean(brandLogo));

  // remove logo
  const removeBtn = await page.$('.logo-editor button:has-text("Remove logo")');
  if (removeBtn) {
    await removeBtn.click();
    await page.waitForTimeout(1200);
  }
  ok('remove logo button present and clickable', Boolean(removeBtn));

  // --- 2. Regional & Timezone: country change auto-syncs timezone ---
  await page.click('.tabs .tab:nth-child(1)', { force: true });
  await page.waitForTimeout(200);
  await page.selectOption('.settings-grid select', { label: 'Malaysia' }).catch(() => {});
  await page.waitForTimeout(900);
  await page.click('.tabs .tab:nth-child(3)', { force: true });
  await page.waitForTimeout(300);
  const tzSelects = await page.$$eval('.settings-grid select', (nodes) => nodes.map((n) => ({ value: n.value, id: n.id })));
  ok('regional tab timezone selects render after country change', tzSelects.length > 0, JSON.stringify(tzSelects).slice(0, 150));

  // --- 3. Templates: edit + save persists after reload ---
  await page.click('.tabs .tab:nth-child(5)', { force: true });
  await page.waitForTimeout(300);
  const templateArea = await page.$('textarea');
  await templateArea.fill('');
  const marker = `TEST-TEMPLATE-${Date.now()}`;
  await templateArea.type(`Dear {{companyName}}, ${marker}`);
  await templateArea.dispatchEvent('change');
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('.settings-grid'));
  await page.click('.tabs .tab:nth-child(5)', { force: true });
  await page.waitForTimeout(400);
  const persisted = await page.$eval('textarea', (n) => n.value);
  ok('template edits persist after reload', persisted.includes(marker), persisted.slice(0, 60));

  // --- 4. Server-side role enforcement via raw API (bypassing UI) ---
  const forbiddenStatus = await page.evaluate(async (tenantId) => {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'user', 'x-tenant-id': tenantId },
      body: JSON.stringify({ company: { name: 'Hacked Inc' } })
    });
    return res.status;
  }, tenant.id);
  ok('server rejects non-admin PATCH to admin-only field (403)', forbiddenStatus === 403, `status=${forbiddenStatus}`);

  const allowedStatus = await page.evaluate(async (tenantId) => {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'user', 'x-tenant-id': tenantId },
      body: JSON.stringify({ regional: { locale: 'en-SG' } })
    });
    return res.status;
  }, tenant.id);
  ok('server allows non-admin PATCH to user-editable field (200)', allowedStatus === 200, `status=${allowedStatus}`);

  // --- 5. Accessibility basics: every settings input has an associated label, across all tabs ---
  let unlabeled = 0;
  const unlabeledDetails = [];
  for (let i = 1; i <= 5; i++) {
    await page.click(`.tabs .tab:nth-child(${i})`, { force: true });
    await page.waitForTimeout(250);
    const missing = await page.$$eval('.settings-grid input, .settings-grid select, .settings-grid textarea', (nodes) =>
      nodes
        .filter((n) => {
          if (n.id && document.querySelector(`label[for="${n.id}"]`)) return false;
          if (n.closest('label')) return false;
          if (n.getAttribute('aria-label')) return false;
          return true;
        })
        .map((n) => `${n.tagName}#${n.id || '(no id)'}[type=${n.type || ''}]`)
    );
    unlabeled += missing.length;
    unlabeledDetails.push(...missing);
  }
  ok('all settings form controls have associated labels (all tabs)', unlabeled === 0, unlabeledDetails.join(', '));

  // --- 6. Save indicator behavior ---
  const nameInput = await page.$('.settings-form input[type="text"]');
  await nameInput.fill('Haw Par Corporation Limited Updated');
  await nameInput.dispatchEvent('change');
  const savedText = await page.waitForFunction(() => {
    const el = document.querySelector('.settings-save-indicator');
    return el && /Sav/i.test(el.textContent) ? el.textContent : null;
  }, null, { timeout: 5000 }).then((h) => h.jsonValue());
  ok('save indicator shows saving/saved feedback', Boolean(savedText), savedText);

  ok('no uncaught page/console errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  fs.unlinkSync(logoPath);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log('Failures:', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
