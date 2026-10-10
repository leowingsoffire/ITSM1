/**
 * Marketing Claims — cross-document A&P claim reconciliation workspace.
 *
 * Lists every distributor marketing-expense claim, showing at a glance whether
 * the claimed amount, dates and A&P code reconcile against the supporting
 * documents. Claims needing human review are surfaced first.
 */
import { api } from '../api.js';
import { subscribe } from '../store.js';
import { el, formatNumber, formatSgd, toast } from '../util.js';
import { card, dataTable, emptyState, kpi, pageHeader } from './common.js';

const money = (value, currency) =>
  value === null || value === undefined
    ? '—'
    : `${currency ? `${currency} ` : ''}${Number(value).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function statusPill(status) {
  return status === 'review'
    ? el('span.badge.badge--danger', { text: 'Needs review' })
    : el('span.badge.badge--success', { text: 'Clear' });
}

function varianceCell(variance, currency) {
  if (variance === null || variance === undefined) return el('span.text-muted', { text: '—' });
  if (Math.abs(variance) <= 0.02) return el('span.text-muted', { text: money(0, currency) });
  return el('span.badge.badge--danger', { text: money(variance, currency) });
}

function exceptionCell(claim) {
  if (claim.exceptionCount === 0) return el('span.text-muted', { text: '—' });
  return el('span', {}, [
    claim.errorCount > 0 ? el('span.badge.badge--danger', { text: `${claim.errorCount}E` }) : null,
    claim.warningCount > 0 ? el('span.badge.badge--warn', { text: `${claim.warningCount}W` }) : null
  ]);
}

export async function render() {
  const node = el('div.view');
  const host = el('div');

  async function paint() {
    let payload;
    try {
      payload = await api.listClaims();
    } catch (error) {
      toast('Could not load marketing claims.', 'error');
      return;
    }

    const { overview, items } = payload;

    if (items.length === 0) {
      host.replaceChildren(
        emptyState(
          'No marketing claims yet',
          'Run the sample library or ingest distributor A&P claim summaries with their supporting invoices to see cross-document reconciliation.',
          el('a.btn.btn--primary', { href: '#/ingest', text: 'Ingest documents' }),
          'scale'
        )
      );
      return;
    }

    const table = dataTable(
      [
        { label: 'Status' },
        { label: 'Claim' },
        { label: 'Distributor' },
        { label: 'A&P code' },
        { label: 'Campaign' },
        { label: 'Claim date' },
        { label: 'Cur' },
        { label: 'Claimed', numeric: true },
        { label: 'Supported', numeric: true },
        { label: 'Variance', numeric: true },
        { label: 'Docs', numeric: true },
        { label: 'Exceptions', numeric: true }
      ],
      items.map((claim) => [
        statusPill(claim.reconciliationStatus),
        el('span.cell-stack', {}, [
          el('strong', { text: claim.claimNumber ?? claim.fileName }),
          el('span.field-row__raw', { text: claim.fileName })
        ]),
        claim.distributor ?? '—',
        el('span.mono', { text: claim.apCode ?? '—', title: claim.apCodeName ?? '' }),
        claim.campaign ?? '—',
        claim.claimDate ?? '—',
        el('span.mono', { text: claim.currency ?? '—' }),
        money(claim.claimAmount, claim.currency),
        money(claim.supportTotal, claim.currency),
        varianceCell(claim.amountVariance, claim.currency),
        formatNumber(claim.supportingCount),
        exceptionCell(claim)
      ]),
      {
        label: 'Marketing claims',
        stack: 600,
        emptyMessage: 'No marketing claims match.',
        label: 'Marketing claims',
        onRowClick: (index) => {
          location.hash = `#/claims/${items[index].id}`;
        }
      }
    );

    host.replaceChildren(
      el('div.grid.grid--kpi.stagger', { style: { marginBottom: '16px' } }, [
        kpi({ label: 'Total claims', icon: 'scale', value: formatNumber(overview.totalClaims), countTo: overview.totalClaims, format: (n) => formatNumber(n) }),
        kpi({
          label: 'Needs review',
          icon: 'alert',
          value: formatNumber(overview.reviewClaims),
          tone: overview.reviewClaims > 0 ? 'bad' : 'good',
          trend: overview.reviewClaims > 0 ? { direction: 'up', text: 'Resolve exceptions' } : { direction: 'flat', text: 'All reconciled' }
        }),
        kpi({ label: 'Reconciled cleanly', icon: 'checkCircle', value: formatNumber(overview.clearClaims), tone: 'good' }),
        kpi({ label: 'Open exceptions', icon: 'target', value: formatNumber(overview.totalExceptions), tone: overview.totalExceptions > 0 ? 'warn' : 'good' }),
        kpi({ label: 'Total claim value', icon: 'wallet', value: formatSgd(overview.totalClaimValue) })
      ]),
      card({
        title: 'Distributor A&P claims',
        icon: 'scale',
        tone: 'amber',
        subtitle: 'Each claim is reconciled across its supporting documents by A&P code. Open a claim to review the exceptions.',
        body: table,
        flush: true
      })
    );
  }

  node.append(
    pageHeader({
      title: 'Marketing Claims',
      icon: 'scale',
      subtitle:
        'Cross-document reconciliation of distributor Advertising & Promotion (A&P) expense claims — extract, compare, flag exceptions and export to Excel.',
      actions: [
        el('a.btn.btn--ghost', { href: '/api/claims/export.xlsx', text: 'Export all (Excel)' }),
        el('button.btn.btn--ghost', { type: 'button', text: 'Refresh', on: { click: () => paint() } })
      ]
    }),
    host
  );

  await paint();
  const unsubscribe = subscribe((unused, reason) => {
    if (reason === 'pipeline' || reason === 'counters') paint().catch(() => {});
  });

  return { node, cleanup: unsubscribe };
}
