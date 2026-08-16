/**
 * Workflow detail — step timeline, agent evidence, SLA and the action panel.
 */
import { api } from '../api.js';
import { icon } from '../icons.js';
import { el, formatDateTime, formatDuration, formatPercent, relativeTime, toast } from '../util.js';
import { card, dataTable, loading, pageHeader, select } from './common.js';

const STEP_VARIANT = Object.freeze({
  completed: 'success',
  skipped: 'neutral',
  'in-progress': 'info',
  pending: 'neutral',
  rejected: 'danger',
  blocked: 'warn'
});
const PRIORITY_VARIANT = Object.freeze({ critical: 'danger', high: 'danger', medium: 'warn', low: 'neutral' });
const SLA_VARIANT = Object.freeze({ breached: 'danger', 'at-risk': 'warn', 'on-track': 'success', closed: 'neutral' });

const ACTION_OPTIONS = Object.freeze([
  { value: 'approve', label: 'Approve current step' },
  { value: 'complete', label: 'Complete current step' },
  { value: 'reject', label: 'Reject' },
  { value: 'hold', label: 'Put on hold' },
  { value: 'resume', label: 'Resume' },
  { value: 'reassign', label: 'Reassign' },
  { value: 'escalate', label: 'Escalate' },
  { value: 'comment', label: 'Add comment only' },
  { value: 'cancel', label: 'Cancel workflow' }
]);

export async function render({ id }) {
  const node = el('div.view');
  const host = el('div', {}, [loading('Loading workflow…')]);
  node.append(host);

  const form = { action: 'approve', actor: 'operations.user@vgc.com', note: '', assignee: '' };

  async function paint() {
    let workflow;
    try {
      workflow = await api.getWorkflow(id);
    } catch (error) {
      host.replaceChildren(
        card({
          title: 'Workflow not found',
          icon: 'alert',
          tone: 'crimson',
          body: [
            el('p', { text: error?.message ?? 'This document does not have a workflow instance.' }),
            el('a.btn.btn--primary', { href: '#/workflows', text: 'Back to workflows' })
          ]
        })
      );
      return;
    }

    const closed = ['completed', 'cancelled'].includes(workflow.status);

    const timeline = el(
      'ol.timeline',
      {},
      workflow.steps.map((step) =>
        el(`li.timeline__item.timeline__item--${step.status}`, {}, [
          el('div.timeline__marker', {}, [
            icon(step.status === 'completed' ? 'check' : step.status === 'rejected' ? 'close' : 'clock', { size: 12 })
          ]),
          el('div.timeline__body', {}, [
            el('div.timeline__head', {}, [
              el('strong', { text: step.name }),
              el(`span.badge.badge--${STEP_VARIANT[step.status] ?? 'neutral'}`, { text: step.status }),
              el('span.chip', { text: step.type })
            ]),
            el('p.timeline__desc', { text: step.exitCriteria }),
            step.evidence ? el('p.timeline__evidence', { text: step.evidence }) : null,
            el('div.timeline__meta', {}, [
              el('span', { text: `Owner: ${step.role}` }),
              step.actor ? el('span', { text: `By: ${step.actor}` }) : null,
              step.completedAt ? el('span', { text: `Completed ${relativeTime(step.completedAt)}` }) : null,
              step.durationMs !== null && step.durationMs !== undefined
                ? el('span', { text: formatDuration(step.durationMs) })
                : null,
              step.note ? el('span', { text: `Note: ${step.note}` }) : null
            ])
          ])
        ])
      )
    );

    const actorInput = el('input', {
      id: 'wf-actor',
      type: 'text',
      value: form.actor,
      maxlength: '80',
      'aria-describedby': 'wf-actor-help'
    });
    actorInput.addEventListener('input', (event) => {
      form.actor = event.target.value;
      actorError.textContent = '';
    });

    const noteInput = el('textarea', { id: 'wf-note', rows: '3', maxlength: '600', placeholder: 'Optional decision note…' });
    noteInput.value = form.note;
    noteInput.addEventListener('input', (event) => {
      form.note = event.target.value;
    });

    const assigneeField = el('div.field', {}, [
      el('label', { text: 'Reassign to', htmlFor: 'wf-assignee' }),
      (() => {
        const input = el('input', { id: 'wf-assignee', type: 'text', value: form.assignee, maxlength: '80', placeholder: 'e.g. ap.lead@vgc.com' });
        input.addEventListener('input', (event) => {
          form.assignee = event.target.value;
          assigneeError.textContent = '';
        });
        return input;
      })()
    ]);
    const assigneeError = el('p.field__error', { id: 'wf-assignee-error', role: 'alert' });
    assigneeField.append(assigneeError);
    assigneeField.hidden = form.action !== 'reassign';

    const actorError = el('p.field__error', { id: 'wf-actor-error', role: 'alert' });

    const submit = el('button.btn.btn--primary', { type: 'submit', text: 'Apply action' });

    const actionForm = el('form.stack', {
      on: {
        submit: async (event) => {
          event.preventDefault();
          actorError.textContent = '';
          assigneeError.textContent = '';

          if (!form.actor.trim()) {
            actorError.textContent = 'An actor is required so the decision is attributable.';
            actorInput.focus();
            return;
          }
          if (form.action === 'reassign' && !form.assignee.trim()) {
            assigneeError.textContent = 'Provide the queue or person to reassign to.';
            return;
          }

          submit.disabled = true;
          submit.textContent = 'Applying…';
          try {
            await api.workflowAction(workflow.documentId, {
              action: form.action,
              actor: form.actor.trim(),
              note: form.note.trim() || undefined,
              assignee: form.assignee.trim() || undefined
            });
            toast(`Workflow action "${form.action}" applied.`, 'success');
            form.note = '';
            form.assignee = '';
            await paint();
          } catch (error) {
            toast(error?.message ?? 'The workflow action could not be applied.', 'error');
            submit.disabled = false;
            submit.textContent = 'Apply action';
          }
        }
      }
    }, [
      select({
        id: 'wf-action',
        label: 'Action',
        value: form.action,
        options: ACTION_OPTIONS,
        onChange: (value) => {
          form.action = value;
          assigneeField.hidden = value !== 'reassign';
        }
      }),
      el('div.field', {}, [el('label', { text: 'Actor', htmlFor: 'wf-actor' }), actorInput, actorError,
        el('p.field__help', { id: 'wf-actor-help', text: 'Recorded on the audit trail against this transition.' })]),
      assigneeField,
      el('div.field', {}, [el('label', { text: 'Note', htmlFor: 'wf-note' }), noteInput]),
      el('div.form-actions', {}, [submit])
    ]);

    host.replaceChildren(
      ...[
      pageHeader({
        title: workflow.definitionName,
        subtitle: `${workflow.document.fileName} · ${workflow.document.typeName} · ${workflow.process}`,
        icon: 'workflow',
        actions: [
          el('a.btn.btn--ghost', { href: '#/workflows', text: 'All workflows' }),
          el('a.btn.btn--ghost', {
            href: `#/documents/${encodeURIComponent(workflow.documentId)}`,
            text: 'Open document'
          })
        ]
      }),
      card({
        title: 'Status',
        icon: 'gauge',
        tone: 'navy',
        body: el('div.meta-grid', {}, [
          metaItem('Workflow status', workflow.status),
          metaItem('Current step', workflow.currentStepName ?? '—'),
          metaItem('Assignee', workflow.assignee ?? '—'),
          metaBadge('Priority', workflow.priority, PRIORITY_VARIANT[workflow.priority] ?? 'neutral'),
          metaItem('Priority score', String(workflow.priorityScore)),
          metaBadge('SLA', workflow.slaState, SLA_VARIANT[workflow.slaState] ?? 'neutral'),
          metaItem('SLA due', formatDateTime(workflow.slaDueAt)),
          metaItem(
            'Accuracy',
            workflow.document.accuracyScore === null ? '—' : formatPercent(workflow.document.accuracyScore * 100)
          ),
          metaItem('Rule errors', String(workflow.document.validationErrors)),
          metaItem('Created', relativeTime(workflow.createdAt))
        ])
      }),
      card({
        title: 'Why this priority',
        subtitle: 'Every driver that raised or lowered the ranking of this item.',
        icon: 'target',
        tone: 'amber',
        body:
          (workflow.priorityReasons ?? []).length === 0
            ? el('p.muted', { text: 'No escalating factors — this item is queued at its baseline priority.' })
            : el('ul.bullets', {}, workflow.priorityReasons.map((reason) => el('li', { text: reason })))
      }),
      card({
        title: 'Step timeline',
        subtitle: `${workflow.steps.filter((step) => step.status === 'completed' || step.status === 'skipped').length} of ${workflow.stepCount} step(s) settled.`,
        icon: 'tasks',
        tone: 'teal',
        body: timeline
      }),
      closed
        ? card({
            title: 'Workflow closed',
            icon: 'checkCircle',
            tone: 'jade',
            body: el('p', {
              text: `This workflow is ${workflow.status}. Only comments can be added to a closed workflow.`
            })
          })
        : null,
      card({
        title: 'Take action',
        subtitle: 'Transitions are validated server-side and written to the audit trail.',
        icon: 'edit',
        tone: 'violet',
        body: actionForm
      }),
      card({
        title: 'Audit history',
        subtitle: 'Every transition, with actor and note.',
        icon: 'history',
        tone: 'navy',
        flush: true,
        body: dataTable(
          [{ label: 'When' }, { label: 'Action' }, { label: 'Step' }, { label: 'Actor' }, { label: 'Note' }],
          (workflow.history ?? [])
            .slice()
            .reverse()
            .map((entry) => [
              formatDateTime(entry.at),
              el('span.badge.badge--info', { text: entry.action }),
              entry.stepName ?? '—',
              entry.actor,
              entry.note ?? '—'
            ]),
          { emptyMessage: 'No transitions have been recorded yet.', label: 'Workflow transitions' }
        )
      })
      ].filter(Boolean)
    );
  }

  function metaItem(label, value) {
    return el('div.meta-item', {}, [
      el('span.meta-item__label', { text: label }),
      el('span.meta-item__value', { text: String(value) })
    ]);
  }

  function metaBadge(label, value, variant) {
    return el('div.meta-item', {}, [
      el('span.meta-item__label', { text: label }),
      el(`span.badge.badge--${variant}`, { text: String(value) })
    ]);
  }

  await paint();

  const onRefresh = () => void paint();
  window.addEventListener('vgc:refresh-view', onRefresh);
  return { node, cleanup: () => window.removeEventListener('vgc:refresh-view', onRefresh) };
}
