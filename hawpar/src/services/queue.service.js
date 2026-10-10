/**
 * Durable job queue.
 *
 * The pipeline's in-memory `queue[]` loses pending jobs on restart/crash and
 * blocks scale-out. This module adds a file-backed pending-job log behind the
 * same `enqueue()` contract: every job is appended atomically before it runs,
 * removed when a worker picks it up, and re-queued on boot so no accepted
 * upload is silently dropped.
 *
 * File layout: one JSON file per job under `<tenantDir>/queue/<jobId>.json`.
 * Zero new dependencies; memory mode (edge/tests) keeps the old behaviour.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { atomicWriteFile } from '../lib/atomicWrite.js';
import { logger } from '../lib/logger.js';
import { tenantDataDir } from './tenant.service.js';

const QUEUE_DIR = 'queue';

/** @type {Map<string, Array<{documentId: string, correlationId: string}>>} pending jobs per tenant (file mode only) */
const pendingByTenant = new Map();

const usesDisk = () => config.persistence === 'file';

function queueDir(tenantId) {
  return path.join(tenantDataDir(tenantId), QUEUE_DIR);
}

function jobPath(tenantId, jobId) {
  return path.join(queueDir(tenantId), `${jobId}.json`);
}

function pending(tenantId) {
  let list = pendingByTenant.get(tenantId);
  if (!list) {
    list = [];
    pendingByTenant.set(tenantId, list);
  }
  return list;
}

/** Persists one pending job; returns its job id. No-op in memory mode. */
export async function persistJob(tenantId, { documentId, correlationId }) {
  if (!usesDisk()) return null;
  const jobId = randomUUID();
  try {
    await atomicWriteFile(
      jobPath(tenantId, jobId),
      JSON.stringify({ jobId, tenantId, documentId, correlationId, enqueuedAt: new Date().toISOString() }),
      'utf8'
    );
  } catch (error) {
    logger.error('Failed to persist queued job.', { tenantId, documentId, error });
  }
  return jobId;
}

/** Removes a job file once a worker picks it up. Never throws. */
export async function claimJob(tenantId, jobId) {
  if (!usesDisk() || !jobId) return;
  await fs.rm(jobPath(tenantId, jobId), { force: true }).catch(() => {});
}

/**
 * Rebuilds pending jobs from disk on boot. Queued behind the tenant's store
 * load so `tenantDataDir()` is ready. Returns the recovered jobs.
 */
export async function recoverJobs(tenantId) {
  pendingByTenant.set(tenantId, []);
  if (!usesDisk()) return [];
  let entries = [];
  try {
    entries = await fs.readdir(queueDir(tenantId));
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('Job queue unreadable — starting empty.', { tenantId, error });
    return [];
  }
  const recovered = [];
  for (const entry of entries.filter((name) => name.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(path.join(queueDir(tenantId), entry), 'utf8');
      const job = JSON.parse(raw);
      if (job?.documentId) {
        recovered.push({ documentId: job.documentId, correlationId: job.correlationId ?? '', jobId: job.jobId ?? null });
      } else {
        await fs.rm(path.join(queueDir(tenantId), entry), { force: true }).catch(() => {});
      }
    } catch (error) {
      logger.warn('Skipping unreadable queued job file.', { tenantId, file: entry, error: error.message });
    }
  }
  pendingByTenant.set(tenantId, recovered.map((job) => ({ ...job })));
  if (recovered.length > 0) logger.info('Recovered queued jobs from disk.', { tenantId, count: recovered.length });
  return recovered;
}

/** Current durable backlog depth for health reporting. */
export function durableBacklog(tenantId) {
  return pendingByTenant.get(tenantId)?.length ?? 0;
}
