/* Browser smoke test: sign-in + main views. Run: node scripts/e2e-smoke.mjs
 * Needs E2E_EMAIL/E2E_PASSWORD (or ADMIN_EMAIL/ADMIN_PASSWORD); E2E_BASE picks the server. */
import { chromium } from 'playwright-core';
import { CHROMIUM_EXE, artifact, signIn } from './lib/e2e-session.mjs';

const BASE = (process.env.E2E_BASE ?? 'http://localhost:8080').replace(/\/+$/, '');
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROMIUM_EXE, headless: true });

/**
 * Opens a hash route and waits for it to settle: the previous view gone, no
 * skeleton or spinner left, or the route's own failure state. A fixed sleep is
 * not enough against a server that has just restarted.
 */
async function openRoute(page, hash, minLength = 40) {
  await page.evaluate((target) => {
    document.querySelector('#view-root')?.firstElementChild?.setAttribute('data-smoke-stale', '');
    location.hash = target;
  }, hash);
  const settled = await page
    .waitForFunction(
      (min) => {
        const root = document.querySelector('#view-root');
        if (!root || root.querySelector('[data-smoke-stale]')) return false;
        if (root.querySelector(':scope > .empty')) return true;
        const view = root.querySelector(':scope > div.view');
        return Boolean(view) && !view.querySelector('.skeleton, .spinner') && view.textContent.trim().length > min;
      },
      minLength,
      { timeout: 20000 }
    )
    .then(() => true, () => false);
  return page.$eval(
    '#view-root',
    (root, done) => ({
      settled: done,
      failure: root.querySelector(':scope > .empty h3')?.textContent.trim() ?? '',
      length: root.textContent.trim().length
    }),
    settled
  );
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'load' });

  // 1. A visitor without a session gets the sign-in screen
  await page.waitForSelector('#auth-email', { timeout: 15000 });
  ok('sign-in screen rendered', true);

  // 2. Wrong credentials are rejected. An unknown address is used so that no
  //    real account collects a failed attempt towards its lockout.
  await page.fill('#auth-email', `nobody.${Date.now()}@example.invalid`);
  await page.fill('#auth-password', 'definitely-not-the-password');
  await page.click('button.auth__submit');
  const error = await page
    .waitForFunction(() => document.querySelector('.auth__error')?.textContent.trim() || '', null, { timeout: 10000 })
    .then((handle) => handle.jsonValue())
    .catch(() => '');
  ok('wrong credentials rejected', /incorrect/i.test(error), error.slice(0, 60));

  // 3. Valid credentials enter the workspace
  await signIn(page);
  ok('sign-in accepted, workspace opened', true);

  // 4. Dashboard renders with KPIs
  await page.waitForFunction(() => document.querySelectorAll('.kpi').length >= 3, null, { timeout: 15000 });
  const kpis = await page.$$eval('.kpi', (n) => n.length);
  ok('dashboard KPIs rendered', kpis >= 3, `${kpis} KPI cards`);

  // 5. The session cookie survives a reload
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-root div.view', { timeout: 15000 });
  const gateGone = (await page.$('.auth')) === null;
  ok('session persists on reload', gateGone);

  // 6. Walk the main routes: each settles into real content, never the
  //    "This view could not be loaded" failure state.
  const routes = ['documents', 'claims', 'review', 'search', 'cost', 'blueprint', 'ingest'];
  for (const r of routes) {
    const view = await openRoute(page, `#/${r}`);
    ok(`route #/${r} renders`, view.settled && !/could not be loaded/i.test(view.failure), view.failure || `${view.length} chars`);
  }

  // 7. The documents table lists the workspace's documents; open one. An empty
  //    workspace first loads the sample pack, exactly as Ingest offers to.
  let listing = await page.evaluate(async () => (await fetch('/api/documents?pageSize=1')).json());
  if (listing.total === 0) {
    await page.evaluate(async () => {
      await fetch('/api/samples/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sampleIds: [] }) });
    });
    await page.waitForFunction(async () => (await (await fetch('/api/documents?pageSize=1')).json()).total > 0, null, { timeout: 60000, polling: 1000 });
    listing = await page.evaluate(async () => (await fetch('/api/documents?pageSize=1')).json());
  }
  await openRoute(page, '#/documents');
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 0, null, { timeout: 15000 });
  const rows = await page.$$eval('table tbody tr', (n) => n.length);
  ok('documents table populated', rows >= Math.min(listing.total, 10), `${rows} rows of ${listing.total}`);

  const docId = listing.items[0].id;
  const detail = await openRoute(page, `#/documents/${docId}`, 100);
  ok('document detail renders', detail.settled && !detail.failure, detail.failure || `${detail.length} chars`);

  // 8. No uncaught page errors during the whole run
  ok('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));

  await page.screenshot({ path: artifact('smoke-dashboard.png'), fullPage: false });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
