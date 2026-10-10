/**
 * Shared browser-suite helpers.
 *
 * Every suite signs in through the same front door and writes screenshots to
 * the same place; keeping that here means a change to the entry flow is made
 * once, not in every suite.
 *
 * The account a suite signs in as comes from the environment and is never
 * hard-coded: E2E_EMAIL / E2E_PASSWORD, falling back to ADMIN_EMAIL /
 * ADMIN_PASSWORD (the platform administrator the server seeds on first boot).
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

/** @returns {{ email: string, password: string }} the account the suites sign in as. */
export function credentials() {
  const email = process.env.E2E_EMAIL ?? process.env.ADMIN_EMAIL;
  const password = process.env.E2E_PASSWORD ?? process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Set E2E_EMAIL and E2E_PASSWORD (or ADMIN_EMAIL and ADMIN_PASSWORD) to the account the browser suites sign in as.');
  }
  return { email, password };
}

function resolveAccount(account) {
  return account?.email && account?.password ? account : credentials();
}

/**
 * Signs in through the real sign-in screen and waits for the workspace shell.
 * @param {import('playwright-core').Page} page
 * @param {{ email?: string, password?: string }} [account]
 */
export async function signIn(page, account) {
  const { email, password } = resolveAccount(account);
  await page.waitForSelector('#auth-email', { timeout: 15000 });
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', password);
  await page.click('button.auth__submit');
  await page.waitForSelector('.auth', { state: 'detached', timeout: 15000 });
  await page.waitForSelector('div.view', { timeout: 15000 });
}

/**
 * Signs in over the API. The browser context's request client shares its
 * cookie jar, so pages opened afterwards are already signed in.
 * @param {import('playwright-core').BrowserContext} context
 * @param {string} base
 * @param {{ email?: string, password?: string }} [account]
 */
export async function apiSignIn(context, base, account) {
  const { email, password } = resolveAccount(account);
  const response = await context.request.post(`${base}/api/auth/login`, { data: { email, password } });
  if (!response.ok()) {
    throw new Error(`API sign-in failed for ${email}: HTTP ${response.status()} ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
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

/** Navigates to the app and signs in through the sign-in screen. */
export async function enterWorkspace(page, base, account) {
  await page.goto(base, { waitUntil: 'load' });
  await signIn(page, account);
}

/**
 * Signs in over the API, provisions a throwaway workspace (the signed-in user
 * becomes its administrator) and pins the tab to it before the app boots, so a
 * suite that edits company details, branding or templates mutates only its own
 * tenant rather than the shared workspace that developers and demos rely on.
 *
 * Navigate to `base` afterwards: the page opens straight into the workspace.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} base
 * @param {string} [label] company name prefix for the throwaway workspace
 * @param {{ email?: string, password?: string }} [account]
 * @returns {Promise<{ id: string, companyName: string }>} the created tenant
 */
export async function useIsolatedWorkspace(page, base, label = 'E2E Test Workspace', account) {
  const context = page.context();
  await apiSignIn(context, base, account);
  const companyName = `${label} ${Date.now()}`;
  const response = await context.request.post(`${base}/api/onboarding`, {
    data: { companyName, businessType: 'Professional Services', country: 'Singapore' }
  });
  if (!response.ok()) {
    throw new Error(`Could not provision an isolated workspace: HTTP ${response.status()} ${(await response.text()).slice(0, 200)}`);
  }
  const { tenant } = await response.json();
  await page.addInitScript((id) => sessionStorage.setItem('vgc.tab-workspace', id), tenant.id);
  return tenant;
}
