/**
 * Application shell: session boot, hash routing, chrome updates and global wiring.
 */
import { api, ApiError } from './api.js';
import { mountCopilot } from './copilot.js';
import { icon } from './icons.js';
import { presentPasswordChange, presentSignIn } from './login.js';
import { presentOnboarding } from './onboarding.js';
import { isAdmin } from './role.js';
import { authOptions, availableWorkspaces, currentUser, currentWorkspace, initialsFor, loadSession } from './session.js';
import { forgetLegacyIdentity, setTenantId, withTenant } from './tenant.js';
import { connectEventStream, loadConfig, refreshCounters, state, subscribe } from './store.js';
import { clear, debounce, el, formatDateTime, formatNumber, relativeTime, toast } from './util.js';
import { confirmDialog, modalDialog } from './views/common.js';

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
  templates: () => import('./views/templates.js'),
  'template-editor': () => import('./views/template-editor.js'),
  'template-detail': () => import('./views/template-detail.js'),
  settings: () => import('./views/settings.js'),
  admin: () => import('./views/admin.js')
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
const adminNav = document.getElementById('nav-admin');
const brandMark = document.querySelector('.brand-mark');
const brandTitle = document.querySelector('.brand-text__title');

let activeCleanup = null;
let renderToken = 0;
let lastAppliedAppName = null;
let eventStream = null;
let signingOut = false;

/** Injects the inline SVG icon set into the static shell markup. */
function paintShellIcons() {
  for (const link of document.querySelectorAll('.nav-item[data-icon]')) {
    link.prepend(icon(link.dataset.icon, { size: 17 }));
  }
  if (exportWorkbook) exportWorkbook.prepend(icon('download', { size: 15 }));
}

/** Uses the longest placeholder that fits the search box, so it never reads "Search acros". */
function fitSearchPlaceholder() {
  if (!globalSearch || typeof ResizeObserver !== 'function') return;
  const phrasings = [globalSearch.getAttribute('placeholder'), 'Search documents…', 'Search…'];
  const measure = document.createElement('canvas').getContext('2d');
  const apply = () => {
    const style = getComputedStyle(globalSearch);
    const available = globalSearch.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (!measure || available <= 0) return;
    measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const fit = phrasings.find((text) => measure.measureText(text).width <= available) ?? phrasings.at(-1);
    if (globalSearch.placeholder !== fit) globalSearch.placeholder = fit;
  };
  new ResizeObserver(apply).observe(globalSearch);
  document.fonts?.ready.then(apply);
  apply();
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
  if (name === 'templates' && rest[0] === 'new') {
    return { route: 'template-editor', navKey: 'templates', params: {} };
  }
  if (name === 'templates' && rest[0] === 'edit' && rest[1]) {
    return { route: 'template-editor', navKey: 'templates', params: { id: decodeURIComponent(rest[1]) } };
  }
  if (name === 'templates' && rest[0]) {
    return { route: 'template-detail', navKey: 'templates', params: { id: decodeURIComponent(rest[0]) } };
  }
  if (name === 'search') {
    return { route: 'search', navKey: 'search', params: { q: rest[0] ? decodeURIComponent(rest[0]) : '' } };
  }
  if (name === 'admin') return { route: 'admin', navKey: 'admin', params: { tab: rest[0] ? decodeURIComponent(rest[0]) : '' } };
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
 * The account menu: who is signed in, the tab's workspace, switching between
 * workspaces the user belongs to, creating a workspace, password and session
 * management, and signing out.
 */
function wireAccountMenu() {
  if (!signOut) return;

  const user = currentUser();
  signOut.textContent = initialsFor(user);
  signOut.title = `Account: ${user.email}`;
  signOut.setAttribute('aria-label', `Account menu for ${user.name || user.email}`);

  const menu = el('div.account-menu', { role: 'menu', hidden: true, id: 'account-menu', 'aria-label': 'Account and workspace' });
  signOut.setAttribute('aria-haspopup', 'menu');
  signOut.setAttribute('aria-controls', 'account-menu');
  signOut.setAttribute('aria-expanded', 'false');
  signOut.after(menu);

  const close = () => {
    if (menu.hidden) return;
    menu.hidden = true;
    signOut.setAttribute('aria-expanded', 'false');
  };

  const item = (iconName, label, onClick, { id } = {}) =>
    el('button.account-menu__item', {
      type: 'button',
      role: 'menuitem',
      id,
      on: {
        click: () => {
          close();
          onClick();
        }
      }
    }, [icon(iconName, { size: 15 }), el('span', { text: label })]);

  const paint = () => {
    const workspace = currentWorkspace();
    const others = availableWorkspaces().filter((entry) => entry.id !== workspace?.id);
    clear(menu);
    const sections = [
      el('div.account-menu__header', {}, [
        el('p.account-menu__name', { text: user.name || user.email }),
        user.name ? el('p.account-menu__email', { text: user.email }) : null,
        el('p.account-menu__role', {
          text: `${workspace?.role === 'admin' ? 'Administrator' : 'Operator'}${user.platformAdmin ? ' · Platform administrator' : ''}`
        })
      ]),
      el('div.account-menu__workspace', {}, [
        el('span.account-menu__label', { text: 'Workspace' }),
        el('span.account-menu__value', { text: workspace?.name ?? '—' })
      ]),
      others.length > 0
        ? el('div.account-menu__group', { role: 'group', 'aria-label': 'Switch workspace' }, [
            el('span.account-menu__label', { text: 'Switch to' }),
            ...others.map((entry) =>
              item('building', entry.name, () => switchWorkspace(entry), { id: `switch-${entry.id}` })
            )
          ])
        : null,
      el('div.account-menu__divider', { role: 'separator' }),
      user.platformAdmin || authOptions().selfSignup
        ? item('sparkles', 'Create a workspace…', createWorkspace, { id: 'menu-create-workspace' })
        : null,
      item('key', 'Change password…', changePassword, { id: 'menu-change-password' }),
      item('history', 'Signed-in devices…', showSessions, { id: 'menu-sessions' }),
      el('div.account-menu__divider', { role: 'separator' }),
      item('logout', 'Sign out', signOutNow, { id: 'menu-sign-out' })
    ];
    // Native append() would stringify the null placeholders as "null".
    menu.append(...sections.filter(Boolean));
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

  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...menu.querySelectorAll('.account-menu__item')];
    const index = items.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
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

async function switchWorkspace(workspace) {
  try {
    await api.switchWorkspace(workspace.id);
    setTenantId(workspace.id);
    location.hash = '#/dashboard';
    location.reload();
  } catch (error) {
    toast(error.message ?? 'The workspace could not be opened.', 'error');
  }
}

async function createWorkspace() {
  const user = currentUser();
  const result = await presentOnboarding({ prefill: { name: user.name, email: user.email } });
  if (!result.created) return;
  location.hash = '#/dashboard';
  location.reload();
}

async function changePassword() {
  const changed = await presentPasswordChange({ minLength: authOptions().passwordMinLength, email: currentUser().email });
  if (changed) toast('Password changed. Your other devices have been signed out.', 'success');
}

function describeDevice(userAgent) {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Chrome\//.test(userAgent) ? 'Chrome' : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const platform = /Windows/.test(userAgent) ? 'Windows' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Android/.test(userAgent) ? 'Android' : /Mac OS X/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${platform}`;
}

async function showSessions() {
  const list = el('ul.session-list', { 'aria-live': 'polite' });
  const revokeOthers = el('button.btn.btn--ghost', { type: 'button', id: 'revoke-other-sessions' }, [icon('logout', { size: 14 }), el('span', { text: 'Sign out all other devices' })]);
  const modal = modalDialog({
    title: 'Signed-in devices',
    subtitle: 'Sessions end automatically when they expire. Sign out any device you do not recognise.',
    content: [list],
    footer: [revokeOthers]
  });

  async function paint() {
    list.replaceChildren(el('li.session-list__empty', { text: 'Loading…' }));
    try {
      const { items } = await api.listSessions();
      revokeOthers.disabled = items.every((entry) => entry.current);
      list.replaceChildren(
        ...items.map((entry) =>
          el(`li.session-list__item${entry.current ? '.is-current' : ''}`, {}, [
            el('div.session-list__text', {}, [
              el('strong', { text: describeDevice(entry.userAgent) }),
              el('span', {
                text: `${entry.workspace?.name ?? ''} · active ${relativeTime(entry.lastSeenAt)} · expires ${formatDateTime(entry.expiresAt)}${entry.ip ? ` · ${entry.ip}` : ''}`
              })
            ]),
            entry.current
              ? el('span.badge.badge--success', { text: 'This device' })
              : el('button.btn.btn--ghost.btn--sm', {
                  type: 'button',
                  on: {
                    click: async () => {
                      await api.revokeSession(entry.id).catch((error) => toast(error.message, 'error'));
                      paint();
                    }
                  }
                }, [el('span', { text: 'Sign out' })])
          ])
        )
      );
    } catch (error) {
      list.replaceChildren(el('li.session-list__empty', { text: error.message ?? 'Sessions could not be loaded.' }));
    }
  }

  revokeOthers.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Sign out other devices?', message: 'Every other browser signed in to your account will need to sign in again.', confirmLabel: 'Sign them out' });
    if (!ok) return;
    try {
      const { revoked } = await api.revokeOtherSessions();
      toast(`${revoked} other ${revoked === 1 ? 'session' : 'sessions'} signed out.`, 'success');
      paint();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  paint();
  await modal.closed;
}

async function signOutNow() {
  // Quiesce the app first: the session is about to die, so live views, the
  // event stream and a hash-triggered re-render would only collect 401s.
  signingOut = true;
  window.removeEventListener('hashchange', renderRoute);
  eventStream?.close();
  if (typeof activeCleanup === 'function') {
    try {
      activeCleanup();
    } catch {
      // The page reloads next; a failed cleanup cannot leak.
    }
    activeCleanup = null;
  }
  await api.logout().catch(() => {});
  setTenantId(null);
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  location.reload();
}

/**
 * Links and EventSource cannot send the x-tenant-id header, so API links name
 * the tab's workspace in the query string just before they are followed.
 */
function wireWorkspaceLinks() {
  const rewrite = (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href^="/api/"]') : null;
    if (anchor) anchor.setAttribute('href', withTenant(anchor.getAttribute('href')));
  };
  for (const type of ['click', 'auxclick', 'contextmenu', 'keydown']) document.addEventListener(type, rewrite, true);
}

/**
 * Resolves once a usable session exists: signs the user in (or runs first-run
 * setup / self-service signup) and enforces a pending password change.
 */
async function establishSession() {
  let view = await loadSession();
  while (!view.authenticated || view.user.mustChangePassword) {
    if (!view.authenticated) await presentSignIn({ options: view.options });
    else await presentPasswordChange({ forced: true, minLength: view.options.passwordMinLength, email: view.user.email });
    view = await loadSession();
  }
  return view;
}

/** The session ended mid-use (expired, revoked or signed out elsewhere). */
function wireSessionInterrupts() {
  let interrupted = false;
  window.addEventListener('vgc:session-expired', async () => {
    if (interrupted || signingOut) return;
    interrupted = true;
    await presentSignIn({ options: authOptions(), message: 'Your session has ended. Sign in again to continue.' });
    location.reload();
  });
  window.addEventListener('vgc:password-change-required', async () => {
    if (interrupted) return;
    interrupted = true;
    await presentPasswordChange({ forced: true, minLength: authOptions().passwordMinLength, email: currentUser()?.email });
    location.reload();
  });
}

function renderUnreachable() {
  showLoading('');
  clear(viewRoot);
  viewRoot.append(
    el('div.empty', {}, [
      el('div.empty__icon', {}, [icon('cloud', { size: 24 })]),
      el('h3', { text: 'The platform API is unreachable' }),
      el('p', { text: 'Check your connection, or start the server with "npm start", then retry.' }),
      el('button.btn.btn--primary', { type: 'button', text: 'Retry', on: { click: () => location.reload() } })
    ])
  );
}

async function main() {
  forgetLegacyIdentity();
  try {
    await establishSession();
  } catch (error) {
    console.error('Session could not be established', error);
    renderUnreachable();
    return;
  }

  if (adminNav) adminNav.hidden = !isAdmin();
  paintShellIcons();
  fitSearchPlaceholder();
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
  wireSessionInterrupts();
  wireWorkspaceLinks();
  wireGlobalSearch();
  wireAccountMenu();

  try {
    await loadConfig();
  } catch {
    renderUnreachable();
    return;
  }

  paintChrome();
  eventStream = connectEventStream();
  mountCopilot();
  refreshCounters().catch(() => {});
  setInterval(() => refreshCounters().catch(() => {}), COUNTER_REFRESH_MS);

  if (!location.hash) location.hash = '#/dashboard';
  await renderRoute();
}

main();
