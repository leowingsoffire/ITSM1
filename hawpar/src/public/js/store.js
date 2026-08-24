/**
 * Application state and the live pipeline event stream.
 * A tiny observable store keeps views decoupled from each other.
 */
import { api } from './api.js';
import { getTenantId } from './tenant.js';

const MAX_ACTIVITY_ENTRIES = 60;

const listeners = new Set();

export const state = {
  config: null,
  pipeline: { queueDepth: 0, activeWorkers: 0, processedCount: 0, failedCount: 0 },
  activity: [],
  documentCount: 0,
  reviewCount: 0,
  claimsReview: 0,
  workflowActive: 0,
  connected: false
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(reason) {
  for (const listener of listeners) {
    try {
      listener(state, reason);
    } catch (error) {
      console.error('State listener failed', error);
    }
  }
}

export async function loadConfig() {
  state.config = await api.getConfig();
  notify('config');
  return state.config;
}

export async function refreshCounters() {
  const [documents, review, pipeline] = await Promise.all([
    api.listDocuments({ pageSize: 1 }),
    api.reviewQueue(1),
    api.getPipelineStatus()
  ]);
  state.documentCount = documents.total;
  state.reviewCount = review.total;
  state.pipeline = pipeline;
  try {
    const claims = await api.listClaims();
    state.claimsReview = claims?.overview?.reviewClaims ?? 0;
  } catch {
    state.claimsReview = 0;
  }
  try {
    const workflows = await api.listWorkflows({ status: 'active', pageSize: 1 });
    state.workflowActive = workflows.total;
  } catch {
    state.workflowActive = 0;
  }
  notify('counters');
}

/**
 * A batch ingest completes many documents in quick succession. Refreshing the
 * counters for each one would issue five API calls per document, so completions
 * are coalesced into a single refresh.
 */
const COUNTER_COALESCE_MS = 700;
let counterTimer = null;

export function scheduleCounterRefresh() {
  if (counterTimer !== null) return;
  counterTimer = setTimeout(() => {
    counterTimer = null;
    refreshCounters().catch(() => {});
  }, COUNTER_COALESCE_MS);
}

function pushActivity(entry) {
  state.activity.unshift(entry);
  if (state.activity.length > MAX_ACTIVITY_ENTRIES) state.activity.length = MAX_ACTIVITY_ENTRIES;
}

const STAGE_LABELS = Object.freeze({
  ingest: 'Reading file',
  analyse: 'Running OCR analysis',
  classify: 'Classifying document',
  extract: 'Extracting fields',
  validate: 'Applying business rules',
  score: 'Scoring and routing'
});

/** Opens the SSE channel and keeps it alive across transient disconnects. */
export function connectEventStream() {
  // EventSource cannot set the x-tenant-id header every other API call uses,
  // so the active workspace is passed as a query param instead — the server
  // filters the shared event bus to this tenant alone (see platform.routes.js).
  const tenantId = getTenantId();
  const source = new EventSource(`/api/events${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`);

  source.addEventListener('ready', () => {
    state.connected = true;
    notify('connection');
  });

  source.addEventListener('pipeline', (message) => {
    let payload;
    try {
      payload = JSON.parse(message.data);
    } catch {
      return;
    }

    if (payload.event === 'queued') {
      state.pipeline = { ...state.pipeline, queueDepth: payload.queueDepth ?? state.pipeline.queueDepth };
      pushActivity({ at: payload.at, text: 'Document queued for processing.', variant: 'info' });
    } else if (payload.event === 'progress') {
      pushActivity({
        at: payload.at,
        text: `${STAGE_LABELS[payload.stage] ?? payload.stage} · ${payload.summary?.fileName ?? ''}`.trim(),
        variant: 'info',
        documentId: payload.documentId
      });
    } else if (payload.event === 'completed') {
      const summary = payload.summary ?? {};
      pushActivity({
        at: payload.at,
        text: `${summary.fileName ?? 'Document'} → ${summary.typeName ?? 'Unclassified'} (${summary.pageCount ?? 0} pages, ${summary.status})`,
        variant: summary.status === 'needs-review' ? 'warn' : 'success',
        documentId: payload.documentId
      });
      scheduleCounterRefresh();
    } else if (payload.event === 'failed') {
      pushActivity({
        at: payload.at,
        text: `${payload.summary?.fileName ?? 'Document'} failed: ${payload.summary?.error?.message ?? 'unknown error'}`,
        variant: 'error',
        documentId: payload.documentId
      });
      scheduleCounterRefresh();
    }

    notify('pipeline');
  });

  source.addEventListener('error', () => {
    state.connected = false;
    notify('connection');
  });

  return source;
}
