/**
 * Settings repository.
 *
 * Single-document JSON persistence (one `settings.json` per workspace under
 * that workspace's tenant-scoped data directory), mirroring the pattern in
 * `store.service.js`. Every tenant (see `tenant.service.js`) gets its own
 * settings document — the current tenant is resolved from the async request
 * context (`lib/tenantContext.js`) so callers never have to pass a tenant id
 * through every function signature. The original, un-namespaced "default"
 * workspace keeps its historical `data/settings.json` path, so existing
 * deployments/tests are unaffected.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { currentTenantId, DEFAULT_TENANT_ID } from '../lib/tenantContext.js';
import { tenantDataDir } from './tenant.service.js';
import {
  FIELD_POLICY,
  Role,
  defaultSettings,
  deepMerge,
  flattenPaths,
  policyFor,
  timezoneForCountry
} from '../domain/settings.js';

const SETTINGS_FILE = 'settings.json';
const MAX_LOGO_DATA_URL_LENGTH = 400_000; // ~300KB decoded — plenty for a compact header/sidebar logo.

/** @type {Map<string, object>} settings document keyed by tenant id */
const settingsByTenant = new Map();
/** @type {Map<string, Promise>} serialised write chain keyed by tenant id */
const writeChains = new Map();
/** @type {Set<string>} tenants whose settings file has been read/seeded at least once */
const loadedTenants = new Set();

const usesDisk = () => config.persistence === 'file';

function settingsPath(tenantId) {
  return path.join(tenantDataDir(tenantId), SETTINGS_FILE);
}

function queueWrite(tenantId, task) {
  if (!usesDisk()) return Promise.resolve();
  const chain = (writeChains.get(tenantId) ?? Promise.resolve()).then(task).catch((error) => {
    logger.error('Failed to persist settings.', { tenantId, error });
  });
  writeChains.set(tenantId, chain);
  return chain;
}

async function persist(tenantId) {
  const document = settingsByTenant.get(tenantId);
  return queueWrite(tenantId, async () => {
    const dir = tenantDataDir(tenantId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(settingsPath(tenantId), JSON.stringify(document, null, 2), 'utf8');
  });
}

/**
 * Lazily loads (or seeds) the settings document for a tenant on first access
 * within a process. Called on every read/write so a workspace created after
 * boot — via the onboarding wizard — is picked up without a restart.
 */
async function ensureLoaded(tenantId) {
  if (loadedTenants.has(tenantId)) return;
  loadedTenants.add(tenantId);

  if (tenantId === DEFAULT_TENANT_ID) {
    // The default workspace's document is seeded eagerly by
    // `initialiseSettingsStore()` at boot; nothing more to do here.
    return;
  }

  settingsByTenant.set(tenantId, defaultSettings());
  if (!usesDisk()) return;

  const dir = tenantDataDir(tenantId);
  await fs.mkdir(dir, { recursive: true });
  try {
    const raw = await fs.readFile(settingsPath(tenantId), 'utf8');
    const stored = JSON.parse(raw);
    settingsByTenant.set(tenantId, deepMerge(defaultSettings(), stored));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('Tenant settings file unreadable — starting from defaults.', { tenantId, error });
    } else {
      await persist(tenantId);
    }
  }
}

export async function initialiseSettingsStore() {
  settingsByTenant.set(DEFAULT_TENANT_ID, defaultSettings());
  loadedTenants.add(DEFAULT_TENANT_ID);
  if (!usesDisk()) return;

  await fs.mkdir(config.dataDir, { recursive: true });
  try {
    const raw = await fs.readFile(settingsPath(DEFAULT_TENANT_ID), 'utf8');
    const stored = JSON.parse(raw);
    settingsByTenant.set(DEFAULT_TENANT_ID, deepMerge(defaultSettings(), stored));
    logger.info('Settings store loaded from disk.', { path: settingsPath(DEFAULT_TENANT_ID) });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('Settings file unreadable — starting from defaults.', { error });
    } else {
      await persist(DEFAULT_TENANT_ID);
      logger.info('No settings file found — seeded defaults.', { path: settingsPath(DEFAULT_TENANT_ID) });
    }
  }
}

/**
 * Seeds a brand-new tenant's settings document from the onboarding wizard's
 * inputs (company name/business type), so the workspace opens already
 * personalised instead of showing VGC's own demo defaults.
 * @param {string} tenantId
 * @param {object} companyPatch e.g. `{ name, address: { country } }`
 */
export async function seedTenantSettings(tenantId, companyPatch = {}) {
  const base = defaultSettings();
  const seeded = deepMerge(base, {
    company: { ...companyPatch, uen: '', legalName: companyPatch.name ?? base.company.legalName },
    branding: { appName: companyPatch.appName ?? base.branding.appName, logoDataUrl: null, logoUpdatedAt: null },
    meta: { updatedAt: new Date().toISOString(), updatedBy: 'onboarding' }
  });
  settingsByTenant.set(tenantId, seeded);
  loadedTenants.add(tenantId);
  await persist(tenantId);
  return seeded;
}

/** @returns {object} the full, unredacted settings document for the current tenant (server-side use only). */
export function getSettingsRaw() {
  const tenantId = currentTenantId();
  return settingsByTenant.get(tenantId) ?? defaultSettings();
}

/**
 * Ensures the current tenant's settings are loaded before a route handler
 * reads/writes them. Must be awaited before `getSettingsRaw()`/`updateSettings()`
 * on any non-default tenant the first time it's touched in this process.
 */
export async function ensureTenantSettingsLoaded() {
  await ensureLoaded(currentTenantId());
}

/**
 * Validates every path in `patch` against the caller's role, throwing a 403
 * naming the first field the caller is not permitted to change.
 * @param {object} patch
 * @param {'admin'|'user'} role
 */
export function assertEditable(patch, role) {
  const paths = flattenPaths(patch);
  for (const dotPath of paths) {
    const required = policyFor(dotPath);
    if (required === Role.ADMIN && role !== Role.ADMIN) {
      throw forbidden(`"${dotPath}" can only be changed by an administrator.`, { field: dotPath });
    }
  }
}

/**
 * Applies a partial update, enforcing role policy and re-deriving the
 * timezone from the company country when auto-sync is enabled.
 * @param {object} patch
 * @param {'admin'|'user'} role
 * @param {string} actor
 */
export async function updateSettings(patch, role, actor = 'unknown') {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw badRequest('Settings patch must be an object.');
  }
  assertEditable(patch, role);

  const tenantId = currentTenantId();
  await ensureLoaded(tenantId);
  const settings = settingsByTenant.get(tenantId) ?? defaultSettings();

  let next = deepMerge(settings, patch);

  const countryChanged = patch.company?.address?.country !== undefined
    && patch.company.address.country !== settings.company?.address?.country;
  const autoTimezoneOn = next.regional?.autoTimezone !== false;
  const timezoneExplicitlySet = patch.regional?.timezone !== undefined;

  if (autoTimezoneOn && countryChanged && !timezoneExplicitlySet) {
    next = deepMerge(next, { regional: { timezone: timezoneForCountry(next.company.address.country) } });
  }

  next.meta = { updatedAt: new Date().toISOString(), updatedBy: actor };
  settingsByTenant.set(tenantId, next);
  await persist(tenantId);
  return next;
}

export const editPolicy = FIELD_POLICY;
