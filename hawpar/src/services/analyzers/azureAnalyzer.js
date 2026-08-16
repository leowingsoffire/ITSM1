/**
 * Azure AI Document Intelligence analysis engine.
 *
 * Calls the Document Intelligence REST API directly (no SDK) to keep the
 * dependency surface — and therefore the patch/vulnerability surface — minimal.
 *
 * Supported authentication:
 *  1. Resource key           (AZURE_DOCINT_KEY)
 *  2. Managed identity       (App Service / Container Apps IMDS, no secret stored)
 *
 * Deep integration points exercised here:
 *  - adaptive model routing (`modelId`) chosen by the Document Intelligence agent
 *  - single-page triage (`pages`) so classification never pays Layout twice
 *  - add-on capabilities (`features=`): high-resolution OCR, barcodes, formulas,
 *    font/style, language detection and key-value pairs
 *  - `queryFields=` for values that sit outside a prebuilt schema
 *  - prebuilt domain output (`analyzeResult.documents[].fields`) normalised into
 *    typed, confidence-scored field candidates the extraction agent can consume
 */
import { AppError, ErrorCode, analyzerFailed } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { buildAuthHeaders, fetchWithTimeout, sleep, throttleError } from './azureHttp.js';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 240; // ~6 minutes, enough for 1000+ page documents.
const MAX_RETRIES = 4;
const MAX_QUERY_FIELDS = 20;

/** Builds the `features`/`queryFields` query fragment for the analyse call. */
function addOnQuery(features = [], queryFields = []) {
  const parts = [];
  const cleanFeatures = [...new Set(features.filter((entry) => typeof entry === 'string' && entry.trim()))];
  if (cleanFeatures.length > 0) parts.push(`&features=${encodeURIComponent(cleanFeatures.join(','))}`);

  const cleanQueryFields = [...new Set(queryFields.filter((entry) => typeof entry === 'string' && entry.trim()))].slice(
    0,
    MAX_QUERY_FIELDS
  );
  if (cleanQueryFields.length > 0) {
    parts.push(`&queryFields=${encodeURIComponent(cleanQueryFields.join(','))}`);
  }
  return parts.join('');
}

async function submitAnalysis({
  analyzerConfig,
  buffer,
  contentType,
  correlationId,
  modelId,
  pages,
  features,
  queryFields
}) {
  const pageRange = pages ? `&pages=${encodeURIComponent(pages)}` : '';
  const url =
    `${analyzerConfig.endpoint}/documentintelligence/documentModels/` +
    `${encodeURIComponent(modelId ?? analyzerConfig.modelId)}:analyze` +
    `?api-version=${encodeURIComponent(analyzerConfig.apiVersion)}&outputContentFormat=text${pageRange}` +
    addOnQuery(features, queryFields);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const authHeaders = await buildAuthHeaders(analyzerConfig);
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': contentType || 'application/octet-stream',
        'x-ms-client-request-id': correlationId
      },
      body: buffer
    });

    if (response.status === 202) {
      const operationLocation = response.headers.get('operation-location');
      if (!operationLocation) {
        throw analyzerFailed('Azure did not return an operation-location header.', { status: 202 });
      }
      return operationLocation;
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get('retry-after') ?? attempt * 2);
      logger.warn('Document Intelligence throttled, backing off.', { attempt, retryAfter, correlationId });
      await sleep(retryAfter * 1000);
      continue;
    }

    const body = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw analyzerFailed('Azure rejected the credentials for Document Intelligence.', {
        status: response.status,
        hint: 'Verify AZURE_DOCINT_KEY or the "Cognitive Services User" role assignment.'
      });
    }
    if (response.status === 429) throw throttleError(60);
    throw analyzerFailed('Azure Document Intelligence rejected the document.', {
      status: response.status,
      detail: body.slice(0, 500)
    });
  }

  throw throttleError(60);
}

async function pollResult({ analyzerConfig, operationLocation, correlationId }) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);
    const authHeaders = await buildAuthHeaders(analyzerConfig);
    const response = await fetchWithTimeout(operationLocation, {
      headers: { ...authHeaders, 'x-ms-client-request-id': correlationId }
    });

    if (response.status === 429) {
      await sleep(Number(response.headers.get('retry-after') ?? 5) * 1000);
      continue;
    }
    if (!response.ok) {
      throw analyzerFailed('Failed to poll the Document Intelligence operation.', {
        status: response.status
      });
    }

    const payload = await response.json();
    if (payload.status === 'succeeded') return payload;
    if (payload.status === 'failed') {
      throw analyzerFailed('Azure Document Intelligence could not process the document.', {
        detail: payload.error?.message ?? 'Unknown analyser failure.'
      });
    }
  }

  throw new AppError({
    code: ErrorCode.ANALYZER_TIMEOUT,
    message: 'Document analysis exceeded the maximum polling window.',
    status: 504
  });
}

/** Converts an Azure polygon (inches) into a normalised [x, y, w, h] box. */
function polygonToBox(polygon, page) {
  if (!Array.isArray(polygon) || polygon.length < 4 || !page?.width || !page?.height) return null;
  const xs = [];
  const ys = [];
  for (let index = 0; index < polygon.length; index += 2) {
    xs.push(polygon[index]);
    ys.push(polygon[index + 1]);
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return [
    Number((minX / page.width).toFixed(5)),
    Number((minY / page.height).toFixed(5)),
    Number(((Math.max(...xs) - minX) / page.width).toFixed(5)),
    Number(((Math.max(...ys) - minY) / page.height).toFixed(5))
  ];
}

function regionPage(regions) {
  return regions?.[0]?.pageNumber ?? 1;
}

/** Human-readable value for one entry of `analyzeResult.documents[].fields`. */
function flattenDocumentField(field) {
  if (!field || typeof field !== 'object') return null;
  switch (field.type) {
    case 'string':
    case 'phoneNumber':
    case 'countryRegion':
      return field.valueString ?? field.valuePhoneNumber ?? field.valueCountryRegion ?? field.content ?? null;
    case 'number':
      return field.valueNumber !== undefined ? String(field.valueNumber) : (field.content ?? null);
    case 'integer':
      return field.valueInteger !== undefined ? String(field.valueInteger) : (field.content ?? null);
    case 'date':
      return field.valueDate ?? field.content ?? null;
    case 'time':
      return field.valueTime ?? field.content ?? null;
    case 'currency': {
      const currency = field.valueCurrency;
      if (!currency) return field.content ?? null;
      const symbol = currency.currencyCode ? `${currency.currencyCode} ` : '';
      return `${symbol}${currency.amount ?? ''}`.trim() || (field.content ?? null);
    }
    case 'address':
      return field.content ?? null;
    case 'selectionMark':
      return field.valueSelectionMark ?? null;
    case 'array':
      return field.content ?? `${(field.valueArray ?? []).length} item(s)`;
    case 'object':
      return field.content ?? null;
    default:
      return field.content ?? null;
  }
}

/**
 * Normalises `analyzeResult.documents[]` (prebuilt domain models) into flat,
 * confidence-scored candidates. These are merged with Layout key-value pairs by
 * the extraction agent, giving a genuine second source for critical fields.
 */
function normaliseDocumentFields(result, pagesByNumber) {
  const documents = result.documents ?? [];
  const candidates = [];

  for (const document of documents) {
    for (const [name, field] of Object.entries(document.fields ?? {})) {
      const value = flattenDocumentField(field);
      if (value === null || value === undefined || String(value).trim() === '') continue;
      const pageNumber = regionPage(field.boundingRegions);
      candidates.push({
        key: name,
        value: String(value).trim(),
        confidence: Number((field.confidence ?? document.confidence ?? 0.9).toFixed(4)),
        pageNumber,
        docType: document.docType ?? null,
        valueType: field.type ?? 'string',
        box: polygonToBox(field.boundingRegions?.[0]?.polygon, pagesByNumber.get(pageNumber)) ?? null
      });
    }
  }

  return candidates;
}

/** Barcodes / QR codes returned by the `ocr.barcode` add-on. */
function normaliseBarcodes(azurePages) {
  const barcodes = [];
  for (const page of azurePages) {
    for (const barcode of page.barcodes ?? []) {
      barcodes.push({
        pageNumber: page.pageNumber,
        kind: barcode.kind ?? 'unknown',
        value: barcode.value ?? '',
        confidence: Number((barcode.confidence ?? 0.9).toFixed(4))
      });
    }
  }
  return barcodes;
}

/** Formulas returned by the `ocr.formula` add-on. */
function normaliseFormulas(azurePages) {
  const formulas = [];
  for (const page of azurePages) {
    for (const formula of page.formulas ?? []) {
      formulas.push({
        pageNumber: page.pageNumber,
        kind: formula.kind ?? 'inline',
        value: formula.value ?? '',
        confidence: Number((formula.confidence ?? 0.9).toFixed(4))
      });
    }
  }
  return formulas;
}

/** Maps the Azure analyzeResult onto the platform's normalised contract. */
export function normaliseAzureResult(payload, { modelId, apiVersion, durationMs, features = [], queryFields = [] }) {
  const result = payload.analyzeResult ?? {};
  const azurePages = result.pages ?? [];
  const pagesByNumber = new Map(azurePages.map((page) => [page.pageNumber, page]));

  let confidenceSum = 0;
  let confidenceCount = 0;
  let lowConfidenceLines = 0;
  let wordCount = 0;

  const pages = azurePages.map((page) => {
    const wordConfidence = new Map();
    for (const word of page.words ?? []) {
      wordCount += 1;
      confidenceSum += word.confidence ?? 0;
      confidenceCount += 1;
      if (word.span) wordConfidence.set(word.span.offset, word.confidence ?? 0);
    }

    const lines = (page.lines ?? []).map((line) => {
      const spanOffset = line.spans?.[0]?.offset ?? -1;
      const confidence = wordConfidence.get(spanOffset) ?? 0.97;
      if (confidence < 0.85) lowConfidenceLines += 1;
      return {
        content: line.content ?? '',
        role: 'paragraph',
        confidence: Number(confidence.toFixed(4)),
        box: polygonToBox(line.polygon, page) ?? [0.08, 0.05, 0.5, 0.015]
      };
    });

    return {
      pageNumber: page.pageNumber,
      width: page.width ?? 8.27,
      height: page.height ?? 11.69,
      unit: page.unit ?? 'inch',
      angle: page.angle ?? 0,
      quality: (page.angle ?? 0) > 1.5 || (page.angle ?? 0) < -1.5 ? 'degraded-scan' : 'clean',
      lines
    };
  });

  const paragraphs = (result.paragraphs ?? [])
    .filter((paragraph) => paragraph.role === 'title' || paragraph.role === 'sectionHeading')
    .map((paragraph) => ({
      role: paragraph.role,
      content: paragraph.content ?? '',
      pageNumber: regionPage(paragraph.boundingRegions)
    }));

  const keyValuePairs = (result.keyValuePairs ?? [])
    .filter((pair) => pair.key?.content)
    .map((pair) => {
      const pageNumber = regionPage(pair.key.boundingRegions);
      const page = pagesByNumber.get(pageNumber);
      return {
        key: pair.key.content.replace(/[:\s]+$/, ''),
        value: pair.value?.content ?? '',
        confidence: Number((pair.confidence ?? 0.9).toFixed(4)),
        pageNumber,
        box: polygonToBox(pair.key.boundingRegions?.[0]?.polygon, page) ?? [0.08, 0.1, 0.35, 0.015]
      };
    });

  const tables = (result.tables ?? []).map((table, index) => {
    const grid = Array.from({ length: table.rowCount }, () => new Array(table.columnCount).fill(''));
    for (const cell of table.cells ?? []) {
      if (cell.rowIndex < table.rowCount && cell.columnIndex < table.columnCount) {
        grid[cell.rowIndex][cell.columnIndex] = (cell.content ?? '').replace(/\s+/g, ' ').trim();
      }
    }
    const [header, ...rows] = grid;
    return {
      id: `tbl-${index + 1}`,
      title: table.caption?.content ?? `Table ${index + 1}`,
      fieldKey: null,
      pageNumber: regionPage(table.boundingRegions),
      columns: header ?? [],
      rows,
      rowCount: rows.length,
      columnCount: table.columnCount ?? (header?.length ?? 0),
      confidence: 0.95
    };
  });

  const handwrittenSpans = (result.styles ?? []).filter((style) => style.isHandwritten);
  const totalContentLength = (result.content ?? '').length || 1;
  const handwrittenLength = handwrittenSpans.reduce(
    (sum, style) => sum + (style.spans ?? []).reduce((inner, span) => inner + (span.length ?? 0), 0),
    0
  );

  return {
    engine: 'azure',
    modelId,
    apiVersion,
    durationMs,
    addOns: [...features],
    queryFields: [...queryFields],
    pageCount: pages.length,
    pages,
    keyValuePairs,
    documentFields: normaliseDocumentFields(result, pagesByNumber),
    barcodes: normaliseBarcodes(azurePages),
    formulas: normaliseFormulas(azurePages),
    selectionMarks: azurePages.reduce((sum, page) => sum + (page.selectionMarks?.length ?? 0), 0),
    tables,
    paragraphs,
    fullText: result.content ?? pages.map((page) => page.lines.map((line) => line.content).join('\n')).join('\n'),
    languages: (result.languages ?? []).slice(0, 5).map((language) => ({
      locale: language.locale,
      confidence: Number((language.confidence ?? 0).toFixed(3))
    })),
    handwrittenRatio: Number((handwrittenLength / totalContentLength).toFixed(4)),
    ocr: {
      averageConfidence: confidenceCount > 0 ? Number((confidenceSum / confidenceCount).toFixed(4)) : 0.97,
      lowConfidenceLines,
      wordCount,
      degradedPages: pages.filter((page) => page.quality === 'degraded-scan').map((page) => page.pageNumber)
    },
    demoTypeId: null
  };
}

/**
 * @param {object} input
 * @param {object} input.analyzerConfig config.analyzer
 * @param {Buffer} input.buffer
 * @param {string} input.contentType
 * @param {string} input.correlationId
 * @param {string} [input.modelId]   Overrides the configured model (adaptive routing).
 * @param {string} [input.pages]     Page range, e.g. "1" for cheap first-page triage.
 * @param {string[]} [input.features]     Add-on capabilities (`features=`).
 * @param {string[]} [input.queryFields]  Named values to request (`queryFields=`).
 */
export async function analyzeWithAzure({
  analyzerConfig,
  buffer,
  contentType,
  correlationId,
  modelId,
  pages,
  features = [],
  queryFields = []
}) {
  const startedAt = Date.now();
  const effectiveModelId = modelId ?? analyzerConfig.modelId;
  const operationLocation = await submitAnalysis({
    analyzerConfig,
    buffer,
    contentType,
    correlationId,
    modelId: effectiveModelId,
    pages,
    features,
    queryFields
  });
  const payload = await pollResult({ analyzerConfig, operationLocation, correlationId });

  return normaliseAzureResult(payload, {
    modelId: effectiveModelId,
    apiVersion: analyzerConfig.apiVersion,
    durationMs: Date.now() - startedAt,
    features,
    queryFields
  });
}
