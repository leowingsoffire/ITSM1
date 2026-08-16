/**
 * Command Centre — the executive view of the whole platform.
 */
import { api } from '../api.js';
import { azureLogo } from '../azure-logos.js';
import { barChart, donutChart, rankedBars } from '../charts.js';
import { state, subscribe } from '../store.js';
import { el, formatNumber, formatPercent, formatTime } from '../util.js';
import { card, dataTable, emptyState, kpi, pageHeader } from './common.js';

const REFRESH_INTERVAL_MS = 12000;

function kpiRow(dashboard) {
  const { volume, quality, performance, economics } = dashboard;
  return el('div.grid.grid--kpi.stagger', {}, [
    kpi({
      label: 'Documents processed',
      icon: 'documents',
      value: formatNumber(volume.processed),
      countTo: volume.processed,
      format: (n) => formatNumber(n),
      hint: `${formatNumber(volume.inFlight)} in flight · ${formatNumber(volume.failed)} failed`
    }),
    kpi({
      label: 'Pages analysed',
      icon: 'pages',
      value: formatNumber(volume.totalPages),
      countTo: volume.totalPages,
      format: (n) => formatNumber(n),
      hint: `Largest document ${formatNumber(volume.largestDocumentPages)} pages`
    }),
    kpi({
      label: 'Straight-through rate',
      icon: 'bolt',
      value: formatPercent(quality.straightThroughRate),
      hint: `${formatNumber(volume.needsReview)} awaiting review`,
      trend: quality.straightThroughRate >= 60
        ? { direction: 'up', text: 'Above the 60% target' }
        : quality.straightThroughRate >= 30
          ? { direction: 'flat', text: 'Approaching target' }
          : { direction: 'down', text: 'Below the 60% target' },
      tone: quality.straightThroughRate >= 60 ? 'good' : quality.straightThroughRate >= 30 ? 'warn' : 'bad'
    }),
    kpi({
      label: 'Avg field confidence',
      icon: 'target',
      value: formatPercent(quality.averageFieldConfidence * 100),
      hint: `${formatNumber(quality.totalFields)} fields extracted`,
      trend: quality.averageFieldConfidence >= 0.9
        ? { direction: 'up', text: 'Above the 90% auto-accept line' }
        : { direction: 'flat', text: 'Below the 90% auto-accept line' },
      tone: quality.averageFieldConfidence >= 0.9 ? 'good' : 'warn'
    }),
    kpi({
      label: 'Avg processing time',
      icon: 'clock',
      value: `${performance.averageSeconds}s`,
      hint: `p95 ${performance.p95Seconds}s · ${performance.pagesPerSecond} pages/s`
    }),
    kpi({
      label: 'Manual effort avoided',
      icon: 'sparkles',
      value: `${formatNumber(economics.manualHoursAvoided, 1)} h`,
      hint: 'Keying time returned to the business',
      trend: { direction: 'up', text: 'Adaptive model routing active' },
      tone: 'good'
    })
  ]);
}

function issuesTable(topIssues) {
  if (topIssues.length === 0) {
    return el('p.text-muted', { text: 'No validation exceptions have been raised across the processed corpus.' });
  }
  return dataTable(
    [{ label: 'Rule' }, { label: 'Description' }, { label: 'Severity' }, { label: 'Occurrences', numeric: true }],
    topIssues.map((entry) => [
      el('span.mono', { text: entry.rule }),
      entry.description || '—',
      el(`span.badge.badge--${entry.severity === 'error' ? 'danger' : 'warn'}`, { text: entry.severity }),
      formatNumber(entry.count)
    ]),
    { label: 'Top validation exceptions' }
  );
}

function activityFeed() {
  const list = el('ul.feed');
  const paint = () => {
    list.replaceChildren(
      ...(state.activity.length === 0
        ? [el('li.feed__item', {}, [el('span.feed__text.text-muted', { text: 'Waiting for pipeline activity…' })])]
        : state.activity.slice(0, 40).map((entry) =>
            el('li.feed__item', {}, [
              el(`span.dot.dot--${entry.variant === 'error' ? 'danger' : entry.variant === 'warn' ? 'warn' : entry.variant === 'success' ? 'success' : 'info'}`),
              el('span.feed__time', { text: formatTime(entry.at) }),
              el('span.feed__text', { text: entry.text })
            ])
          ))
    );
  };
  paint();
  return { list, paint };
}

export async function render() {
  const node = el('div.view');
  const dashboard = await api.dashboard();

  const feed = activityFeed();

  const engineNote = state.config?.analyzer?.mode === 'azure'
    ? 'Live Azure AI Document Intelligence is analysing every page.'
    : 'Running on the offline demo engine — no Azure charges are being incurred. Set ANALYZER_MODE=azure to switch.';

  node.append(
    pageHeader({
      title: 'Command Centre',
      icon: 'dashboard',
      subtitle: 'Live operational picture of VGC document processing across healthcare, leisure, property and investments.',
      actions: [
        el('a.btn.btn--ghost', { href: '/api/export/documents.xlsx', text: 'Export workbook' }),
        el('a.btn.btn--primary', { href: '#/ingest', text: 'Ingest documents' })
      ]
    }),
    el('div.inline-note', {}, [
      azureLogo('document-intelligence', { size: 18, decorative: true }),
      el('span', { text: engineNote })
    ]),
    kpiRow(dashboard)
  );

  if (dashboard.volume.processed === 0) {
    node.append(
      el('div', { style: { marginTop: '16px' } }, [
        emptyState(
          'No documents processed yet',
          'Run the VGC sample pack or upload your own files to populate the command centre.',
          el('a.btn.btn--accent', { href: '#/ingest', text: 'Go to ingestion' }),
          'upload'
        )
      ])
    );
    return { node };
  }

  node.append(
    el('div.grid.grid--2', { style: { marginTop: '16px' } }, [
      card({
        title: 'Throughput (last 60 minutes)',
        icon: 'bolt',
        tone: 'amber',
        subtitle: 'Documents completed per 5-minute bucket',
        body: barChart(dashboard.throughput.map((bucket) => ({ label: bucket.label, value: bucket.documents })))
      }),
      card({
        title: 'Document mix',
        icon: 'layers',
        tone: 'violet',
        subtitle: 'Processed volume by document type',
        body: donutChart(dashboard.mix.byDocumentType.slice(0, 7))
      })
    ]),
    el('div.grid.grid--2', { style: { marginTop: '16px' } }, [
      card({
        title: 'Business unit coverage',
        icon: 'building',
        tone: 'teal',
        body: rankedBars(dashboard.mix.byBusinessUnit, { valueFormatter: (count) => `${count} doc(s)` })
      }),
      card({
        title: 'Extraction quality',
        icon: 'target',
        tone: 'jade',
        body: el('dl.kv-list', {}, [
          el('dt', { text: 'Field acceptance rate' }),
          el('dd', { text: formatPercent(dashboard.quality.fieldAcceptanceRate) }),
          el('dt', { text: 'Average OCR confidence' }),
          el('dd', { text: formatPercent(dashboard.quality.averageOcrConfidence * 100) }),
          el('dt', { text: 'Documents with degraded scans' }),
          el('dd', { text: formatNumber(dashboard.quality.documentsWithDegradedScans) }),
          el('dt', { text: 'Median processing time' }),
          el('dd', { text: `${dashboard.performance.medianSeconds}s` }),
          el('dt', { text: 'Fields extracted' }),
          el('dd', { text: formatNumber(dashboard.quality.totalFields) }),
          el('dt', { text: 'Manual hours avoided' }),
          el('dd', { text: `${formatNumber(dashboard.economics.manualHoursAvoided, 1)} h` })
        ])
      })
    ]),
    el('div.grid.grid--2', { style: { marginTop: '16px' } }, [
      card({ title: 'Top validation exceptions', icon: 'alert', tone: 'crimson', body: issuesTable(dashboard.topIssues), flush: dashboard.topIssues.length > 0 }),
      card({ title: 'Live pipeline activity', icon: 'sparkles', tone: 'violet', subtitle: 'Streamed over server-sent events', body: feed.list, flush: false })
    ])
  );

  const unsubscribe = subscribe((unused, reason) => {
    if (reason === 'pipeline') feed.paint();
  });

  const timer = setInterval(() => {
    location.hash === '#/dashboard' && window.dispatchEvent(new CustomEvent('vgc:refresh-view'));
  }, REFRESH_INTERVAL_MS);

  return {
    node,
    cleanup: () => {
      unsubscribe();
      clearInterval(timer);
    }
  };
}
