/**
 * DOM construction and formatting helpers.
 * Everything is built with textContent so untrusted OCR content can never be
 * interpreted as HTML.
 */

/**
 * Creates an element.
 * @param {string} tag        Tag name, optionally with `.class` suffixes (e.g. "div.card.card--wide").
 * @param {object} [props]    Attributes, `class`, `text`, `html` (trusted only), `on` handlers, `dataset`.
 * @param {Array|Node|string} [children]
 */
export function el(tag, props = {}, children = []) {
  const [tagName, ...classes] = String(tag).split('.');
  const node = document.createElement(tagName || 'div');
  if (classes.length > 0) node.classList.add(...classes);

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.classList.add(...String(value).split(/\s+/).filter(Boolean));
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'on') for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
    else if (key === 'dataset') for (const [dataKey, dataValue] of Object.entries(value)) node.dataset[dataKey] = dataValue;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, String(value));
  }

  appendChildren(node, children);
  return node;
}

export function appendChildren(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Creates an SVG element with the correct namespace. */
export function svgEl(tag, attributes = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ── Formatters ─────────────────────────────────────────────────────────── */

export const formatNumber = (value, decimals = 0) =>
  Number(value ?? 0).toLocaleString('en-SG', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const formatPercent = (value, decimals = 1) => `${Number(value ?? 0).toFixed(decimals)}%`;

export const formatUsd = (value) =>
  `US$${Number(value ?? 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatSgd = (value) =>
  `S$${Number(value ?? 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function formatBytes(bytes) {
  const value = Number(bytes ?? 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-SG', { hour12: false });
}

export function formatDuration(milliseconds) {
  if (!milliseconds && milliseconds !== 0) return '—';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(2)} s`;
  return `${Math.floor(milliseconds / 60000)}m ${Math.round((milliseconds % 60000) / 1000)}s`;
}

export function relativeTime(value) {
  if (!value) return '—';
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60000) return 'just now';
  if (delta < 3600000) return `${Math.floor(delta / 60000)} min ago`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} h ago`;
  return `${Math.floor(delta / 86400000)} d ago`;
}

/* ── Status helpers ─────────────────────────────────────────────────────── */

const STATUS_META = Object.freeze({
  queued: { label: 'Queued', variant: 'neutral' },
  processing: { label: 'Processing', variant: 'info' },
  completed: { label: 'Auto-approved', variant: 'success' },
  'needs-review': { label: 'Needs review', variant: 'warn' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  failed: { label: 'Failed', variant: 'danger' }
});

export function statusBadge(status) {
  const meta = STATUS_META[status] ?? { label: status ?? 'Unknown', variant: 'neutral' };
  return el(`span.badge.badge--${meta.variant}`, { text: meta.label });
}

export function confidenceChip(confidence) {
  const value = Number(confidence ?? 0);
  const tier = value >= 0.9 ? 'high' : value >= 0.75 ? 'mid' : 'low';
  return el(`span.confidence-chip.confidence-chip--${tier}`, { text: `${Math.round(value * 100)}%` });
}

export function meter(ratio, variant) {
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
  return el('div.meter', {}, [
    el(`div.meter__fill${variant ? `.meter__fill--${variant}` : ''}`, { style: { width: `${clamped * 100}%` } })
  ]);
}

/** Highlights the search term inside a snippet without using innerHTML. */
export function highlightSnippet(snippet, term) {
  const container = el('div.snippet');
  const needle = String(term ?? '').toLowerCase();
  if (!needle) {
    container.textContent = snippet;
    return container;
  }
  const haystack = String(snippet);
  let cursor = 0;
  let index = haystack.toLowerCase().indexOf(needle);
  while (index >= 0) {
    container.append(document.createTextNode(haystack.slice(cursor, index)));
    container.append(el('mark', { text: haystack.slice(index, index + needle.length) }));
    cursor = index + needle.length;
    index = haystack.toLowerCase().indexOf(needle, cursor);
  }
  container.append(document.createTextNode(haystack.slice(cursor)));
  return container;
}

export function debounce(fn, waitMs = 280) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

/** Simple accessible toast. */
export function toast(message, variant = 'info', timeoutMs = 4200) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const node = el(`div.toast${variant === 'info' ? '' : `.toast--${variant}`}`, { text: message, role: 'status' });
  stack.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 0.25s ease';
    setTimeout(() => node.remove(), 260);
  }, timeoutMs);
}
