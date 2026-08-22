/**
 * VGC OCR Intelligence — end-to-end browser suite.
 *
 * Covers the complete user journeys (login → ingest → workflow action →
 * agent trace → accuracy → Azure console), responsive layouts at three
 * breakpoints, keyboard accessibility and console/network error hygiene.
 *
 * Run: node scripts/e2e.mjs   (server must be listening on E2E_BASE / :8080)
 */
import { chromium } from 'playwright-core';
import { ARTIFACT_DIR, CHROMIUM_EXE, dismissOnboarding, signIn } from './lib/e2e-session.mjs';
import { findLowContrastText } from './lib/contrast.mjs';

const EXE = CHROMIUM_EXE;
const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:8080';
const PASSPHRASE = 'vgc';

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
  'blueprint'
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
  await dismissOnboarding(page);
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
      // A table may scroll horizontally inside .table-wrap — that is intentional.
      if (node.closest('.table-wrap')) continue;
      if (rect.right > docWidth + 2) {
        const label =
          typeof node.className === 'string' && node.className
            ? `${node.tagName.toLowerCase()}.${node.className.trim().split(/\s+/).join('.')}`
            : node.tagName.toLowerCase();
        problems.push(`${label} overflows right edge by ${Math.round(rect.right - docWidth)}px`);
      }
      if (problems.length > 6) break;
    }
    return problems;
  });
}

/* ── Desktop: full functional journey ──────────────────────────────────── */

const desktop = await newSession(VIEWPORTS[0]);
try {
  const { page } = desktop;

  ok('login gate accepted the demo passphrase and dismissed', true);

  // Wrong passphrase is genuinely rejected (validation works).
  const rejectContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const rejectPage = await rejectContext.newPage();
  await rejectPage.goto(BASE, { waitUntil: 'load' });
  await dismissOnboarding(rejectPage);
  await rejectPage.waitForSelector('#auth-passphrase', { timeout: 15000 });
  await rejectPage.fill('#auth-passphrase', 'not-the-passphrase');
  await rejectPage.click('button.auth__submit', { force: true });
  const authError = await rejectPage.waitForSelector('.auth__error', { timeout: 8000 });
  ok('invalid passphrase is rejected with an inline error', Boolean(authError));
  await rejectContext.close();

  /* ── Onboarding: a first-time visitor provisions their own workspace ─── */
  const onboardContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const onboardPage = await onboardContext.newPage();
  const onboardErrors = [];
  onboardPage.on('pageerror', (error) => onboardErrors.push(String(error)));
  try {
    await onboardPage.emulateMedia({ reducedMotion: 'reduce' });
    await onboardPage.goto(BASE, { waitUntil: 'load' });

    await onboardPage.waitForSelector('.onboard', { timeout: 15000 });
    ok('a first-time visitor is shown the onboarding wizard', true);

    // Step 1 validation: the company name is mandatory.
    await onboardPage.click('.onboard-actions .btn--primary');
    const nameError = await onboardPage.$eval('.onboard-error', (node) => node.textContent.trim());
    ok('onboarding rejects a blank company name', nameError.length > 0, nameError);

    // Step 1 validation: a malformed optional email is refused.
    const companyName = `E2E Onboarding ${Date.now()}`;
    await onboardPage.fill('#ob-company-name', companyName);
    await onboardPage.fill('#ob-contact-email', 'not-an-email');
    await onboardPage.click('.onboard-actions .btn--primary');
    const emailError = await onboardPage.$eval('.onboard-error', (node) => node.textContent.trim());
    ok('onboarding rejects a malformed contact email', /valid contact email/i.test(emailError), emailError);

    await onboardPage.fill('#ob-contact-email', 'e2e@example.com');
    await onboardPage.fill('#ob-contact-name', 'E2E Tester');
    await onboardPage.selectOption('#ob-country', 'Malaysia');
    await onboardPage.click('.onboard-actions .btn--primary');

    // Step 2 validation: an industry must be chosen.
    await onboardPage.waitForSelector('#ob-business-type', { timeout: 10000 });
    await onboardPage.click('.onboard-actions .btn--primary');
    const typeError = await onboardPage.$eval('.onboard-error', (node) => node.textContent.trim());
    ok('onboarding requires a business type', typeError.length > 0, typeError);

    await onboardPage.selectOption('#ob-business-type', 'Logistics & Supply Chain');
    await onboardPage.click('.onboard-actions .btn--primary');

    // Step 3: the review step must echo back exactly what was entered.
    await onboardPage.waitForSelector('.onboard-summary', { timeout: 10000 });
    const summary = await onboardPage.$eval('.onboard-summary', (node) => node.textContent);
    ok(
      'onboarding review step echoes the entered profile',
      summary.includes(companyName) && summary.includes('Malaysia') && summary.includes('Logistics & Supply Chain'),
      summary.slice(0, 120)
    );

    // Back/forward navigation must preserve what was typed.
    await onboardPage.click('.onboard-actions .btn--ghost');
    await onboardPage.waitForSelector('#ob-business-type', { timeout: 10000 });
    const retainedType = await onboardPage.$eval('#ob-business-type', (node) => node.value);
    ok('onboarding retains answers when stepping back', retainedType === 'Logistics & Supply Chain', retainedType);
    await onboardPage.click('.onboard-actions .btn--primary');
    await onboardPage.waitForSelector('.onboard-summary', { timeout: 10000 });

    await onboardPage.click('.onboard-actions .btn--primary');
    await onboardPage.waitForSelector('.onboard', { state: 'detached', timeout: 20000 });
    ok('creating a workspace dismisses the wizard', true);

    const tenantId = await onboardPage.evaluate(() => localStorage.getItem('vgc.tenant-id'));
    ok('the created workspace id is persisted client-side', Boolean(tenantId), String(tenantId));

    await signIn(onboardPage);

    // Isolation: the new workspace opens with its own company profile…
    const seeded = await onboardPage.evaluate(async (id) => {
      const response = await fetch('/api/settings', { headers: { 'x-tenant-id': id } });
      return (await response.json()).settings?.company?.name ?? null;
    }, tenantId);
    ok('the new workspace is seeded with the customer company profile', seeded === companyName, String(seeded));

    // …and none of the shared demo workspace's documents.
    const isolated = await onboardPage.evaluate(async (id) => {
      const mine = await (await fetch('/api/documents?pageSize=1', { headers: { 'x-tenant-id': id } })).json();
      const shared = await (await fetch('/api/documents?pageSize=1')).json();
      return { mine: mine.total, shared: shared.total };
    }, tenantId);
    ok(
      'documents are isolated to the workspace that owns them',
      isolated.mine === 0 && isolated.shared >= 0,
      `own ${isolated.mine} vs shared ${isolated.shared}`
    );

    // The created workspace must be identifiable from the shell, not just implied.
    await onboardPage.click('#sign-out');
    await onboardPage.waitForSelector('.account-menu:not([hidden])', { timeout: 8000 });
    const menuWorkspace = await onboardPage.$eval('.account-menu__value', (node) => node.textContent.trim());
    ok('the account menu names the customer workspace', menuWorkspace === companyName, menuWorkspace);
    await onboardPage.keyboard.press('Escape');

    // The workspace survives a reload — the wizard must not reappear.
    await onboardPage.reload({ waitUntil: 'load' });
    await onboardPage.waitForSelector('div.view', { timeout: 20000 });
    const wizardAgain = await onboardPage.$('.onboard');
    ok('a returning visitor is not asked to onboard again', wizardAgain === null);

    ok('no uncaught page errors during onboarding', onboardErrors.length === 0, onboardErrors.slice(0, 2).join(' | '));
  } finally {
    await onboardContext.close();
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
  ok('account menu names the active workspace', accountWorkspace === 'Shared demo workspace', accountWorkspace);
  const accountActions = await page.$$eval('.account-menu__item', (nodes) => nodes.map((node) => node.textContent.trim()));
  ok(
    'account menu offers lock and switch actions',
    accountActions.some((label) => /lock/i.test(label)) && accountActions.some((label) => /switch/i.test(label)),
    accountActions.join(' | ')
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.account-menu')?.hidden === true, null, { timeout: 5000 });
  ok('account menu closes on Escape', true);

  // Declining onboarding must be remembered — otherwise every reload re-prompts.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('div.view', { timeout: 20000 });
  ok('declining onboarding is remembered across a reload', (await page.$('.onboard')) === null);

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

    // Validation: blank actor must be refused client-side.
    await page.fill('#wf-actor', '');
    await page.click('button:has-text("Apply action")');
    const actorError = await page.$eval('#wf-actor-error', (node) => node.textContent.trim());
    ok('workflow form rejects an empty actor', actorError.length > 0, actorError);

    // Validation: reassign without an assignee must be refused.
    await page.fill('#wf-actor', 'e2e.tester@vgc.com');
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
      return { step: body.currentStepId, history: body.history.length, status: body.status };
    }, targetDocument);
    ok(
      'approving a step advances the workflow and writes audit history',
      after.history > before.history && after.step !== before.step,
      `${before.step} → ${after.step}, history ${before.history} → ${after.history}`
    );

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
    const stillExists = await fetch(`${BASE}/api/documents/${encodeURIComponent(deleteTargetId)}`).then((r) => r.status);
    ok('cancelling document delete keeps the document', stillExists === 200, `status=${stillExists}`);

    await page.click('button:has-text("Delete")');
    await page.waitForSelector('dialog.confirm-dialog[open]', { timeout: 5000 });
    await page.click('dialog.confirm-dialog button:has-text("Delete document")');
    await page.waitForFunction(() => location.hash === '#/documents', null, { timeout: 10000 });
    await settle(page);
    const deletedStatus = await fetch(`${BASE}/api/documents/${encodeURIComponent(deleteTargetId)}`).then((r) => r.status);
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

for (const viewport of VIEWPORTS) {
  const session = await newSession(viewport);
  try {
    const problems = [];
    const illegible = [];
    const obstructed = [];
    const undersized = [];
    for (const route of ROUTES) {
      try {
        await goto(session.page, route);
      } catch (error) {
        const diagnostic = await session.page
          .evaluate(() => (document.getElementById('view-root')?.textContent ?? '').trim().slice(0, 160))
          .catch(() => '');
        problems.push(
          `${route}: ${error.message} | root="${diagnostic}" | console=${session.consoleErrors.slice(-2).join(' / ')} | net=${session.badResponses.slice(-2).join(' / ')}`
        );
        continue;
      }
      const issues = await layoutProblems(session.page);
      if (issues.length > 0) problems.push(`${route}: ${issues.join('; ')}`);
      for (const run of await findLowContrastText(session.page)) {
        illegible.push(`${route}: ${run.label} "${run.text.slice(0, 24)}" at ${run.ratio}:1`);
      }
      for (const covered of await fabObstructions(session.page)) {
        obstructed.push(`${route}: ${covered}`);
      }
      for (const target of await smallTargets(session.page)) {
        undersized.push(`${route}: ${target}`);
      }
      await session.page.evaluate(() => {
        const content = document.querySelector('.content');
        if (content) content.scrollTop = 0;
      });
      await session.page.waitForTimeout(250);
      await session.page.screenshot({
        path: `${ARTIFACT_DIR}/${viewport.name}-${route}.png`,
        fullPage: false
      });
    }
    ok(`${viewport.name} (${viewport.width}px) has no layout overflow`, problems.length === 0, problems.slice(0, 3).join(' | '));
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

await browser.close();

const failed = results.filter((entry) => !entry.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('\nFailures:');
  for (const entry of failed) console.log(`  - ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);
