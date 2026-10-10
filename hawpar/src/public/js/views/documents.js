/**
 * Document Library — filterable, paginated view of every processed document.
 */
import { api } from '../api.js';
import { state } from '../store.js';
import { confidenceChip, debounce, el, formatDateTime, formatDuration, formatNumber, statusBadge, toast } from '../util.js';
import { card, dataTable, pageHeader, select } from './common.js';

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Auto-approved' },
  { value: 'needs-review', label: 'Needs review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' }
];

export async function render(params = {}) {
  const node = el('div.view');
  const config = state.config ?? (await api.getConfig());

  const filters = {
    status: params.status ?? '',
    typeId: '',
    businessUnit: '',
    q: '',
    page: 1
  };

  const businessUnits = [...new Set(config.documentTypes.map((type) => type.businessUnit))].sort();
  const tableHost = el('div');
  const pager = el('div.row', { style: { padding: '10px 16px', borderTop: '1px solid var(--slate-200)' } });

  async function paint() {
    tableHost.replaceChildren(el('div.table-empty', { text: 'Loading documents…' }));
    let listing;
    try {
      listing = await api.listDocuments({ ...filters, pageSize: PAGE_SIZE, sort: 'uploadedAt:desc' });
    } catch (error) {
      toast('Could not load the document library.', 'error');
      return;
    }

    const table = dataTable(
      [
        { label: 'Document' },
        { label: 'Type' },
        { label: 'Business unit' },
        { label: 'Pages', numeric: true },
        { label: 'Fields', numeric: true },
        { label: 'Confidence', numeric: true },
        { label: 'Exceptions', numeric: true },
        { label: 'Duration', numeric: true },
        { label: 'Status' },
        { label: 'Uploaded' }
      ],
      listing.items.map((item) => [
        el('span.cell-stack', {}, [
          el('strong', { text: item.fileName }),
          el('span.field-row__raw', { text: item.id, title: item.id })
        ]),
        item.typeName ?? '—',
        item.businessUnit ?? '—',
        formatNumber(item.pageCount ?? 0),
        `${item.fieldCount - item.reviewFieldCount}/${item.fieldCount}`,
        item.averageFieldConfidence === null ? '—' : confidenceChip(item.averageFieldConfidence),
        el('span', {}, [
          item.validationErrors > 0 ? el('span.badge.badge--danger', { text: `${item.validationErrors}E` }) : null,
          item.validationWarnings > 0 ? el('span.badge.badge--warn', { text: `${item.validationWarnings}W` }) : null,
          item.validationErrors === 0 && item.validationWarnings === 0 ? el('span.text-muted', { text: '—' }) : null
        ]),
        formatDuration(item.durationMs),
        statusBadge(item.status),
        formatDateTime(item.uploadedAt)
      ]),
      {
        label: 'Document library',
        stack: 600,
        emptyMessage: 'No documents match the current filters.',
        label: 'Documents',
        onRowClick: (index) => {
          location.hash = `#/documents/${listing.items[index].id}`;
        }
      }
    );

    tableHost.replaceChildren(table);

    const lastPage = Math.max(1, Math.ceil(listing.total / listing.pageSize));
    pager.replaceChildren(
      el('span.text-muted', { text: `${formatNumber(listing.total)} document(s) · page ${listing.page} of ${lastPage}` }),
      el('span', { style: { marginLeft: 'auto' } }),
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: 'Previous',
        disabled: listing.page <= 1,
        on: { click: () => { filters.page -= 1; paint(); } }
      }),
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: 'Next',
        disabled: listing.page >= lastPage,
        on: { click: () => { filters.page += 1; paint(); } }
      })
    );
  }

  const searchInput = el('input', {
    type: 'search',
    placeholder: 'File name, type or extracted value…',
    value: filters.q,
    on: {
      input: debounce((event) => {
        filters.q = event.target.value;
        filters.page = 1;
        paint();
      })
    }
  });

  const filterBar = el('div.filter-bar', {}, [
    el('div.field.field--grow', {}, [
      el('label', { text: 'Search' }),
      searchInput
    ]),
    select({
      label: 'Status',
      value: filters.status,
      options: STATUS_OPTIONS,
      onChange: (value) => { filters.status = value; filters.page = 1; paint(); }
    }),
    select({
      label: 'Document type',
      value: filters.typeId,
      options: [{ value: '', label: 'All types' }, ...config.documentTypes.map((type) => ({ value: type.id, label: type.name }))],
      onChange: (value) => { filters.typeId = value; filters.page = 1; paint(); }
    }),
    select({
      label: 'Business unit',
      value: filters.businessUnit,
      options: [{ value: '', label: 'All units' }, ...businessUnits.map((unit) => ({ value: unit, label: unit }))],
      onChange: (value) => { filters.businessUnit = value; filters.page = 1; paint(); }
    }),
    el('button.btn.btn--ghost', {
      type: 'button',
      text: 'Reset',
      on: {
        click: () => {
          Object.assign(filters, { status: '', typeId: '', businessUnit: '', q: '', page: 1 });
          searchInput.value = '';
          node.querySelectorAll('select').forEach((element) => { element.value = ''; });
          paint();
        }
      }
    })
  ]);

  node.append(
    pageHeader({
      title: 'Document Library',
      icon: 'library',
      subtitle: 'Every document the platform has processed, with extraction quality, exceptions and cost per document.',
      actions: [
        el('a.btn.btn--ghost', { href: '/api/export/fields.csv', text: 'Export fields (.csv)' }),
        el('a.btn.btn--ghost', { href: '/api/export/documents.xlsx', text: 'Export workbook' })
      ]
    }),
    card({ body: filterBar }),
    el('div', { style: { height: '16px' } }),
    card({ body: el('div', {}, [tableHost, pager]), flush: true })
  );

  await paint();
  return { node };
}
