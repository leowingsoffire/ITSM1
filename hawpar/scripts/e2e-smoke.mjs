/* Browser smoke test: login gate + main views. Run: node scripts/e2e-smoke.mjs */
import { chromium } from 'playwright-core';
import { CHROMIUM_EXE, artifact, dismissOnboarding } from './lib/e2e-session.mjs';

const EXE = CHROMIUM_EXE;
const BASE = process.env.E2E_BASE ?? 'http://localhost:8080';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: 'reduce' }); // motion.js animates transforms forever otherwise
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'load' });

  // 0. A first-time visitor is offered the onboarding wizard; this suite
  //    verifies the shared demo workspace, so take its explicit opt-out.
  const sawWizard = await dismissOnboarding(page);
  ok('onboarding wizard offers a shared-workspace opt-out', sawWizard);

  // 1. Login gate appears
  await page.waitForSelector('#auth-passphrase', { timeout: 10000 });
  ok('login gate rendered', true);

  // 2. Wrong passphrase is rejected
  await page.fill('#auth-passphrase', 'wrong-pass');
  await page.click('button.auth__submit', { force: true });
  const err = await page.waitForSelector('.auth__error', { timeout: 5000 });
  ok('wrong passphrase rejected', Boolean(err), (await err.textContent()).slice(0, 60));

  // 3. Correct passphrase enters the workspace
  await page.fill('#auth-passphrase', 'vgc');
  await page.click('button.auth__submit', { force: true });
  await page.waitForSelector('.auth', { state: 'detached', timeout: 10000 });
  ok('login accepted, gate dismissed', true);

  // 4. Dashboard renders with KPIs
  await page.waitForSelector('div.view', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('.kpi').length >= 3, null, { timeout: 10000 });
  const kpis = await page.$$eval('.kpi', (n) => n.length);
  ok('dashboard KPIs rendered', kpis >= 3, `${kpis} KPI cards`);

  // 5. Session persists across reload (sessionStorage gate)
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('div.view', { timeout: 10000 });
  const gateGone = (await page.$('.auth')) === null;
  ok('session persists on reload', gateGone);

  // 6. Walk the main routes
  const routes = ['documents', 'claims', 'review', 'search', 'cost', 'blueprint', 'ingest'];
  for (const r of routes) {
    await page.evaluate((h) => { location.hash = h; }, `#/${r}`);
    await page.waitForFunction(() => document.querySelector('div.view'), null, { timeout: 10000 });
    await page.waitForTimeout(700); // let async data paint
    const hasError = await page.$eval('body', (b) => b.textContent.includes('Something went wrong'));
    const text = await page.$eval('div.view', (v) => v.textContent.trim().length);
    ok(`route #/${r} renders`, !hasError && text > 40, `${text} chars`);
  }

  // 7. Documents table shows the seeded corpus; open a document detail
  await page.evaluate(() => { location.hash = '#/documents'; });
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 0, null, { timeout: 10000 });
  const rows = await page.$$eval('table tbody tr', (n) => n.length);
  ok('documents table populated', rows >= 10, `${rows} rows`);

  const docId = await page.evaluate(async () => (await (await fetch('/api/documents?pageSize=1')).json()).items[0].id);
  await page.evaluate((id) => { location.hash = `#/documents/${id}`; }, docId);
  await page.waitForTimeout(1200);
  const detailLen = await page.$eval('div.view', (v) => v.textContent.trim().length);
  ok('document detail renders', detailLen > 100, `${detailLen} chars`);

  // 8. No uncaught page errors during the whole run
  ok('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));

  await page.screenshot({ path: artifact('smoke-dashboard.png'), fullPage: false });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
