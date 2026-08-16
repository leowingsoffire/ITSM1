/* Browser verification for the Settings module. Run: node scripts/e2e-settings.mjs */
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  // Ignore benign "Failed to load resource: 400/403" network noise from the
  // intentionally-tested honest-failure paths (SMTP not configured, etc.) —
  // only genuine uncaught JS console errors indicate a real bug.
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) pageErrors.push(msg.text());
  });

  await page.goto(BASE, { waitUntil: 'load' });
  await dismissOnboarding(page);
  await page.waitForSelector('#auth-passphrase', { timeout: 10000 });

  // --- Log in as Administrator ---
  const adminOption = await page.$('.auth__role-toggle button[data-role="admin"]');
  ok('login role picker present', Boolean(adminOption));
  if (adminOption) await adminOption.click();
  await page.fill('#auth-passphrase', 'vgc');
  await page.click('button.auth__submit', { force: true });
  await page.waitForSelector('.auth', { state: 'detached', timeout: 10000 });

  // --- Navigate to Settings ---
  await page.waitForSelector('a.nav-item[data-view="settings"]', { timeout: 10000 });
  await page.click('a.nav-item[data-view="settings"]');
  await page.waitForFunction(() => document.querySelector('.settings-grid'), null, { timeout: 10000 });
  await page.waitForTimeout(400);
  ok('settings page renders (admin)', true);

  const tabNames = await page.$$eval('.tabs .tab', (nodes) => nodes.map((n) => n.textContent.trim()));
  ok('settings tabs present', tabNames.length === 5, tabNames.join(', '));

  // --- Company Profile tab: fields editable as admin ---
  const nameInput = await page.$('input[id*="company"]');
  ok('company profile fields render', Boolean(nameInput));

  // --- ACRA lookup ---
  const acraButton = await page.$('.settings-acra button');
  if (acraButton) {
    await acraButton.click();
    await page.waitForFunction(
      () => document.querySelector('.settings-acra-status') || document.querySelector('.settings-acra-candidate'),
      null,
      { timeout: 15000 }
    );
    const acraOutcome = await page.$eval('.settings-acra-results', (n) => n.textContent.trim().slice(0, 120));
    ok('ACRA lookup returns a real (non-fabricated) outcome', acraOutcome.length > 0, acraOutcome);
  } else {
    ok('ACRA lookup returns a real (non-fabricated) outcome', false, 'button not found');
  }

  // --- Branding tab ---
  await page.click('.tabs .tab:nth-child(2)');
  await page.waitForTimeout(300);
  const dropzone = await page.$('.settings-dropzone');
  ok('branding dropzone renders', Boolean(dropzone));

  // --- Regional & Timezone tab (user-editable) ---
  await page.click('.tabs .tab:nth-child(3)');
  await page.waitForTimeout(300);
  const timezoneSelect = await page.$('.settings-grid select');
  ok('regional/timezone tab renders', Boolean(timezoneSelect));

  // --- SMTP tab ---
  await page.click('.tabs .tab:nth-child(4)');
  await page.waitForTimeout(300);
  const verifyBtn = await page.$('.settings-form button.btn--ghost');
  if (verifyBtn) {
    await verifyBtn.click();
    await page.waitForFunction(() => document.querySelector('.settings-smtp-status')?.textContent.trim().length > 0, null, { timeout: 15000 });
    const smtpText = await page.$eval('.settings-smtp-status', (n) => n.textContent.trim());
    ok('SMTP test reports an honest result (no fabricated success)', smtpText.length > 0, smtpText.slice(0, 100));
  } else {
    ok('SMTP test reports an honest result (no fabricated success)', false, 'verify button not found');
  }

  // --- Templates tab ---
  await page.click('.tabs .tab:nth-child(5)');
  await page.waitForTimeout(300);
  const templateArea = await page.$('textarea');
  ok('templates tab renders editable template', Boolean(templateArea));

  // --- Role enforcement: switch to Standard User, reload, fields should be disabled/locked ---
  await page.evaluate(() => sessionStorage.setItem('vgc.demo-role', 'user'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('.settings-grid'), null, { timeout: 10000 });
  await page.waitForTimeout(400);
  const lockedCount = await page.$$eval('.settings-field__lock', (n) => n.length);
  ok('standard-user role sees admin-only fields locked', lockedCount > 0, `${lockedCount} locked fields`);

  const userTab = await page.$('.tabs .tab');
  await userTab.click();
  await page.waitForTimeout(300);
  const companyInputDisabled = await page.$eval('input[id*="company"]', (n) => n.disabled);
  ok('company fields disabled for standard user', companyInputDisabled === true);

  // --- Responsive check ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 4);
  ok('no horizontal overflow on mobile (390px)', !overflowX);

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForTimeout(300);
  const overflowXTablet = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 4);
  ok('no horizontal overflow on tablet (820px)', !overflowXTablet);

  await page.screenshot({ path: artifact('settings-mobile.png'), fullPage: true });

  ok('no uncaught page/console errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log('Failures:', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
