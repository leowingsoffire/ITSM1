/**
 * Workflows — the operational board for every document workflow instance.
 * Filters, search, sorting, paging and inline actions all round-trip to the API.
 */
import { api } from '../api.js';
import { el, formatDateTime, formatNumber, formatPercent, relativeTime, toast } from '../util.js';
import { card, dataTable, emptyState, kpi, loading, pageHeader, select } from './common.js';

const PRIORITY_VARIANT = Object.freeze({ critical: 'danger', high: 'danger', medium: 'warn', low: 'neutral' });
const SLA_VARIANT = Object.freeze({ breached: 'danger', 'at-risk': 'warn', 'on-track': 'success', closed: 'neutral', none: 'neutral' });
const STATUS_VARIANT = Object.freeze({ active: 'info', 'on-hold': 'warn', completed: 'success', cancelled: 'neutral' });

const filters = {
  status: '',
  definitionId: '',
  priority: '',
  slaState: '',
  search: '',
  sort: 'priorityScore:desc',
  page: 1,
  pageSize: 25
};

export async function render() {
  const node = el('div.view');
  const overviewHost = el('div');
  const boardHost = el('div', {}, [loading('Loading workflows…')]);

  let definitions = [];

  node.append(
    pageHeader({
      title: 'Workflows',
      subtitle:
        'Every document is instantiated into the workflow that owns its business process. Steps completed by agents are pre-filled; only genuine exceptions reach a person.',
      icon: 'workflow',
      actions: [
        el('button.btn.btn--ghost', {
          type: 'button',
          text: 'Refresh',
          on: { click: () => void paintAll() }
        })
      ]
    }),
    overviewHost,
    boardHost
  );

  function filterBar() {
    const searchInput = el('input', {
      id: 'workflow-search',
      type: 'search',
      value: filters.search,
      placeholder: 'Search file, workflow, step or assignee…',
      'aria-label': 'Search workflows'
    });
    let timer = null;
    searchInput.addEventListener('input', (event) => {
      const value = event.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        filters.search = value;
        filters.page = 1;
        void paintBoard();
      }, 280);
    });

    return el('div.filter-bar', {}, [
      el('div.field.field--grow', {}, [
        el('label', { text: 'Search', htmlFor: 'workflow-search' }),
        searchInput
      ]),
      select({
        id: 'workflow-status',
        label: 'Status',
        value: filters.status,
        options: [
          { value: '', label: 'All statuses' },
          { value: 'active', label: 'Active' },
          { value: 'on-hold', label: 'On hold' },
          { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' }
        ],
        onChange: (value) => {
          filters.status = value;
          filters.page = 1;
          void paintBoard();
        }
      }),
      select({
        id: 'workflow-definition',
        label: 'Workflow',
        value: filters.definitionId,
        options: [
          { value: '', label: 'All workflows' },
          ...definitions.map((definition) => ({ value: definition.id, label: definition.name }))
        ],
        onChange: (value) => {
          filters.definitionId = value;
          filters.page = 1;
          void paintBoard();
        }
      }),
      select({
        id: 'workflow-priority',
        label: 'Priority',
        value: filters.priority,
        options: [
          { value: '', label: 'All priorities' },
          { value: 'critical', label: 'Critical' },
          { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' },
          { value: 'low', label: 'Low' }
        ],
        onChange: (value) => {
          filters.priority = value;
          filters.page = 1;
          void paintBoard();
        }
      }),
      select({
        id: 'workflow-sla',
        label: 'SLA',
        value: filters.slaState,
        options: [
          { value: '', label: 'Any SLA state' },
          { value: 'breached', label: 'Breached' },
          { value: 'at-risk', label: 'At risk' },
          { value: 'on-track', label: 'On track' },
          { value: 'closed', label: 'Closed' }
        ],
        onChange: (value) => {
          filters.slaState = value;
          filters.page = 1;
          void paintBoard();
        }
      }),
      select({
        id: 'workflow-sort',
        label: 'Sort by',
        value: filters.sort,
        options: [
          { value: 'priorityScore:desc', label: 'Priority (highest first)' },
          { value: 'priorityScore:asc', label: 'Priority (lowest first)' },
          { value: 'slaDueAt:asc', label: 'SLA due (soonest first)' },
          { value: 'createdAt:desc', label: 'Newest first' },
          { value: 'createdAt:asc', label: 'Oldest first' },
          { value: 'progress:desc', label: 'Most progressed' }
        ],
        onChange: (value) => {
          filters.sort = value;
          filters.page = 1;
          void paintBoard();
        }
      }),
      el('button.btn.btn--ghost', {
        type: 'button',
        text: 'Clear',
        on: {
          click: () => {
            filters.status = '';
            filters.definitionId = '';
            filters.priority = '';
            filters.slaState = '';
            filters.search = '';
            filters.sort = 'priorityScore:desc';
            filters.page = 1;
            void paintBoard();
          }
        }
      })
    ]);
  }

  async function paintOverview() {
    try {
      const overview = await api.workflowOverview();
      overviewHost.replaceChildren(
        el('div.grid.grid--kpi.stagger', {}, [
          kpi({
            label: 'Active workflows',
            value: formatNumber(overview.active),
            hint: `${formatNumber(overview.total)} instantiated in total`,
            icon: 'workflow'
          }),
          kpi({
            label: 'SLA breached',
            value: formatNumber(overview.breached),
            hint: `${formatNumber(overview.atRisk)} at risk within 4 hours`,
            tone: overview.breached > 0 ? 'bad' : 'good',
            icon: 'clock'
          }),
          kpi({
            label: 'Step automation',
            value: formatPercent((overview.automationRate ?? 0) * 100),
            hint: `${formatNumber(overview.completed)} workflow(s) completed`,
            tone: overview.automationRate >= 0.5 ? 'good' : 'warn',
            icon: 'bolt'
          }),
          kpi({
            label: 'Average progress',
            value: formatPercent((overview.averageProgress ?? 0) * 100),
            hint: `${formatNumber(overview.critical)} critical item(s) open`,
            icon: 'gauge'
          })
        ]),
        card({
          title: 'Queues by owner',
          subtitle: 'Where the work currently sits.',
          icon: 'users',
          tone: 'violet',
          flush: true,
          body: dataTable(
            [
              { label: 'Queue / role' },
              { label: 'Open items', numeric: true },
              { label: 'Breached', numeric: true },
              { label: 'Critical', numeric: true }
            ],
            (overview.queues ?? []).map((queue) => [
              el('strong', { text: queue.role }),
              formatNumber(queue.count),
              queue.breached > 0
                ? el('span.badge.badge--danger', { text: String(queue.breached) })
                : el('span', { text: '0' }),
              formatNumber(queue.critical)
            ]),
            { emptyMessage: 'No open queues — every workflow is closed.', label: 'Open workflow queues' }
          )
        }),
        card({
          title: 'Workflow definitions',
          subtitle: `${(overview.definitions ?? []).length} processes modelled end-to-end.`,
          icon: 'route',
          tone: 'teal',
          flush: true,
          body: dataTable(
            [
              { label: 'Workflow' },
              { label: 'Owner' },
              { label: 'Steps', numeric: true },
              { label: 'Instances', numeric: true },
              { label: 'Active', numeric: true },
              { label: 'Completed', numeric: true },
              { label: 'SLA' }
            ],
            (overview.definitions ?? []).map((definition) => [
              el('strong', { text: definition.name }),
              definition.owner,
              formatNumber(definition.stepCount),
              formatNumber(definition.total),
              formatNumber(definition.active),
              formatNumber(definition.completed),
              `${definition.slaHours} h`
            ]),
            { emptyMessage: 'No workflow definitions are registered.', label: 'Workflow definitions' }
          )
        })
      );
    } catch {
      overviewHost.replaceChildren(
        card({
          title: 'Workflow overview unavailable',
          icon: 'alert',
          tone: 'crimson',
          body: el('p', { text: 'The workflow overview could not be loaded. Use Refresh to try again.' })
        })
      );
    }
  }

  async function paintBoard() {
    let result;
    try {
      result = await api.listWorkflows({
        status: filters.status,
        definitionId: filters.definitionId,
        priority: filters.priority,
        slaState: filters.slaState,
        search: filters.search,
        sort: filters.sort,
        page: filters.page,
        pageSize: filters.pageSize
      });
    } catch {
      boardHost.replaceChildren(
        card({
          title: 'Workflows unavailable',
          icon: 'alert',
          tone: 'crimson',
          body: el('p', { text: 'The workflow list could not be loaded. Use Refresh to try again.' })
        })
      );
      return;
    }

    const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

    const body =
      result.items.length === 0
        ? emptyState(
            'No workflows match these filters',
            'Adjust or clear the filters, or ingest documents to create new workflow instances.',
            el('a.btn.btn--primary', { href: '#/ingest', text: 'Ingest documents' }),
            'workflow'
          )
        : dataTable(
            [
              { label: 'Priority' },
              { label: 'Document' },
              { label: 'Workflow' },
              { label: 'Current step' },
              { label: 'Assignee' },
              { label: 'Progress' },
              { label: 'SLA' },
              { label: 'Status' },
              { label: 'Updated' }
            ],
            result.items.map((item) => [
              el(`span.badge.badge--${PRIORITY_VARIANT[item.priority] ?? 'neutral'}`, {
                text: `${item.priority} · ${item.priorityScore}`
              }),
              el('strong', { text: item.fileName ?? item.documentId }),
              el('span', { text: item.definitionName }),
              el('span', { text: item.currentStepName ?? '—' }),
              el('span', { text: item.assignee ?? '—' }),
              el('div.progress-cell', {}, [
                el('div.progress', {}, [
                  el('div.progress__bar', { style: `width:${Math.round(item.progress * 100)}%` })
                ]),
                el('span.progress__label', { text: `${item.completedSteps}/${item.stepCount}` })
              ]),
              el(`span.badge.badge--${SLA_VARIANT[item.slaState] ?? 'neutral'}`, { text: item.slaState }),
              el(`span.badge.badge--${STATUS_VARIANT[item.status] ?? 'neutral'}`, { text: item.status }),
              relativeTime(item.updatedAt)
            ]),
            {
              emptyMessage: 'No workflows match these filters.',
              label: 'Workflow instances',
              onRowClick: (index) => {
                location.hash = `#/workflows/${encodeURIComponent(result.items[index].documentId)}`;
              }
            }
          );

    boardHost.replaceChildren(
      card({
        title: 'Workflow board',
        subtitle: `${formatNumber(result.total)} workflow instance(s) · page ${result.page} of ${totalPages}`,
        icon: 'tasks',
        tone: 'navy',
        actions: [
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Previous',
            disabled: result.page <= 1 ? 'disabled' : null,
            on: {
              click: () => {
                if (filters.page > 1) {
                  filters.page -= 1;
                  void paintBoard();
                }
              }
            }
          }),
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Next',
            disabled: result.page >= totalPages ? 'disabled' : null,
            on: {
              click: () => {
                if (filters.page < totalPages) {
                  filters.page += 1;
                  void paintBoard();
                }
              }
            }
          })
        ],
        body: [filterBar(), body]
      })
    );
  }

  async function paintAll() {
    try {
      const definitionResult = await api.workflowDefinitions();
      definitions = definitionResult.items ?? [];
    } catch {
      definitions = [];
    }
    await Promise.all([paintOverview(), paintBoard()]);
  }

  await paintAll();

  const onRefresh = () => void paintAll();
  window.addEventListener('vgc:refresh-view', onRefresh);

  return { node, cleanup: () => window.removeEventListener('vgc:refresh-view', onRefresh) };
}

export { formatDateTime };
