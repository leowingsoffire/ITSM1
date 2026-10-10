/**
 * Shared building blocks for the view modules.
 */
import { icon, iconBadge } from '../icons.js';
import { el } from '../util.js';

export function pageHeader({ title, subtitle, actions = [], icon: iconName }) {
  return el('header.page-header', {}, [
    iconName ? el('div.page-header__icon', {}, [icon(iconName, { size: 22 })]) : null,
    el('div.page-header__text', {}, [
      el('h1', { text: title }),
      subtitle ? el('p', { text: subtitle }) : null
    ]),
    actions.length > 0 ? el('div.page-header__actions', {}, actions) : null
  ]);
}

export function card({ title, subtitle, actions = [], body, flush = false, icon: iconName, tone = 'navy', interactive = false }) {
  const header = title
    ? el('div.card__header', {}, [
        iconName ? iconBadge(iconName, tone, 16) : null,
        el('div.card__header-text', {}, [el('h2', { text: title }), subtitle ? el('p', { text: subtitle }) : null]),
        actions.length > 0 ? el('div.card__actions', {}, actions) : null
      ])
    : null;

  return el(`section.card${interactive ? '.card--interactive' : ''}`, {}, [
    header,
    el(`div.card__body${flush ? '.card__body--flush' : ''}`, {}, body)
  ]);
}

/**
 * KPI tile.
 * @param {object} input
 * @param {string} input.label
 * @param {string} input.value      Pre-formatted display value.
 * @param {string} [input.hint]
 * @param {'good'|'warn'|'bad'} [input.tone]
 * @param {string} [input.icon]     Icon name from the icon set.
 * @param {{direction: 'up'|'down'|'flat', text: string}} [input.trend]
 * @param {number} [input.countTo]  When set, the value animates up to this number.
 * @param {(n: number) => string} [input.format] Formatter used during the count-up.
 */
export function kpi({ label, value, hint, tone, icon: iconName, trend, countTo, format }) {
  const valueNode = el('span.kpi__value', { text: value });

  const toneMap = { good: 'jade', warn: 'amber', bad: 'crimson' };
  const node = el(`article.card.kpi${tone ? `.kpi--${tone}` : ''}`, {}, [
    el('div.kpi__top', {}, [
      iconName ? iconBadge(iconName, toneMap[tone] ?? 'navy', 16) : null,
      el('span.kpi__label', { text: label })
    ]),
    valueNode,
    trend
      ? el(`span.kpi__trend.kpi__trend--${trend.direction}`, {}, [
          icon(trend.direction === 'down' ? 'trendDown' : trend.direction === 'up' ? 'trendUp' : 'info', { size: 13 }),
          el('span', { text: trend.text })
        ])
      : null,
    hint ? el('span.kpi__hint', { text: hint }) : null
  ]);

  if (typeof countTo === 'number' && Number.isFinite(countTo) && typeof format === 'function') {
    countUp(valueNode, countTo, format);
  }
  return node;
}

/**
 * Animates a number from zero to its final value.
 * Skipped entirely when the user has asked for reduced motion, and always
 * settles on the exact formatted value so the display can never drift.
 */
function countUp(node, target, format, duration = 850) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    node.textContent = format(target);
    return;
  }

  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = format(target * eased);
    if (progress < 1) requestAnimationFrame(step);
    else node.textContent = format(target);
  };
  requestAnimationFrame(step);
}

export function emptyState(title, message, action, iconName = 'search') {
  return el('div.empty', {}, [
    el('div.empty__icon', {}, [icon(iconName, { size: 24 })]),
    el('h3', { text: title }),
    el('p', { text: message }),
    action
  ]);
}

export function loading(message = 'Loading…') {
  return el('div.loading-state', {}, [el('div.spinner', { 'aria-hidden': 'true' }), el('p', { text: message })]);
}

/** Skeleton block used while a panel's data is still in flight. */
export function skeletonBlock(variant = 'chart') {
  return el(`div.skeleton.skeleton--${variant}`, { 'aria-hidden': 'true' });
}

/**
 * Builds a data table.
 *
 * The wrapper scrolls horizontally on narrow viewports. A plain scroll
 * container cannot be reached by keyboard in Chromium, which would strand the
 * off-screen columns, so it is exposed as a labelled, focusable region.
 *
 * With `stack`, a table narrower than its threshold (840px for `true`, or a
 * number of pixels) shows each row as a block of label/value pairs instead
 * (see `.table-wrap.is-stacked`), so inline controls and trailing columns such
 * as status stay on screen. Explicit ARIA table roles keep the table
 * semantics that `display: block` would otherwise strip in some browsers.
 *
 * @param {Array<{label: string, numeric?: boolean}>} columns
 * @param {Array<Array<Node|string>>} rows
 * @param {{onRowClick?: Function, emptyMessage?: string, label?: string, stack?: boolean|number}} [options]
 */
export function dataTable(columns, rows, { onRowClick, emptyMessage = 'Nothing to display yet.', label = 'Data table', stack = false } = {}) {
  if (rows.length === 0) return el('div.table-empty', { 'data-table': label, text: emptyMessage });

  const stackBelow = stack === true ? 840 : Number(stack) || 0;
  const roles = (role) => (stack ? { role } : {});
  const head = el('thead', roles('rowgroup'), [
    el('tr', roles('row'), columns.map((column) => el(`th${column.numeric ? '.num' : ''}`, { ...roles('columnheader'), text: column.label })))
  ]);

  const body = el(
    'tbody',
    roles('rowgroup'),
    rows.map((cells, rowIndex) => {
      const tr = el(`tr${onRowClick ? '.is-clickable' : ''}`, roles('row'));
      cells.forEach((cell, index) => {
        const column = columns[index] ?? {};
        const attributes = stack ? { role: 'cell', 'data-label': column.label ?? '' } : {};
        tr.append(el(`td${column.numeric ? '.num' : ''}${column.mono ? '.mono' : ''}`, attributes, cell));
      });
      if (onRowClick) {
        tr.addEventListener('click', () => onRowClick(rowIndex));
        tr.tabIndex = 0;
        tr.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') onRowClick(rowIndex);
        });
      }
      return tr;
    })
  );

  const wrap = el('div.table-wrap', { 'data-table': label }, [el('table.data', roles('table'), [head, body])]);

  // Only a container that actually overflows earns a tab stop; otherwise every
  // table would add a focus stop that does nothing. The scroll region is also
  // only named when it exists — a page carrying six non-scrolling tables would
  // otherwise expose six identically-labelled landmarks to a screen reader.
  // Stacking never changes the wrapper's width, so toggling it here cannot
  // trigger another resize notification.
  const syncScrollAffordance = () => {
    const stacked = stackBelow > 0 && wrap.clientWidth < stackBelow;
    wrap.classList.toggle('is-stacked', stacked);
    const scrollable = !stacked && wrap.scrollWidth > wrap.clientWidth + 1;
    wrap.classList.toggle('is-scrollable', scrollable);
    if (scrollable) {
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', `${label} (scrollable)`);
    } else {
      wrap.removeAttribute('tabindex');
      wrap.removeAttribute('role');
      wrap.removeAttribute('aria-label');
    }
  };
  requestAnimationFrame(syncScrollAffordance);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(syncScrollAffordance).observe(wrap);
  }

  return wrap;
}

export function select({ label, value, options, onChange, id }) {
  const node = el('select', { id, on: { change: (event) => onChange(event.target.value) } },
    options.map((option) => el('option', { value: option.value, text: option.label, selected: option.value === value }))
  );
  return el('div.field', {}, [label ? el('label', { text: label, htmlFor: id }) : null, node]);
}

export function numberInput({ label, value, min, max, step = 1, onChange, id }) {
  const node = el('input', {
    id,
    type: 'number',
    value,
    min,
    max,
    step,
    on: { change: (event) => onChange(Number(event.target.value)) }
  });
  return el('div.field', {}, [el('label', { text: label, htmlFor: id }), node]);
}

/**
 * An accessible tab group.
 *
 * Follows the ARIA authoring practice for tabs: a single tab stop on the strip,
 * arrow keys to move between tabs, Home/End to jump to the ends, and
 * `aria-selected`/`aria-controls` so a screen reader announces which panel is
 * showing. Panels are produced lazily by `render` so a heavy tab costs nothing
 * until it is opened.
 *
 * @param {{id:string,label:string,render:() => Node}[]} panels
 * @param {{ label?: string, idPrefix?: string, initial?: string, onSelect?: (id: string) => void }} [options]
 * @returns {{ node: Node, tabBar: Node, panelHost: Node, select: (id:string) => void }}
 */
export function tabGroup(panels, { label = 'Sections', idPrefix = 'tab', initial, onSelect } = {}) {
  if (panels.length === 0) return { node: el('div'), tabBar: el('div'), panelHost: el('div'), select: () => {} };

  const initialIndex = Math.max(0, panels.findIndex((panel) => panel.id === initial));
  const panelHost = el('div.tab-panel', {
    id: `${idPrefix}-panel`,
    role: 'tabpanel',
    tabIndex: 0,
    'aria-labelledby': `${idPrefix}-${panels[initialIndex].id}`
  }, [panels[initialIndex].render()]);

  const buttons = [];
  const activate = (index, { focus = false } = {}) => {
    const panel = panels[index];
    buttons.forEach((button, position) => {
      const isActive = position === index;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });
    panelHost.setAttribute('aria-labelledby', `${idPrefix}-${panel.id}`);
    panelHost.replaceChildren(panel.render());
    if (focus) buttons[index].focus();
    revealTab(buttons[index]);
    onSelect?.(panel.id);
  };

  panels.forEach((panel, index) => {
    buttons.push(
      el(`button.tab${index === initialIndex ? '.is-active' : ''}`, {
        type: 'button',
        id: `${idPrefix}-${panel.id}`,
        role: 'tab',
        'aria-selected': String(index === initialIndex),
        'aria-controls': `${idPrefix}-panel`,
        tabIndex: index === initialIndex ? 0 : -1,
        text: panel.label,
        on: {
          click: () => activate(index),
          keydown: (event) => {
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            if (step !== 0) {
              event.preventDefault();
              activate((index + step + panels.length) % panels.length, { focus: true });
            } else if (event.key === 'Home') {
              event.preventDefault();
              activate(0, { focus: true });
            } else if (event.key === 'End') {
              event.preventDefault();
              activate(panels.length - 1, { focus: true });
            }
          }
        }
      })
    );
  });

  const tabBar = el('div.tabs', { role: 'tablist', 'aria-label': label }, buttons);

  // On a narrow screen the strip scrolls sideways. Fade whichever edge hides
  // more tabs so the overflow is discoverable, and keep the selected tab in
  // view rather than leaving it scrolled off behind the fade.
  const EDGE_MARGIN = 28;
  function syncEdges() {
    const max = tabBar.scrollWidth - tabBar.clientWidth;
    tabBar.classList.toggle('has-more-start', max > 1 && tabBar.scrollLeft > 1);
    tabBar.classList.toggle('has-more-end', max > 1 && tabBar.scrollLeft < max - 1);
  }
  function revealTab(button) {
    if (!button?.isConnected) return;
    const bar = tabBar.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    if (rect.left < bar.left + EDGE_MARGIN) tabBar.scrollLeft -= bar.left + EDGE_MARGIN - rect.left;
    else if (rect.right > bar.right - EDGE_MARGIN) tabBar.scrollLeft += rect.right - (bar.right - EDGE_MARGIN);
    syncEdges();
  }
  tabBar.addEventListener('scroll', syncEdges, { passive: true });
  if (typeof ResizeObserver === 'function') {
    // Toggling the fade classes never changes the strip's size, so this
    // cannot feed back into another resize notification.
    new ResizeObserver(() => {
      syncEdges();
      revealTab(buttons.find((button) => button.classList.contains('is-active')));
    }).observe(tabBar);
  }

  return {
    node: el('div', {}, [tabBar, panelHost]),
    tabBar,
    panelHost,
    select: (id) => {
      const index = panels.findIndex((panel) => panel.id === id);
      if (index >= 0) activate(index);
    }
  };
}

export function stageStrip(stages = []) {
  return el(
    'div.stages',
    {},
    stages.map((stage) =>
      el(`span.stage${stage.status === 'pending' ? '' : `.stage--${stage.status}`}`, { title: stage.detail ?? stage.status }, [
        stage.status === 'completed' ? icon('check', { size: 11 }) : null,
        stage.status === 'failed' ? icon('close', { size: 11 }) : null,
        el('span', { text: stage.name })
      ])
    )
  );
}

/**
 * An accessible confirmation dialog for destructive actions (delete, discard,
 * etc.). Built on the native `<dialog>` element so focus trapping, Escape-to-
 * close and backdrop semantics are provided by the browser rather than
 * hand-rolled — the one thing this app did not yet have anywhere, even though
 * several destructive API calls (e.g. deleting a template) had no UI trigger
 * because there was nothing safe to gate them behind.
 *
 * @param {object} input
 * @param {string} input.title
 * @param {string} input.message
 * @param {string} [input.confirmLabel]
 * @param {string} [input.cancelLabel]
 * @param {'default'|'danger'} [input.tone]
 * @returns {Promise<boolean>} resolves true if confirmed, false if cancelled/dismissed.
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'danger' } = {}) {
  return new Promise((resolve) => {
    const dialog = el('dialog.confirm-dialog', { 'aria-label': title }, [
      el('form', { method: 'dialog' }, [
        el('h2', { text: title }),
        el('p', { text: message }),
        el('div.confirm-dialog__actions', {}, [
          el('button.btn.btn--ghost', { type: 'button', text: cancelLabel, autofocus: tone !== 'danger' }),
          el(`button.btn.${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`, {
            type: 'button',
            text: confirmLabel,
            autofocus: tone === 'danger' ? false : undefined
          })
        ])
      ])
    ]);

    const [cancelButton, confirmButton] = dialog.querySelectorAll('button');
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
      dialog.close();
      dialog.remove();
    };

    cancelButton.addEventListener('click', () => finish(false));
    confirmButton.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', () => finish(false)); // Escape key
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false); // backdrop click
    });

    document.body.append(dialog);
    dialog.showModal();
    cancelButton.focus();
  });
}

/**
 * A general-purpose modal on the native `<dialog>` element (focus trapping,
 * Escape and backdrop semantics come from the browser).
 *
 * @param {object} input
 * @param {string} input.title
 * @param {string} [input.subtitle]
 * @param {Array<Node>} input.content
 * @param {Array<Node>} [input.footer]
 * @param {boolean} [input.wide]
 * @param {boolean} [input.dismissible=true] Escape and backdrop close the dialog.
 * @returns {{ dialog: HTMLDialogElement, close: () => void, closed: Promise<void> }}
 */
export function modalDialog({ title, subtitle, content, footer = [], wide = false, dismissible = true }) {
  const titleId = `dialog-title-${Math.random().toString(36).slice(2, 9)}`;
  const dialog = el(`dialog.modal${wide ? '.modal--wide' : ''}`, { 'aria-labelledby': titleId }, [
    el('div.modal__header', {}, [
      el('div', {}, [el('h2', { id: titleId, text: title }), subtitle ? el('p', { text: subtitle }) : null]),
      dismissible
        ? el('button.modal__close', { type: 'button', 'aria-label': 'Close dialog', on: { click: () => close() } }, [icon('close', { size: 16 })])
        : null
    ]),
    el('div.modal__body', {}, content),
    footer.length > 0 ? el('div.modal__footer', {}, footer) : null
  ]);

  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  let done = false;
  function close() {
    if (done) return;
    done = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    resolveClosed();
  }

  dialog.addEventListener('cancel', (event) => {
    if (!dismissible) event.preventDefault();
    else close();
  });
  // Browsers may force-close even a non-dismissible dialog (Chrome's close
  // watcher honours a repeated Escape); always clean up and settle.
  dialog.addEventListener('close', () => close());
  dialog.addEventListener('click', (event) => {
    if (dismissible && event.target === dialog) close();
  });

  document.body.append(dialog);
  dialog.showModal();
  requestAnimationFrame(() => {
    const focusTarget = dialog.querySelector('[autofocus], input:not([type=hidden]):not([readonly]), select, textarea, .modal__footer .btn--primary');
    focusTarget?.focus();
  });
  return { dialog, close, closed };
}

async function copyText(text, input) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (e.g. insecure context): select for Ctrl+C.
    input?.select();
    return false;
  }
}

/**
 * Shows a credential exactly once (API key, webhook signing secret, temporary
 * password) with a copy button. It cannot be dismissed by accident: the user
 * must confirm they have stored it.
 *
 * @param {object} input
 * @param {string} input.title
 * @param {string} input.message
 * @param {string} input.secret
 * @param {string} input.label
 * @param {Array<Node>} [input.extra]
 * @returns {Promise<void>}
 */
export function revealSecretDialog({ title, message, secret, label, extra = [] }) {
  const inputId = `secret-${Math.random().toString(36).slice(2, 9)}`;
  const input = el('input.secret-reveal__value', { id: inputId, type: 'text', readOnly: true, value: secret, autocomplete: 'off' });
  const status = el('p.secret-reveal__status', { role: 'status' });
  const copyButton = el('button.btn.btn--ghost', { type: 'button', on: {
    click: async () => {
      const copied = await copyText(secret, input);
      status.textContent = copied ? 'Copied to the clipboard.' : 'Selected — press Ctrl+C (or ⌘C) to copy.';
    }
  } }, [icon('documents', { size: 14 }), el('span', { text: 'Copy' })]);
  const done = el('button.btn.btn--primary', { type: 'button', text: 'I have stored it safely' });
  const modal = modalDialog({
    title,
    dismissible: false,
    content: [
      el('p.modal__lead', { text: message }),
      el('div.secret-reveal', {}, [
        el('label', { for: inputId, text: label }),
        el('div.secret-reveal__row', {}, [input, copyButton]),
        status
      ]),
      el('p.secret-reveal__warning', {}, [icon('alert', { size: 14 }), el('span', { text: 'It will not be shown again.' })]),
      ...extra
    ],
    footer: [done]
  });
  done.addEventListener('click', () => modal.close());
  requestAnimationFrame(() => input.select());
  return modal.closed;
}

