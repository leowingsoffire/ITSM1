/**
 * Shared browser-suite helpers.
 *
 * Every e2e script has to get past the same two front doors — the onboarding
 * wizard (shown to visitors with no workspace) and the demo passphrase gate —
 * and every script needs somewhere to put screenshots. Keeping that in one
 * place means a change to the entry flow is made once, not four times.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Chromium binary used by the suites; override with PLAYWRIGHT_CHROMIUM. */
export const CHROMIUM_EXE =
  process.env.PLAYWRIGHT_CHROMIUM ??
  'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';

/**
 * Screenshots are build artefacts, not customer uploads — they must never be
 * written into the document blob store under `data/uploads`.
 */
export const ARTIFACT_DIR = process.env.E2E_ARTIFACTS ?? 'artifacts/e2e';

/** @returns {string} an artefact path, creating the directory on first use. */
export function artifact(name) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  return path.join(ARTIFACT_DIR, name);
}

/**
 * Dismisses the onboarding wizard via its explicit "use the shared demo
 * workspace" opt-out. Returns false when no wizard was shown (a visitor who
 * already has a workspace), so callers can assert on either path.
 * @returns {Promise<boolean>}
 */
export async function dismissOnboarding(page, timeout = 8000) {
  const wizard = await page.waitForSelector('.onboard', { timeout }).catch(() => null);
  if (!wizard) return false;
  await page.click('.onboard-skip');
  await page.waitForSelector('.onboard', { state: 'detached', timeout: 10000 });
  return true;
}

/**
 * Passes the demo passphrase gate.
 * @param {import('playwright-core').Page} page
 * @param {{ passphrase?: string, role?: 'admin'|'user' }} [options]
 */
export async function signIn(page, { passphrase = 'vgc', role = null } = {}) {
  await page.waitForSelector('#auth-passphrase', { timeout: 15000 });
  if (role) {
    const button = await page.$(`.auth__role-toggle button[data-role="${role}"]`);
    if (button) await button.click();
  }
  await page.fill('#auth-passphrase', passphrase);
  await page.click('button.auth__submit', { force: true });
  await page.waitForSelector('.auth', { state: 'detached', timeout: 15000 });
  await page.waitForSelector('div.view', { timeout: 15000 });
}

/**
 * Waits until a view has finished rendering: present, no spinner or skeleton,
 * and carrying real content. Shared so every suite settles the same way.
 */
export async function settleUi(page, label = 'view') {
  try {
    await page.waitForFunction(
      () => {
        const view = document.querySelector('#view-root div.view');
        if (!view) return false;
        if (view.querySelector('.spinner')) return false;
        if (view.querySelector('.skeleton')) return false;
        return view.textContent.trim().length > 60;
      },
      null,
      { timeout: 25000 }
    );
  } catch (error) {
    const state = await page
      .evaluate(() => {
        const view = document.querySelector('#view-root div.view');
        return {
          hash: location.hash,
          exists: Boolean(view),
          spinner: Boolean(view?.querySelector('.spinner')),
          length: view ? view.textContent.trim().length : -1,
          head: view ? view.textContent.trim().slice(0, 120) : ''
        };
      })
      .catch(() => ({ hash: 'unknown' }));
    throw new Error(`settle(${label}) timed out — ${JSON.stringify(state)} :: ${error.message}`);
  }
}

/** Navigates to the app and walks all the way into the workspace shell. */
export async function enterWorkspace(page, base, options = {}) {
  await page.goto(base, { waitUntil: 'load' });
  await dismissOnboarding(page);
  await signIn(page, options);
}

/**
 * Provisions a throwaway workspace and binds the browser to it *before* the
 * app boots, so a suite that edits company details, branding or templates
 * mutates only its own tenant. Without this, running the settings suites
 * overwrites the shared demo workspace that developers and demos rely on.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} base
 * @param {string} [label] company name for the throwaway workspace
 * @returns {Promise<{ id: string, companyName: string }>} the created tenant
 */
export async function useIsolatedWorkspace(page, base, label = 'E2E Test Workspace') {
  const companyName = `${label} ${Date.now()}`;
  const response = await fetch(`${base}/api/onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName, businessType: 'Professional Services', country: 'Singapore' })
  });
  if (!response.ok) {
    throw new Error(`Could not provision an isolated workspace: HTTP ${response.status}`);
  }
  const { tenant } = await response.json();

  await page.addInitScript(
    ({ id, meta }) => {
      localStorage.setItem('vgc.tenant-id', id);
      localStorage.setItem('vgc.tenant-meta', JSON.stringify(meta));
    },
    { id: tenant.id, meta: { companyName: tenant.companyName, businessType: tenant.businessType } }
  );

  return tenant;
}
