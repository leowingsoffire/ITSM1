/**
 * Application shell: hash routing, chrome updates and global wiring.
 */
import { mountAmbient, mountParallax } from './ambient.js';
import { ApiError } from './api.js';
import { mountCopilot } from './copilot.js';
import { mountCursor } from './cursor.js';
import { icon } from './icons.js';
import { clearSession, presentLogin } from './login.js';
import { mountMotion } from './motion.js';
import { presentOnboarding } from './onboarding.js';
import { getRole, Role } from './role.js';
import { clearTenant, hasWorkspaceChoice, workspaceLabel } from './tenant.js';
import { connectEventStream, loadConfig, refreshCounters, state, subscribe } from './store.js';
import { clear, debounce, el, formatNumber, toast } from './util.js';

const ROUTES = Object.freeze({
  dashboard: () => import('./views/dashboard.js'),
  ingest: () => import('./views/ingest.js'),
  documents: () => import('./views/documents.js'),
  'document-detail': () => import('./views/document-detail.js'),
  claims: () => import('./views/marketing-claims.js'),
  'claim-detail': () => import('./views/claim-detail.js'),
  review: () => import('./views/review.js'),
  workflows: () => import('./views/workflows.js'),
  'workflow-detail': () => import('./views/workflow-detail.js'),
  agents: () => import('./views/agents.js'),
  accuracy: () => import('./views/accuracy.js'),
  azure: () => import('./views/azure.js'),
  search: () => import('./views/search.js'),
  cost: () => import('./views/cost.js'),
  blueprint: () => import('./views/blueprint.js'),
  settings: () => import('./views/settings.js')
});

const DEFAULT_ROUTE = 'dashboard';
const COUNTER_REFRESH_MS = 15000;

const viewRoot = document.getElementById('view-root');
const engineBadge = document.getElementById('engine-badge');
const queueBadge = document.getElementById('queue-badge');
const documentCount = document.getElementById('nav-count-documents');
const reviewCount = document.getElementById('nav-count-review');
const claimsCount = document.getElementById('nav-count-claims');
const workflowCount = document.getElementById('nav-count-workflows');
const sidebarNote = document.getElementById('sidebar-engine-note');
const globalSearch = document.getElementById('global-search');
const exportWorkbook = document.getElementById('export-workbook');
const signOut = document.getElementById('sign-out');
const brandMark = document.querySelector('.brand-mark');
const brandTitle = document.querySelector('.brand-text__title');

let activeCleanup = null;
let renderToken = 0;
let lastAppliedAppName = null;

/** Injects the inline SVG icon set into the static shell markup. */
function paintShellIcons() {
  for (const link of document.querySelectorAll('.nav-item[data-icon]')) {
    link.prepend(icon(link.dataset.icon, { size: 17 }));
  }
  if (exportWorkbook) exportWorkbook.prepend(icon('download', { size: 15 }));
}

/** Parses `#/documents/abc` into a route name, nav key and params. */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '').trim();
  const [head, ...rest] = raw.split('/');
  const name = head || DEFAULT_ROUTE;

  if (name === 'documents' && rest[0]) {
    return { route: 'document-detail', navKey: 'documents', params: { id: decodeURIComponent(rest[0]) } };
  }
  if (name === 'claims' && rest[0]) {
    return { route: 'claim-detail', navKey: 'claims', params: { id: decodeURIComponent(rest[0]) } };
  }
  if (name === 'workflows' && rest[0]) {
    return { route: 'workflow-detail', navKey: 'workflows', params: { id: decodeURIComponent(rest[0]) } };
  }
  if (name === 'search') {
    return { route: 'search', navKey: 'search', params: { q: rest[0] ? decodeURIComponent(rest[0]) : '' } };
  }
  if (name === 'review') return { route: 'review', navKey: 'review', params: {} };
  if (!ROUTES[name]) return { route: DEFAULT_ROUTE, navKey: DEFAULT_ROUTE, params: {} };
  return { route: name, navKey: name, params: {} };
}

function setActiveNav(navKey) {
  for (const link of document.querySelectorAll('.nav-item')) {
    link.classList.toggle('is-active', link.dataset.view === navKey);
  }
}

function showLoading(message) {
  clear(viewRoot);
  viewRoot.append(el('div.loading-state', {}, [el('div.spinner', { 'aria-hidden': 'true' }), el('p', { text: message })]));
}

/**
 * Skeleton placeholder shown while a view module loads. Mirrors the shape of a
 * typical page (header, KPI strip, two panels) so the layout does not jump when
 * the real content arrives.
 */
function showSkeleton() {
  clear(viewRoot);
  viewRoot.append(
    el('div.view', {}, [
      el('div.skeleton.skeleton--title', { 'aria-hidden': 'true' }),
      el('div.skeleton.skeleton--text', { style: { width: '32%' }, 'aria-hidden': 'true' }),
      el('div.skeleton-grid', { style: { margin: '20px 0' }, 'aria-hidden': 'true' }, [
        el('div.skeleton.skeleton--kpi'),
        el('div.skeleton.skeleton--kpi'),
        el('div.skeleton.skeleton--kpi'),
        el('div.skeleton.skeleton--kpi')
      ]),
      el('div.grid.grid--2', { 'aria-hidden': 'true' }, [
        el('div.skeleton.skeleton--chart'),
        el('div.skeleton.skeleton--chart')
      ]),
      el('p.visually-hidden', { role: 'status', text: 'Loading workspace' })
    ])
  );
}

async function renderRoute() {
  const token = ++renderToken;
  const { route, navKey, params } = parseHash();
  setActiveNav(navKey);

  if (typeof activeCleanup === 'function') {
    try {
      activeCleanup();
    } catch (error) {
      console.error('View cleanup failed', error);
    }
    activeCleanup = null;
  }

  showSkeleton();

  try {
    const module = await ROUTES[route]();
    const result = await module.render(params);
    if (token !== renderToken) return;
    activeCleanup = result?.cleanup ?? null;
    clear(viewRoot);
    viewRoot.append(result.node);
    viewRoot.scrollTop = 0;
  } catch (error) {
    if (token !== renderToken) return;
    console.error('View failed to render', error);
    clear(viewRoot);
    viewRoot.append(
      el('div.empty', {}, [
        el('div.empty__icon', {}, [icon('alert', { size: 24 })]),
        el('h3', { text: 'This view could not be loaded' }),
        el('p', { text: error instanceof ApiError ? error.message : String(error?.message ?? error) }),
        el('button.btn.btn--primary', { type: 'button', text: 'Retry', on: { click: () => renderRoute() } })
      ])
    );
  }
}

function paintChrome() {
  paintBranding();
  const analyzer = state.config?.analyzer;
  if (analyzer) {
    const isAzure = analyzer.mode === 'azure';
    engineBadge.textContent = isAzure ? `Azure DI · ${analyzer.modelId}` : 'Offline demo engine';
    engineBadge.classList.toggle('pill--live', isAzure);
    sidebarNote.textContent = isAzure
      ? `Analysing with Azure AI Document Intelligence ${analyzer.apiVersion} using ${analyzer.authentication}.`
      : 'Demo engine active — full functionality with zero Azure spend. Set ANALYZER_MODE=azure to use the live service.';
  }

  const queueDepth = state.pipeline?.queueDepth ?? 0;
  const activeWorkers = state.pipeline?.activeWorkers ?? 0;
  queueBadge.textContent = `Queue ${queueDepth}${activeWorkers > 0 ? ` · ${activeWorkers} active` : ''}`;
  queueBadge.classList.toggle('is-busy', queueDepth > 0 || activeWorkers > 0);

  setCounter(documentCount, state.documentCount);
  setCounter(reviewCount, state.reviewCount);
  if (claimsCount) setCounter(claimsCount, state.claimsReview);
  if (workflowCount) setCounter(workflowCount, state.workflowActive);
}

/**
 * Applies the (possibly admin-customised) app name and logo from Settings to
 * the topbar brand mark and the browser tab title. Falls back to the static
 * shell markup already in index.html when no custom branding is set.
 */
function paintBranding() {
  const application = state.config?.application;
  if (!application) return;

  const appName = application.name || 'VGC OCR Intelligence';
  if (appName !== lastAppliedAppName) {
    lastAppliedAppName = appName;
    if (brandTitle) brandTitle.textContent = appName;
    document.title = appName;
  }

  if (brandMark) {
    if (application.logoDataUrl) {
      let logoImg = brandMark.querySelector('img.brand-mark__logo');
      if (!logoImg) {
        clear(brandMark);
        logoImg = el('img.brand-mark__logo', { alt: `${appName} logo` });
        brandMark.append(logoImg);
      }
      if (logoImg.src !== application.logoDataUrl) logoImg.src = application.logoDataUrl;
    } else if (brandMark.querySelector('img.brand-mark__logo')) {
      // Custom logo was removed — restore the original inline SVG mark.
      location.reload();
    }
  }
}

/** Updates a nav pill and pops it briefly when the number actually changes. */
function setCounter(node, value) {
  const next = value > 0 ? formatNumber(value) : '';
  if (node.textContent === next) return;
  node.textContent = next;
  if (!next) return;
  node.classList.remove('pop');
  void node.offsetWidth; // restart the animation
  node.classList.add('pop');
}

function wireGlobalSearch() {
  const run = debounce(() => {
    const term = globalSearch.value.trim();
    if (term.length < 2) return;
    location.hash = `#/search/${encodeURIComponent(term)}`;
  }, 500);

  globalSearch.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const term = globalSearch.value.trim();
    if (term.length < 2) return toast('Enter at least two characters to search.', 'warn');
    location.hash = `#/search/${encodeURIComponent(term)}`;
  });
  globalSearch.addEventListener('input', run);
}

/**
 * The account menu: shows who is signed in and which workspace is active, and
 * offers the two ways out — locking the workspace (back to the passphrase
 * gate) and switching to a different workspace (back to the onboarding
 * wizard). Without this the workspace a customer created during onboarding is
 * invisible and impossible to leave.
 */
function wireAccountMenu() {
  if (!signOut) return;

  const menu = el('div.account-menu', { role: 'menu', hidden: true, 'aria-label': 'Account and workspace' });
  signOut.setAttribute('aria-haspopup', 'menu');
  signOut.setAttribute('aria-expanded', 'false');
  signOut.after(menu);

  const close = () => {
    if (menu.hidden) return;
    menu.hidden = true;
    signOut.setAttribute('aria-expanded', 'false');
  };

  const paint = () => {
    clear(menu);
    menu.append(
      el('div.account-menu__header', {}, [
        el('p.account-menu__name', { text: 'demo.user@vgc.com' }),
        el('p.account-menu__role', { text: getRole() === Role.ADMIN ? 'Administrator' : 'Standard user' })
      ]),
      el('div.account-menu__workspace', {}, [
        el('span.account-menu__label', { text: 'Workspace' }),
        el('span.account-menu__value', { text: workspaceLabel() })
      ]),
      el('button.account-menu__item', {
        type: 'button',
        role: 'menuitem',
        on: {
          click: () => {
            close();
            clearSession();
            location.reload();
          }
        }
      }, [icon('lock', { size: 15 }), el('span', { text: 'Lock workspace' })]),
      el('button.account-menu__item', {
        type: 'button',
        role: 'menuitem',
        on: {
          click: () => {
            close();
            clearTenant();
            clearSession();
            location.reload();
          }
        }
      }, [icon('sparkles', { size: 15 }), el('span', { text: 'Switch workspace…' })])
    );
  };

  signOut.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) {
      paint();
      menu.hidden = false;
      signOut.setAttribute('aria-expanded', 'true');
      menu.querySelector('.account-menu__item')?.focus();
    } else {
      close();
    }
  });

  document.addEventListener('click', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== signOut) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      close();
      signOut.focus();
    }
  });
}

async function main() {
  // The atmosphere is mounted first so the welcome gate rises out of it.
  mountAmbient();
  mountCursor();
  // First-time visitors with no workspace yet see the onboarding wizard
  // before the passphrase gate. Once they have either created a workspace or
  // explicitly declined one, the choice is remembered so they are never asked
  // again on subsequent loads.
  if (!hasWorkspaceChoice()) {
    await presentOnboarding();
  }
  await presentLogin();

  paintShellIcons();
  subscribe(paintChrome);
  window.addEventListener('hashchange', renderRoute);
  window.addEventListener('vgc:refresh-view', renderRoute);
  // Settings saves push their result straight into state.config so the
  // topbar app name/logo update immediately, without a full page reload.
  window.addEventListener('vgc:settings-updated', (event) => {
    if (!state.config) return;
    const settings = event.detail ?? {};
    state.config.application = {
      ...state.config.application,
      name: settings.branding?.appName ?? state.config.application.name,
      customer: settings.company?.name ?? state.config.application.customer,
      logoDataUrl: settings.branding?.logoDataUrl ?? null
    };
    paintChrome();
  });
  wireGlobalSearch();
  wireAccountMenu();
  mountParallax(viewRoot);
  // Mounted after the shell icons exist so the nav morph can measure them.
  mountMotion();

  try {
    await loadConfig();
  } catch (error) {
    showLoading('');
    clear(viewRoot);
    viewRoot.append(
      el('div.empty', {}, [
        el('div.empty__icon', {}, [icon('cloud', { size: 24 })]),
        el('h3', { text: 'The platform API is unreachable' }),
        el('p', { text: 'Start the server with "npm start" and refresh this page.' })
      ])
    );
    return;
  }

  paintChrome();
  connectEventStream();
  mountCopilot();
  refreshCounters().catch(() => {});
  setInterval(() => refreshCounters().catch(() => {}), COUNTER_REFRESH_MS);

  if (!location.hash) location.hash = '#/dashboard';
  await renderRoute();
}

main();
