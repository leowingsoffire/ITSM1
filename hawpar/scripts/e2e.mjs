/**
 * VGC OCR Intelligence — end-to-end browser suite.
 *
 * Covers the complete user journeys (sign-in → self-service signup → ingest →
 * workflow action → agent trace → accuracy → Azure console), responsive layouts
 * at three breakpoints, keyboard accessibility and console/network error hygiene.
 *
 * Run: node scripts/e2e.mjs   (server must be listening on E2E_BASE / :8080)
 * Signs in with E2E_EMAIL/E2E_PASSWORD (or ADMIN_EMAIL/ADMIN_PASSWORD). The
 * signup journey creates a real workspace, so it runs against a local server,
 * or remotely only with E2E_ALLOW_SIGNUP=1.
 */
import { chromium } from 'playwright-core';
import { ARTIFACT_DIR, CHROMIUM_EXE, credentials, signIn } from './lib/e2e-session.mjs';
import { findLowContrastText } from './lib/contrast.mjs';

const EXE = CHROMIUM_EXE;
const BASE = (process.env.E2E_BASE ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE);
const ALLOW_SIGNUP = LOCAL || process.env.E2E_ALLOW_SIGNUP === '1';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 }
];

const ROUTES = [
  'dashboard',
  'ingest',
  'documents',
  'workflows',
  'agents',
  'accuracy',
  'review',
  'claims',
  'search',
  'azure',
  'cost',
  'blueprint',
  'settings',
  'admin'
];

const browser = await chromium.launch({ executablePath: EXE, headless: true });

/** Errors that are expected as part of a negative test. */
// Deliberate negative probes made by this suite: a workflow action replay and the
// not-found sentinel used to assert the recoverable empty state.
const IGNORED_REQUEST_PATTERNS = [/\/api\/workflows\/.*\/actions$/, /doc_does-not-exist/];
const IGNORED_CONSOLE_PATTERNS = [/doc_does-not-exist/];

async function newSession(viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const pageErrors = [];
  const consoleErrors = [];
  const cspViolations = [];
  const badResponses = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const origin = message.location()?.url ?? '';
    // A CSP report means a declaration was dropped, so the UI silently rendered
    // wrong rather than throwing. Track it by name so the cause is obvious.
    if (/Content Security Policy/i.test(text)) cspViolations.push(`${text.slice(0, 120)} @ ${origin}`);
    // Only suppress the console echo of a request this suite deliberately made.
    if (IGNORED_REQUEST_PATTERNS.some((pattern) => pattern.test(origin))) return;
    if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return;
    consoleErrors.push(`${text}${origin ? ` @ ${origin}` : ''}`);
  });
  page.on('response', (response) => {
    const url = response.url();
    if (response.status() >= 400 && !IGNORED_REQUEST_PATTERNS.some((pattern) => pattern.test(url))) {
      badResponses.push(`${response.status()} ${url}`);
    }
  });

  await page.goto(BASE, { waitUntil: 'load' });
  await signIn(page);

  return { context, page, pageErrors, consoleErrors, cspViolations, badResponses };
}

/** Waits until the view has settled: no spinner and real content painted. */
async function settle(page, label = 'view') {
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

async function goto(page, route) {
  await page.evaluate((hash) => {
    location.hash = hash;
  }, `#/${route}`);
  await settle(page, route);
}

/** Detects horizontal overflow and clipped/misaligned content. */
/**
 * The assistant button floats above the workspace. Scrolled to the end of a
 * view, nothing the user needs to read or click may sit underneath it.
 */
async function fabObstructions(page) {
  await page.evaluate(() => {
    const content = document.querySelector('.content');
    if (content) content.scrollTop = content.scrollHeight;
  });
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const fab = document.querySelector('.copilot-fab');
    if (!fab) return [];
    const f = fab.getBoundingClientRect();
    const covered = [];
    const selector = '.content a, .content button, .content input, .content select, .content td, .content th';
    for (const node of document.querySelectorAll(selector)) {
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right < f.left || r.left > f.right || r.bottom < f.top || r.top > f.bottom) continue;
      covered.push(`${node.tagName} "${(node.textContent ?? '').trim().slice(0, 20)}"`);
    }
    return covered;
  });
}

/**
 * WCAG 2.5.8 target size (minimum): every pointer target must be at least
 * 24x24 CSS px. The target a user actually aims at is the wrapping label when
 * a control has one — clicking the label text activates the control — so the
 * label's box is the honest measurement, not the native widget's.
 */
async function smallTargets(page) {
  return page.evaluate(() => {
    const MIN = 24;
    const selector =
      'a[href], button:not([disabled]), input:not([type=hidden]), select, textarea, [role=tab], [role=button]';
    const offenders = [];
    for (const node of document.querySelectorAll(selector)) {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const own = node.getBoundingClientRect();
      if (own.width < 1 || own.height < 1) continue;
      const wrapper = node.closest('label');
      const target = wrapper && wrapper.contains(node) ? wrapper.getBoundingClientRect() : own;
      if (Math.min(target.width, target.height) >= MIN) continue;
      const label =
        typeof node.className === 'string' && node.className
          ? `${node.tagName.toLowerCase()}.${node.className.trim().split(/\s+/)[0]}`
          : node.tagName.toLowerCase();
      offenders.push(`${label} "${(node.textContent ?? '').trim().slice(0, 18)}" ${Math.round(target.width)}x${Math.round(target.height)}`);
      if (offenders.length > 6) break;
    }
    return offenders;
  });
}

/**
 * A data table fits, stacks into label/value rows, or scrolls inside a
 * labelled, focusable region (`dataTable` in views/common.js). One that
 * overflows without that region looks clipped and strands its off-screen
 * columns from keyboard users — for example a stacked table whose content is
 * still too wide.
 */
async function tableProblems(page) {
  return page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Array.from(document.querySelectorAll('#view-root .table-wrap'))
      .filter((wrap) => wrap.getClientRects().length > 0 && wrap.scrollWidth > wrap.clientWidth + 1)
      .filter(
        (wrap) =>
          !(
            wrap.classList.contains('is-scrollable') &&
            wrap.tabIndex === 0 &&
            wrap.getAttribute('role') === 'region' &&
            wrap.getAttribute('aria-label')
          )
      )
      .map((wrap) => {
        // Name the innermost body element past the right edge so a failure points at its cause.
        const edge = wrap.getBoundingClientRect().right + 1;
        const past = (node) => node.getBoundingClientRect().right > edge;
        const culprit = Array.from(wrap.querySelectorAll('tbody *')).find((node) => past(node) && !Array.from(node.children).some(past));
        const where = culprit
          ? ` (${culprit.tagName.toLowerCase()}${typeof culprit.className === 'string' && culprit.className ? `.${culprit.className.trim().split(/\s+/).join('.')}` : ''}` +
            ` "${(culprit.textContent ?? '').trim().slice(0, 40)}")`
          : '';
        return (
          `"${wrap.dataset.table ?? 'table'}" overflows by ${wrap.scrollWidth - wrap.clientWidth}px` +
          `${wrap.classList.contains('is-stacked') ? ' while stacked' : ''} with no scroll region${where}`
        );
      });
  });
}

async function layoutProblems(page) {
  return page.evaluate(() => {
    const problems = [];
    const docWidth = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > docWidth + 2) {
      problems.push(`page scrollWidth ${document.documentElement.scrollWidth} > viewport ${docWidth}`);
    }
    for (const node of document.querySelectorAll('#view-root *')) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right <= docWidth + 2) continue;
      // Content inside a sideways-scrolling container (a wide table, a tab
      // strip) is reachable by scrolling it; the container itself is still
      // checked, so a strip wider than the screen is caught.
      let scroller = null;
      for (let parent = node.parentElement; parent && parent.id !== 'view-root'; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') {
          scroller = parent;
          break;
        }
      }
      if (scroller) continue;
      const label =
        typeof node.className === 'string' && node.className
          ? `${node.tagName.toLowerCase()}.${node.className.trim().split(/\s+/).join('.')}`
          : node.tagName.toLowerCase();
      problems.push(`${label} overflows right edge by ${Math.round(rect.right - docWidth)}px`);
      if (problems.length > 6) break;
    }
    return problems;
  });
}

/**
 * Composition defects that an overflow check cannot see: in-flow children of
 * a grid or flex container drawn over each other (a field sliding under the
 * next control), a card grid of three or more columns whose last row holds a
 * single orphaned card, and stacked boxed sections (cards, KPI tiles) that
 * touch with no visible gap between them.
 */
async function compositionProblems(page) {
  return page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => {}))),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);

    const root = document.getElementById('view-root');
    const describe = (node) => {
      const classes = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean) : [];
      const text = (node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.textContent || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 24);
      return `${node.tagName.toLowerCase()}${classes.slice(0, 2).map((name) => `.${name}`).join('')} "${text}"`;
    };
    const shown = (node) => {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.display === 'contents' || style.visibility === 'hidden') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const overlaps = [];
    const lone = [];
    const touching = [];

    for (const parent of root.querySelectorAll('*')) {
      const display = getComputedStyle(parent).display;
      if (!/(grid|flex)$/.test(display)) continue;
      const kids = [...parent.children].filter(
        (kid) => shown(kid) && !['absolute', 'fixed'].includes(getComputedStyle(kid).position)
      );
      for (let i = 0; i < kids.length; i += 1) {
        const a = kids[i].getBoundingClientRect();
        for (let j = i + 1; j < kids.length; j += 1) {
          const b = kids[j].getBoundingClientRect();
          const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (width <= 2 || height <= 2) continue;
          // Items explicitly placed in the same grid cell are layered on purpose.
          const first = getComputedStyle(kids[i]);
          const second = getComputedStyle(kids[j]);
          const placed = (style) => style.gridRowStart !== 'auto' && style.gridColumnStart !== 'auto';
          if (
            display.endsWith('grid') &&
            placed(first) &&
            placed(second) &&
            first.gridRowStart === second.gridRowStart &&
            first.gridColumnStart === second.gridColumnStart
          ) {
            continue;
          }
          overlaps.push(`${describe(kids[i])} overlaps ${describe(kids[j])} by ${Math.round(width)}x${Math.round(height)}px`);
        }
      }
    }

    for (const grid of root.querySelectorAll('.grid')) {
      const tops = [...grid.children]
        .filter(shown)
        .map((kid) => kid.getBoundingClientRect().top)
        .sort((x, y) => x - y);
      const rows = [];
      let rowTop = null;
      for (const top of tops) {
        if (rowTop === null || top - rowTop > 2) {
          rows.push(0);
          rowTop = top;
        }
        rows[rows.length - 1] += 1;
      }
      if (rows.length > 1 && rows.at(-1) === 1 && Math.max(...rows) > 2) {
        lone.push(`${describe(grid)} lays out ${tops.length} items as ${rows.join('+')}`);
      }
    }

    const boxes = [...root.querySelectorAll('*')].filter((node) => {
      if (node.matches('input, select, textarea, button, a, label, option') || node.closest('svg')) return false;
      if (!shown(node)) return false;
      const style = getComputedStyle(node);
      if (style.position === 'fixed') return false;
      const edge = (side) =>
        parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Color`] !== 'rgba(0, 0, 0, 0)';
      if (!edge('Top') || !edge('Bottom') || !edge('Left')) return false;
      const rect = node.getBoundingClientRect();
      return rect.width >= 120 && rect.height >= 36;
    });
    for (const upper of boxes) {
      const a = upper.getBoundingClientRect();
      for (const lower of boxes) {
        if (upper === lower || upper.contains(lower) || lower.contains(upper)) continue;
        const b = lower.getBoundingClientRect();
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) < 20) continue;
        const gap = b.top - a.bottom;
        if (gap > -2 && gap < 6) touching.push(`${describe(upper)} touches ${describe(lower)} (gap ${Math.round(gap)}px)`);
      }
    }

    return { overlaps, lone, touching };
  });
}

/* ── Desktop: full functional journey ──────────────────────────────────── */

const desktop = await newSession(VIEWPORTS[0]);
try {
  const { page } = desktop;

  const signedIn = await page.evaluate(async () => (await fetch('/api/auth/session')).json());
  ok('signed in with a real account', signedIn.authenticated === true && Boolean(signedIn.user?.email), signedIn.user?.email ?? '');

  // Wrong credentials are genuinely rejected (validation works). An unknown
  // address is used so that no real account collects a lockout strike.
  const rejectContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const rejectPage = await rejectContext.newPage();
  await rejectPage.goto(BASE, { waitUntil: 'load' });
  await rejectPage.waitForSelector('#auth-email', { timeout: 15000 });
  await rejectPage.click('button.auth__submit');
  const blankError = await rejectPage.$eval('.auth__error', (node) => node.textContent.trim()).catch(() => '');
  ok('signing in with blank fields is refused inline', blankError.length > 0, blankError);
  await rejectPage.fill('#auth-email', `nobody.${Date.now()}@example.invalid`);
  await rejectPage.fill('#auth-password', 'not-the-password');
  await rejectPage.click('button.auth__submit');
  const authError = await rejectPage
    .waitForFunction(() => {
      const text = document.querySelector('.auth__error')?.textContent.trim() ?? '';
      return /incorrect/i.test(text) ? text : false;
    }, null, { timeout: 8000 })
    .then((handle) => handle.jsonValue())
    .catch(() => '');
  ok('invalid credentials are rejected with an inline error', Boolean(authError), String(authError));
  await rejectContext.close();

  /* ── Signup: a first-time visitor provisions their own workspace ────── */
  if (!signedIn.options?.selfSignup) {
    console.log('SKIP  self-service signup journey — this deployment is invitation-only (SELF_SIGNUP=false)');
  } else if (!ALLOW_SIGNUP) {
    console.log('SKIP  self-service signup journey — creates a real workspace; set E2E_ALLOW_SIGNUP=1 to run it remotely');
  } else {
    const onboardContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const onboardPage = await onboardContext.newPage();
    const onboardErrors = [];
    onboardPage.on('pageerror', (error) => onboardErrors.push(String(error)));
    try {
      await onboardPage.emulateMedia({ reducedMotion: 'reduce' });
      await onboardPage.goto(BASE, { waitUntil: 'load' });

      await onboardPage.waitForSelector('#auth-create-workspace', { timeout: 15000 });
      await onboardPage.click('#auth-create-workspace');
      await onboardPage.waitForSelector('.onboard', { timeout: 15000 });
      ok('a first-time visitor can open the signup wizard from the sign-in screen', true);

      // Step 1 validation: the company name is mandatory.
      await onboardPage.click('.onboard-actions .btn--primary');
      const nameError = await onboardPage.$eval('.onboard-error', (node) => node.textContent.trim());
      ok('onboarding rejects a blank company name', nameError.length > 0, nameError);

      // Step 1: the company profile. In signup mode the account step collects
      // the person's details, so the optional contact fields are not shown.
      const stamp = Date.now().toString(36);
      const companyName = `E2E Onboarding ${stamp}`;
      const ownerEmail = `owner.${stamp}@e2e.vgc.test`;
      const ownerPassword = `Owner-${stamp}-Pass!`;
      ok('signup does not ask for the contact details twice', (await onboardPage.$('#ob-contact-email')) === null);
      await onboardPage.fill('#ob-company-name', companyName);
      await onboardPage.selectOption('#ob-country', 'Malaysia');
      await onboardPage.click('.onboard-actions .btn--primary');

      // Step 2 validation: an industry must be chosen.
      await onboardPage.waitForSelector('#ob-business-type', { timeout: 10000 });
      await onboardPage.click('.onboard-actions .btn--primary');
      const typeError = await onboardPage.$eval('.onboard-error', (node) => node.textContent.trim());
      ok('onboarding requires a business type', typeError.length > 0, typeError);

      await onboardPage.selectOption('#ob-business-type', 'Logistics & Supply Chain');
      await onboardPage.click('.onboard-actions .btn--primary');

      // Step 3: the administrator account is validated field by field.
      await onboardPage.waitForSelector('#ob-account-email', { timeout: 10000 });
      const accountError = async () => onboardPage.$eval('.onboard-error', (node) => node.textContent.trim());
      await onboardPage.click('.onboard-actions .btn--primary');
      const nameRequired = await accountError();
      ok('onboarding asks for the administrator name', /your name/i.test(nameRequired), nameRequired);
      await onboardPage.fill('#ob-account-name', 'E2E Tester');
      await onboardPage.fill('#ob-account-email', 'not-an-email');
      await onboardPage.click('.onboard-actions .btn--primary');
      const emailError = await accountError();
      ok('onboarding rejects a malformed sign-in email', /valid work email/i.test(emailError), emailError);
      await onboardPage.fill('#ob-account-email', ownerEmail);
      await onboardPage.fill('#ob-account-password', 'short');
      await onboardPage.click('.onboard-actions .btn--primary');
      const tooShort = await accountError();
      ok('onboarding enforces the password length policy', /at least \d+ characters/i.test(tooShort), tooShort);
      await onboardPage.fill('#ob-account-password', ownerPassword);
      await onboardPage.fill('#ob-account-confirm', `${ownerPassword}-typo`);
      await onboardPage.click('.onboard-actions .btn--primary');
      const mismatch = await accountError();
      ok('onboarding refuses mismatched passwords', /do not match/i.test(mismatch), mismatch);
      await onboardPage.fill('#ob-account-confirm', ownerPassword);
      await onboardPage.click('.onboard-actions .btn--primary');

      // Step 4: the review step must echo back exactly what was entered.
      await onboardPage.waitForSelector('.onboard-summary', { timeout: 10000 });
      const summary = await onboardPage.$eval('.onboard-summary', (node) => node.textContent);
      ok(
        'onboarding review step echoes the entered profile and administrator',
        summary.includes(companyName) && summary.includes('Malaysia') && summary.includes('Logistics & Supply Chain') && summary.includes(ownerEmail),
        summary.slice(0, 160)
      );

      // Back/forward navigation must preserve what was typed.
      await onboardPage.click('.onboard-actions .btn--ghost');
      await onboardPage.waitForSelector('#ob-account-email', { timeout: 10000 });
      await onboardPage.click('.onboard-actions .btn--ghost');
      await onboardPage.waitForSelector('#ob-business-type', { timeout: 10000 });
      const retainedType = await onboardPage.$eval('#ob-business-type', (node) => node.value);
      ok('onboarding retains answers when stepping back', retainedType === 'Logistics & Supply Chain', retainedType);
      await onboardPage.click('.onboard-actions .btn--primary');
      await onboardPage.waitForSelector('#ob-account-email', { timeout: 10000 });
      await onboardPage.click('.onboard-actions .btn--primary');
      await onboardPage.waitForSelector('.onboard-summary', { timeout: 10000 });

      await onboardPage.click('#onboard-create');
      await onboardPage.waitForSelector('.onboard', { state: 'detached', timeout: 20000 });
      await onboardPage.waitForSelector('#view-root div.view', { timeout: 20000 });
      ok('creating a workspace signs the new administrator straight in', (await onboardPage.$('.auth')) === null);

      const created = await onboardPage.evaluate(async () => (await fetch('/api/auth/session')).json());
      ok(
        'the new account administers the new workspace',
        created.user?.email === ownerEmail && created.workspace?.name === companyName && created.workspace?.role === 'admin',
        `${created.user?.email} · ${created.workspace?.name} · ${created.workspace?.role}`
      );
      const tenantId = created.workspace?.id;
      const pinned = await onboardPage.evaluate(() => sessionStorage.getItem('vgc.tab-workspace'));
      ok('the tab is pinned to the created workspace', Boolean(tenantId) && pinned === tenantId, String(pinned));

      // Isolation: the new workspace opens with its own company profile…
      const seeded = await onboardPage.evaluate(async () => {
        const response = await fetch('/api/settings');
        return (await response.json()).settings?.company?.name ?? null;
      });
      ok('the new workspace is seeded with the customer company profile', seeded === companyName, String(seeded));

      // …none of another workspace's documents, and no way into it.
      const isolated = await onboardPage.evaluate(async (otherId) => {
        const mine = await (await fetch('/api/documents?pageSize=1')).json();
        const other = await fetch('/api/documents?pageSize=1', { headers: { 'x-tenant-id': otherId } });
        return { mine: mine.total, otherStatus: other.status };
      }, signedIn.workspace?.id);
      ok(
        'documents are isolated to the workspace that owns them',
        isolated.mine === 0 && isolated.otherStatus === 403,
        `own ${isolated.mine} · another workspace answers ${isolated.otherStatus}`
      );

      // The created workspace must be identifiable from the shell, not just implied.
      await onboardPage.click('#sign-out');
      await onboardPage.waitForSelector('.account-menu:not([hidden])', { timeout: 8000 });
      const menuWorkspace = await onboardPage.$eval('.account-menu__value', (node) => node.textContent.trim());
      ok('the account menu names the customer workspace', menuWorkspace === companyName, menuWorkspace);
      await onboardPage.keyboard.press('Escape');

      // The session survives a reload — neither the wizard nor the sign-in screen returns.
      await onboardPage.reload({ waitUntil: 'load' });
      await onboardPage.waitForSelector('#view-root div.view', { timeout: 20000 });
      const promptedAgain = (await onboardPage.$('.onboard')) !== null || (await onboardPage.$('.auth')) !== null;
      ok('a returning administrator stays signed in to their workspace', !promptedAgain);

      ok('no uncaught page errors during onboarding', onboardErrors.length === 0, onboardErrors.slice(0, 2).join(' | '));
    } finally {
      await onboardContext.close();
    }
  }

  // Branding.
  const title = await page.title();
  ok('document title carries the product name', title.includes('VGC OCR Intelligence'), title);
  const brand = await page.$eval('.brand-text__title', (node) => node.textContent.trim());
  ok('sidebar brand is VGC OCR Intelligence', brand === 'VGC OCR Intelligence', brand);

  /* ── Account menu ───────────────────────────────────────────────────── */
  await page.click('#sign-out');
  await page.waitForSelector('.account-menu:not([hidden])', { timeout: 8000 });
  const accountWorkspace = await page.$eval('.account-menu__value', (node) => node.textContent.trim());
  ok('account menu names the active workspace', accountWorkspace === signedIn.workspace?.name, accountWorkspace);
  const accountName = await page.$eval('.account-menu__name', (node) => node.textContent.trim());
  ok('account menu names the signed-in person', accountName === (signedIn.user?.name || signedIn.user?.email), accountName);
  const accountActions = await page.$$eval('.account-menu__item', (nodes) => nodes.map((node) => node.textContent.trim()));
  ok(
    'account menu offers password, device and sign-out actions',
    ['Change password', 'Signed-in devices', 'Sign out'].every((label) => accountActions.some((action) => action.includes(label))),
    accountActions.join(' | ')
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.account-menu')?.hidden === true, null, { timeout: 5000 });
  ok('account menu closes on Escape', true);

  // The session cookie must survive a reload — otherwise every reload re-prompts.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-root div.view', { timeout: 20000 });
  ok('the session survives a reload without signing in again', (await page.$('.auth')) === null);

  // Every route renders.
  for (const route of ROUTES) {
    await goto(page, route);
    const length = await page.$eval('#view-root div.view', (node) => node.textContent.trim().length);
    const failed = await page.$('#view-root .empty h3');
    const failedText = failed ? await failed.textContent() : '';
    ok(
      `route #/${route} renders`,
      length > 60 && !failedText.includes('could not be loaded'),
      `${length} chars`
    );

    // Unfinished UI: a stray "null"/"undefined" leaking into the rendered DOM.
    const placeholders = await page.$eval('#view-root', (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const found = [];
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent.trim();
        if (text === 'null' || text === 'undefined' || text === 'NaN' || text === '[object Object]') {
          found.push(`${text} in <${walker.currentNode.parentElement?.tagName.toLowerCase()}>`);
        }
      }
      return found;
    });
    ok(`route #/${route} renders no placeholder artefacts`, placeholders.length === 0, placeholders.slice(0, 3).join(' | '));
  }

  // Navigation highlights the active item.
  await goto(page, 'workflows');
  const activeNav = await page.$eval('.nav-item.is-active', (node) => node.dataset.view);
  ok('active navigation item tracks the route', activeNav === 'workflows', activeNav);

  /* ── Ingest journey ─────────────────────────────────────────────────── */
  await goto(page, 'ingest');
  const beforeCount = await page.evaluate(async () => (await (await fetch('/api/documents?pageSize=1')).json()).total);
  const acceptedIds = await page.evaluate(async () => {
    const response = await fetch('/api/samples/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleIds: ['sample-invoice', 'sample-po'] })
    });
    return (await response.json()).accepted.map((doc) => doc.id);
  });
  // Wait on each ingested document reaching a terminal status, not on
  // /api/pipeline/status: the pipeline gauge is in-process, so a multi-node
  // deployment can report idle while another instance is still working.
  // The poll runs through page.evaluate (which awaits promises) — a
  // waitForFunction predicate that returns a promise resolves immediately,
  // because the pending promise object itself is truthy.
  {
    const TERMINAL = ['completed', 'needs-review', 'approved', 'rejected', 'failed'];
    const deadline = Date.now() + 180000;
    let pending = [...acceptedIds];
    while (pending.length > 0) {
      if (Date.now() > deadline) {
        throw new Error(`Ingested documents never reached a terminal status: ${pending.join(', ')}`);
      }
      await page.waitForTimeout(2000);
      const statuses = await page.evaluate(
        (ids) =>
          Promise.all(
            ids.map((id) =>
              fetch(`/api/documents/${encodeURIComponent(id)}`)
                .then((response) => response.json())
                .then((doc) => doc?.status ?? 'unknown')
                .catch(() => 'unknown')
            )
          ),
        pending
      );
      pending = pending.filter((_, index) => !TERMINAL.includes(statuses[index]));
    }
  }
  const afterCount = await page.evaluate(async () => (await (await fetch('/api/documents?pageSize=1')).json()).total);
  ok('ingest creates and processes new documents', afterCount > beforeCount, `${beforeCount} → ${afterCount}`);

  /* ── Agent mesh ─────────────────────────────────────────────────────── */
  await goto(page, 'agents');
  const agentNodes = await page.$$eval('.agent-node', (nodes) => nodes.length);
  ok('agent mesh renders every agent node', agentNodes === 11, `${agentNodes} nodes`);
  const waves = await page.$$eval('.wave', (nodes) => nodes.length);
  ok('agent mesh renders execution waves', waves >= 8, `${waves} waves`);

  await page.click('.agent-node >> nth=3');
  await page.waitForFunction(() => document.querySelector('.agent-node.is-active') !== null, null, { timeout: 10000 });
  await page.waitForFunction(
    () => document.body.textContent.includes('Capabilities') && document.body.textContent.includes('Recent evidence'),
    null,
    { timeout: 15000 }
  );
  ok('selecting an agent opens its evidence panel', true);

  const runRows = await page.$$eval('table.data tbody tr', (nodes) => nodes.length);
  ok('orchestration run history is populated', runRows > 0, `${runRows} runs`);

  /* ── Accuracy ───────────────────────────────────────────────────────── */
  await goto(page, 'accuracy');
  const accuracyKpi = await page.$eval('.kpi .kpi__value', (node) => node.textContent.trim());
  ok('accuracy console shows a corpus score', /\d/.test(accuracyKpi), accuracyKpi);
  const reliabilityRows = await page.$$eval('.reliability__row', (nodes) => nodes.length);
  ok('calibration reliability curve renders', reliabilityRows > 0, `${reliabilityRows} buckets`);

  // The console must publish the integrity dimension, not just accuracy: a
  // document that contradicts its own arithmetic is a different problem from a
  // field the platform transcribed wrongly, and reviewers act on each
  // differently.
  const integritySurface = await page.evaluate(async () => {
    const benchmark = await (await fetch('/api/accuracy/benchmark')).json();
    const kpiLabels = Array.from(document.querySelectorAll('.kpi')).map((node) => node.textContent.toLowerCase());
    const attributions = Array.from(
      document.querySelectorAll('[data-table="Assurance checks"] tbody tr td:nth-child(2)')
    ).map((cell) => cell.textContent.trim());
    return {
      hasKpi: kpiLabels.some((text) => text.includes('document integrity')),
      attributions,
      checks: benchmark.byCheck?.length ?? 0,
      hasModelCurve: Boolean(benchmark.modelCalibration)
    };
  });
  ok('accuracy console publishes the document-integrity KPI', integritySurface.hasKpi);
  ok(
    'every assurance check declares what it proves',
    integritySurface.attributions.length === integritySurface.checks &&
      integritySurface.attributions.every((text) => /extraction fidelity|document integrity/.test(text)),
    integritySurface.attributions.join(', ')
  );
  ok(
    'the calibrated curve is published alongside the raw model curve',
    integritySurface.hasModelCurve
  );

  const typeOptions = await page.$$eval('#accuracy-type option', (nodes) => nodes.length);
  ok('accuracy type filter is populated', typeOptions > 1, `${typeOptions} options`);
  const secondType = await page.$eval('#accuracy-type option >> nth=1', (node) => node.value);
  await page.selectOption('#accuracy-type', secondType);
  await settle(page);
  await page
    .waitForFunction(
      () => document.querySelectorAll('[data-table="Accuracy by document type"] tbody tr').length === 1,
      null,
      { timeout: 15000 }
    )
    .catch(() => {});
  await settle(page);
  const filteredRows = await page.$$eval(
    '[data-table="Accuracy by document type"] tbody tr',
    (nodes) => nodes.length
  );
  ok(
    'accuracy type filter narrows the table to the selected type',
    filteredRows === 1,
    `${filteredRows} row(s) for "${secondType}"`
  );
  await page.selectOption('#accuracy-type', '');
  await settle(page);

  /* ── Azure console ──────────────────────────────────────────────────── */
  await goto(page, 'azure');
  const routingRows = await page.$$eval('table.data tbody tr', (nodes) => nodes.length);
  ok('azure console renders the model and routing tables', routingRows >= 20, `${routingRows} rows`);
  await page.click('button:has-text("Re-probe resource")');
  await page.waitForSelector('.toast', { timeout: 15000 });
  ok('azure re-probe returns a result and notifies', true);

  /* ── Workflow board: filters, search, sort, paging ──────────────────── */
  await goto(page, 'workflows');
  const totalWorkflows = await page.evaluate(async () => (await (await fetch('/api/workflows?pageSize=1')).json()).total);
  ok('workflow board has workflow instances', totalWorkflows > 0, `${totalWorkflows} instances`);

  // The board is one of three tables on this page, so it is addressed by its
  // own data hook: when a filter empties the list the table is replaced by an
  // empty state, and a positional selector would silently start counting the
  // workflow-definitions table instead.
  const boardRows = () =>
    page.$$eval('[data-table="Workflow instances"] tbody tr', (nodes) => nodes.length).catch(() => 0);

  const allRows = await boardRows();
  const statusMismatches = [];
  for (const status of ['completed', 'active', 'on-hold']) {
    const expected = await page.evaluate(
      async (value) => (await (await fetch(`/api/workflows?status=${value}&pageSize=1`)).json()).total,
      status
    );
    const wanted = Math.min(expected, 25);
    await page.selectOption('#workflow-status', status);
    await page
      .waitForFunction(
        (target) => {
          const body = document.querySelector('[data-table="Workflow instances"] tbody');
          const rows = body ? body.querySelectorAll('tr').length : 0;
          return rows === target;
        },
        wanted,
        { timeout: 15000 }
      )
      .catch(() => {});
    await settle(page);
    const rows = await boardRows();
    if (rows !== wanted) statusMismatches.push(`${status}: ui ${rows} vs api ${expected}`);
    if (expected === 0 && !(await page.evaluate(() => document.body.textContent.includes('No workflows match these filters')))) {
      statusMismatches.push(`${status}: empty state missing`);
    }
  }
  ok(
    'workflow status filter agrees with the API for every status',
    statusMismatches.length === 0,
    `${allRows} unfiltered · ${statusMismatches.join(' | ')}`
  );
  await page.selectOption('#workflow-status', '');
  await settle(page);

  await page.fill('#workflow-search', 'zzz-no-such-document');
  await page.waitForFunction(
    () => document.body.textContent.includes('No workflows match these filters'),
    null,
    { timeout: 15000 }
  );
  ok('workflow search shows an empty state when nothing matches', true);
  await page.fill('#workflow-search', '');
  await settle(page);

  await page.selectOption('#workflow-sort', 'slaDueAt:asc');
  await settle(page);
  ok('workflow sort control applies without error', true);

  /* ── Workflow detail: validation + real state transition ────────────── */
  const targetDocument = await page.evaluate(async () => {
    const body = await (await fetch('/api/workflows?status=active&pageSize=1&sort=priorityScore:desc')).json();
    return body.items[0]?.documentId ?? null;
  });
  ok('an active workflow is available to action', Boolean(targetDocument), String(targetDocument));

  if (targetDocument) {
    await page.evaluate((id) => {
      location.hash = `#/workflows/${id}`;
    }, targetDocument);
    await settle(page);

    const steps = await page.$$eval('.timeline__item', (nodes) => nodes.length);
    ok('workflow detail renders the step timeline', steps > 0, `${steps} steps`);

    // The audit actor is the signed-in person, never a typed-in name.
    const actorNote = await page.$eval('#wf-actor-help', (node) => node.textContent.trim());
    ok('workflow form records the signed-in person as the actor', actorNote.includes(signedIn.user?.email ?? '\u0000'), actorNote);
    ok('workflow form offers no free-text actor field', (await page.$('#wf-actor')) === null);

    // Validation: reassign without an assignee must be refused.
    await page.selectOption('#wf-action', 'reassign');
    await page.click('button:has-text("Apply action")');
    const assigneeError = await page.$eval('#wf-assignee-error', (node) => node.textContent.trim());
    ok('workflow form requires an assignee when reassigning', assigneeError.length > 0, assigneeError);

    // Real transition: approve the current step.
    const before = await page.evaluate(async (id) => {
      const body = await (await fetch(`/api/workflows/${id}`)).json();
      return { step: body.currentStepId, history: body.history.length };
    }, targetDocument);

    await page.selectOption('#wf-action', 'approve');
    await page.fill('#wf-note', 'Approved by the automated end-to-end suite.');
    await page.click('button:has-text("Apply action")');
    await page.waitForSelector('.toast', { timeout: 15000 });
    await page.waitForFunction(
      (previous) =>
        fetch(`/api/workflows/${previous.id}`)
          .then((response) => response.json())
          .then((body) => body.history.length > previous.history),
      { id: targetDocument, history: before.history },
      { timeout: 20000 }
    );
    const after = await page.evaluate(async (id) => {
      const body = await (await fetch(`/api/workflows/${id}`)).json();
      return { step: body.currentStepId, history: body.history.length, status: body.status, actor: body.history.at(-1)?.actor };
    }, targetDocument);
    ok(
      'approving a step advances the workflow and writes audit history',
      after.history > before.history && after.step !== before.step,
      `${before.step} → ${after.step}, history ${before.history} → ${after.history}`
    );
    ok('the audit history names the signed-in approver', after.actor === signedIn.user?.email, String(after.actor));

    // Persistence: the transition survives a full reload.
    await page.reload({ waitUntil: 'load' });
    await settle(page);
    const persisted = await page.evaluate(
      async (id) => (await (await fetch(`/api/workflows/${id}`)).json()).history.length,
      targetDocument
    );
    ok('workflow transition is persisted across a reload', persisted === after.history, `${persisted} entries`);
  }

  /* ── Document detail keeps working (regression) ─────────────────────── */
  // Assert on a document this suite ingested itself: on a live shared
  // deployment other sessions upload documents at any moment, and a foreign
  // record can legitimately be mid-pipeline (placeholder view) or carry no
  // scored fields (empty assurance tab), which would fail these checks.
  const documentId = acceptedIds[0];
  await page.evaluate((id) => {
    location.hash = `#/documents/${id}`;
  }, documentId);
  await settle(page);
  const detailLength = await page.$eval('#view-root div.view', (node) => node.textContent.trim().length);
  ok('document detail still renders', detailLength > 200, `${detailLength} chars`);

  /* ── Assurance evidence is auditable per field ───────────────────────── */
  const expectedAccuracy = await page.evaluate(async (id) => {
    const record = await (await fetch(`/api/documents/${encodeURIComponent(id)}`)).json();
    return {
      fields: record.accuracy?.fields?.length ?? 0,
      verdicts: (record.accuracy?.fields ?? []).map((field) => field.verdict),
      integrityIssues: record.accuracy?.integrityIssueCount ?? 0
    };
  }, documentId);

  await page.click('#doc-tab-assurance');
  await page.waitForSelector('.assurance__field', { timeout: 10000 }).catch(() => {});
  const assurance = await page.evaluate(() => ({
    cards: document.querySelectorAll('.assurance__field').length,
    checks: document.querySelectorAll('.assurance__check').length,
    selected: document.querySelector('#doc-tab-assurance')?.getAttribute('aria-selected'),
    labelled: document.querySelector('.tab-panel')?.getAttribute('aria-labelledby')
  }));
  ok(
    'assurance tab lists every scored field with its evidence',
    assurance.cards === expectedAccuracy.fields && assurance.checks > assurance.cards,
    `${assurance.cards}/${expectedAccuracy.fields} field(s), ${assurance.checks} check(s)`
  );
  ok(
    'assurance tab is announced as the selected tab panel',
    assurance.selected === 'true' && assurance.labelled === 'doc-tab-assurance',
    `selected=${assurance.selected} labelledby=${assurance.labelled}`
  );

  // Tabs must be operable from the keyboard, not the mouse alone.
  await page.focus('#doc-tab-assurance');
  await page.keyboard.press('ArrowRight');
  const afterArrow = await page.evaluate(() => ({
    active: document.activeElement?.id,
    selected: document.querySelector('.tab[aria-selected="true"]')?.id
  }));
  ok(
    'tabs respond to arrow-key navigation',
    afterArrow.active === 'doc-tab-tables' && afterArrow.selected === 'doc-tab-tables',
    `active=${afterArrow.active} selected=${afterArrow.selected}`
  );

  const tabStops = await page.$$eval('.tabs .tab', (nodes) => nodes.filter((n) => n.tabIndex === 0).length);
  ok('the tab strip is a single tab stop', tabStops === 1, `${tabStops} stop(s)`);

  /* ── Document deletion (with confirm dialog cancel/confirm) ──────────── */
  {
    const deleteTargetId = acceptedIds[1] ?? acceptedIds[0];
    await page.evaluate((id) => {
      location.hash = `#/documents/${id}`;
    }, deleteTargetId);
    await settle(page);
    await page.click('button:has-text("Delete")');
    await page.waitForSelector('dialog.confirm-dialog[open]', { timeout: 5000 });
    await page.click('dialog.confirm-dialog button:has-text("Cancel")');
    await page.waitForTimeout(200);
    // Probe through the context's request client: it carries the session
    // cookie but is not page traffic, so the expected 404 after deletion is
    // not mistaken for an application error by the console/network checks.
    const documentStatus = async (id) => (await desktop.context.request.get(`${BASE}/api/documents/${encodeURIComponent(id)}`)).status();
    const stillExists = await documentStatus(deleteTargetId);
    ok('cancelling document delete keeps the document', stillExists === 200, `status=${stillExists}`);

    await page.click('button:has-text("Delete")');
    await page.waitForSelector('dialog.confirm-dialog[open]', { timeout: 5000 });
    await page.click('dialog.confirm-dialog button:has-text("Delete document")');
    await page.waitForFunction(() => location.hash === '#/documents', null, { timeout: 10000 });
    await settle(page);
    const deletedStatus = await documentStatus(deleteTargetId);
    ok('confirming document delete removes it and returns to the library', deletedStatus === 404, `status=${deletedStatus}`);
  }

  /* ── Error handling ─────────────────────────────────────────────────── */
  await goto(page, 'workflows');
  const labelIssues = await page.evaluate(() => {
    const issues = [];
    for (const control of document.querySelectorAll('#view-root select, #view-root input, #view-root textarea')) {
      const id = control.id;
      const labelled =
        (id && document.querySelector(`label[for="${id}"]`)) ||
        control.getAttribute('aria-label') ||
        control.closest('label');
      if (!labelled) issues.push(control.id || control.name || control.tagName);
    }
    return issues;
  });
  ok('every form control on the workflow board is labelled', labelIssues.length === 0, labelIssues.join(', '));

  const headings = await page.$$eval('#view-root h1', (nodes) => nodes.length);
  ok('each view exposes exactly one h1', headings === 1, `${headings} h1`);

  await page.keyboard.press('Tab');
  const focusVisible = await page.evaluate(() => document.activeElement !== document.body);
  ok('keyboard focus moves into the page', focusVisible);

  /* ── Error handling ─────────────────────────────────────────────────── */
  await page.evaluate(() => {
    location.hash = '#/workflows/doc_does-not-exist';
  });
  await page.waitForFunction(() => document.body.textContent.includes('Workflow not found'), null, { timeout: 15000 });
  ok('unknown workflow shows a recoverable not-found state', true);

  await page.evaluate(() => {
    location.hash = '#/this-route-does-not-exist';
  });
  await settle(page);
  const fallbackNav = await page.$eval('.nav-item.is-active', (node) => node.dataset.view);
  ok('unknown route falls back to the dashboard', fallbackNav === 'dashboard', fallbackNav);

  ok('no uncaught page errors during the desktop journey', desktop.pageErrors.length === 0, desktop.pageErrors.slice(0, 3).join(' | '));
  ok(
    'no console errors during the desktop journey',
    desktop.consoleErrors.length === 0,
    desktop.consoleErrors.slice(0, 3).join(' | ')
  );
  ok(
    'no content security policy violations during the desktop journey',
    desktop.cspViolations.length === 0,
    desktop.cspViolations.slice(0, 2).join(' | ')
  );
  ok(
    'no failed network requests during the desktop journey',
    desktop.badResponses.length === 0,
    desktop.badResponses.slice(0, 3).join(' | ')
  );
} finally {
  await desktop.context.close();
}

/* ── Responsive sweep ──────────────────────────────────────────────────── */

// The member-controls check needs at least one listed member, and a workspace
// can legitimately have none (a platform administrator is not listed). Add a
// temporary operator to the workspace the sweep signs in to, removed below.
const fixtureContext = await browser.newContext();
const { email: adminEmail, password: adminPassword } = credentials();
await fixtureContext.request.post(`${BASE}/api/auth/login`, { data: { email: adminEmail, password: adminPassword } });
const sweepWorkspace = (await (await fixtureContext.request.get(`${BASE}/api/auth/session`)).json()).workspace?.id;
const fixtureHeaders = sweepWorkspace ? { 'x-tenant-id': sweepWorkspace } : {};
const fixtureMember = await fixtureContext.request.post(`${BASE}/api/admin/members`, {
  headers: fixtureHeaders,
  data: { email: `layout.${Date.now()}@e2e.vgc.test`, name: 'Layout Fixture', role: 'user' }
});
const fixtureMemberId = fixtureMember.ok() ? (await fixtureMember.json()).member?.id : null;
ok('responsive sweep fixture: a temporary operator is added', Boolean(fixtureMemberId), `HTTP ${fixtureMember.status()}`);

// Detail screens are swept too, using records the journey above created. The
// journey ingests no marketing claim, so one is ingested here with its two
// supporting bills; otherwise the claim reconciliation screen would go unchecked.
const existingClaims = await fixtureContext.request.get(`${BASE}/api/claims`, { headers: fixtureHeaders });
if (existingClaims.ok() && ((await existingClaims.json()).items ?? []).length === 0) {
  const SETTLED = ['completed', 'needs-review', 'approved', 'rejected', 'failed'];
  const run = await fixtureContext.request.post(`${BASE}/api/samples/run`, {
    headers: fixtureHeaders,
    data: { sampleIds: ['sample-mkt-claim-pop', 'sample-mkt-support-pop-1', 'sample-mkt-support-pop-2'] }
  });
  let pending = run.ok() ? ((await run.json()).accepted ?? []).map((doc) => doc.id) : [];
  const deadline = Date.now() + 180000;
  while (pending.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const statuses = await Promise.all(
      pending.map(async (id) => {
        const response = await fixtureContext.request.get(`${BASE}/api/documents/${encodeURIComponent(id)}`, {
          headers: fixtureHeaders
        });
        return response.ok() ? (await response.json()).status : 'unknown';
      })
    );
    pending = pending.filter((_, index) => !SETTLED.includes(statuses[index]));
  }
}
const detailRoutes = [];
for (const [prefix, path, key] of [
  ['documents', '/api/documents?pageSize=1', 'id'],
  ['workflows', '/api/workflows?pageSize=1', 'documentId'],
  ['claims', '/api/claims', 'id']
]) {
  const response = await fixtureContext.request.get(`${BASE}${path}`, { headers: fixtureHeaders });
  const id = response.ok() ? (await response.json()).items?.[0]?.[key] : null;
  if (id) detailRoutes.push(`${prefix}/${encodeURIComponent(id)}`);
}
ok(
  'responsive sweep covers document, workflow and claim detail',
  detailRoutes.length === 3,
  detailRoutes.map((route) => route.split('/')[0]).join(', ') || 'none'
);
const sweepRoutes = [...ROUTES, ...detailRoutes];

try {
for (const viewport of VIEWPORTS) {
  const session = await newSession(viewport);
  try {
    const problems = [];
    const illegible = [];
    const obstructed = [];
    const undersized = [];
    const overlapping = [];
    const orphaned = [];
    const cramped = [];
    const clippedTables = [];
    for (const route of sweepRoutes) {
      const label = route.includes('/') ? `${route.split('/')[0]}/:id` : route;
      try {
        await goto(session.page, route);
      } catch (error) {
        const diagnostic = await session.page
          .evaluate(() => (document.getElementById('view-root')?.textContent ?? '').trim().slice(0, 160))
          .catch(() => '');
        problems.push(
          `${label}: ${error.message} | root="${diagnostic}" | console=${session.consoleErrors.slice(-2).join(' / ')} | net=${session.badResponses.slice(-2).join(' / ')}`
        );
        continue;
      }
      const issues = await layoutProblems(session.page);
      if (issues.length > 0) problems.push(`${label}: ${issues.join('; ')}`);
      const composition = await compositionProblems(session.page);
      overlapping.push(...composition.overlaps.map((entry) => `${label}: ${entry}`));
      orphaned.push(...composition.lone.map((entry) => `${label}: ${entry}`));
      cramped.push(...composition.touching.map((entry) => `${label}: ${entry}`));
      clippedTables.push(...(await tableProblems(session.page)).map((entry) => `${label}: ${entry}`));
      for (const run of await findLowContrastText(session.page)) {
        illegible.push(`${label}: ${run.label} "${run.text.slice(0, 24)}" at ${run.ratio}:1`);
      }
      for (const covered of await fabObstructions(session.page)) {
        obstructed.push(`${label}: ${covered}`);
      }
      for (const target of await smallTargets(session.page)) {
        undersized.push(`${label}: ${target}`);
      }
      await session.page.evaluate(() => {
        const content = document.querySelector('.content');
        if (content) content.scrollTop = 0;
      });
      await session.page.waitForTimeout(250);
      await session.page.screenshot({
        path: `${ARTIFACT_DIR}/${viewport.name}-${label.replace('/:id', '-detail')}.png`,
        fullPage: false
      });
    }
    ok(`${viewport.name} (${viewport.width}px) has no layout overflow`, problems.length === 0, problems.slice(0, 3).join(' | '));
    ok(
      `${viewport.name} (${viewport.width}px) draws no control or section over another`,
      overlapping.length === 0,
      overlapping.slice(0, 3).join(' | ')
    );
    ok(
      `${viewport.name} (${viewport.width}px) leaves no lone card on a multi-column row`,
      orphaned.length === 0,
      orphaned.slice(0, 3).join(' | ')
    );
    ok(
      `${viewport.name} (${viewport.width}px) keeps a visible gap between stacked sections`,
      cramped.length === 0,
      cramped.slice(0, 3).join(' | ')
    );
    ok(
      `${viewport.name} (${viewport.width}px) fits or stacks every table, or scrolls it in a labelled region`,
      clippedTables.length === 0,
      clippedTables.slice(0, 3).join(' | ')
    );
    ok(
      `${viewport.name} (${viewport.width}px) renders every text run legibly`,
      illegible.length === 0,
      illegible.slice(0, 3).join(' | ')
    );
    ok(
      `${viewport.name} (${viewport.width}px) keeps content clear of the assistant button`,
      obstructed.length === 0,
      obstructed.slice(0, 3).join(' | ')
    );
    ok(
      `${viewport.name} (${viewport.width}px) meets the 24px minimum target size`,
      undersized.length === 0,
      undersized.slice(0, 3).join(' | ')
    );

    // The workflow board must remain usable on a phone.
    await goto(session.page, 'workflows');
    const controlsReachable = await session.page.evaluate(() => {
      const control = document.querySelector('#workflow-status');
      if (!control) return false;
      const rect = control.getBoundingClientRect();
      return rect.width > 40 && rect.height >= 24 && rect.left >= -1;
    });
    ok(`${viewport.name}: workflow filters remain reachable`, controlsReachable);

    // The global search box never shows a clipped placeholder ("Search acros").
    const searchHint = await session.page.$eval('#global-search', (input) => {
      const style = getComputedStyle(input);
      const measure = document.createElement('canvas').getContext('2d');
      measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const available = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return { placeholder: input.placeholder, text: measure.measureText(input.placeholder).width, available };
    });
    ok(
      `${viewport.name}: the search placeholder fits its box`,
      searchHint.placeholder.length > 0 && searchHint.text <= searchHint.available + 0.5,
      `"${searchHint.placeholder}" ${Math.round(searchHint.text)}px in ${Math.round(searchHint.available)}px`
    );

    // The admin console stays operable: member controls sit on screen rather
    // than behind a sideways scroll, and the tab strip shows where tabs hide.
    await goto(session.page, 'admin');
    await session.page.waitForSelector('[data-table="Workspace members"]', { timeout: 15000 });
    const memberControls = await session.page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const controls = [...document.querySelectorAll('[data-table="Workspace members"] select, [data-table="Workspace members"] .admin-row-actions button')];
      const offscreen = controls.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < 0 || rect.right > width + 1;
      });
      return { total: controls.length, offscreen: offscreen.length };
    });
    ok(
      `${viewport.name}: member role and actions stay on screen`,
      memberControls.total > 0 && memberControls.offscreen === 0,
      `${memberControls.offscreen}/${memberControls.total} off screen`
    );
    await session.page.focus('.tabs .tab.is-active');
    await session.page.keyboard.press('End');
    await session.page.waitForTimeout(150);
    const strip = await session.page.evaluate(() => {
      const bar = document.querySelector('.tabs');
      const active = bar.querySelector('.tab.is-active');
      const barRect = bar.getBoundingClientRect();
      const tabRect = active.getBoundingClientRect();
      return {
        label: active.textContent.trim(),
        last: [...bar.querySelectorAll('.tab')].at(-1)?.textContent.trim(),
        visible: tabRect.left >= barRect.left - 1 && tabRect.right <= barRect.right + 1,
        overflowing: bar.scrollWidth > bar.clientWidth + 1,
        fadeStart: bar.classList.contains('has-more-start'),
        fadeEnd: bar.classList.contains('has-more-end')
      };
    });
    // End selects the last tab: Learning memory, or Workspaces for a platform administrator.
    ok(
      `${viewport.name}: the selected tab is scrolled into view and hidden tabs are signposted`,
      ['Learning memory', 'Workspaces'].includes(strip.label) &&
        strip.label === strip.last &&
        strip.visible &&
        strip.fadeEnd === false &&
        strip.fadeStart === strip.overflowing,
      JSON.stringify(strip)
    );

    ok(
      `${viewport.name}: no page errors`,
      session.pageErrors.length === 0,
      session.pageErrors.slice(0, 2).join(' | ')
    );
    ok(
      `${viewport.name}: no content security policy violations`,
      session.cspViolations.length === 0,
      session.cspViolations.slice(0, 2).join(' | ')
    );
  } finally {
    await session.context.close();
  }
}
} finally {
  if (fixtureMemberId) {
    const removed = await fixtureContext.request.delete(`${BASE}/api/admin/members/${encodeURIComponent(fixtureMemberId)}`, { headers: fixtureHeaders });
    ok('responsive sweep fixture: the temporary operator is removed', removed.ok(), `HTTP ${removed.status()}`);
  }
  await fixtureContext.close();
}

await browser.close();

const failed = results.filter((entry) => !entry.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('\nFailures:');
  for (const entry of failed) console.log(`  - ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);
