/**
 * Icon system.
 *
 * A single stroke-based set drawn on a 24x24 grid, rendered as inline SVG so it
 * works under the strict CSP (no external requests, no icon font, no `img`
 * fetches) and inherits `currentColor` from whatever it sits inside.
 *
 * Paths are stored as plain path-data strings and injected with
 * `setAttribute('d', ...)` — never as innerHTML — so nothing here can become an
 * HTML injection vector.
 */

import { svgEl } from './util.js';

/** @type {Record<string, string[]>} icon name → array of path `d` strings. */
const PATHS = Object.freeze({
  /* Navigation */
  dashboard: ['M3 3h7v7H3z', 'M14 3h7v4h-7z', 'M14 11h7v10h-7z', 'M3 14h7v7H3z'],
  upload: ['M12 16V4', 'M7.5 8.5 12 4l4.5 4.5', 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'],
  library: ['M5 4h9l4 4v12H5z', 'M14 4v4h4', 'M8.5 12.5h6', 'M8.5 16h4'],
  review: ['M20 11.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6', 'M8 9h8', 'M8 13h4', 'm14.5 17.5 2 2 4-4'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm16.2 16.2 4.3 4.3'],
  cost: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v10', 'M14.6 9.4A2.8 2.8 0 0 0 12 8c-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2.1c1.6.4 2.6 1 2.6 2.1S13.5 16 12 16a2.8 2.8 0 0 1-2.6-1.4'],
  blueprint: ['M3 4h18v16H3z', 'M3 9h18', 'M9 9v11', 'M15 9v11'],

  /* Metrics and status */
  documents: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 12h6', 'M9 16h6'],
  pages: ['M8 2h7l4 4v12H8z', 'M15 2v4h4', 'M5 6v14a2 2 0 0 0 2 2h9'],
  bolt: ['m13 2-8 12h6l-1 8 8-12h-6z'],
  gauge: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'm14.1 9.9 4.2-4.2', 'M4 20a10 10 0 1 1 16 0'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5V12l3 2'],
  target: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z', 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'],
  shield: ['M12 3l7.5 3v5.5c0 4.4-3 8.2-7.5 9.5C7.5 19.7 4.5 15.9 4.5 11.5V6z', 'm9 12 2 2 4-4'],
  sparkles: ['m12 3 1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z', 'M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z'],
  trendUp: ['m3 17 6-6 4 4 8-8', 'M15 7h6v6'],
  trendDown: ['m3 7 6 6 4-4 8 8', 'M15 17h6v-6'],
  wallet: ['M4 7a2 2 0 0 1 2-2h11v4', 'M4 7v10a2 2 0 0 0 2 2h13V9H6a2 2 0 0 1-2-2z', 'M16.5 13.5h.01'],
  scale: ['M12 4v16', 'M7 8h10', 'M7 8 4 15h6z', 'M17 8l-3 7h6z', 'M8.5 20h7'],
  sigma: ['M18 5H6l6 7-6 7h12', 'M18 5v2.5', 'M18 19v-2.5'],

  /* Actions */
  play: ['m8 5 11 7-11 7z'],
  download: ['M12 4v11', 'm7.5 10.5 4.5 4.5 4.5-4.5', 'M5 20h14'],
  refresh: ['M20 12a8 8 0 1 1-2.7-6', 'M20 4v5h-5'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  checkCircle: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'm8 12.2 2.7 2.7L16 9.6'],
  close: ['m6 6 12 12', 'm18 6-12 12'],
  alert: ['M12 4.5 2.8 20h18.4z', 'M12 10v4', 'M12 17h.01'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5', 'M12 8h.01'],
  filter: ['M3 5h18', 'M6.5 12h11', 'M10 19h4'],
  chevronLeft: ['m14.5 6-6 6 6 6'],
  chevronRight: ['m9.5 6 6 6-6 6'],
  external: ['M14 4h6v6', 'm20 4-8.5 8.5', 'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'm14 6 4 4'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],

  /* Domain */
  cloud: ['M7 18a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.5 11 3.5 3.5 0 0 1 17 18z'],
  database: ['M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  cpu: ['M7 7h10v10H7z', 'M4.5 10H7', 'M4.5 14H7', 'M17 10h2.5', 'M17 14h2.5', 'M10 4.5V7', 'M14 4.5V7', 'M10 17v2.5', 'M14 17v2.5'],
  layers: ['m12 3 9 5-9 5-9-5z', 'm3 13 9 5 9-5', 'm3 17 9 4 9-4'],
  table: ['M4 5h16v14H4z', 'M4 10h16', 'M9.5 10v9'],
  tag: ['M4 4h7l9 9-7 7-9-9z', 'M8 8h.01'],
  users: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 4.6a3.5 3.5 0 0 1 0 6.8', 'M17.5 14.2A6.5 6.5 0 0 1 21.5 20'],
  building: ['M4 21V6l7-3 7 3v15', 'M8 10h.01', 'M12 10h.01', 'M8 14h.01', 'M12 14h.01', 'M10 21v-4h4v4'],
  route: ['M6 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M18 15a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M6 9v3a4 4 0 0 0 4 4h4'],

  /* Access & assistant */
  lock: ['M6.5 10.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z', 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5', 'M12 14v2'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20.5a7.5 7.5 0 0 1 15 0'],
  logout: ['M15 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3', 'M10.5 8 14.5 12l-4 4', 'M14.5 12H4'],
  chat: ['M20 13.5A4.5 4.5 0 0 1 15.5 18H9l-4.5 3v-3.6A4.5 4.5 0 0 1 4 13.5v-4A4.5 4.5 0 0 1 8.5 5h7A4.5 4.5 0 0 1 20 9.5z', 'M9 11h6', 'M9 14h3.5'],
  mic: ['M12 3.5a2.75 2.75 0 0 1 2.75 2.75v5.5a2.75 2.75 0 0 1-5.5 0v-5.5A2.75 2.75 0 0 1 12 3.5z', 'M6.5 11.5a5.5 5.5 0 0 0 11 0', 'M12 17v3.5', 'M9.5 20.5h5'],
  send: ['m4 12 16-8-6 16-2.5-6.5z', 'M11.5 13.5 20 4'],
  tasks: ['M4 6.5 5.8 8.3 9 5', 'M4 13.5 5.8 15.3 9 12', 'M4 20l1.8-1.8', 'M12 6.5h8', 'M12 13.5h8', 'M12 20h8'],
  chart: ['M4 20V4', 'M4 20h16', 'M8 17v-5', 'M12.5 17V8', 'M17 17v-7'],
  brain: ['M9.5 4.5A2.5 2.5 0 0 0 7 7a2.5 2.5 0 0 0-1.5 4.5A2.5 2.5 0 0 0 7 16a2.5 2.5 0 0 0 2.5 2.5V4.5z', 'M14.5 4.5A2.5 2.5 0 0 1 17 7a2.5 2.5 0 0 1 1.5 4.5A2.5 2.5 0 0 1 17 16a2.5 2.5 0 0 1-2.5 2.5V4.5z', 'M12 4.5v14'],

  /* Orchestration, workflow and integration */
  workflow: ['M4 5.5h5v4H4z', 'M15 5.5h5v4h-5z', 'M9.5 14.5h5v4h-5z', 'M6.5 9.5v2a1.5 1.5 0 0 0 1.5 1.5h1', 'M17.5 9.5v2a1.5 1.5 0 0 1-1.5 1.5h-1'],
  agents: [
    'M12 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    'M5 15.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    'M19 15.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    'M10.6 7.4 6.4 14.1',
    'M13.4 7.4l4.2 6.7',
    'M7 17.5h10'
  ],
  azure: ['M9.6 4h4.6l4.9 14.3-8.1 1.7-5.6-3.6 4.6-.4 2.6-6.4-3-5.6z'],
  handshake: ['M6 12.5 9.5 9l2.5 2 2.5-2 3.5 3.5', 'M4 8.5h3l2 2', 'M20 8.5h-3l-2 2', 'M8.5 15.5l2.2 2.2a1.5 1.5 0 0 0 2.1 0l2.7-2.7'],
  history: ['M12 7v5l3 2', 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1', 'M3.5 4.5v4h4'],
  network: ['M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M12 8v4', 'M6 12h12', 'M6 12v3', 'M18 12v3', 'M12 12v3', 'M4.5 15h3v4h-3z', 'M10.5 15h3v4h-3z', 'M16.5 15h3v4h-3z'],

  /* Settings */
  settings: ['M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M4 12h1.6', 'M18.4 12H20', 'M12 4v1.6', 'M12 18.4V20', 'm6.3 6.3 1.1 1.1', 'm16.6 16.6 1.1 1.1', 'm17.7 6.3-1.1 1.1', 'm7.4 16.6-1.1 1.1'],
  mail: ['M4 6h16v12H4z', 'm4 7 8 6 8-6'],
  image: ['M4 5h16v14H4z', 'M8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'm5 17 5.5-5.5 3 3L18 10l1 1'],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.6 4 6 4 9s-1.5 6.4-4 9c-2.5-2.6-4-6-4-9s1.5-6.4 4-9z'],
  crop: ['M6 2v14a2 2 0 0 0 2 2h14', 'M18 22V8a2 2 0 0 0-2-2H2', 'M18 18h4'],
  key: ['M14.5 3.5a5 5 0 1 0 2 9.7L18 15l1.5-1.5L18 12l1.5-1.5L18 9l-1-1', 'M9.5 14.5 3 21', 'M6 18l1.5 1.5']
});

const DEFAULT_SIZE = 18;

/** Icon names available to callers — useful for guarding dynamic lookups. */
export const ICON_NAMES = Object.freeze(Object.keys(PATHS));

/**
 * Renders an icon as an inline SVG node.
 * @param {string} name          Key from PATHS.
 * @param {object} [options]
 * @param {number} [options.size]      Width/height in px. Default 18.
 * @param {string} [options.className] Extra classes, space separated.
 * @param {string} [options.title]     Accessible label. Omit for decorative icons.
 * @param {number} [options.strokeWidth]
 * @returns {SVGSVGElement}
 */
export function icon(name, { size = DEFAULT_SIZE, className = '', title = '', strokeWidth = 1.7 } = {}) {
  const paths = PATHS[name] ?? PATHS.info;

  const svg = svgEl('svg', {
    class: `icon${className ? ` ${className}` : ''}`,
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    focusable: 'false',
    role: title ? 'img' : 'presentation',
    'aria-hidden': title ? null : 'true'
  });

  if (title) svg.append(svgEl('title', {}, title));
  for (const d of paths) svg.append(svgEl('path', { d }));
  return svg;
}

/**
 * A circular tinted icon badge, used on KPI tiles and card headers.
 * @param {string} name
 * @param {'navy'|'amber'|'jade'|'crimson'|'violet'|'teal'} [tone]
 * @param {number} [size] Icon size in px; the badge scales around it.
 */
export function iconBadge(name, tone = 'navy', size = 18) {
  const span = document.createElement('span');
  span.className = `icon-badge icon-badge--${tone}`;
  span.append(icon(name, { size }));
  return span;
}
