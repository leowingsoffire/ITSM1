/**
 * Template Studio — list of customer-trained extraction templates.
 */
import { api, ApiError } from '../api.js';
import { el, formatTime, toast } from '../util.js';
import { icon } from '../icons.js';
import { card, dataTable, emptyState, pageHeader } from './common.js';

export async function render() {
  const node = el('div.view');
  const body = el('div');

  async function paint() {
    try {
      const { items } = await api.listTemplates();
      if (items.length === 0) {
        body.replaceChildren(
          emptyState(
            'No extraction templates yet',
            'Train one from a sample PDF or image — draw a box over each field you want extracted, then optionally upload your own Excel layout so exports match it exactly.',
            el('a.btn.btn--primary', { href: '#/templates/new', text: 'Train a new template' }),
            'crop'
          )
        );
        return;
      }

      const table = dataTable(
        [
          { label: 'Template' },
          { label: 'Trained from' },
          { label: 'Fields', numeric: true },
          { label: 'Excel layout' },
          { label: 'Runs', numeric: true },
          { label: 'Last run' },
          { label: 'Updated' }
        ],
        items.map((template) => [
          el('a', { href: `#/templates/${template.id}`, text: template.name }),
          template.sourceFileName ?? '—',
          String(template.fieldCount),
          template.hasExcelTemplate
            ? el('span.badge.badge--success', { text: 'Matched' })
            : el('span.badge.badge--neutral', { text: 'Default columns' }),
          String(template.runCount ?? 0),
          template.lastRunAt ? formatTime(template.lastRunAt) : '—',
          formatTime(template.updatedAt)
        ]),
        {
          onRowClick: (index) => {
            location.hash = `#/templates/${items[index].id}`;
          },
          emptyMessage: 'No extraction templates yet.',
          label: 'Extraction templates'
        }
      );

      body.replaceChildren(table);
    } catch (error) {
      body.replaceChildren(
        el('p.text-muted', { text: error instanceof ApiError ? error.message : 'Could not load templates.' })
      );
    }
  }

  node.append(
    pageHeader({
      title: 'Template Studio',
      icon: 'crop',
      subtitle:
        'Train a custom extractor for any layout your document library doesn\u2019t already know: upload a sample, draw a box over each field, and optionally match your own Excel/requirement template.',
      actions: [el('a.btn.btn--primary', { href: '#/templates/new', text: 'Train a new template' })]
    }),
    card({ title: 'Your templates', icon: 'library', body })
  );

  await paint();

  return { node, cleanup: () => {} };
}
