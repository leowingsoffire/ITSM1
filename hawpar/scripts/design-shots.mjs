/**
 * Design inspection harness. Captures every route at desktop, tablet and mobile
 * so layout, density and contrast regressions are visible while iterating on
 * the theme. Not part of the acceptance suites — `npm run e2e` remains the gate.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { CHROMIUM_EXE, dismissOnboarding, signIn } from './lib/e2e-session.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080';
const OUT = 'artifacts/design';
const ROUTES = process.env.SHOT_ROUTES?.split(',') ?? [
  'dashboard', 'ingest', 'documents', 'workflows', 'agents', 'accuracy',
  'review', 'claims', 'search', 'azure', 'cost', 'blueprint', 'settings'
];
const VIEWPORTS = process.env.SHOT_VIEWPORT
  ? [{ name: process.env.SHOT_VIEWPORT, width: Number(process.env.SHOT_WIDTH), height: Number(process.env.SHOT_HEIGHT) }]
  : [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'tablet', width: 834, height: 1112 },
      { name: 'mobile', width: 390, height: 844 }
    ];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROMIUM_EXE });
const problems = [];

for (const viewport of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${viewport.name}: ${m.text().slice(0, 100)}`);
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await dismissOnboarding(page);
  await signIn(page);

  for (const route of ROUTES) {
    await page.goto(`${BASE}/#/${route}`, { waitUntil: 'load' });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const content = document.querySelector('.content');
      if (content) content.scrollTop = 0;
    });
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth > doc.clientWidth + 1 ? `${doc.scrollWidth}>${doc.clientWidth}` : null;
    });
    if (overflow) problems.push(`${viewport.name}/${route}: horizontal overflow ${overflow}`);
    await page.screenshot({ path: `${OUT}/${viewport.name}-${route}.png`, fullPage: Boolean(process.env.SHOT_FULL) });
  }
  await page.close();
}

await browser.close();
console.log(`Captured ${ROUTES.length * VIEWPORTS.length} screenshots into ${OUT}`);
if (problems.length > 0) {
  console.log('\nProblems:');
  for (const problem of [...new Set(problems)]) console.log(`  - ${problem}`);
} else {
  console.log('No overflow or console errors detected.');
}
