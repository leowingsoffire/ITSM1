/**
 * Review Queue — exceptions ranked by business impact.
 */
import { api } from '../api.js';
import { subscribe } from '../store.js';
import { confidenceChip, el, formatNumber, relativeTime, toast } from '../util.js';
import { card, dataTable, emptyState, kpi, pageHeader } from './common.js';

const PRIORITY_VARIANT = Object.freeze({ high: 'danger', medium: 'warn', low: 'neutral' });

export async function render() {
  const node = el('div.view');
  const host = el('div');

  async function paint() {
    let queue;
    try {
      queue = await api.reviewQueue(100);
    } catch (error) {
      toast('Could not load the review queue.', 'error');
      return;
    }

    if (queue.total === 0) {
      host.replaceChildren(
        emptyState(
          'Nothing is waiting for review',
          'Every processed document passed its confidence thresholds and business rules.',
          el('a.btn.btn--primary', { href: '#/documents', text: 'Open document library' }),
          'checkCircle'
        )
      );
      return;
    }

    const high = queue.items.filter((item) => item.priority === 'high').length;
    const criticalFields = queue.items.reduce((sum, item) => sum + item.criticalFieldsToReview, 0);
    const errors = queue.items.reduce((sum, item) => sum + item.validationErrors, 0);

    const table = dataTable(
      [
        { label: 'Priority' },
        { label: 'Document' },
        { label: 'Type' },
        { label: 'Business unit' },
        { label: 'Pages', numeric: true },
        { label: 'Rule errors', numeric: true },
        { label: 'Fields to verify', numeric: true },
        { label: 'Classification' },
        { label: 'Waiting' }
      ],
      queue.items.map((item) => [
        el(`span.badge.badge--${PRIORITY_VARIANT[item.priority]}`, { text: `${item.priority} · ${item.priorityScore}` }),
        el('strong', { text: item.fileName }),
        item.typeName,
        item.businessUnit ?? '—',
        formatNumber(item.pageCount),
        String(item.validationErrors),
        `${item.fieldsToReview}${item.criticalFieldsToReview > 0 ? ` (${item.criticalFieldsToReview} critical)` : ''}`,
        confidenceChip(item.classificationConfidence),
        relativeTime(item.uploadedAt)
      ]),
      { stack: 600, label: 'Review queue', onRowClick: (index) => { location.hash = `#/documents/${queue.items[index].documentId}`; } }
    );

    host.replaceChildren(
      el('div.grid.grid--kpi.stagger', { style: { marginBottom: '16px' } }, [
        kpi({ label: 'Awaiting review', icon: 'review', value: formatNumber(queue.total), countTo: queue.total, format: (n) => formatNumber(n), tone: 'warn' }),
        kpi({ label: 'High priority', icon: 'alert', value: formatNumber(high), tone: high > 0 ? 'bad' : 'good', trend: high > 0 ? { direction: 'up', text: 'Escalate first' } : { direction: 'flat', text: 'Queue is clear' } }),
        kpi({ label: 'Critical fields to verify', icon: 'target', value: formatNumber(criticalFields) }),
        kpi({ label: 'Open rule errors', icon: 'scale', value: formatNumber(errors) })
      ]),
      card({ title: 'Prioritised exception queue', icon: 'review', tone: 'amber', subtitle: 'Ranked by rule errors, critical fields and total fields below threshold', body: table, flush: true })
    );
  }

  node.append(
    pageHeader({
      title: 'Review Queue',
      icon: 'review',
      subtitle: 'Human-in-the-loop verification. Highest business impact first — open a document to correct values and record an approval decision.',
      actions: [el('button.btn.btn--ghost', { type: 'button', text: 'Refresh', on: { click: () => paint() } })]
    }),
    host
  );

  await paint();
  const unsubscribe = subscribe((unused, reason) => {
    if (reason === 'pipeline') paint().catch(() => {});
  });

  return { node, cleanup: unsubscribe };
}
