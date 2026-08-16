/**
 * Claim Detail — full cross-document reconciliation for a single A&P claim.
 *
 * Shows the claim summary, the reconciliation verdict with every check, the
 * flagged exceptions a reviewer must clear, the linked supporting documents and
 * the raw extracted fields. Everything is exportable to Excel.
 */
import { api } from '../api.js';
import { el, formatNumber } from '../util.js';
import { card, dataTable, emptyState, pageHeader } from './common.js';

const money = (value, currency) =>
  value === null || value === undefined
    ? '—'
    : `${currency ? `${currency} ` : ''}${Number(value).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function resultBadge(item) {
  if (item.status === 'pass') return el('span.badge.badge--success', { text: 'Pass' });
  if (item.status === 'info') return el('span.badge.badge--info', { text: 'Info' });
  return item.severity === 'error'
    ? el('span.badge.badge--danger', { text: 'Fail' })
    : el('span.badge.badge--warn', { text: 'Review' });
}

function severityBadge(severity) {
  if (severity === 'error') return el('span.badge.badge--danger', { text: 'Error' });
  if (severity === 'warning') return el('span.badge.badge--warn', { text: 'Warning' });
  return el('span.badge.badge--neutral', { text: 'Info' });
}

function okBadge(value) {
  if (value === null || value === undefined) return el('span.badge.badge--neutral', { text: 'n/a' });
  return value ? el('span.badge.badge--success', { text: 'Match' }) : el('span.badge.badge--danger', { text: 'Mismatch' });
}

function summaryGrid(summary) {
  const currency = summary.currency;
  const rows = [
    ['Claim number', summary.claimNumber ?? '—'],
    ['Distributor', summary.distributor ?? '—'],
    ['A&P code', summary.apCode ? `${summary.apCode}${summary.apCodeName ? ` · ${summary.apCodeName}` : ''}` : '—'],
    ['Campaign', summary.campaign ?? '—'],
    ['Claim date', summary.claimDate ?? '—'],
    ['Currency', currency ?? '—'],
    ['Claim amount', money(summary.claimAmount, currency)],
    ['Supporting total', money(summary.supportTotal, currency)],
    ['Variance', money(summary.amountVariance, currency)],
    ['Supporting documents', String(summary.supportingCount)]
  ];
  return el(
    'dl.detail-grid',
    {},
    rows.flatMap(([label, value]) => [
      el('dt', { text: label }),
      el('dd', { text: value })
    ])
  );
}

function budgetPanel(budget) {
  if (!budget) return emptyState('No budget mapping', 'This A&P code is not in the annual budget table.', null, 'alert');
  const utilisation = budget.utilisation !== undefined ? budget.utilisation : (budget.annualBudget ? budget.spentToDate / budget.annualBudget : 0);
  const pct = Math.min(100, Math.round(utilisation * 100));
  const grid = el('dl.detail-grid', {}, [
    ['A&P code', `${budget.code} · ${budget.name}`],
    ['Annual budget', money(budget.annualBudget, budget.currency)],
    ['Spent to date', money(budget.spentToDate, budget.currency)],
    ['Remaining', money(budget.remaining, budget.currency)],
    ['This claim', budget.claimAmount === null ? '—' : money(budget.claimAmount, budget.claimCurrency ?? budget.currency)]
  ].flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })]));
  const bar = el('div.budget-bar', {}, [
    el(`div.budget-bar__fill${pct >= 90 ? '.budget-bar__fill--hot' : ''}`, { style: { width: `${pct}%` } })
  ]);
  return el('div', {}, [grid, el('div.budget-bar__label', { text: `${pct}% of annual budget utilised` }), bar]);
}

function verdictBanner(reconciliation) {
  const clear = reconciliation.status === 'clear';
  return el(`div.callout${clear ? '.callout--good' : '.callout--bad'}`, {}, [
    el('strong', {
      text: clear
        ? 'Reconciled — no exceptions'
        : `${reconciliation.errorCount} error(s) and ${reconciliation.warningCount} warning(s) require review`
    }),
    el('p', {
      text: clear
        ? 'The claimed amount, dates and A&P code are consistent across all supporting documents.'
        : 'Resolve the flagged exceptions below before approving this claim for payment.'
    })
  ]);
}

export async function render(params = {}) {
  const node = el('div.view');

  let detail;
  try {
    detail = await api.getClaim(params.id);
  } catch (error) {
    node.append(
      pageHeader({ title: 'Marketing Claim', icon: 'scale', actions: [el('a.btn.btn--ghost', { href: '#/claims', text: 'Back to claims' })] }),
      emptyState('Claim not found', 'This marketing claim could not be located. It may have been removed.', el('a.btn.btn--primary', { href: '#/claims', text: 'Back to claims' }), 'alert')
    );
    return { node };
  }

  const { summary, claim, supportingDocuments, reconciliation } = detail;
  const currency = reconciliation.currency ?? summary.currency;

  const checksTable = dataTable(
    [{ label: 'Check' }, { label: 'Severity' }, { label: 'Result' }, { label: 'Detail' }],
    reconciliation.checks.map((item) => [
      el('strong', { text: item.label }),
      severityBadge(item.severity),
      resultBadge(item),
      item.message
    ]),
    { emptyMessage: 'No reconciliation checks were run.', label: 'Reconciliation checks' }
  );

  const exceptionsBody =
    reconciliation.exceptions.length === 0
      ? emptyState('No exceptions', 'Every reconciliation check passed for this claim.', null, 'checkCircle')
      : el(
          'ul.exception-list',
          {},
          reconciliation.exceptions.map((item) =>
            el('li.exception-list__item', {}, [
              severityBadge(item.severity),
              el('div', {}, [el('strong', { text: item.label }), el('p', { text: item.message })])
            ])
          )
        );

  const lineComparison = reconciliation.lineComparison ?? [];
  const lineTable = dataTable(
    [
      { label: 'Vendor' },
      { label: 'Invoice ref' },
      { label: 'Product' },
      { label: 'Summary date' },
      { label: 'Attachment date' },
      { label: 'Date' },
      { label: 'Summary amt', numeric: true },
      { label: 'Attachment amt', numeric: true },
      { label: 'Amount' },
      { label: 'Mark-up' }
    ],
    lineComparison.map((line) => [
      line.vendor ?? '—',
      el('span.mono', { text: line.invoiceRef ?? '—' }),
      el('span.mono', { text: line.productType ?? '—' }),
      line.summaryDate ?? '—',
      line.attachmentDate ?? (line.matched ? '—' : 'no attachment'),
      okBadge(line.dateOk),
      money(line.summaryAmount, currency),
      money(line.attachmentAmount, currency),
      okBadge(line.amountOk),
      line.annotation ?? '—'
    ]),
    { emptyMessage: 'No claim line items were itemised on the summary.', label: 'Claim line items' }
  );

  const summationRows = reconciliation.productSummation ?? [];
  const summationTable = dataTable(
    [
      { label: 'Product type' },
      { label: 'Page-one subtotal', numeric: true },
      { label: 'Highlighted lines', numeric: true },
      { label: 'Variance', numeric: true },
      { label: 'Result' }
    ],
    summationRows.map((row) => [
      el('span.mono', { text: row.productType }),
      money(row.stated, currency),
      row.actual === null ? '—' : money(row.actual, currency),
      row.delta === null ? '—' : money(row.delta, currency),
      row.status === 'ok'
        ? el('span.badge.badge--success', { text: 'Match' })
        : row.status === 'mismatch'
          ? el('span.badge.badge--danger', { text: 'Mismatch' })
          : el('span.badge.badge--neutral', { text: 'Unverified' })
    ]),
    { emptyMessage: 'No product-type summary was itemised on the claim.', label: 'Claim product-type summary' }
  );

  const supportTable = dataTable(
    [
      { label: 'Document' },
      { label: 'Kind' },
      { label: 'Vendor' },
      { label: 'Reference' },
      { label: 'Product' },
      { label: 'Date' },
      { label: 'Amount', numeric: true },
      { label: 'A&P code' },
      { label: 'Match' }
    ],
    supportingDocuments.map((support) => [
      el('span', {}, [el('strong', { text: support.fileName })]),
      support.documentKind ?? '—',
      support.vendor ?? '—',
      support.reference ?? '—',
      el('span.mono', { text: support.productType ?? '—' }),
      support.documentDate ?? '—',
      support.amount === null ? '—' : money(support.amount, currency),
      el('span.mono', { text: support.apCode ?? '—' }),
      support.apCodeMatches ? el('span.badge.badge--success', { text: 'Yes' }) : el('span.badge.badge--danger', { text: 'No' })
    ]),
    {
      emptyMessage: 'No supporting documents were linked to this claim.',
      label: 'Supporting documents',
      onRowClick: (index) => {
        location.hash = `#/documents/${supportingDocuments[index].id}`;
      }
    }
  );

  const fieldsTable = dataTable(
    [{ label: 'Field' }, { label: 'Value' }, { label: 'Raw OCR value' }],
    claim.fields.map((field) => [
      el('strong', { text: field.label }),
      field.value === null || field.value === undefined || field.value === '' ? '—' : String(field.value),
      el('span.field-row__raw', { text: field.rawValue ?? '—' })
    ]),
    { emptyMessage: 'No fields were extracted.', label: 'Extracted claim fields' }
  );

  node.append(
    pageHeader({
      title: summary.claimNumber ?? 'Marketing Claim',
      icon: 'scale',
      subtitle: `${summary.distributor ?? 'Distributor'} · A&P ${summary.apCode ?? '—'} · ${summary.campaign ?? ''}`.trim(),
      actions: [
        el('a.btn.btn--ghost', { href: '#/claims', text: 'Back to claims' }),
        el('a.btn.btn--primary', { href: `/api/claims/${encodeURIComponent(claim.id)}/export.xlsx`, text: 'Export reconciliation (Excel)' })
      ]
    }),
    verdictBanner(reconciliation),
    el('div.grid.grid--2', { style: { marginTop: '16px' } }, [
      card({ title: 'Claim summary', icon: 'tag', body: summaryGrid(summary) }),
      card({ title: 'Flagged exceptions', icon: 'alert', tone: reconciliation.exceptions.length > 0 ? 'crimson' : 'jade', body: exceptionsBody })
    ]),
    el('div.grid.grid--2', { style: { marginTop: '16px' } }, [
      card({ title: 'A&P budget consumption', icon: 'wallet', tone: 'violet', subtitle: `Annual budget for code ${summary.apCode ?? '—'}.`, body: budgetPanel(reconciliation.budget) }),
      card({ title: 'Product-type summation', icon: 'sigma', tone: 'amber', subtitle: 'Highlighted attachment lines summed back to page-one subtotals.', body: summationTable, flush: true })
    ]),
    el('div', { style: { marginTop: '16px' } }, [
      card({ title: 'Per-invoice comparison', icon: 'scale', tone: 'amber', subtitle: 'Summary line vs. the actual attachment — amount and date, to the dollar and to the day.', body: lineTable, flush: true })
    ]),
    el('div', { style: { marginTop: '16px' } }, [
      card({ title: 'Reconciliation checks', icon: 'scale', tone: 'amber', subtitle: 'Cross-document comparison of amount, dates, A&P code, budget and product summation.', body: checksTable, flush: true })
    ]),
    el('div', { style: { marginTop: '16px' } }, [
      card({ title: 'Supporting documents', icon: 'library', subtitle: 'Linked by A&P code. Open a document to inspect its extraction.', body: supportTable, flush: true })
    ]),
    el('div', { style: { marginTop: '16px' } }, [
      card({ title: 'Extracted claim fields', icon: 'documents', body: fieldsTable, flush: true })
    ])
  );

  return { node };
}
