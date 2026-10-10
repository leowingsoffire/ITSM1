/**
 * Outbound webhooks: push document lifecycle events to a customer's systems
 * (ERP, RPA, data lake) the moment they happen, instead of making them poll.
 *
 * - Every delivery is signed: `x-vgc-signature: t=<unix>,v1=<hex>`, where
 *   v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Receivers verify the HMAC and
 *   reject stale timestamps to stop replays.
 * - Failed deliveries are retried with backoff, and every attempt is kept in a
 *   per-workspace delivery log so administrators can see what happened.
 * - SSRF guard: destinations must resolve to public addresses. The check runs
 *   inside the socket's DNS lookup, so a DNS-rebinding answer cannot slip a
 *   private address past it. Redirects are never followed.
 *
 * Retries are in-process timers: a restart abandons in-flight retries. That is
 * acceptable at-least-once-while-running semantics, and it is documented. A
 * durable outbox can replace `scheduleAttempt` later without changing the API.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { config } from '../config/index.js';
import { atomicWriteFile } from '../lib/atomicWrite.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../lib/tenantContext.js';
import { DocumentStatus, toSummary, tryGetDocument } from './store.service.js';
import { tenantDataDir } from './tenant.service.js';

export const WEBHOOK_EVENTS = Object.freeze([
  'document.processed',
  'document.review_required',
  'document.failed',
  'document.approved',
  'document.rejected',
  'document.deleted'
]);

const WEBHOOKS_FILE = 'webhooks.json';
const DELIVERIES_FILE = 'webhook-deliveries.json';
const MAX_WEBHOOKS = 10;
const MAX_DELIVERIES = 200;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESPONSE_SNIPPET = 500;
const MAX_URL_LENGTH = 2048;
const RETRY_MULTIPLIERS = Object.freeze([0, 1, 6, 24]);
const DELIVERY_PERSIST_DEBOUNCE_MS = 1000;

/** @type {Map<string, {hooks: object[], deliveries: object[]}>} */
const state = new Map();
const loading = new Map();
const persistTimers = new Map();

const usesDisk = () => config.persistence === 'file';
const retryBaseMs = () => Math.max(1, Number(process.env.WEBHOOK_RETRY_BASE_MS) || 5000);
const allowPrivateTargets = () => config.security.webhookAllowPrivateTargets;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('Webhook file unreadable — starting empty.', { file, error });
    return fallback;
  }
}

async function ensureLoaded(tenantId) {
  if (state.has(tenantId)) return state.get(tenantId);
  if (!loading.has(tenantId)) {
    loading.set(
      tenantId,
      (async () => {
        const directory = tenantDataDir(tenantId);
        const hooks = usesDisk() ? await readJson(path.join(directory, WEBHOOKS_FILE), []) : [];
        const deliveries = usesDisk() ? await readJson(path.join(directory, DELIVERIES_FILE), []) : [];
        state.set(tenantId, {
          hooks: Array.isArray(hooks) ? hooks : [],
          deliveries: Array.isArray(deliveries) ? deliveries.slice(-MAX_DELIVERIES) : []
        });
      })().finally(() => loading.delete(tenantId))
    );
  }
  await loading.get(tenantId);
  return state.get(tenantId);
}

async function persistHooks(tenantId) {
  if (!usesDisk()) return;
  await atomicWriteFile(
    path.join(tenantDataDir(tenantId), WEBHOOKS_FILE),
    JSON.stringify(state.get(tenantId).hooks, null, 2),
    'utf8'
  );
}

function schedulePersistDeliveries(tenantId) {
  if (!usesDisk() || persistTimers.has(tenantId)) return;
  const timer = setTimeout(() => {
    persistTimers.delete(tenantId);
    atomicWriteFile(
      path.join(tenantDataDir(tenantId), DELIVERIES_FILE),
      JSON.stringify(state.get(tenantId)?.deliveries ?? []),
      'utf8'
    ).catch((error) => logger.error('Failed to persist webhook deliveries.', { tenantId, error }));
  }, DELIVERY_PERSIST_DEBOUNCE_MS);
  timer.unref?.();
  persistTimers.set(tenantId, timer);
}

/* ── SSRF guard ──────────────────────────────────────────────────────────── */

function ipv4ToInt(address) {
  return address.split('.').reduce((total, octet) => (total << 8) + Number(octet), 0) >>> 0;
}

const PRIVATE_V4_RANGES = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].map(([base, bits]) => [ipv4ToInt(base), bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0]);

/** @returns {boolean} true for loopback, private, link-local, CGNAT, multicast and reserved addresses. */
export function isPrivateAddress(address) {
  const value = String(address ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(value)) {
    const numeric = ipv4ToInt(value);
    return PRIVATE_V4_RANGES.some(([base, mask]) => ((numeric & mask) >>> 0) === base);
  }
  if (net.isIPv6(value)) {
    if (value === '::' || value === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(value) || value.startsWith('64:ff9b:') || value.startsWith('2001:db8');
  }
  return true;
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = Array.isArray(addresses) ? addresses : [];
    if (!allowPrivateTargets() && list.some((entry) => isPrivateAddress(entry.address))) {
      const blocked = new Error(`Destination "${hostname}" resolves to a private or reserved address.`);
      blocked.code = 'EWEBHOOKPRIVATE';
      return callback(blocked);
    }
    if (options?.all) return callback(null, list);
    if (list.length === 0) return callback(Object.assign(new Error(`Cannot resolve ${hostname}.`), { code: 'ENOTFOUND' }));
    return callback(null, list[0].address, list[0].family);
  });
}

/** Validates a destination URL at configuration time. */
export function validateWebhookUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > MAX_URL_LENGTH) throw badRequest('Enter the full https:// URL of your endpoint.');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw badRequest('Enter the full https:// URL of your endpoint.');
  }
  const insecureAllowed = allowPrivateTargets() && config.env !== 'production';
  if (url.protocol !== 'https:' && !(insecureAllowed && url.protocol === 'http:')) {
    throw badRequest('Webhook endpoints must use https://.');
  }
  if (url.username || url.password) throw badRequest('Do not embed credentials in the URL — verify the signature instead.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivateTargets() && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || (net.isIP(host) && isPrivateAddress(host)))) {
    throw badRequest('Webhook endpoints must be reachable on the public internet.');
  }
  url.hash = '';
  return url.toString();
}

function validateEvents(events) {
  const list = Array.isArray(events) ? [...new Set(events.map(String))] : [];
  if (list.length === 0) throw badRequest('Subscribe to at least one event.');
  const unknown = list.filter((event) => !WEBHOOK_EVENTS.includes(event));
  if (unknown.length > 0) throw badRequest(`Unknown event(s): ${unknown.join(', ')}.`);
  return list;
}

/* ── Configuration ───────────────────────────────────────────────────────── */

function publicHook(hook) {
  const { secret, ...rest } = hook;
  return { ...rest, secretPreview: `whsec_…${secret.slice(-4)}` };
}

const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

export async function listWebhooks(tenantId) {
  const { hooks } = await ensureLoaded(tenantId);
  return hooks.map(publicHook);
}

async function requireHook(tenantId, id) {
  const { hooks } = await ensureLoaded(tenantId);
  const hook = hooks.find((candidate) => candidate.id === id);
  if (!hook) throw notFound('Webhook not found.');
  return hook;
}

/** @returns {{webhook: object, secret: string}} — the signing secret is shown once. */
export async function createWebhook(tenantId, { url, events, description }, actor) {
  const entry = await ensureLoaded(tenantId);
  if (entry.hooks.length >= MAX_WEBHOOKS) throw conflict(`A workspace can have at most ${MAX_WEBHOOKS} webhooks.`);
  const hook = {
    id: `wh_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    url: validateWebhookUrl(url),
    events: validateEvents(events),
    description: String(description ?? '').trim().slice(0, 120) || null,
    active: true,
    secret: newSecret(),
    createdAt: new Date().toISOString(),
    createdBy: actor,
    updatedAt: new Date().toISOString(),
    lastDeliveryAt: null,
    lastDeliveryStatus: null
  };
  entry.hooks.push(hook);
  await persistHooks(tenantId);
  return { webhook: publicHook(hook), secret: hook.secret };
}

export async function updateWebhook(tenantId, id, patch = {}) {
  const hook = await requireHook(tenantId, id);
  if (patch.url !== undefined) hook.url = validateWebhookUrl(patch.url);
  if (patch.events !== undefined) hook.events = validateEvents(patch.events);
  if (patch.description !== undefined) hook.description = String(patch.description ?? '').trim().slice(0, 120) || null;
  if (patch.active !== undefined) hook.active = Boolean(patch.active);
  hook.updatedAt = new Date().toISOString();
  await persistHooks(tenantId);
  return publicHook(hook);
}

export async function rotateWebhookSecret(tenantId, id) {
  const hook = await requireHook(tenantId, id);
  hook.secret = newSecret();
  hook.updatedAt = new Date().toISOString();
  await persistHooks(tenantId);
  return { webhook: publicHook(hook), secret: hook.secret };
}

export async function deleteWebhook(tenantId, id) {
  const entry = await ensureLoaded(tenantId);
  const before = entry.hooks.length;
  entry.hooks = entry.hooks.filter((hook) => hook.id !== id);
  if (entry.hooks.length === before) throw notFound('Webhook not found.');
  await persistHooks(tenantId);
  return { deleted: true };
}

export async function listDeliveries(tenantId, { webhookId, limit = 50 } = {}) {
  const { deliveries } = await ensureLoaded(tenantId);
  const max = Math.min(Math.max(Number(limit) || 50, 1), MAX_DELIVERIES);
  return deliveries
    .filter((delivery) => !webhookId || delivery.webhookId === webhookId)
    .slice(-max)
    .reverse();
}

/* ── Delivery ────────────────────────────────────────────────────────────── */

export function signPayload(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function postOnce(hook, body, headers) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let url;
    try {
      url = new URL(hook.url);
    } catch {
      resolve({ ok: false, error: 'Invalid URL.', durationMs: 0 });
      return;
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivateTargets() && net.isIP(host) && isPrivateAddress(host)) {
      resolve({ ok: false, error: 'Destination is a private or reserved address.', durationMs: 0 });
      return;
    }
    const transport = url.protocol === 'https:' ? https : http;
    const outgoing = transport.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
        lookup: guardedLookup,
        timeout: REQUEST_TIMEOUT_MS
      },
      (incoming) => {
        let snippet = '';
        incoming.setEncoding('utf8');
        incoming.on('data', (chunk) => {
          if (snippet.length < MAX_RESPONSE_SNIPPET) snippet += chunk.slice(0, MAX_RESPONSE_SNIPPET - snippet.length);
        });
        incoming.on('end', () => {
          const status = incoming.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, responseStatus: status, responseSnippet: snippet || null, durationMs: Date.now() - startedAt });
        });
        incoming.on('error', (error) => resolve({ ok: false, responseStatus: incoming.statusCode ?? null, error: error.message, durationMs: Date.now() - startedAt }));
      }
    );
    outgoing.on('timeout', () => outgoing.destroy(new Error(`Timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`)));
    outgoing.on('error', (error) => resolve({ ok: false, error: error.message, durationMs: Date.now() - startedAt }));
    outgoing.end(body);
  });
}

function recordDelivery(tenantId, delivery) {
  const entry = state.get(tenantId);
  if (!entry) return;
  entry.deliveries.push(delivery);
  if (entry.deliveries.length > MAX_DELIVERIES) entry.deliveries.splice(0, entry.deliveries.length - MAX_DELIVERIES);
  schedulePersistDeliveries(tenantId);
}

async function attempt(tenantId, hook, event, attemptNumber, { retry = true } = {}) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const deliveryId = randomUUID();
  const result = await postOnce(hook, body, {
    'content-type': 'application/json',
    'user-agent': 'VGC-OCR-Intelligence-Webhooks/1.0',
    'x-vgc-event': event.type,
    'x-vgc-delivery': deliveryId,
    'x-vgc-timestamp': String(timestamp),
    'x-vgc-signature': `t=${timestamp},v1=${signPayload(hook.secret, timestamp, body)}`
  });
  const willRetry = !result.ok && retry && attemptNumber < RETRY_MULTIPLIERS.length;
  const delivery = {
    id: deliveryId,
    webhookId: hook.id,
    eventId: event.id,
    event: event.type,
    url: hook.url,
    attempt: attemptNumber,
    status: result.ok ? 'succeeded' : willRetry ? 'retrying' : 'failed',
    responseStatus: result.responseStatus ?? null,
    responseSnippet: result.responseSnippet ?? null,
    error: result.error ?? (result.ok ? null : `Endpoint answered HTTP ${result.responseStatus}.`),
    durationMs: result.durationMs,
    at: new Date().toISOString()
  };
  recordDelivery(tenantId, delivery);
  hook.lastDeliveryAt = delivery.at;
  hook.lastDeliveryStatus = delivery.status;
  if (willRetry) scheduleAttempt(tenantId, hook.id, event, attemptNumber + 1);
  return delivery;
}

function scheduleAttempt(tenantId, hookId, event, attemptNumber) {
  const delay = RETRY_MULTIPLIERS[attemptNumber - 1] * retryBaseMs();
  const timer = setTimeout(async () => {
    try {
      const entry = await ensureLoaded(tenantId);
      // Re-read the hook so a deleted or disabled webhook stops retrying.
      const hook = entry.hooks.find((candidate) => candidate.id === hookId);
      if (hook?.active) await attempt(tenantId, hook, event, attemptNumber);
    } catch (error) {
      logger.error('Webhook delivery failed unexpectedly.', { tenantId, hookId, error });
    }
  }, delay);
  timer.unref?.();
}

function buildEvent(tenantId, type, data) {
  return { id: `evt_${randomUUID().replace(/-/g, '')}`, type, createdAt: new Date().toISOString(), workspaceId: tenantId, data };
}

/** Fans an event out to every active webhook in the workspace subscribed to it. */
export async function dispatchEvent(tenantId, type, data) {
  const entry = await ensureLoaded(tenantId || DEFAULT_TENANT_ID);
  const targets = entry.hooks.filter((hook) => hook.active && hook.events.includes(type));
  if (targets.length === 0) return 0;
  const event = buildEvent(tenantId, type, data);
  for (const hook of targets) scheduleAttempt(tenantId, hook.id, event, 1);
  return targets.length;
}

/** Sends a signed `webhook.test` event once, synchronously, and reports the outcome. */
export async function sendTestEvent(tenantId, id) {
  const hook = await requireHook(tenantId, id);
  const event = buildEvent(tenantId, 'webhook.test', { message: 'Test delivery from VGC OCR Intelligence.', webhookId: hook.id });
  return attempt(tenantId, hook, event, 1, { retry: false });
}

/** The integration payload for a document: summary plus extracted fields. */
export function documentEventData(record) {
  const summary = toSummary(record);
  return {
    documentId: record.id,
    fileName: record.fileName,
    status: record.status,
    documentType: summary.typeId ? { id: summary.typeId, name: summary.typeName } : null,
    pageCount: summary.pageCount ?? null,
    batchId: record.batchId ?? null,
    averageFieldConfidence: summary.averageFieldConfidence,
    reviewFieldCount: summary.reviewFieldCount,
    validationErrors: summary.validationErrors,
    riskLevel: summary.riskLevel,
    fields: (record.fields ?? []).map((field) => ({
      key: field.key,
      label: field.label,
      value: field.value ?? null,
      rawValue: field.rawValue ?? null,
      confidence: field.confidence,
      status: field.status ?? null
    })),
    completedAt: record.completedAt ?? null
  };
}

/** Dispatches a document event, loading the record in its own workspace. */
export function dispatchDocumentEvent(tenantId, type, documentId) {
  return runWithTenant(tenantId, async () => {
    const record = tryGetDocument(documentId);
    if (!record) return 0;
    return dispatchEvent(tenantId, type, documentEventData(record));
  }).catch((error) => {
    logger.error('Webhook dispatch failed.', { tenantId, type, documentId, error });
    return 0;
  });
}

let pipelineSubscribed = false;

/** Subscribes the dispatcher to pipeline completions. Idempotent. */
export function startWebhookDispatcher(pipelineEvents) {
  if (pipelineSubscribed) return;
  pipelineSubscribed = true;
  pipelineEvents.on('event', (payload) => {
    const tenantId = payload.tenantId ?? DEFAULT_TENANT_ID;
    if (payload.event === 'completed') {
      dispatchDocumentEvent(tenantId, 'document.processed', payload.documentId);
      if (payload.summary?.status === DocumentStatus.NEEDS_REVIEW) {
        dispatchDocumentEvent(tenantId, 'document.review_required', payload.documentId);
      }
    } else if (payload.event === 'failed') {
      dispatchDocumentEvent(tenantId, 'document.failed', payload.documentId);
    }
  });
}
