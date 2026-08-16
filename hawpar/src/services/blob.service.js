/**
 * Uploaded-file storage.
 *
 * Two drivers behind one interface: the local prototype writes bytes to disk,
 * while serverless edge runtimes (which have no durable file system) keep them
 * in the isolate. Swappable for Azure Blob Storage without touching callers.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { currentTenantId } from '../lib/tenantContext.js';
import { tenantUploadDir } from './tenant.service.js';

const MAX_RETAINED_BLOBS = 500;

/** @type {Map<string, Buffer>} */
const blobs = new Map();

const usesDisk = () => config.persistence === 'file';

function evictIfNeeded() {
  while (blobs.size > MAX_RETAINED_BLOBS) {
    const oldest = blobs.keys().next().value;
    blobs.delete(oldest);
  }
}

/**
 * Persists uploaded bytes and returns the opaque key used to read them back.
 * @param {Buffer} buffer
 * @param {string} extension file extension including the leading dot
 * @returns {Promise<string>}
 */
export async function putUpload(buffer, extension) {
  const uploadDir = tenantUploadDir(currentTenantId());
  const key = path.join(uploadDir, `${randomUUID()}${extension}`);

  if (usesDisk()) {
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(key, buffer);
    return key;
  }

  blobs.set(key, buffer);
  evictIfNeeded();
  return key;
}

/**
 * @param {string} key returned by {@link putUpload}
 * @returns {Promise<Buffer>}
 */
export async function getUpload(key) {
  if (usesDisk()) return fs.readFile(key);

  const buffer = blobs.get(key);
  if (!buffer) {
    const error = new Error(`Upload ${key} is no longer available.`);
    error.code = 'ENOENT';
    throw error;
  }
  return buffer;
}

/** Best-effort removal; missing blobs are not an error. */
export async function removeUpload(key) {
  if (!key) return;
  if (usesDisk()) {
    await fs.rm(key, { force: true }).catch(() => {});
    return;
  }
  blobs.delete(key);
}

/** Drops every stored blob — used by the admin reset endpoint. */
export function clearUploads() {
  blobs.clear();
}
