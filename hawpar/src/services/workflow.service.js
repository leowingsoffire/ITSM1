/**
 * Workflow engine.
 *
 * Instantiates the process definition chosen by the routing agent, completes the
 * steps the agent mesh actually performed (with their machine evidence), and
 * then drives the remaining human and integration steps through an auditable set
 * of transitions.
 *
 * Instances live on the document record, so they inherit the store's persistence
 * and eviction behaviour and can never drift out of sync with the document.
 */
import {
  Priority,
  StepStatus,
  StepType,
  WORKFLOW_DEFINITIONS,
  WorkflowStatus,
  definitionForProcess,
  getWorkflowDefinition
} from '../domain/workflows.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { DocumentStatus, appendAudit, getDocument, listAllDocuments, updateDocument } from './store.service.js';

const HOUR_MS = 3600000;
const MAX_NOTE_LENGTH = 500;
const MAX_ACTOR_LENGTH = 80;

export const WorkflowAction = Object.freeze({
  COMPLETE: 'complete',
  APPROVE: 'approve',
  REJECT: 'reject',
  HOLD: 'hold',
  RESUME: 'resume',
  REASSIGN: 'reassign',
  ESCALATE: 'escalate',
  COMMENT: 'comment',
  CANCEL: 'cancel'
});

const ACTIONS = new Set(Object.values(WorkflowAction));

/* ── Priority ────────────────────────────────────────────────────────────── */

/**
 * Priority is derived, never guessed: exposure (monetary value), assurance risk,
 * rule breaches and process urgency each contribute to a 0–100 score.
 */
export function scorePriority({ record, accuracy, validation, definition }) {
  let score = 20;
  const reasons = [];

  const errorCount = validation?.errorCount ?? 0;
  if (errorCount > 0) {
    score += Math.min(30, errorCount * 12);
    reasons.push(`${errorCount} business rule error(s)`);
  }

  const conflicts = accuracy?.conflictCount ?? 0;
  if (conflicts > 0) {
    score += Math.min(25, conflicts * 10);
    reasons.push(`${conflicts} field conflict(s)`);
  }

  // A document that contradicts its own arithmetic is an exception even when the
  // transcription is perfect, so integrity disputes carry their own weight.
  const integrityIssues = accuracy?.integrityIssueCount ?? 0;
  if (integrityIssues > 0) {
    score += Math.min(22, integrityIssues * 9);
    reasons.push(`${integrityIssues} document integrity dispute(s)`);
  }

  if (accuracy && accuracy.criticalCoverage < 1) {
    score += 18;
    reasons.push('critical field missing');
  }

  const amountField = (record.fields ?? []).find(
    (field) => field.type === 'currency' && /total|amount|value|rent|claim/i.test(field.key)
  );
  const amount = typeof amountField?.value === 'number' ? amountField.value : 0;
  if (amount >= 100000) {
    score += 20;
    reasons.push('high monetary exposure');
  } else if (amount >= 20000) {
    score += 10;
    reasons.push('material monetary value');
  }

  if ((definition?.slaHours ?? 24) <= 12) {
    score += 8;
    reasons.push('short process SLA');
  }

  if (accuracy?.straightThroughEligible) {
    score -= 15;
    reasons.push('straight-through eligible');
  }

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  const level =
    bounded >= 75 ? Priority.CRITICAL : bounded >= 55 ? Priority.HIGH : bounded >= 30 ? Priority.NORMAL : Priority.LOW;

  return { score: bounded, level, reasons };
}

/* ── Instantiation ───────────────────────────────────────────────────────── */

const nowIso = () => new Date().toISOString();

function buildStep(definitionStep, index) {
  return {
    index,
    id: definitionStep.id,
    name: definitionStep.name,
    type: definitionStep.type,
    role: definitionStep.role,
    slaHours: definitionStep.slaHours,
    exitCriteria: definitionStep.exitCriteria,
    status: StepStatus.PENDING,
    startedAt: null,
    completedAt: null,
    actor: null,
    durationMs: null,
    evidence: null,
    note: null
  };
}

/**
 * Creates a workflow instance and immediately settles every automated step using
 * the evidence produced by the agent run.
 *
 * @param {object} input
 * @param {object} input.record        document record (post-pipeline)
 * @param {object} input.accuracy      accuracy report
 * @param {object} input.validation    validation result
 * @param {object} input.classification
 * @param {object} input.agentRun      orchestration run
 * @param {boolean} input.needsReview
 */
export function instantiateWorkflow({ record, accuracy, validation, classification, agentRun, needsReview }) {
  const definition = definitionForProcess(classification?.process ?? 'Manual Triage');
  const priority = scorePriority({ record, accuracy, validation, definition });
  const createdAt = nowIso();

  const steps = definition.steps.map(buildStep);
  const evidenceFor = (stepId) => {
    switch (stepId) {
      case 'capture':
        return `${record.fileName} accepted · SHA-256 ${String(record.checksum ?? '').slice(0, 12)}… · ${record.pageCount ?? 0} page(s).`;
      case 'analyse':
        return `${agentRun?.analysis?.modelId ?? record.modelId ?? 'analyser'} produced ${record.pageCount ?? 0} normalised page(s) with ${Math.round((record.quality?.averageOcrConfidence ?? 0) * 100)}% mean OCR confidence.`;
      case 'assure':
        return `${accuracy?.checksRun ?? 0} assurance checks across ${accuracy?.fieldCount ?? 0} field(s); accuracy score ${(100 * (accuracy?.accuracyScore ?? 0)).toFixed(1)}%.`;
      default: {
        const agentStep = (agentRun?.steps ?? []).find((entry) => entry.workflowStepId === stepId);
        if (agentStep) return agentStep.summary;
        return `${validation?.rulesEvaluated ?? 0} rule(s) evaluated · ${validation?.errorCount ?? 0} error(s), ${validation?.warningCount ?? 0} warning(s).`;
      }
    }
  };

  let cursor = 0;
  for (const stepEntry of steps) {
    if (stepEntry.type !== StepType.AUTOMATED) break;
    stepEntry.status = StepStatus.COMPLETED;
    stepEntry.startedAt = createdAt;
    stepEntry.completedAt = createdAt;
    stepEntry.actor = stepEntry.role;
    stepEntry.durationMs = 0;
    stepEntry.evidence = evidenceFor(stepEntry.id);
    cursor += 1;
  }

  // A clean, straight-through document does not need a human to look at it: the
  // review step is skipped with its evidence recorded, exactly as a rules-based
  // auto-approval would be minuted.
  if (!needsReview && steps[cursor] && steps[cursor].type === StepType.HUMAN) {
    steps[cursor].status = StepStatus.SKIPPED;
    steps[cursor].startedAt = createdAt;
    steps[cursor].completedAt = createdAt;
    steps[cursor].actor = 'Accuracy agent';
    steps[cursor].evidence = 'Straight-through processed: no field required human intervention.';
    cursor += 1;
  }

  const current = steps[cursor] ?? null;
  if (current) {
    current.status = StepStatus.IN_PROGRESS;
    current.startedAt = createdAt;
  }

  const slaDueAt = new Date(Date.now() + definition.slaHours * HOUR_MS).toISOString();

  return {
    id: `wf_${record.id.replace(/^doc_/, '')}`,
    documentId: record.id,
    definitionId: definition.id,
    definitionName: definition.name,
    process: definition.process,
    owner: definition.owner,
    description: definition.description,
    status: current ? WorkflowStatus.ACTIVE : WorkflowStatus.COMPLETED,
    currentStepIndex: current ? cursor : steps.length - 1,
    currentStepId: current?.id ?? null,
    currentStepName: current?.name ?? null,
    assignee: current?.role ?? null,
    priority: priority.level,
    priorityScore: priority.score,
    priorityReasons: priority.reasons,
    createdAt,
    updatedAt: createdAt,
    completedAt: current ? null : createdAt,
    slaHours: definition.slaHours,
    slaDueAt,
    stepCount: steps.length,
    automatedStepCount: steps.filter((entry) => entry.type === StepType.AUTOMATED).length,
    steps,
    history: [
      {
        at: createdAt,
        actor: 'Routing agent',
        action: 'started',
        detail: `Routed to "${definition.name}" (${definition.process}); priority ${priority.level}.`
      }
    ]
  };
}

/* ── Derived state ───────────────────────────────────────────────────────── */

export function slaState(workflow, at = Date.now()) {
  if (!workflow) return 'none';
  if (workflow.status === WorkflowStatus.COMPLETED || workflow.status === WorkflowStatus.CANCELLED) return 'closed';
  const due = new Date(workflow.slaDueAt).getTime();
  if (!Number.isFinite(due)) return 'none';
  const remaining = due - at;
  if (remaining < 0) return 'breached';
  if (remaining < 4 * HOUR_MS) return 'at-risk';
  return 'on-track';
}

export function workflowSummary(workflow, record) {
  if (!workflow) return null;
  const completed = workflow.steps.filter((entry) =>
    [StepStatus.COMPLETED, StepStatus.SKIPPED].includes(entry.status)
  ).length;

  return {
    id: workflow.id,
    documentId: workflow.documentId,
    fileName: record?.fileName ?? null,
    typeName: record?.classification?.typeName ?? 'Unclassified',
    definitionId: workflow.definitionId,
    definitionName: workflow.definitionName,
    process: workflow.process,
    owner: workflow.owner,
    status: workflow.status,
    currentStepId: workflow.currentStepId,
    currentStepName: workflow.currentStepName,
    assignee: workflow.assignee,
    priority: workflow.priority,
    priorityScore: workflow.priorityScore,
    progress: workflow.stepCount > 0 ? Number((completed / workflow.stepCount).toFixed(3)) : 0,
    completedSteps: completed,
    stepCount: workflow.stepCount,
    slaDueAt: workflow.slaDueAt,
    slaState: slaState(workflow),
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    completedAt: workflow.completedAt,
    accuracyScore: record?.accuracy?.accuracyScore ?? null,
    validationErrors: record?.validation?.errorCount ?? 0,
    documentStatus: record?.status ?? null
  };
}

/* ── Queries ─────────────────────────────────────────────────────────────── */

const SORTABLE = new Set(['createdAt', 'updatedAt', 'priorityScore', 'slaDueAt', 'progress']);

/**
 * @param {object} [query]
 * @param {string} [query.status]
 * @param {string} [query.definitionId]
 * @param {string} [query.priority]
 * @param {string} [query.assignee]
 * @param {string} [query.slaState]
 * @param {string} [query.search]
 */
export function listWorkflows(query = {}) {
  const { status, definitionId, priority, assignee, slaState: slaFilter, search, page = 1, pageSize = 25 } = query;
  const sortRaw = String(query.sort ?? 'priorityScore:desc');
  const [sortField, sortDirection] = sortRaw.split(':');
  const field = SORTABLE.has(sortField) ? sortField : 'priorityScore';
  const direction = sortDirection === 'asc' ? 1 : -1;

  const needle = String(search ?? '').trim().toLowerCase();

  let items = listAllDocuments()
    .filter((record) => record.workflow)
    .map((record) => workflowSummary(record.workflow, record));

  if (status) items = items.filter((item) => item.status === status);
  if (definitionId) items = items.filter((item) => item.definitionId === definitionId);
  if (priority) items = items.filter((item) => item.priority === priority);
  if (assignee) items = items.filter((item) => item.assignee === assignee);
  if (slaFilter) items = items.filter((item) => item.slaState === slaFilter);
  if (needle) {
    items = items.filter(
      (item) =>
        String(item.fileName ?? '').toLowerCase().includes(needle) ||
        String(item.definitionName ?? '').toLowerCase().includes(needle) ||
        String(item.typeName ?? '').toLowerCase().includes(needle) ||
        String(item.currentStepName ?? '').toLowerCase().includes(needle) ||
        String(item.assignee ?? '').toLowerCase().includes(needle)
    );
  }

  items.sort((left, right) => {
    const leftValue = left[field] ?? 0;
    const rightValue = right[field] ?? 0;
    if (leftValue === rightValue) return new Date(right.createdAt) - new Date(left.createdAt);
    return leftValue > rightValue ? direction : -direction;
  });

  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const safePage = Math.max(1, Number(page) || 1);
  const start = (safePage - 1) * safePageSize;

  return {
    total: items.length,
    page: safePage,
    pageSize: safePageSize,
    items: items.slice(start, start + safePageSize)
  };
}

export function getWorkflow(documentId) {
  const record = getDocument(documentId);
  if (!record.workflow) throw notFound(`Document ${documentId} does not have a workflow instance yet.`);
  return {
    ...record.workflow,
    slaState: slaState(record.workflow),
    document: {
      id: record.id,
      fileName: record.fileName,
      status: record.status,
      typeName: record.classification?.typeName ?? 'Unclassified',
      typeId: record.classification?.typeId ?? null,
      accuracyScore: record.accuracy?.accuracyScore ?? null,
      validationErrors: record.validation?.errorCount ?? 0
    }
  };
}

/** Aggregate view used by the workflow board header and the dashboard. */
export function workflowOverview() {
  const records = listAllDocuments().filter((record) => record.workflow);
  const summaries = records.map((record) => workflowSummary(record.workflow, record));

  const byDefinition = new Map();
  for (const definition of WORKFLOW_DEFINITIONS) {
    byDefinition.set(definition.id, {
      definitionId: definition.id,
      name: definition.name,
      process: definition.process,
      owner: definition.owner,
      slaHours: definition.slaHours,
      stepCount: definition.steps.length,
      humanSteps: definition.steps.filter((entry) => entry.type === StepType.HUMAN).length,
      total: 0,
      active: 0,
      completed: 0,
      breached: 0,
      averageProgress: 0,
      progressSum: 0
    });
  }

  for (const summary of summaries) {
    const bucket = byDefinition.get(summary.definitionId);
    if (!bucket) continue;
    bucket.total += 1;
    bucket.progressSum += summary.progress;
    if (summary.status === WorkflowStatus.COMPLETED) bucket.completed += 1;
    else bucket.active += 1;
    if (summary.slaState === 'breached') bucket.breached += 1;
  }

  const active = summaries.filter((summary) =>
    [WorkflowStatus.ACTIVE, WorkflowStatus.BLOCKED, WorkflowStatus.ON_HOLD].includes(summary.status)
  );

  return {
    total: summaries.length,
    active: active.length,
    completed: summaries.filter((summary) => summary.status === WorkflowStatus.COMPLETED).length,
    onHold: summaries.filter((summary) => summary.status === WorkflowStatus.ON_HOLD).length,
    breached: summaries.filter((summary) => summary.slaState === 'breached').length,
    atRisk: summaries.filter((summary) => summary.slaState === 'at-risk').length,
    critical: active.filter((summary) => summary.priority === Priority.CRITICAL).length,
    averageProgress:
      summaries.length > 0
        ? Number((summaries.reduce((sum, summary) => sum + summary.progress, 0) / summaries.length).toFixed(3))
        : 0,
    automationRate: (() => {
      const steps = records.flatMap((record) => record.workflow.steps ?? []);
      const settled = steps.filter((entry) =>
        [StepStatus.COMPLETED, StepStatus.SKIPPED].includes(entry.status)
      );
      const automated = settled.filter((entry) => entry.type === StepType.AUTOMATED || entry.status === StepStatus.SKIPPED);
      return settled.length > 0 ? Number((automated.length / settled.length).toFixed(3)) : 0;
    })(),
    definitions: [...byDefinition.values()].map((bucket) => ({
      definitionId: bucket.definitionId,
      name: bucket.name,
      process: bucket.process,
      owner: bucket.owner,
      slaHours: bucket.slaHours,
      stepCount: bucket.stepCount,
      humanSteps: bucket.humanSteps,
      total: bucket.total,
      active: bucket.active,
      completed: bucket.completed,
      breached: bucket.breached,
      averageProgress: bucket.total > 0 ? Number((bucket.progressSum / bucket.total).toFixed(3)) : 0
    })),
    queues: (() => {
      const map = new Map();
      for (const summary of active) {
        const key = summary.assignee ?? 'Unassigned';
        const bucket = map.get(key) ?? { role: key, count: 0, breached: 0, critical: 0 };
        bucket.count += 1;
        if (summary.slaState === 'breached') bucket.breached += 1;
        if (summary.priority === Priority.CRITICAL) bucket.critical += 1;
        map.set(key, bucket);
      }
      return [...map.values()].sort((left, right) => right.count - left.count);
    })()
  };
}

/* ── Transitions ─────────────────────────────────────────────────────────── */

function nextStepIndex(steps, from) {
  for (let index = from; index < steps.length; index += 1) {
    if (steps[index].status === StepStatus.PENDING || steps[index].status === StepStatus.IN_PROGRESS) return index;
  }
  return -1;
}

function sanitiseText(value, max, label) {
  const text = String(value ?? '').trim();
  if (text.length > max) throw badRequest(`"${label}" must be ${max} characters or fewer.`);
  return text;
}

/**
 * Applies a transition to a workflow instance and persists the result.
 *
 * @param {string} documentId
 * @param {object} input
 * @param {string} input.action
 * @param {string} [input.actor]
 * @param {string} [input.note]
 * @param {string} [input.assignee]
 */
export async function applyWorkflowAction(documentId, { action, actor, note, assignee } = {}) {
  const normalisedAction = String(action ?? '').toLowerCase();
  if (!ACTIONS.has(normalisedAction)) {
    throw badRequest(`"action" must be one of ${[...ACTIONS].join(', ')}.`);
  }

  const record = getDocument(documentId);
  if (!record.workflow) throw notFound(`Document ${documentId} does not have a workflow instance.`);

  // Every transition is minuted, so it must be attributable: the server never
  // invents an actor on the caller's behalf.
  if (!String(actor ?? '').trim()) {
    throw badRequest('"actor" is required so the decision is attributable.');
  }
  const safeActor = sanitiseText(actor, MAX_ACTOR_LENGTH, 'actor');
  if (!safeActor) throw badRequest('"actor" is required so the decision is attributable.');
  const safeNote = sanitiseText(note, MAX_NOTE_LENGTH, 'note');
  const safeAssignee = assignee ? sanitiseText(assignee, MAX_ACTOR_LENGTH, 'assignee') : null;

  const workflow = record.workflow;
  if ([WorkflowStatus.COMPLETED, WorkflowStatus.CANCELLED].includes(workflow.status) && normalisedAction !== WorkflowAction.COMMENT) {
    throw conflict('This workflow is closed and cannot be transitioned further.');
  }
  if (workflow.status === WorkflowStatus.ON_HOLD && ![WorkflowAction.RESUME, WorkflowAction.COMMENT, WorkflowAction.CANCEL].includes(normalisedAction)) {
    throw conflict('This workflow is on hold. Resume it before taking further action.');
  }
  if (normalisedAction === WorkflowAction.REASSIGN && !safeAssignee) {
    throw badRequest('"assignee" is required when reassigning a workflow.');
  }

  const at = nowIso();

  const updated = await updateDocument(documentId, (current) => {
    const instance = structuredClone(current.workflow);
    const steps = instance.steps;
    const index = Math.max(0, Math.min(steps.length - 1, instance.currentStepIndex ?? 0));
    const step = steps[index];
    let documentStatus = current.status;
    let detail = safeNote;

    switch (normalisedAction) {
      case WorkflowAction.COMPLETE:
      case WorkflowAction.APPROVE: {
        step.status = StepStatus.COMPLETED;
        step.completedAt = at;
        step.actor = safeActor;
        step.note = safeNote || null;
        step.durationMs = step.startedAt ? new Date(at) - new Date(step.startedAt) : 0;
        step.evidence = step.evidence ?? `${step.name} completed by ${safeActor}.`;

        const next = nextStepIndex(steps, index + 1);
        if (next === -1) {
          instance.status = WorkflowStatus.COMPLETED;
          instance.completedAt = at;
          instance.currentStepId = null;
          instance.currentStepName = null;
          instance.assignee = null;
          instance.currentStepIndex = steps.length - 1;
          documentStatus =
            current.status === DocumentStatus.REJECTED ? DocumentStatus.REJECTED : DocumentStatus.APPROVED;
        } else {
          steps[next].status = StepStatus.IN_PROGRESS;
          steps[next].startedAt = at;
          instance.currentStepIndex = next;
          instance.currentStepId = steps[next].id;
          instance.currentStepName = steps[next].name;
          instance.assignee = steps[next].role;
          instance.status = WorkflowStatus.ACTIVE;
          if (normalisedAction === WorkflowAction.APPROVE) documentStatus = DocumentStatus.APPROVED;
        }
        detail = detail || `${step.name} completed.`;
        break;
      }

      case WorkflowAction.REJECT: {
        step.status = StepStatus.REJECTED;
        step.completedAt = at;
        step.actor = safeActor;
        step.note = safeNote || null;
        instance.status = WorkflowStatus.CANCELLED;
        instance.completedAt = at;
        instance.currentStepId = null;
        instance.currentStepName = null;
        instance.assignee = null;
        documentStatus = DocumentStatus.REJECTED;
        detail = detail || `${step.name} rejected.`;
        break;
      }

      case WorkflowAction.HOLD: {
        instance.status = WorkflowStatus.ON_HOLD;
        detail = detail || 'Workflow placed on hold.';
        break;
      }

      case WorkflowAction.RESUME: {
        instance.status = WorkflowStatus.ACTIVE;
        detail = detail || 'Workflow resumed.';
        break;
      }

      case WorkflowAction.REASSIGN: {
        instance.assignee = safeAssignee;
        step.actor = null;
        detail = detail || `Reassigned to ${safeAssignee}.`;
        break;
      }

      case WorkflowAction.ESCALATE: {
        instance.priority = Priority.CRITICAL;
        instance.priorityScore = Math.max(instance.priorityScore ?? 0, 80);
        instance.priorityReasons = [...new Set([...(instance.priorityReasons ?? []), 'manually escalated'])];
        instance.slaDueAt = new Date(Date.now() + 2 * HOUR_MS).toISOString();
        detail = detail || 'Escalated to critical priority with a two-hour SLA.';
        break;
      }

      case WorkflowAction.CANCEL: {
        instance.status = WorkflowStatus.CANCELLED;
        instance.completedAt = at;
        instance.currentStepId = null;
        instance.currentStepName = null;
        instance.assignee = null;
        detail = detail || 'Workflow cancelled.';
        break;
      }

      case WorkflowAction.COMMENT:
      default: {
        detail = detail || 'Comment added.';
        break;
      }
    }

    instance.updatedAt = at;
    instance.history = [
      ...(instance.history ?? []),
      { at, actor: safeActor, action: normalisedAction, detail }
    ].slice(-100);

    const withAudit = appendAudit(current, {
      actor: safeActor,
      action: `workflow-${normalisedAction}`,
      detail
    });

    return { ...withAudit, status: documentStatus, workflow: instance };
  });

  return {
    workflow: { ...updated.workflow, slaState: slaState(updated.workflow) },
    documentStatus: updated.status
  };
}

export { WORKFLOW_DEFINITIONS, WorkflowStatus, StepStatus, StepType, Priority, getWorkflowDefinition };
