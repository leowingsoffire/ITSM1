/**
 * Lightweight SVG charts — no charting library, no extra bytes to ship.
 * Rendered in the enterprise design-token palette (see css/app.css).
 */
import { el, svgEl } from './util.js';

/** Enterprise series colours: accent blue first, then distinguishable neutrals-with-hue. */
const PALETTE = Object.freeze(['#1d5bc4', '#0d7f91', '#6b56cd', '#05865c', '#b45f0d', '#5f6c7e', '#c03136', '#7a8798']);

/**
 * Vertical bar chart.
 * @param {Array<{label: string, value: number}>} data
 */
export function barChart(data, { height = 150, barGap = 5, valueSuffix = '', emptyLabel = 'No activity in this window' } = {}) {
  const width = 460;
  const paddingBottom = 20;
  const paddingTop = 14;
  const maximum = Math.max(1, ...data.map((entry) => entry.value));
  const barWidth = Math.max(4, (width - barGap * (data.length - 1)) / Math.max(1, data.length));
  const plotHeight = height - paddingBottom - paddingTop;
  // Every bucket at zero is a legitimate reading, not missing data — but a row
  // of 1px stubs looks identical to a broken chart, so say so explicitly.
  const isEmpty = data.length === 0 || data.every((entry) => !(entry.value > 0));

  const svg = svgEl('svg', {
    class: 'chart-svg',
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': isEmpty ? `Throughput chart — ${emptyLabel}` : 'Throughput chart'
  });

  svg.append(
    svgEl('line', { class: 'axis', x1: 0, y1: height - paddingBottom, x2: width, y2: height - paddingBottom })
  );

  data.forEach((entry, index) => {
    const barHeight = (entry.value / maximum) * plotHeight;
    const x = index * (barWidth + barGap);
    const y = height - paddingBottom - barHeight;
    const rect = svgEl('rect', {
      class: 'bar',
      x,
      y: entry.value > 0 ? y : height - paddingBottom - 1,
      width: barWidth,
      height: entry.value > 0 ? Math.max(2, barHeight) : 1,
      rx: 3,
      style: `--bar-delay:${index * 26}ms`
    });
    rect.append(svgEl('title', {}, `${entry.label}: ${entry.value}${valueSuffix}`));
    svg.append(rect);

    if (index % 2 === 0) {
      svg.append(
        svgEl('text', { class: 'label', x: x + barWidth / 2, y: height - 6, 'text-anchor': 'middle' }, entry.label)
      );
    }
  });

  if (isEmpty) {
    svg.append(
      svgEl(
        'text',
        {
          class: 'chart-empty-label',
          x: width / 2,
          y: paddingTop + plotHeight / 2,
          'text-anchor': 'middle',
          'dominant-baseline': 'middle'
        },
        emptyLabel
      )
    );
  }

  return svg;
}

/**
 * Donut chart with a legend.
 * @param {Array<{key: string, count: number}>} data
 */
export function donutChart(data, { size = 168, thickness = 26 } = {}) {
  const total = data.reduce((sum, entry) => sum + entry.count, 0);
  const radius = size / 2 - thickness / 2;
  const centre = size / 2;
  const circumference = 2 * Math.PI * radius;

  const svg = svgEl('svg', {
    class: 'chart-svg chart-svg--donut',
    viewBox: `0 0 ${size} ${size}`,
    width: size,
    height: size,
    role: 'img',
    'aria-label': 'Document mix'
  });

  // Track ring — always drawn so the donut keeps its shape when empty.
  svg.append(
    svgEl('circle', {
      class: 'donut-track',
      cx: centre,
      cy: centre,
      r: radius,
      fill: 'none',
      'stroke-width': thickness
    })
  );

  let offset = 0;
  data.forEach((entry, index) => {
    const fraction = total > 0 ? entry.count / total : 0;
    const arc = svgEl('circle', {
      class: 'donut-seg',
      cx: centre,
      cy: centre,
      r: radius,
      fill: 'none',
      stroke: PALETTE[index % PALETTE.length],
      'stroke-width': thickness,
      'stroke-dasharray': `${fraction * circumference} ${circumference}`,
      'stroke-dashoffset': -offset,
      transform: `rotate(-90 ${centre} ${centre})`
    });
    arc.append(svgEl('title', {}, `${entry.key}: ${entry.count}`));
    svg.append(arc);
    offset += fraction * circumference;
  });

  svg.append(
    svgEl(
      'text',
      {
        x: centre,
        y: centre - 2,
        'text-anchor': 'middle',
        'font-size': '22',
        'font-weight': '700',
        fill: 'var(--text)'
      },
      String(total)
    ),
    svgEl(
      'text',
      { x: centre, y: centre + 16, 'text-anchor': 'middle', 'font-size': '11', 'font-weight': '500', fill: 'var(--text-secondary)' },
      'documents'
    )
  );

  const legend = el('div', { style: { display: 'grid', gap: '6px', minWidth: '170px' } },
    data.map((entry, index) =>
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px' } }, [
        el('span', {
          style: {
            width: '9px', height: '9px', borderRadius: '3px', flex: '0 0 9px',
            background: PALETTE[index % PALETTE.length]
          }
        }),
        el('span', { text: entry.key, style: { flex: '1' } }),
        el('strong', { text: String(entry.count) })
      ])
    )
  );

  return el('div', { style: { display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' } }, [svg, legend]);
}

/** Horizontal ranked bars used for type/business-unit mixes. */
export function rankedBars(data, { valueFormatter = (value) => String(value) } = {}) {
  const maximum = Math.max(1, ...data.map((entry) => entry.count));
  return el(
    'div',
    {},
    data.map((entry) =>
      el('div.bar-row', {}, [
        el('span.bar-row__label', { text: entry.key }),
        el('span.bar-row__value', { text: valueFormatter(entry.count) }),
        el('div.bar-row__track', {}, [
          el('div.bar-row__fill', { style: { width: `${(entry.count / maximum) * 100}%` } })
        ])
      ])
    )
  );
}
