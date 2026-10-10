/**
 * Legibility sweep — every route, every breakpoint.
 *
 * Walks the whole application and reports text that a reader cannot make out
 * against its own background. Run it directly for a report; `e2e.mjs` asserts
 * on the same measurement so regressions fail the suite.
 *
 *   node scripts/legibility.mjs           # report every route at 3 widths
 *   node scripts/legibility.mjs --top 20  # also list the 20 tightest passes
 */
import { chromium } from 'playwright-core';
import { CHROMIUM_EXE, signIn, settleUi } from './lib/e2e-session.mjs';
import { measureTextContrast } from './lib/contrast.mjs';

const BASE = (process.env.E2E_BASE ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const THRESHOLD = Number(process.env.CONTRAST_THRESHOLD ?? 4.5);
const topIndex = process.argv.indexOf('--top');
const TOP = topIndex === -1 ? 0 : Number(process.argv[topIndex + 1] ?? 10);

const ROUTES = [
  'dashboard', 'ingest', 'documents', 'workflows', 'agents', 'accuracy',
  'review', 'claims', 'search', 'azure', 'cost', 'blueprint', 'settings', 'admin'
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 }
];

const browser = await chromium.launch({ executablePath: CHROMIUM_EXE, headless: true });
const failures = [];
const all = [];

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    // The motion layer drives inline transforms from rAF and goes inert under
    // reduced motion. Without this the grid drifts a few pixels between the
    // screenshot and the measurement, so glyphs never line up with their rects.
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await signIn(page);

  for (const route of ROUTES) {
    await page.goto(`${BASE}/#/${route}`, { waitUntil: 'networkidle' });
    await settleUi(page);
    const measured = await measureTextContrast(page);
    for (const entry of measured) {
      const row = { ...entry, route, viewport: viewport.name };
      all.push(row);
      if (entry.ratio < THRESHOLD) failures.push(row);
    }
    process.stdout.write(`  ${viewport.name}/${route}: ${measured.length} text runs\n`);
  }
  await context.close();
}
await browser.close();

const describe = (row) =>
  `${String(row.ratio).padStart(6)}:1  ${row.viewport}/${row.route}  ${row.label.slice(0, 40).padEnd(42)} ${JSON.stringify(row.text).slice(0, 46)}`;

if (TOP > 0) {
  console.log(`\nTightest ${TOP} text runs overall:`);
  for (const row of all.sort((a, b) => a.ratio - b.ratio).slice(0, TOP)) console.log(describe(row));
}

console.log(`\nMeasured ${all.length} text runs across ${ROUTES.length} routes × ${VIEWPORTS.length} viewports.`);
if (failures.length > 0) {
  console.log(`\n${failures.length} text runs below ${THRESHOLD}:1 —`);
  for (const row of failures.sort((a, b) => a.ratio - b.ratio)) console.log(describe(row));
  process.exitCode = 1;
} else {
  console.log(`All text renders at ${THRESHOLD}:1 or better against its own background.`);
}
