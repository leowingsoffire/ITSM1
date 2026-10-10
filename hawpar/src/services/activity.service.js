/**
 * Workspace activity log: an append-only audit trail of who did what.
 *
 * Covers sign-ins, membership and role changes, API keys, webhooks, settings
 * changes and document decisions. The per-document audit trail on each record
 * still captures field-level history; this log is the workspace-wide view
 * administrators and auditors need.
 *
 * Persisted as JSON Lines (`activity.jsonl`) and only ever appended, never
 * rewritten, so a crash can at worst lose the line being written. Listing reads
 * the tail of the file, so the log can grow without slowing the API.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { displayIp } from '../lib/format.js';
import { logger } from '../lib/logger.js';
import { tenantDataDir } from './tenant.service.js';

const ACTIVITY_FILE = 'activity.jsonl';
const MAX_CACHED_ENTRIES = 1000;
const TAIL_READ_BYTES = 2 * 1024 * 1024;
const MAX_DETAIL_LENGTH = 400;

/** @type {Map<string, object[]>} tenant id → entries, oldest first */
const cache = new Map();
/** @type {Map<string, Promise<void>>} */
const loading = new Map();
/** @type {Map<string, Promise<void>>} */
const appendChains = new Map();

const usesDisk = () => config.persistence === 'file';
const activityPath = (tenantId) => path.join(tenantDataDir(tenantId), ACTIVITY_FILE);

async function readTail(tenantId) {
  let handle;
  try {
    handle = await fs.open(activityPath(tenantId), 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, TAIL_READ_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    // A partial first line is expected when only the tail was read.
    if (size > length) lines.shift();
    const entries = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        /* skip a torn line rather than losing the whole log */
      }
    }
    return entries.slice(-MAX_CACHED_ENTRIES);
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('Activity log unreadable.', { tenantId, error });
    return [];
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function ensureLoaded(tenantId) {
  if (cache.has(tenantId)) return;
  if (!loading.has(tenantId)) {
    loading.set(
      tenantId,
      (async () => {
        const entries = usesDisk() ? await readTail(tenantId) : [];
        // Entries recorded while the file was being read are already cached.
        cache.set(tenantId, [...entries, ...(cache.get(tenantId) ?? [])]);
      })().finally(() => loading.delete(tenantId))
    );
  }
  await loading.get(tenantId);
}

function clip(value, max) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Appends an entry to a workspace's activity log.
 * @param {string} tenantId
 * @param {{actor: string, action: string, target?: string, detail?: string, ip?: string, correlationId?: string}} input
 */
export async function recordActivity(tenantId, { actor, action, target, detail, ip, correlationId }) {
  await ensureLoaded(tenantId);
  const entry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: clip(actor ?? 'system', 120),
    action: clip(action, 60),
    target: clip(target, 160),
    detail: clip(detail, MAX_DETAIL_LENGTH),
    ip: displayIp(ip),
    correlationId: clip(correlationId, 64)
  };
  const entries = cache.get(tenantId);
  entries.push(entry);
  if (entries.length > MAX_CACHED_ENTRIES) entries.splice(0, entries.length - MAX_CACHED_ENTRIES);

  if (usesDisk()) {
    const previous = appendChains.get(tenantId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        await fs.mkdir(path.dirname(activityPath(tenantId)), { recursive: true });
        await fs.appendFile(activityPath(tenantId), `${JSON.stringify(entry)}\n`, 'utf8');
      })
      .catch((error) => logger.error('Failed to append to the activity log.', { tenantId, error }));
    appendChains.set(tenantId, next);
    await next;
  }
  return entry;
}

/** Records an activity entry for the request's workspace and principal. Never throws. */
export function auditRequest(request, action, { target, detail, tenantId } = {}) {
  const workspace = tenantId ?? request.tenantId;
  if (!workspace) return Promise.resolve(null);
  return recordActivity(workspace, {
    actor: request.actor ?? request.principal?.email ?? 'anonymous',
    action,
    target,
    detail,
    ip: request.ip,
    correlationId: request.correlationId
  }).catch((error) => {
    logger.error('Activity logging failed.', { action, error });
    return null;
  });
}

/**
 * Lists a workspace's activity, newest first.
 *
 * `before` pages backwards: pass the id of the oldest entry already shown
 * (exact, even when entries share a timestamp) or an ISO timestamp.
 * @param {string} tenantId
 * @param {{limit?: number, before?: string, action?: string, actor?: string, q?: string}} [query]
 */
export async function listActivity(tenantId, { limit = 100, before, action, actor, q } = {}) {
  await ensureLoaded(tenantId);
  const max = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const prefix = action ? String(action).toLowerCase() : null;
  const actorFilter = actor ? String(actor).toLowerCase() : null;
  const search = q ? String(q).toLowerCase() : null;
  const entries = cache.get(tenantId);
  let startIndex = entries.length - 1;
  let beforeTime = null;
  if (before) {
    const anchor = entries.findIndex((entry) => entry.id === before);
    if (anchor >= 0) startIndex = anchor - 1;
    else beforeTime = Date.parse(before) || null;
  }
  const items = [];
  let hasMore = false;
  for (let index = startIndex; index >= 0; index -= 1) {
    const entry = entries[index];
    if (beforeTime && Date.parse(entry.at) >= beforeTime) continue;
    if (prefix && !entry.action.toLowerCase().startsWith(prefix)) continue;
    if (actorFilter && !String(entry.actor).toLowerCase().includes(actorFilter)) continue;
    if (search && ![entry.action, entry.target, entry.detail, entry.actor].some((value) => String(value ?? '').toLowerCase().includes(search))) continue;
    if (items.length === max) {
      hasMore = true;
      break;
    }
    items.push(entry);
  }
  return { items, total: entries.length, hasMore };
}

export async function flushActivityWrites() {
  await Promise.all(appendChains.values());
}
