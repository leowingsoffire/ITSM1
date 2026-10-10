/**
 * Accuracy Assurance — corpus-level accuracy, calibration and per-check evidence.
 */
import { api } from '../api.js';
import { el, formatNumber, formatPercent, toast } from '../util.js';
import { card, dataTable, emptyState, kpi, loading, pageHeader, select } from './common.js';

const VERDICT_VARIANT = Object.freeze({
  verified: 'success',
  probable: 'info',
  unverified: 'warn',
  conflict: 'danger',
  missing: 'neutral'
});

let typeFilter = '';

export async function render() {
  const node = el('div.view');
  const host = el('div.stack', {}, [loading('Scoring the corpus…')]);

  node.append(
    pageHeader({
      title: 'Accuracy Assurance',
      subtitle:
        'Accuracy is measured with independent evidence — grounding, corroboration, arithmetic, reference data and business rules — not by restating the model\u2019s own confidence.',
      icon: 'target',
      actions: [el('button.btn.btn--ghost', { type: 'button', text: 'Refresh', on: { click: () => void paint() } })]
    }),
    host
  );

  async function paint() {
    let benchmark;
    let calibration;
    try {
      [benchmark, calibration] = await Promise.all([api.accuracyBenchmark(), api.accuracyCalibration()]);
    } catch {      host.replaceChildren(
        card({
          title: 'Accuracy data unavailable',
          icon: 'alert',
          tone: 'crimson',
          body: el('p', { text: 'The accuracy benchmark could not be loaded. Use Refresh to try again.' })
        })
      );
      return;
    }

    if (benchmark.documentsScored === 0) {
      host.replaceChildren(
        emptyState(
          'Nothing has been scored yet',
          'Ingest documents and the assurance engine will score every extracted field against independent evidence.',
          el('a.btn.btn--primary', { href: '#/ingest', text: 'Ingest documents' }),
          'target'
        )
      );
      return;
    }

    const filtered = typeFilter ? benchmark.byType.filter((entry) => entry.typeId === typeFilter) : benchmark.byType;

    const reliability = el(
      'div.reliability',
      {},
      (calibration.reliability ?? []).filter((bucket) => bucket.count > 0).map((bucket) =>
        el('div.reliability__row', {}, [
          el('span.reliability__label', { text: bucket.label }),
          el('div.reliability__bars', {}, [
            el('div.reliability__bar.reliability__bar--predicted', {
              style: `width:${Math.round(bucket.predicted * 100)}%`,
              title: `Predicted ${formatPercent(bucket.predicted * 100)}`
            }),
            el('div.reliability__bar.reliability__bar--observed', {
              style: `width:${Math.round(bucket.observed * 100)}%`,
              title: `Observed ${formatPercent(bucket.observed * 100)}`
            })
          ]),
          el('span.reliability__count', { text: `${formatNumber(bucket.count)} field(s)` })
        ])
      )
    );

    host.replaceChildren(
      el('div.grid.grid--kpi.stagger', {}, [
        kpi({
          label: 'Corpus accuracy',
          value: formatPercent(benchmark.averageAccuracy * 100),
          hint: `${formatNumber(benchmark.documentsScored)} document(s), ${formatNumber(benchmark.fieldsScored)} field(s)`,
          tone: benchmark.averageAccuracy >= 0.9 ? 'good' : benchmark.averageAccuracy >= 0.75 ? 'warn' : 'bad',
          icon: 'target'
        }),
        kpi({
          label: 'Independently verified',
          value: formatPercent(benchmark.verifiedFieldRatio * 100),
          hint: `${formatPercent(benchmark.conflictRatio * 100)} of fields conflict with a second source`,
          tone: benchmark.conflictRatio <= 0.05 ? 'good' : 'warn',
          icon: 'checkCircle'
        }),
        kpi({
          label: 'Document integrity',
          value: formatPercent((benchmark.averageIntegrity ?? 1) * 100),
          hint: `${formatNumber(benchmark.documentsWithIntegrityIssues ?? 0)} document(s) contradict their own arithmetic or policy`,
          tone: (benchmark.documentsWithIntegrityIssues ?? 0) === 0 ? 'good' : 'warn',
          icon: 'scale'
        }),
        kpi({
          label: 'Field coverage',
          value: formatPercent(benchmark.averageCoverage * 100),
          hint: `${formatNumber(benchmark.autoRepairs)} value(s) auto-repaired before verification`,
          icon: 'fill'
        }),
        kpi({
          label: 'Straight-through eligible',
          value: formatPercent(benchmark.straightThroughEligibleRatio * 100),
          hint: 'Every critical field corroborated and every rule passing',
          tone: benchmark.straightThroughEligibleRatio >= 0.6 ? 'good' : 'warn',
          icon: 'bolt'
        })
      ]),
      card({
        title: 'Calibration',
        subtitle: `Expected calibration error ${formatPercent((calibration.expectedCalibrationError ?? 0) * 100)} · Brier score ${(calibration.brierScore ?? 0).toFixed(4)}. The curve audits the calibrated confidence the platform publishes, not the extractor's raw claim.`,
        icon: 'gauge',
        tone: 'violet',
        body: [
          el('div.legend', {}, [
            el('span.legend__item', {}, [el('span.legend__swatch.legend__swatch--predicted'), el('span', { text: 'Predicted confidence' })]),
            el('span.legend__item', {}, [el('span.legend__swatch.legend__swatch--observed'), el('span', { text: 'Observed accuracy' })])
          ]),
          (calibration.reliability ?? []).filter((bucket) => bucket.count > 0).length === 0
            ? el('p.muted', { text: 'Not enough scored fields to build a reliability curve yet.' })
            : reliability,
          benchmark.modelCalibration
            ? el('p.muted.calibration-compare', {
                text:
                  `Recalibration improves the Brier score from ${(benchmark.modelCalibration.brierScore ?? 0).toFixed(4)} ` +
                  `(raw extractor confidence) to ${(benchmark.calibration?.brierScore ?? 0).toFixed(4)} across ` +
                  `${formatNumber(benchmark.calibration?.observations ?? 0)} scored field(s).`
              })
            : null
        ]
      }),
      card({
        title: 'Assurance checks',
        subtitle:
          'Which independent checks fire, how often they pass, and what a failure actually proves — a misread value or a document that contradicts itself.',
        icon: 'shield',
        tone: 'amber',
        flush: true,
        body: dataTable(
          [
            { label: 'Check' },
            { label: 'Proves' },
            { label: 'Evaluated', numeric: true },
            { label: 'Passed', numeric: true },
            { label: 'Failed', numeric: true },
            { label: 'Pass rate', numeric: true }
          ],
          (benchmark.byCheck ?? []).map((entry) => [
            el('strong', { text: entry.name }),
            el(`span.badge.badge--${entry.attribution === 'document' ? 'warn' : 'info'}`, {
              text: entry.attribution === 'document' ? 'document integrity' : 'extraction fidelity'
            }),
            formatNumber(entry.evaluated),
            formatNumber(entry.pass),
            entry.fail > 0
              ? el('span.badge.badge--danger', { text: String(entry.fail) })
              : el('span', { text: '0' }),
            formatPercent(entry.passRate * 100)
          ]),
          { emptyMessage: 'No checks have been applied yet.', label: 'Assurance checks' }
        )
      }),
      card({
        title: 'Accuracy by document type',
        subtitle: 'Where the assurance engine is confident, and where it is not.',
        icon: 'library',
        tone: 'teal',
        flush: true,
        actions: [
          select({
            id: 'accuracy-type',
            label: 'Filter',
            value: typeFilter,
            options: [
              { value: '', label: 'All document types' },
              ...benchmark.byType.map((entry) => ({ value: entry.typeId, label: entry.typeName }))
            ],
            onChange: (value) => {
              typeFilter = value;
              void paint();
            }
          })
        ],
        body: dataTable(
          [
            { label: 'Document type' },
            { label: 'Docs', numeric: true },
            { label: 'Accuracy', numeric: true },
            { label: 'Coverage', numeric: true },
            { label: 'Calibrated confidence', numeric: true },
            { label: 'Conflicts', numeric: true },
            { label: 'Doc disputes', numeric: true },
            { label: 'STP eligible', numeric: true }
          ],
          filtered.map((entry) => [
            el('strong', { text: entry.typeName }),
            formatNumber(entry.documents),
            el(
              `span.badge.badge--${entry.averageAccuracy >= 0.9 ? 'success' : entry.averageAccuracy >= 0.75 ? 'warn' : 'danger'}`,
              { text: formatPercent(entry.averageAccuracy * 100) }
            ),
            formatPercent(entry.averageCoverage * 100),
            formatPercent(entry.averageCalibratedConfidence * 100),
            entry.conflicts > 0
              ? el('span.badge.badge--danger', { text: String(entry.conflicts) })
              : el('span', { text: '0' }),
            (entry.integrityIssues ?? 0) > 0
              ? el('span.badge.badge--warn', { text: String(entry.integrityIssues) })
              : el('span', { text: '0' }),
            formatPercent(entry.stpEligibleRatio * 100)
          ]),
          { emptyMessage: 'No document types match this filter.', label: 'Accuracy by document type' }
        )
      }),
      card({
        title: 'Verdict distribution',
        subtitle: 'How every scored field was classified across the corpus.',
        icon: 'chart',
        tone: 'navy',
        body: el('div.chip-row.chip-row--lg', {}, [
          el('span.badge.badge--success', {
            text: `verified: ${formatPercent(benchmark.verifiedFieldRatio * 100)}`
          }),
          el('span.badge.badge--danger', {
            text: `conflict: ${formatPercent(benchmark.conflictRatio * 100)}`
          }),
          el('span.badge.badge--warn', {
            text: `document disputes: ${formatPercent((benchmark.integrityIssueRatio ?? 0) * 100)}`
          }),
          el('span.badge.badge--info', {
            text: `calibrated confidence: ${formatPercent(benchmark.averageCalibratedConfidence * 100)}`
          }),
          el('span.badge.badge--neutral', { text: `fields scored: ${formatNumber(benchmark.fieldsScored)}` }),
          el('span.badge.badge--warn', { text: `auto-repairs: ${formatNumber(benchmark.autoRepairs)}` })
        ])
      })
    );
  }

  await paint();

  const onRefresh = () => void paint();
  window.addEventListener('vgc:refresh-view', onRefresh);
  return { node, cleanup: () => window.removeEventListener('vgc:refresh-view', onRefresh) };
}
