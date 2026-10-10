/**
 * Self-learning extractor feedback.
 *
 * Rossum Aurora / Hyperscience learn from every human correction; we have
 * the same signal (field corrections + approve/reject) but throw it away.
 * This module records per-tenant correction memory as data only — no new
 * dependencies, no model training. The extractor consults it as a prior:
 * when the same label recently corrected to the same value shape, the prior
 * boosts that binding. Removing a tenant's memory is a single file delete.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../lib/atomicWrite.js';
import { logger } from '../lib/logger.js';
import { currentTenantId } from '../lib/tenantContext.js';
import { tenantDataDir } from './tenant.service.js';
import { config } from '../config/index.js';

const MEMORY_FILE = 'extraction-memory.json';
const MAX_ENTRIES = 500;

/** @type {Map<string, Array>} correction memory per tenant */
const memoryByTenant = new Map();
/** @type {Set<string>} */
const loadedTenants = new Set();

const usesDisk = () => config.persistence === 'file';

function memoryPath(tenantId) {
  return path.join(tenantDataDir(tenantId), MEMORY_FILE);
}

function memory(tenantId = currentTenantId()) {
  let list = memoryByTenant.get(tenantId);
  if (!list) {
    list = [];
    memoryByTenant.set(tenantId, list);
  }
  return list;
}

async function ensureLoaded(tenantId) {
  if (loadedTenants.has(tenantId)) return;
  loadedTenants.add(tenantId);
  if (!usesDisk()) return;
  try {
    const raw = await fs.readFile(memoryPath(tenantId), 'utf8');
    const stored = JSON.parse(raw);
    if (Array.isArray(stored)) memoryByTenant.set(tenantId, stored.slice(-MAX_ENTRIES));
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('Extraction memory unreadable — starting empty.', { tenantId, error });
  }
}

async function persist(tenantId) {
  if (!usesDisk()) return;
  await atomicWriteFile(memoryPath(tenantId), JSON.stringify(memory(tenantId).slice(-MAX_ENTRIES)), 'utf8').catch(
    (error) => logger.error('Failed to persist extraction memory.', { tenantId, error })
  );
}

/**
 * Records a human correction so future extractions prefer it.
 * @param {object} input { typeId, fieldKey, label, fromValue, toValue }
 */
export async function recordCorrection({ typeId, fieldKey, label, fromValue, toValue }) {
  const tenantId = currentTenantId();
  await ensureLoaded(tenantId);
  const list = memory(tenantId);
  list.push({ typeId, fieldKey, label, fromValue, toValue, at: new Date().toISOString() });
  while (list.length > MAX_ENTRIES) list.shift();
  await persist(tenantId);
  return { recorded: true, entries: list.length };
}

/**
 * Returns a prior boost (0..0.12) when recent corrections for the same
 * type+field agree with the candidate value shape. Pure function of memory.
 */
export async function priorBoost({ typeId, fieldKey, candidateValue }) {
  const tenantId = currentTenantId();
  await ensureLoaded(tenantId);
  const recent = memory(tenantId).filter((entry) => entry.typeId === typeId && entry.fieldKey === fieldKey).slice(-20);
  if (recent.length === 0 || candidateValue === null || candidateValue === undefined) return 0;
  const candidate = String(candidateValue).trim().toLowerCase();
  if (!candidate) return 0;
  const matches = recent.filter((entry) => String(entry.toValue ?? '').trim().toLowerCase() === candidate).length;
  if (matches === 0) return 0;
  return Math.min(0.12, 0.04 + matches * 0.02);
}

/** How many corrections this tenant has taught the extractor, plus the most recent ones. */
export async function memoryStats({ recent = 25 } = {}) {
  const tenantId = currentTenantId();
  await ensureLoaded(tenantId);
  const list = memory(tenantId);
  const byField = new Map();
  for (const entry of list) {
    const key = `${entry.typeId}:${entry.fieldKey}`;
    const current = byField.get(key) ?? { typeId: entry.typeId, fieldKey: entry.fieldKey, label: entry.label, corrections: 0, lastAt: null };
    current.corrections += 1;
    current.lastAt = entry.at;
    byField.set(key, current);
  }
  return {
    entries: list.length,
    capacity: MAX_ENTRIES,
    fields: byField.size,
    topFields: [...byField.values()].sort((left, right) => right.corrections - left.corrections).slice(0, 10),
    recent: list.slice(-Math.max(0, recent)).reverse()
  };
}

/** Forgets every correction this tenant has taught the extractor. */
export async function clearMemory() {
  const tenantId = currentTenantId();
  await ensureLoaded(tenantId);
  const removed = memory(tenantId).length;
  memoryByTenant.set(tenantId, []);
  if (usesDisk()) await fs.rm(memoryPath(tenantId), { force: true });
  return { removed };
}
