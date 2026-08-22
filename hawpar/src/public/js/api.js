/**
 * Typed API client. Centralises error handling so every view reacts consistently.
 */
import { getRole } from './role.js';
import { getTenantId } from './tenant.js';

const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json' });

export class ApiError extends Error {
  constructor(message, { status, code, correlationId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 4000;

/** Honours `Retry-After` (seconds or HTTP-date), falling back to a capped backoff. */
function retryDelay(response, attempt) {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS);
  }
  return Math.min(300 * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

async function request(path, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase();
  // Every request carries the demo role so the server can enforce field-level
  // edit permissions (see role.js) — never trust the UI gate alone.
  const headers = new Headers(options.headers ?? {});
  headers.set('x-user-role', getRole());
  const tenantId = getTenantId();
  if (tenantId) headers.set('x-tenant-id', tenantId);
  const requestOptions = { ...options, headers };
  // Only idempotent requests may be replayed automatically.
  const retryable = method === 'GET' || method === 'HEAD';
  let response;

  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(path, requestOptions);
    } catch (cause) {
      throw new ApiError('Cannot reach the VGC platform API. Is the server still running?', { status: 0 });
    }
    if (!retryable || attempt >= MAX_RETRIES || !RETRY_STATUSES.has(response.status)) break;
    await sleep(retryDelay(response, attempt));
  }

  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new ApiError(`Request failed with status ${response.status}.`, { status: response.status });
    return response.text();
  }

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload?.error ?? {};
    throw new ApiError(detail.message ?? `Request failed with status ${response.status}.`, {
      status: response.status,
      code: detail.code,
      correlationId: detail.correlationId
    });
  }
  return payload;
}

const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  getConfig: () => request('/api/config'),
  getHealth: () => request('/api/health'),
  getPipelineStatus: () => request('/api/pipeline/status'),

  listDocuments: (params) => request(`/api/documents${query(params)}`),
  getDocument: (id) => request(`/api/documents/${encodeURIComponent(id)}`),
  getPage: (id, pageNumber) => request(`/api/documents/${encodeURIComponent(id)}/pages/${pageNumber}`),
  getText: (id) => request(`/api/documents/${encodeURIComponent(id)}/text`),
  deleteDocument: (id) => request(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  updateField: (id, fieldKey, value, actor) =>
    request(`/api/documents/${encodeURIComponent(id)}/fields/${encodeURIComponent(fieldKey)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ value, actor })
    }),

  decide: (id, decision, note, actor) =>
    request(`/api/documents/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ decision, note, actor })
    }),

  upload: (files, label) => {
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);
    if (label) form.append('label', label);
    return request('/api/documents', { method: 'POST', body: form });
  },

  runSamples: (sampleIds) =>
    request('/api/samples/run', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sampleIds })
    }),

  dashboard: () => request('/api/analytics/dashboard'),
  reviewQueue: (limit) => request(`/api/analytics/review-queue${query({ limit })}`),
  search: (term) => request(`/api/search${query({ q: term })}`),
  listClaims: () => request('/api/claims'),
  getClaim: (id) => request(`/api/claims/${encodeURIComponent(id)}`),
  requirements: () => request('/api/requirements'),

  // ── Agent mesh ──────────────────────────────────────────────────────────
  listAgents: () => request('/api/agents'),
  agentTopology: () => request('/api/agents/topology'),
  agentRuns: (limit) => request(`/api/agents/runs${query({ limit })}`),
  getAgent: (agentId) => request(`/api/agents/${encodeURIComponent(agentId)}`),
  documentAgentRun: (id) => request(`/api/documents/${encodeURIComponent(id)}/agent-run`),

  // ── Workflows ───────────────────────────────────────────────────────────
  listWorkflows: (params) => request(`/api/workflows${query(params)}`),
  workflowDefinitions: () => request('/api/workflows/definitions'),
  workflowOverview: () => request('/api/workflows/overview'),
  getWorkflow: (documentId) => request(`/api/workflows/${encodeURIComponent(documentId)}`),
  workflowAction: (documentId, body) =>
    request(`/api/workflows/${encodeURIComponent(documentId)}/actions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body)
    }),

  // ── Accuracy assurance ──────────────────────────────────────────────────
  accuracyBenchmark: () => request('/api/accuracy/benchmark'),
  accuracyCalibration: () => request('/api/accuracy/calibration'),
  documentAccuracy: (id) => request(`/api/documents/${encodeURIComponent(id)}/accuracy`),

  // ── Azure Document Intelligence ─────────────────────────────────────────
  azureStatus: (refresh) => request(`/api/azure/status${query({ refresh: refresh ? 'true' : '' })}`),
  azureModels: () => request('/api/azure/models'),
  azureProfile: () => request('/api/azure/profile'),

  priceBook: () => request('/api/cost/pricebook'),
  estimateCost: (body) =>
    request('/api/cost/estimate', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
  reset: () => request('/api/admin/reset', { method: 'DELETE' }),

  // ── Settings ────────────────────────────────────────────────────────────
  getSettings: () => request('/api/settings'),
  updateSettings: (patch) =>
    request('/api/settings', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }),
  listTimezones: () => request('/api/settings/timezones'),
  acraLookup: (q) => request(`/api/settings/acra-lookup${query({ q })}`),
  smtpTest: (body) =>
    request('/api/settings/smtp-test', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),

  // ── Template Studio (custom extraction templates) ──────────────────────
  templatePreview: (file) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request('/api/templates/preview', { method: 'POST', body: form });
  },
  getTemplatePreview: (previewId) => request(`/api/templates/preview/${encodeURIComponent(previewId)}`),
  parseExcelTemplate: (file) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request('/api/templates/excel-template', { method: 'POST', body: form });
  },
  listTemplates: () => request('/api/templates'),
  getTemplate: (id) => request(`/api/templates/${encodeURIComponent(id)}`),
  createTemplate: (body) =>
    request('/api/templates', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
  updateTemplate: (id, patch) =>
    request(`/api/templates/${encodeURIComponent(id)}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }),
  deleteTemplate: (id) => request(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runTemplate: (id, files) => {
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);
    return request(`/api/templates/${encodeURIComponent(id)}/run`, { method: 'POST', body: form });
  },
  listTemplateRuns: (id) => request(`/api/templates/${encodeURIComponent(id)}/runs`),
  getTemplateRun: (id, runId) => request(`/api/templates/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`),

  // ── Onboarding / workspace provisioning ─────────────────────────────────
  onboardingBusinessTypes: () => request('/api/onboarding/business-types'),
  onboardingCountries: () => request('/api/onboarding/countries'),
  createWorkspace: (body) =>
    request('/api/onboarding', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
  getWorkspace: (tenantId) => request(`/api/onboarding/${encodeURIComponent(tenantId)}`)
};
