/**
 * Template Studio repository + zonal extraction engine.
 *
 * Mirrors `store.service.js`'s persistence shape (in-memory index per tenant,
 * one JSON file per record, serialised writes) but for a different concept:
 * a customer-trained "extraction template" — a sample document annotated
 * with field regions, optionally paired with the customer's own Excel layout
 * — plus the "runs" produced by applying that template to new documents.
 *
 * Region-based extraction works directly against OCR output (no document
 * classification / declared field schema required), which is what lets a
 * customer train an extractor for a layout the platform has never seen.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { atomicWriteFile } from '../lib/atomicWrite.js';
import { logger } from '../lib/logger.js';
import { formatMoney, parseAmount, parseDate, toIsoDate } from '../lib/format.js';
import { currentTenantId, DEFAULT_TENANT_ID } from '../lib/tenantContext.js';
import { tenantDataDir } from './tenant.service.js';
import {
  assertValidRegion,
  MAX_REGIONS_PER_TEMPLATE,
  SYSTEM_COLUMN_TOKENS,
  sanitiseTemplateName
} from '../domain/customTemplates.js';

const TEMPLATES_DIR = 'templates';
const RUNS_DIR = 'template-runs';
const PREVIEW_TTL_MS = 30 * 60 * 1000; // Preview OCR is only needed while the wizard tab is open.
const MAX_RETAINED_TEMPLATES = 200;
const MAX_RETAINED_RUNS_PER_TEMPLATE = 100;
const MIN_OVERLAP_RATIO = 0.12;

/** @type {Map<string, Map<string, object>>} templates, keyed by tenant id */
const templatesByTenant = new Map();
/** @type {Map<string, Map<string, object>>} runs, keyed by tenant id */
const runsByTenant = new Map();
/** @type {Map<string, {expiresAt: number, payload: object}>} in-memory only — never written to disk */
const previews = new Map();
/** @type {Set<string>} tenants whose store has been loaded from disk at least once */
const loadedTenants = new Set();

let writeChain = Promise.resolve();
const usesDisk = () => config.persistence === 'file';

function templatesIndex(tenantId = currentTenantId()) {
  let map = templatesByTenant.get(tenantId);
  if (!map) {
    map = new Map();
    templatesByTenant.set(tenantId, map);
  }
  return map;
}

function runsIndex(tenantId = currentTenantId()) {
  let map = runsByTenant.get(tenantId);
  if (!map) {
    map = new Map();
    runsByTenant.set(tenantId, map);
  }
  return map;
}

function templatesDirPath(tenantId) {
  return path.join(tenantDataDir(tenantId), TEMPLATES_DIR);
}

function runsDirPath(tenantId) {
  return path.join(tenantDataDir(tenantId), RUNS_DIR);
}

function templateFilePath(id, tenantId) {
  return path.join(templatesDirPath(tenantId), `${id}.json`);
}

function runFilePath(id, tenantId) {
  return path.join(runsDirPath(tenantId), `${id}.json`);
}

function queueWrite(task) {
  if (!usesDisk()) return writeChain;
  writeChain = writeChain.then(task).catch((error) => {
    logger.error('Failed to persist Template Studio state.', { error });
  });
  return writeChain;
}

async function persistTemplate(record, tenantId) {
  return queueWrite(async () => {
    await atomicWriteFile(templateFilePath(record.id, tenantId), JSON.stringify(record), 'utf8');
  });
}

async function persistRun(record, tenantId) {
  return queueWrite(async () => {
    await atomicWriteFile(runFilePath(record.id, tenantId), JSON.stringify(record), 'utf8');
  });
}

async function loadDirectory(dirPath) {
  let entries = [];
  try {
    entries = await fs.readdir(dirPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
  const records = [];
  for (const entry of entries.filter((name) => name.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(path.join(dirPath, entry), 'utf8');
      const record = JSON.parse(raw);
      if (record?.id) records.push(record);
    } catch (error) {
      logger.warn('Skipping unreadable Template Studio file.', { entry, error });
    }
  }
  return records;
}

/** Lazily loads a tenant's templates/runs from disk the first time this process touches that tenant. */
async function ensureTenantLoaded(tenantId) {
  if (loadedTenants.has(tenantId)) return;
  loadedTenants.add(tenantId);
  if (!usesDisk()) return;

  await fs.mkdir(templatesDirPath(tenantId), { recursive: true });
  await fs.mkdir(runsDirPath(tenantId), { recursive: true });

  const templateIndex = templatesIndex(tenantId);
  for (const record of await loadDirectory(templatesDirPath(tenantId))) {
    templateIndex.set(record.id, record);
  }

  const runIndex = runsIndex(tenantId);
  for (const record of await loadDirectory(runsDirPath(tenantId))) {
    runIndex.set(record.id, record);
  }
}

export async function ensureTemplateStoreLoaded() {
  await ensureTenantLoaded(currentTenantId());
}

export async function initialiseTemplateStore() {
  loadedTenants.add(DEFAULT_TENANT_ID);
  if (usesDisk()) {
    await fs.mkdir(templatesDirPath(DEFAULT_TENANT_ID), { recursive: true });
    await fs.mkdir(runsDirPath(DEFAULT_TENANT_ID), { recursive: true });
  }
  const templateIndex = templatesIndex(DEFAULT_TENANT_ID);
  for (const record of await loadDirectory(templatesDirPath(DEFAULT_TENANT_ID))) {
    templateIndex.set(record.id, record);
  }
  const runIndex = runsIndex(DEFAULT_TENANT_ID);
  for (const record of await loadDirectory(runsDirPath(DEFAULT_TENANT_ID))) {
    runIndex.set(record.id, record);
  }
  logger.info('Template Studio store initialised.', { templateCount: templateIndex.size, runCount: runIndex.size });
}

/** Test-only reset, mirroring `store.service.js`'s `clearAll()`. */
export async function clearAllTemplates() {
  templatesByTenant.clear();
  runsByTenant.clear();
  previews.clear();
  loadedTenants.clear();
  writeChain = Promise.resolve();
}

// ---------------------------------------------------------------------------
// Preview (OCR of the sample / training document) — deliberately in-memory
// only. It is a working artefact for the wizard, not a customer record, so it
// never touches disk and expires after PREVIEW_TTL_MS.
// ---------------------------------------------------------------------------

function sweepExpiredPreviews() {
  const now = Date.now();
  for (const [id, entry] of previews) {
    if (entry.expiresAt < now) previews.delete(id);
  }
}

/**
 * Stores an analyzer result keyed by a short-lived preview id so the editing
 * UI can re-fetch OCR line/page data while the customer is drawing regions.
 */
export function cachePreview({ tenantId, fileName, mimeType, analysis }) {
  sweepExpiredPreviews();
  const id = randomUUID();
  const pages = (analysis.pages ?? []).map((page) => ({
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    lines: (page.lines ?? []).map((line) => ({ content: line.content, box: line.box, confidence: line.confidence }))
  }));
  previews.set(id, {
    expiresAt: Date.now() + PREVIEW_TTL_MS,
    payload: {
      id,
      tenantId,
      fileName,
      mimeType,
      pageCount: pages.length,
      engine: analysis.engine,
      pages
    }
  });
  return previews.get(id).payload;
}

export function getPreview(previewId, tenantId) {
  sweepExpiredPreviews();
  const entry = previews.get(previewId);
  if (!entry || entry.payload.tenantId !== tenantId) {
    throw notFound('This preview has expired. Re-upload the sample document to keep training.', { previewId });
  }
  return entry.payload;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function evictTemplatesIfNeeded(tenantId) {
  const index = templatesIndex(tenantId);
  if (index.size <= MAX_RETAINED_TEMPLATES) return;
  const sorted = [...index.values()].sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
  for (let i = 0; i < index.size - MAX_RETAINED_TEMPLATES; i += 1) {
    const victim = sorted[i];
    index.delete(victim.id);
    queueWrite(() => fs.rm(templateFilePath(victim.id, tenantId), { force: true }));
  }
}

function validateExcelTemplate(excelTemplate, regionKeys) {
  if (!excelTemplate) return null;
  const { fileName, sheetName, columns, mappings } = excelTemplate;
  if (!Array.isArray(columns) || columns.length === 0) {
    throw badRequest('"excelTemplate.columns" is required and must be non-empty.');
  }
  const knownTargets = new Set([...regionKeys, ...Object.values(SYSTEM_COLUMN_TOKENS), null]);
  const safeMappings = {};
  for (const column of columns) {
    const target = mappings?.[column.index] ?? null;
    if (target !== null && !knownTargets.has(target)) {
      throw badRequest(`Column "${column.header}" is mapped to an unknown field ("${target}").`);
    }
    safeMappings[column.index] = target;
  }
  return {
    fileName: String(fileName ?? 'template.xlsx').slice(0, 200),
    sheetName: String(sheetName ?? 'Sheet1').slice(0, 31),
    columns: columns.map((column) => ({ column: column.column, index: column.index, header: String(column.header).slice(0, 120) })),
    mappings: safeMappings
  };
}

/**
 * Creates a new extraction template.
 * @param {object} input
 * @param {string} input.name
 * @param {string} [input.description]
 * @param {string} input.previewId       Preview produced by `analyzeTemplateSource`.
 * @param {Array<object>} input.regions  Drawn field regions.
 * @param {object} [input.excelTemplate] Parsed customer Excel layout + column mappings.
 */
export function createTemplate({ name, description, previewId, regions, excelTemplate }) {
  const tenantId = currentTenantId();
  const preview = getPreview(previewId, tenantId);

  if (!Array.isArray(regions) || regions.length === 0) {
    throw badRequest('At least one field region is required to create a template.');
  }
  if (regions.length > MAX_REGIONS_PER_TEMPLATE) {
    throw badRequest(`A template supports at most ${MAX_REGIONS_PER_TEMPLATE} fields.`);
  }

  const cleanRegions = regions.map((region, index) => assertValidRegion(region, index));
  const keys = new Set();
  for (const region of cleanRegions) {
    if (keys.has(region.key)) throw badRequest(`Duplicate field key "${region.key}" — field keys must be unique.`);
    keys.add(region.key);
    if (region.pageNumber > preview.pageCount) {
      throw badRequest(`Region "${region.label}" references page ${region.pageNumber}, but the sample only has ${preview.pageCount} page(s).`);
    }
  }

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    tenantId,
    name: sanitiseTemplateName(name),
    description: String(description ?? '').trim().slice(0, 500) || null,
    createdAt: now,
    updatedAt: now,
    sourceFileName: preview.fileName,
    sourceMimeType: preview.mimeType,
    pageCount: preview.pageCount,
    engine: preview.engine,
    regions: cleanRegions,
    excelTemplate: validateExcelTemplate(excelTemplate, keys),
    runCount: 0,
    lastRunAt: null
  };

  templatesIndex(tenantId).set(record.id, record);
  evictTemplatesIfNeeded(tenantId);
  persistTemplate(record, tenantId);
  logger.info('Extraction template created.', { templateId: record.id, tenantId, fieldCount: cleanRegions.length });
  return record;
}

export function getTemplate(id) {
  const record = templatesIndex().get(id);
  if (!record) throw notFound(`Template "${id}" was not found.`, { templateId: id });
  return record;
}

export function listTemplates() {
  return [...templatesIndex().values()].sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

export function updateTemplate(id, patch) {
  const tenantId = currentTenantId();
  const existing = getTemplate(id);

  const next = { ...existing };
  if (patch.name !== undefined) next.name = sanitiseTemplateName(patch.name);
  if (patch.description !== undefined) next.description = String(patch.description ?? '').trim().slice(0, 500) || null;

  if (patch.regions !== undefined) {
    if (!Array.isArray(patch.regions) || patch.regions.length === 0) {
      throw badRequest('At least one field region is required.');
    }
    if (patch.regions.length > MAX_REGIONS_PER_TEMPLATE) {
      throw badRequest(`A template supports at most ${MAX_REGIONS_PER_TEMPLATE} fields.`);
    }
    const cleanRegions = patch.regions.map((region, index) => assertValidRegion(region, index));
    const keys = new Set();
    for (const region of cleanRegions) {
      if (keys.has(region.key)) throw badRequest(`Duplicate field key "${region.key}" — field keys must be unique.`);
      keys.add(region.key);
    }
    next.regions = cleanRegions;
  }

  if (patch.excelTemplate !== undefined) {
    const regionKeys = new Set(next.regions.map((region) => region.key));
    next.excelTemplate = patch.excelTemplate === null ? null : validateExcelTemplate(patch.excelTemplate, regionKeys);
  }

  next.updatedAt = new Date().toISOString();
  templatesIndex(tenantId).set(id, next);
  persistTemplate(next, tenantId);
  return next;
}

export async function deleteTemplate(id) {
  const tenantId = currentTenantId();
  getTemplate(id); // 404s if missing
  templatesIndex(tenantId).delete(id);
  await queueWrite(() => fs.rm(templateFilePath(id, tenantId), { force: true }));

  const runIndex = runsIndex(tenantId);
  const orphanedRuns = [...runIndex.values()].filter((run) => run.templateId === id);
  for (const run of orphanedRuns) {
    runIndex.delete(run.id);
    await queueWrite(() => fs.rm(runFilePath(run.id, tenantId), { force: true }));
  }
  return { deleted: true, id, runsRemoved: orphanedRuns.length };
}

// ---------------------------------------------------------------------------
// Zonal extraction
// ---------------------------------------------------------------------------

function intersectionArea(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  return width * height;
}

function coerceValue(rawText, type) {
  const text = String(rawText ?? '').trim();
  if (text.length === 0) return { value: null, displayValue: '' };

  if (type === 'number' || type === 'currency') {
    const amount = parseAmount(text);
    if (amount === null) return { value: null, displayValue: text };
    return { value: amount, displayValue: type === 'currency' ? formatMoney(amount) : String(amount) };
  }
  if (type === 'date') {
    const date = parseDate(text);
    if (!date) return { value: null, displayValue: text };
    return { value: toIsoDate(date), displayValue: toIsoDate(date) };
  }
  return { value: text, displayValue: text };
}

/**
 * Extracts one field's value from a document's OCR analysis by finding every
 * recognised line that overlaps the trained region, in reading order.
 *
 * @param {object} analysis   Result of `analyzeDocument()` for the *target* file.
 * @param {object} region     A trained region `{key,label,type,pageNumber,box}`.
 * @returns {{key:string,label:string,type:string,rawText:string,value:*,displayValue:string,confidence:number}}
 */
export function extractRegionField(analysis, region) {
  const page = (analysis.pages ?? []).find((candidate) => candidate.pageNumber === region.pageNumber);
  if (!page) {
    return { key: region.key, label: region.label, type: region.type, rawText: '', value: null, displayValue: '', confidence: 0 };
  }

  const regionArea = region.box[2] * region.box[3];
  const matches = [];
  let coveredArea = 0;

  for (const line of page.lines ?? []) {
    if (!line.box) continue;
    const lineArea = line.box[2] * line.box[3];
    if (lineArea <= 0) continue;
    const overlap = intersectionArea(line.box, region.box);
    const overlapRatio = overlap / lineArea;
    if (overlapRatio < MIN_OVERLAP_RATIO) continue;
    matches.push({ line, overlapRatio });
    coveredArea += overlap;
  }

  // Reading order: top row first, then left-to-right within a row.
  matches.sort((left, right) => {
    const rowDelta = left.line.box[1] - right.line.box[1];
    if (Math.abs(rowDelta) > 0.006) return rowDelta;
    return left.line.box[0] - right.line.box[0];
  });

  const rawText = matches.map((match) => match.line.content).join(' ').trim();
  const { value, displayValue } = coerceValue(rawText, region.type);

  const weightedConfidence = matches.length
    ? matches.reduce((sum, match) => sum + (match.line.confidence ?? 0.8) * match.overlapRatio, 0) /
      matches.reduce((sum, match) => sum + match.overlapRatio, 0)
    : 0;
  const coverageRatio = regionArea > 0 ? Math.min(1, coveredArea / regionArea) : 0;
  const confidence = matches.length ? Number((weightedConfidence * Math.min(1, coverageRatio * 1.25 + 0.25)) .toFixed(4)) : 0;

  return {
    key: region.key,
    label: region.label,
    type: region.type,
    rawText,
    value,
    displayValue,
    confidence,
    critical: region.critical === true
  };
}

/** Runs every region of a template against one document's analysis. */
export function extractTemplateFields(template, analysis) {
  return template.regions.map((region) => extractRegionField(analysis, region));
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

function evictRunsIfNeeded(tenantId, templateId) {
  const index = runsIndex(tenantId);
  const forTemplate = [...index.values()].filter((run) => run.templateId === templateId);
  if (forTemplate.length <= MAX_RETAINED_RUNS_PER_TEMPLATE) return;
  const sorted = forTemplate.sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
  for (let i = 0; i < forTemplate.length - MAX_RETAINED_RUNS_PER_TEMPLATE; i += 1) {
    const victim = sorted[i];
    index.delete(victim.id);
    queueWrite(() => fs.rm(runFilePath(victim.id, tenantId), { force: true }));
  }
}

/**
 * Records a completed extraction run (one or more documents processed against
 * a template).
 */
export function createRun({ templateId, documents }) {
  const tenantId = currentTenantId();
  const template = getTemplate(templateId);
  const now = new Date().toISOString();

  const record = {
    id: randomUUID(),
    tenantId,
    templateId,
    createdAt: now,
    documents
  };

  runsIndex(tenantId).set(record.id, record);
  evictRunsIfNeeded(tenantId, templateId);
  persistRun(record, tenantId);

  const updatedTemplate = { ...template, runCount: (template.runCount ?? 0) + 1, lastRunAt: now };
  templatesIndex(tenantId).set(templateId, updatedTemplate);
  persistTemplate(updatedTemplate, tenantId);

  return record;
}

export function getRun(id) {
  const record = runsIndex().get(id);
  if (!record) throw notFound(`Extraction run "${id}" was not found.`, { runId: id });
  return record;
}

export function listRuns(templateId) {
  return [...runsIndex().values()]
    .filter((run) => run.templateId === templateId)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}
