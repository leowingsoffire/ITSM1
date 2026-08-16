/**
 * Tenant registry — the "workspace" a customer gets after completing the
 * onboarding wizard.
 *
 * This is intentionally lightweight, consistent with the rest of the
 * platform's demo-grade identity model (see `public/js/login.js`): there is
 * still no real user/password/session backend. What onboarding adds is
 * *workspace isolation* — each tenant gets its own settings document, its own
 * document/document-store namespace and its own upload directory, so one
 * customer's company profile, branding and processed documents can never leak
 * into another's. The client persists the returned tenant id (localStorage)
 * and sends it on every request as `x-tenant-id`; the server is the source of
 * truth for what that id is allowed to see.
 *
 * Single JSON file persistence, mirroring `settings.service.js` — this is a
 * registry of workspaces, not a workspace's data itself.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { DEFAULT_TENANT_ID } from '../lib/tenantContext.js';

const REGISTRY_FILE = 'tenants.json';
const MAX_NAME_LENGTH = 160;
const MAX_SLUG_LENGTH = 48;

/** Curated so the wizard's dropdown is meaningful without needing a taxonomy service. */
export const BUSINESS_TYPES = Object.freeze([
  'Healthcare & Life Sciences',
  'Leisure & Hospitality',
  'Property & Real Estate',
  'Insurance & Investments',
  'Banking & Financial Services',
  'Logistics & Supply Chain',
  'Retail & E-commerce',
  'Manufacturing',
  'Professional Services',
  'Government & Public Sector',
  'Education',
  'Other'
]);

/** @type {Map<string, object>} keyed by tenant id */
const tenants = new Map();
let writeChain = Promise.resolve();
let initialised = false;

const usesDisk = () => config.persistence === 'file';

function registryPath() {
  return path.join(config.dataDir, REGISTRY_FILE);
}

function queueWrite(task) {
  if (!usesDisk()) return writeChain;
  writeChain = writeChain.then(task).catch((error) => {
    logger.error('Failed to persist tenant registry.', { error });
  });
  return writeChain;
}

async function persist() {
  return queueWrite(async () => {
    await fs.mkdir(config.dataDir, { recursive: true });
    const payload = JSON.stringify([...tenants.values()], null, 2);
    await fs.writeFile(registryPath(), payload, 'utf8');
  });
}

function slugify(input) {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH) || 'workspace';
}

export async function initialiseTenantRegistry() {
  tenants.clear();
  initialised = true;
  if (!usesDisk()) return;

  await fs.mkdir(config.dataDir, { recursive: true });
  try {
    const raw = await fs.readFile(registryPath(), 'utf8');
    const stored = JSON.parse(raw);
    for (const record of Array.isArray(stored) ? stored : []) {
      if (record?.id) tenants.set(record.id, record);
    }
    logger.info('Tenant registry loaded from disk.', { count: tenants.size });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('Tenant registry file unreadable — starting empty.', { error });
    }
  }
}

/** @returns {string} a data directory scoped to `tenantId`, or the shared root for the default workspace. */
export function tenantDataDir(tenantId) {
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) return config.dataDir;
  return path.join(config.dataDir, 'tenants', tenantId);
}

/** @returns {string} the upload directory scoped to `tenantId`. */
export function tenantUploadDir(tenantId) {
  return path.join(tenantDataDir(tenantId), 'uploads');
}

function ensureUniqueSlug(base) {
  let candidate = base;
  let suffix = 1;
  const taken = new Set([...tenants.values()].map((tenant) => tenant.slug));
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

/**
 * Provisions a brand-new isolated workspace for a customer completing the
 * onboarding wizard.
 * @param {object} input
 * @param {string} input.companyName
 * @param {string} input.businessType
 * @param {string} [input.contactName]
 * @param {string} [input.contactEmail]
 * @param {string} [input.country]
 * @param {string} [input.companySize]
 * @returns {Promise<object>} the created tenant record
 */
export async function createTenant(input) {
  if (!initialised) throw new Error('Tenant registry was not initialised.');

  const companyName = String(input?.companyName ?? '').trim();
  if (companyName.length < 2 || companyName.length > MAX_NAME_LENGTH) {
    throw badRequest(`"companyName" must be between 2 and ${MAX_NAME_LENGTH} characters.`);
  }

  const businessType = String(input?.businessType ?? '').trim();
  if (businessType.length === 0) {
    throw badRequest('"businessType" is required.');
  }

  const contactEmail = String(input?.contactEmail ?? '').trim();
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw badRequest('"contactEmail" must be a valid email address.');
  }

  const slug = ensureUniqueSlug(slugify(companyName));
  const id = `${slug}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const tenant = {
    id,
    slug,
    companyName,
    businessType,
    contactName: String(input?.contactName ?? '').trim().slice(0, MAX_NAME_LENGTH) || null,
    contactEmail: contactEmail || null,
    country: String(input?.country ?? '').trim().slice(0, 80) || null,
    companySize: String(input?.companySize ?? '').trim().slice(0, 40) || null,
    createdAt: now,
    updatedAt: now,
    status: 'active'
  };

  tenants.set(id, tenant);
  await persist();

  logger.info('Tenant workspace provisioned.', { tenantId: id, companyName, businessType });
  return tenant;
}

/** @returns {object} the tenant record, throwing 404 if unknown (except the reserved default workspace). */
export function getTenant(tenantId) {
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
    return { id: DEFAULT_TENANT_ID, slug: DEFAULT_TENANT_ID, companyName: null, status: 'active' };
  }
  const tenant = tenants.get(tenantId);
  if (!tenant) throw notFound(`Workspace "${tenantId}" was not found.`, { tenantId });
  return tenant;
}

/** @returns {boolean} whether `tenantId` is a known, provisioned workspace (or the default one). */
export function tenantExists(tenantId) {
  return !tenantId || tenantId === DEFAULT_TENANT_ID || tenants.has(tenantId);
}

export function listTenants() {
  return [...tenants.values()].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

export function tenantCount() {
  return tenants.size;
}
