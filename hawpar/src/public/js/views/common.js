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
 * @param {Array<{label: string, numeric?: boolean}>} columns
 * @param {Array<Array<Node|string>>} rows
 * @param {{onRowClick?: Function, emptyMessage?: string, label?: string}} [options]
 */
export function dataTable(columns, rows, { onRowClick, emptyMessage = 'Nothing to display yet.', label = 'Data table' } = {}) {
  if (rows.length === 0) return el('div.table-empty', { 'data-table': label, text: emptyMessage });

  const head = el('thead', {}, [
    el('tr', {}, columns.map((column) => el(`th${column.numeric ? '.num' : ''}`, { text: column.label })))
  ]);

  const body = el(
    'tbody',
    {},
    rows.map((cells, rowIndex) => {
      const tr = el(`tr${onRowClick ? '.is-clickable' : ''}`, {});
      cells.forEach((cell, index) => {
        const column = columns[index] ?? {};
        tr.append(el(`td${column.numeric ? '.num' : ''}${column.mono ? '.mono' : ''}`, {}, cell));
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

  const wrap = el('div.table-wrap', { 'data-table': label }, [el('table.data', {}, [head, body])]);

  // Only a container that actually overflows earns a tab stop; otherwise every
  // table would add a focus stop that does nothing. The scroll region is also
  // only named when it exists — a page carrying six non-scrolling tables would
  // otherwise expose six identically-labelled landmarks to a screen reader.
  const syncScrollAffordance = () => {
    const scrollable = wrap.scrollWidth > wrap.clientWidth + 1;
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
 * @param {{ label?: string, idPrefix?: string }} [options]
 * @returns {{ node: Node, tabBar: Node, panelHost: Node, select: (id:string) => void }}
 */
export function tabGroup(panels, { label = 'Sections', idPrefix = 'tab' } = {}) {
  if (panels.length === 0) return { node: el('div'), tabBar: el('div'), panelHost: el('div'), select: () => {} };

  const panelHost = el('div.tab-panel', {
    id: `${idPrefix}-panel`,
    role: 'tabpanel',
    tabIndex: 0,
    'aria-labelledby': `${idPrefix}-${panels[0].id}`
  }, [panels[0].render()]);

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
  };

  panels.forEach((panel, index) => {
    buttons.push(
      el(`button.tab${index === 0 ? '.is-active' : ''}`, {
        type: 'button',
        id: `${idPrefix}-${panel.id}`,
        role: 'tab',
        'aria-selected': String(index === 0),
        'aria-controls': `${idPrefix}-panel`,
        tabIndex: index === 0 ? 0 : -1,
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
