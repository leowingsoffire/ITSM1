/**
 * Identity persistence: the global user directory, sessions and workspace
 * API keys.
 *
 * Identity is global rather than per-workspace: one person can belong to
 * several workspaces (an operator serving many client companies) with a
 * different role in each, and a session is bound to exactly one active
 * workspace at a time. Everything lives under `DATA_DIR/identity/`, apart from
 * any workspace's own documents.
 *
 * No secret is stored in the clear: passwords are salted scrypt hashes, and
 * session tokens and API keys are stored only as SHA-256 digests. They are
 * 256-bit / 192-bit random values, so a fast digest is appropriate, and a
 * stolen file cannot be replayed as a credential.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { atomicWriteFile } from '../lib/atomicWrite.js';
import { logger } from '../lib/logger.js';

const IDENTITY_DIRECTORY = 'identity';
const FILES = Object.freeze({ users: 'users.json', sessions: 'sessions.json', apiKeys: 'api-keys.json' });

export const identity = Object.freeze({
  /** @type {Map<string, object>} user id → user */
  users: new Map(),
  /** @type {Map<string, object>} SHA-256(token) → session */
  sessions: new Map(),
  /** @type {Map<string, object>} key id → API key record */
  apiKeys: new Map()
});

const writeChains = { users: Promise.resolve(), sessions: Promise.resolve(), apiKeys: Promise.resolve() };

const usesDisk = () => config.persistence === 'file';

function filePath(store) {
  return path.join(config.dataDir, IDENTITY_DIRECTORY, FILES[store]);
}

async function readList(store) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(store), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('Identity file unreadable — starting empty.', { store, error });
    return [];
  }
}

export async function loadIdentity() {
  identity.users.clear();
  identity.sessions.clear();
  identity.apiKeys.clear();
  if (!usesDisk()) return;

  for (const user of await readList('users')) {
    if (user?.id && user?.email) identity.users.set(user.id, { memberships: [], ...user });
  }
  const now = Date.now();
  for (const session of await readList('sessions')) {
    if (session?.id && Date.parse(session.expiresAt) > now) identity.sessions.set(session.id, session);
  }
  for (const key of await readList('apiKeys')) {
    if (key?.id && key?.hash) identity.apiKeys.set(key.id, key);
  }
  logger.info('Identity directory loaded.', {
    users: identity.users.size,
    sessions: identity.sessions.size,
    apiKeys: identity.apiKeys.size
  });
}

/**
 * Persists one identity store. Writes are serialised per file and each one
 * snapshots the whole map, so a later write always contains every earlier
 * change even if they were requested concurrently.
 * @param {'users'|'sessions'|'apiKeys'} store
 */
export function persistIdentity(store) {
  if (!usesDisk()) return Promise.resolve();
  writeChains[store] = writeChains[store]
    .then(() => atomicWriteFile(filePath(store), JSON.stringify([...identity[store].values()], null, 2), 'utf8'))
    .catch((error) => logger.error('Failed to persist identity store.', { store, error }));
  return writeChains[store];
}

export function flushIdentityWrites() {
  return Promise.all(Object.values(writeChains));
}
