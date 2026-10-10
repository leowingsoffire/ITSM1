/**
 * Browser verification for Template Studio: train a custom extraction
 * template from a sample document, draw a region, attach an Excel layout,
 * save, then run it against a new document and download the matching
 * export. Run: node scripts/e2e-templates.mjs (server must be running).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { CHROMIUM_EXE, artifact, settleUi, useIsolatedWorkspace } from './lib/e2e-session.mjs';
import { generateSamplePdf } from '../src/services/sample.service.js';
import { buildWorkbook } from '../src/lib/xlsx.js';

const EXE = CHROMIUM_EXE;
const BASE = (process.env.E2E_BASE ?? 'http://localhost:8080').replace(/\/+$/, '');
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vgc-e2e-templates-'));
const samplePdfPath = path.join(tmpDir, 'sample-invoice.pdf');
const runPdfPath = path.join(tmpDir, 'new-invoice.pdf');
const excelPath = path.join(tmpDir, 'customer-layout.xlsx');

const { buffer: samplePdf } = await generateSamplePdf('supplier_invoice', 'e2e-template-sample');
fs.writeFileSync(samplePdfPath, samplePdf);
const { buffer: runPdf } = await generateSamplePdf('supplier_invoice', 'e2e-template-run');
fs.writeFileSync(runPdfPath, runPdf);
fs.writeFileSync(excelPath, buildWorkbook([{ name: 'Customer Layout', rows: [['Reference No', 'Notes'], ['', '']] }]));

const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) pageErrors.push(msg.text());
  });

  const tenant = await useIsolatedWorkspace(page, BASE, 'Template Studio E2E');
  // Already signed in over the API; the app opens straight into the workspace.
  await page.goto(BASE, { waitUntil: 'load' });
  await settleUi(page, 'dashboard');

  // --- Navigate to Template Studio (empty state) ---
  await page.waitForSelector('a.nav-item[data-view="templates"]', { timeout: 10000 });
  await page.click('a.nav-item[data-view="templates"]');
  await settleUi(page, 'templates list');
  await page.waitForSelector('.empty, table.data', { timeout: 10000 });
  const emptyState = await page.$('.empty');
  ok('template studio shows an empty state for a fresh workspace', Boolean(emptyState));

  await page.click('a[href="#/templates/new"]');
  await page.waitForFunction(() => location.hash === '#/templates/new', null, { timeout: 5000 });
  await settleUi(page, 'template editor');
  await page.waitForSelector('.template-region-form, .dropzone', { timeout: 10000 });
  ok('template editor renders the 4-step wizard', (await page.$$('.card')).length >= 4);

  // --- Step 1: upload a sample document ---
  const fileInputs = await page.$$('input[type="file"]');
  ok('editor exposes an upload control for the sample document', fileInputs.length > 0);
  await fileInputs[0].setInputFiles(samplePdfPath);
  await page.waitForFunction(() => document.querySelector('.template-canvas'), null, { timeout: 20000 });
  ok('sample document is analysed and rendered as a drawable page', true);

  // --- Step 2: draw a region over the first recognised OCR line ---
  const firstLineBox = await page.evaluate(() => {
    const rect = document.querySelector('.template-canvas .ocr-line');
    if (!rect) return null;
    const svg = document.querySelector('.template-canvas');
    const svgBounds = svg.getBoundingClientRect();
    const r = rect.getBBox();
    const viewBox = svg.viewBox.baseVal;
    const scaleX = svgBounds.width / viewBox.width;
    const scaleY = svgBounds.height / viewBox.height;
    return {
      left: svgBounds.left + r.x * scaleX,
      top: svgBounds.top + r.y * scaleY,
      right: svgBounds.left + (r.x + r.width) * scaleX,
      bottom: svgBounds.top + (r.y + r.height) * scaleY
    };
  });
  ok('at least one OCR line is available to draw a region around', Boolean(firstLineBox));

  if (firstLineBox) {
    await page.mouse.move(firstLineBox.left - 2, firstLineBox.top - 2);
    await page.mouse.down();
    await page.mouse.move(firstLineBox.right + 2, firstLineBox.bottom + 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForSelector('.template-region-form', { timeout: 5000 });
    ok('dragging over the canvas opens the field definition form', true);

    await page.fill('.template-region-form input[type="text"]:nth-of-type(1)', 'Reference Number');
    await page.click('.template-region-form button[type="submit"]');
    await page.waitForSelector('.template-region-list li', { timeout: 5000 });
    ok('saved field appears in the trained fields list', true);
  } else {
    ok('dragging over the canvas opens the field definition form', false, 'no OCR line found');
    ok('saved field appears in the trained fields list', false, 'skipped — no region drawn');
  }

  // --- Step 3: attach the customer's Excel layout ---
  const excelInputs = await page.$$('input[type="file"][accept=".xlsx"]');
  ok('editor exposes an Excel template upload control', excelInputs.length > 0);
  if (excelInputs.length > 0) {
    await excelInputs[0].setInputFiles(excelPath);
    await page.waitForSelector('table.data select', { timeout: 10000 });
    ok('excel columns are parsed into a mapping table', true);
    await page.selectOption('table.data select', { index: 1 });
  }

  // --- Step 4: save the template ---
  const templateNameInput = await page.$('input[placeholder*="Distributor"]');
  ok('template name field is present', Boolean(templateNameInput));
  await templateNameInput.fill('E2E Trained Template');
  await page.click('button:has-text("Save template")');
  await page.waitForFunction(() => location.hash.startsWith('#/templates/') && !location.hash.includes('new'), null, {
    timeout: 10000
  });
  await settleUi(page, 'template detail after save');
  const detailHref = await page.evaluate(() => location.href);
  ok('saving the template navigates to its detail page', detailHref.length > 0);

  const fieldRows = await page.$$('table.data tbody tr');
  ok('template detail lists the trained field', fieldRows.length > 0);

  // --- Run extraction against a new document ---
  const runInput = await page.$('input[type="file"][multiple]');
  ok('run panel exposes a multi-file upload control', Boolean(runInput));
  if (runInput) {
    await runInput.setInputFiles(runPdfPath);
    await page.waitForFunction(() => document.querySelector('a[href*="/export.xlsx"]'), null, { timeout: 20000 });
    ok('running extraction against a new document produces a downloadable export', true);

    const exportHref = await page.$eval('a[href*="/export.xlsx"]', (a) => a.getAttribute('href'));
    const exportResponse = await page.request.get(`${BASE}${exportHref}`, { headers: { 'x-tenant-id': tenant.id } });
    const exportBuffer = Buffer.from(await exportResponse.body());
    const isZip = exportBuffer.length > 4 && exportBuffer.readUInt32LE(0) === 0x04034b50;
    ok('exported workbook is a well-formed, non-empty .xlsx file', exportResponse.ok() && isZip, `status=${exportResponse.status()} bytes=${exportBuffer.length}`);
  } else {
    ok('running extraction against a new document produces a downloadable export', false, 'no run input found');
    ok('exported workbook is a well-formed, non-empty .xlsx file', false, 'skipped');
  }

  // --- Responsive checks ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflowMobile = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 4);
  ok('no horizontal overflow on mobile (390px) on the template detail page', !overflowMobile);

  await page.goto(`${BASE}/#/templates`, { waitUntil: 'load' });
  await settleUi(page, 'templates list (mobile)');
  const overflowListMobile = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 4);
  ok('no horizontal overflow on mobile (390px) on the templates list', !overflowListMobile);

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto(`${BASE}/#/templates/new`, { waitUntil: 'load' });
  await settleUi(page, 'template editor (tablet)');
  const overflowTablet = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 4);
  ok('no horizontal overflow on tablet (820px) on the template editor', !overflowTablet);

  await page.screenshot({ path: artifact('templates-mobile.png'), fullPage: true });

  // --- Delete the template via the confirm dialog (back on desktop) ---
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(detailHref, { waitUntil: 'load' });
  await settleUi(page, 'template detail (desktop, before delete)');
  await page.click('button:has-text("Delete template")');
  await page.waitForSelector('dialog.confirm-dialog[open]', { timeout: 5000 });
  // Cancelling must not delete anything.
  await page.click('dialog.confirm-dialog button:has-text("Cancel")');
  await page.waitForTimeout(200);
  const stillOnDetail = await page.evaluate(() => location.hash.startsWith('#/templates/') && !location.hash.includes('new'));
  ok('cancelling the delete dialog keeps the template', stillOnDetail);

  await page.click('button:has-text("Delete template")');
  await page.waitForSelector('dialog.confirm-dialog[open]', { timeout: 5000 });
  await page.click('dialog.confirm-dialog button:has-text("Delete template")');
  await page.waitForFunction(() => location.hash === '#/templates', null, { timeout: 10000 });
  await settleUi(page, 'templates list after delete');
  await page.waitForSelector('.empty, table.data', { timeout: 10000 });
  const emptyAfterDelete = await page.$('.empty');
  ok('confirming the delete dialog removes the template and returns to an empty list', Boolean(emptyAfterDelete));

  ok('no uncaught page/console errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log('Failures:', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
