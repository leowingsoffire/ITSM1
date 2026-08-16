/**
 * Agent Mesh — topology, live run traces and per-agent evidence.
 */
import { api } from '../api.js';
import { icon } from '../icons.js';
import { el, formatDuration, formatNumber, formatPercent, relativeTime, toast } from '../util.js';
import { card, dataTable, emptyState, kpi, loading, pageHeader } from './common.js';

const LEVEL_VARIANT = Object.freeze({ error: 'danger', warn: 'warn', info: 'info' });
const ROLE_TONE = Object.freeze({
  perception: 'teal',
  reasoning: 'violet',
  verification: 'amber',
  orchestration: 'navy'
});

export async function render() {
  const node = el('div.view');
  const host = el('div', {}, [loading('Loading the agent mesh…')]);
  node.append(
    pageHeader({
      title: 'Agent Mesh',
      subtitle:
        'Eleven specialist agents cooperate over every document. Agents run in dependency waves — anything in the same wave executes concurrently.',
      icon: 'agents',
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Refresh', on: { click: () => void paint() } })
      ]
    }),
    host
  );

  let selectedAgentId = null;
  const detailHost = el('div');
  /** @type {Map<string, HTMLButtonElement>} */
  const agentButtons = new Map();

  function highlightSelection() {
    for (const [agentId, button] of agentButtons) {
      const active = agentId === selectedAgentId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  async function paintDetail(agentId) {
    selectedAgentId = agentId;
    highlightSelection();
    detailHost.replaceChildren(loading('Loading agent evidence…'));
    let detail;
    try {
      detail = await api.getAgent(agentId);
    } catch {
      detailHost.replaceChildren(
        card({ title: 'Agent unavailable', icon: 'alert', tone: 'crimson', body: el('p', { text: 'This agent could not be loaded.' }) })
      );
      return;
    }

    const agent = detail.agent;
    detailHost.replaceChildren(
      card({
        title: `${agent.name}`,
        subtitle: agent.mission,
        icon: agent.icon,
        tone: ROLE_TONE[agent.role] ?? 'navy',
        body: [
          el('div.meta-grid', {}, [
            metaItem('Role', agent.role),
            metaItem('Pipeline stage', agent.stage),
            metaItem('Depends on', agent.dependsOn.length > 0 ? agent.dependsOn.join(', ') : 'nothing — entry point'),
            metaItem('Feeds', detail.dependents.length > 0 ? detail.dependents.join(', ') : 'terminal agent'),
            metaItem('Executions observed', formatNumber(detail.executions)),
            metaItem(
              'Mean confidence',
              detail.averageConfidence === null ? '—' : formatPercent(detail.averageConfidence * 100)
            )
          ]),
          el('h3.section-title', { text: 'Capabilities' }),
          el('ul.bullets', {}, agent.capabilities.map((entry) => el('li', { text: entry }))),
          el('h3.section-title', { text: 'Tools' }),
          el('div.chip-row', {}, agent.tools.map((tool) => el('span.chip', { text: tool }))),
          el('h3.section-title', { text: 'Recent evidence' }),
          detail.recent.length === 0
            ? el('p.muted', { text: 'This agent has not run yet. Ingest a document to generate evidence.' })
            : dataTable(
                [
                  { label: 'Document' },
                  { label: 'Type' },
                  { label: 'Outcome' },
                  { label: 'Confidence', numeric: true },
                  { label: 'Duration', numeric: true },
                  { label: 'When' }
                ],
                detail.recent.map((entry) => [
                  el('strong', { text: entry.fileName }),
                  entry.typeName,
                  el('span', { text: entry.summary }),
                  entry.confidence === null ? '—' : formatPercent(entry.confidence * 100),
                  formatDuration(entry.durationMs),
                  relativeTime(entry.at)
                ]),
                {
                  label: 'Recent agent activity',
                  onRowClick: (index) => {
                    location.hash = `#/documents/${encodeURIComponent(detail.recent[index].documentId)}`;
                  }
                }
              )
        ]
      })
    );
  }

  async function paint() {
    let mesh;
    let runs;
    try {
      [mesh, runs] = await Promise.all([api.listAgents(), api.agentRuns(30)]);
    } catch {
      host.replaceChildren(
        card({
          title: 'Agent mesh unavailable',
          icon: 'alert',
          tone: 'crimson',
          body: el('p', { text: 'The agent mesh could not be loaded. Use Refresh to try again.' })
        })
      );
      return;
    }

    agentButtons.clear();
    const waveGrid = el(
      'div.wave-grid',
      {},
      mesh.waves.map((wave) =>
        el('div.wave', {}, [
          el('div.wave__label', {}, [
            el('span.wave__index', { text: `Wave ${wave.index}` }),
            el('span.wave__hint', {
              text: wave.agentIds.length > 1 ? `${wave.agentIds.length} agents in parallel` : 'sequential'
            })
          ]),
          el(
            'div.wave__agents',
            {},
            wave.agentIds.map((agentId) => {
              const agent = mesh.agents.find((candidate) => candidate.id === agentId);
              const button = el(
                `button.agent-node.agent-node--${agent.role}${selectedAgentId === agentId ? '.is-active' : ''}`,
                {
                  type: 'button',
                  'aria-pressed': selectedAgentId === agentId ? 'true' : 'false',
                  on: { click: () => void paintDetail(agentId) }
                },
                [
                  el('span.agent-node__icon', {}, [icon(agent.icon, { size: 16 })]),
                  el('span.agent-node__text', {}, [
                    el('span.agent-node__name', { text: agent.name }),
                    el('span.agent-node__role', { text: agent.role })
                  ])
                ]
              );
              agentButtons.set(agentId, button);
              return button;
            })
          )
        ])
      )
    );

    host.replaceChildren(
      el('div.grid.grid--kpi.stagger', {}, [
        kpi({ label: 'Agents in the mesh', value: formatNumber(mesh.total), hint: 'Specialists with distinct missions', icon: 'agents' }),
        kpi({
          label: 'Execution waves',
          value: formatNumber(mesh.waveCount),
          hint: `${mesh.parallelism} agents per wave on average`,
          icon: 'network'
        }),
        kpi({
          label: 'Runs recorded',
          value: formatNumber(runs.total),
          hint: runs.averageDurationMs === null ? 'No runs yet' : `${formatDuration(runs.averageDurationMs)} average`,
          icon: 'history'
        }),
        kpi({
          label: 'Straight-through',
          value: runs.total === 0 ? '—' : formatPercent((runs.straightThroughCount / runs.total) * 100),
          hint: `${formatNumber(runs.failedCount)} failed run(s)`,
          tone: runs.failedCount > 0 ? 'warn' : 'good',
          icon: 'bolt'
        })
      ]),
      card({
        title: 'Execution topology',
        subtitle: 'Select an agent to inspect its mission, tools and the evidence it produced.',
        icon: 'network',
        tone: 'violet',
        body: waveGrid
      }),
      detailHost,
      card({
        title: 'Recent orchestration runs',
        subtitle: 'One run per document, newest first.',
        icon: 'history',
        tone: 'teal',
        flush: true,
        body:
          runs.items.length === 0
            ? emptyState(
                'No orchestration runs yet',
                'Ingest a document and the mesh will record every agent hand-off here.',
                el('a.btn.btn--primary', { href: '#/ingest', text: 'Ingest documents' }),
                'agents'
              )
            : dataTable(
                [
                  { label: 'Document' },
                  { label: 'Type' },
                  { label: 'Disposition' },
                  { label: 'Agents', numeric: true },
                  { label: 'Waves', numeric: true },
                  { label: 'Consensus', numeric: true },
                  { label: 'Findings' },
                  { label: 'Duration', numeric: true },
                  { label: 'When' }
                ],
                runs.items.map((run) => [
                  el('strong', { text: run.fileName ?? run.documentId }),
                  run.typeName ?? '—',
                  el(`span.badge.badge--${run.status === 'failed' ? 'danger' : run.disposition === 'straight-through' ? 'success' : 'warn'}`, {
                    text: run.status === 'failed' ? 'failed' : (run.disposition ?? '—')
                  }),
                  formatNumber(run.agentCount),
                  formatNumber(run.waveCount),
                  run.consensus === null ? '—' : formatPercent(run.consensus * 100),
                  el('span.chip-row', {}, [
                    el('span.badge.badge--danger', { text: `${run.findingCounts.error} err` }),
                    el('span.badge.badge--warn', { text: `${run.findingCounts.warn} warn` }),
                    el('span.badge.badge--info', { text: `${run.findingCounts.info} info` })
                  ]),
                  formatDuration(run.durationMs),
                  relativeTime(run.completedAt)
                ]),
                {
                  label: 'Orchestration runs',
                  onRowClick: (index) => {
                    location.hash = `#/documents/${encodeURIComponent(runs.items[index].documentId)}`;
                  }
                }
              )
      })
    );

    if (selectedAgentId) await paintDetail(selectedAgentId);
  }

  function metaItem(label, value) {
    return el('div.meta-item', {}, [
      el('span.meta-item__label', { text: label }),
      el('span.meta-item__value', { text: String(value) })
    ]);
  }

  await paint();

  const onRefresh = () => void paint();
  window.addEventListener('vgc:refresh-view', onRefresh);
  return { node, cleanup: () => window.removeEventListener('vgc:refresh-view', onRefresh) };
}

export { LEVEL_VARIANT };
