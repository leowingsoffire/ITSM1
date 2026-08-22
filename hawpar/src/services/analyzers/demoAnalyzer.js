/**
 * Offline demo analysis engine.
 *
 * Produces the same normalised analysis contract as the Azure AI Document
 * Intelligence engine, allowing the whole platform (classification, extraction,
 * validation, review, export) to be demonstrated without any cloud spend.
 */
import { createRandom, hashString } from '../../lib/random.js';
import { GENERATED_TYPE_IDS, generateDocumentContent } from './demoContent.js';

const LINES_PER_PAGE = 44;
const PAGE_WIDTH_INCHES = 8.27;
const PAGE_HEIGHT_INCHES = 11.69;
const TOP_MARGIN = 0.055;
const LEFT_MARGIN = 0.08;
const LINE_HEIGHT = 0.0205;
const CHARACTER_WIDTH = 0.0072;
const MAX_LINE_CHARACTERS = 108;

const FILENAME_HINTS = Object.freeze([
  [/marketing[_\- ]?claim|a&p[_\- ]?claim|mkt[_\- ]?clm/i, 'marketing_claim'],
  [/[_\- ]support[_\- ]|marketing[_\- ]?support|a&p[_\- ]?support|cover[_\- ]?letter/i, 'marketing_support'],
  [/(annual[_\- ]?report|financial[_\- ]?statement|fy\d{2,4}|ar\d{4})/i, 'annual_report'],
  [/(tax[_\- ]?)?invoice|\binv[_\- ]?\d/i, 'supplier_invoice'],
  [/purchase[_\- ]?order|\bpo[_\- ]?\d/i, 'purchase_order'],
  [/delivery[_\- ]?(order|note)|goods[_\- ]?received|\bgrn\b|\bdo[_\- ]?\d/i, 'delivery_order'],
  [/certificate[_\- ]?of[_\- ]?analysis|\bcoa\b|batch[_\- ]?record/i, 'certificate_of_analysis'],
  [/bill[_\- ]?of[_\- ]?lading|\bbl[_\- ]?\d|\bb\/l\b|shipping/i, 'bill_of_lading'],
  [/registration|licen[cs]e|regulatory|hsa|npra/i, 'product_registration'],
  [/trade[_\- ]?mark|trademark|\btm[_\- ]?\d|ipos/i, 'trademark_certificate'],
  [/tenancy|lease|rental[_\- ]?agreement|landlord/i, 'tenancy_agreement'],
  [/bank[_\- ]?statement|statement[_\- ]?of[_\- ]?account|\bsoa\b/i, 'bank_statement'],
  [/claim|expense|reimburse/i, 'employee_claim']
]);

/**
 * Best-effort page count for a real PDF upload so demo output matches the file.
 * @param {Buffer} buffer
 * @returns {number|null}
 */
export function estimatePdfPageCount(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return null;
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return null;

  const content = buffer.toString('latin1');
  const countMatch = /\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g;
  let highest = 0;
  let match = countMatch.exec(content);
  while (match !== null) {
    highest = Math.max(highest, Number(match[1]));
    match = countMatch.exec(content);
  }
  if (highest > 0) return highest;

  const pageObjects = content.match(/\/Type\s*\/Page[^s]/g);
  return pageObjects ? pageObjects.length : null;
}

/** Chooses a document type from the file name, falling back to a deterministic pick. */
export function inferTypeFromFileName(fileName) {
  for (const [pattern, typeId] of FILENAME_HINTS) {
    if (pattern.test(fileName)) return typeId;
  }
  const index = hashString(fileName) % GENERATED_TYPE_IDS.length;
  return GENERATED_TYPE_IDS[index];
}

function wrapText(value) {
  const words = String(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + word.length + 1 <= MAX_LINE_CHARACTERS) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function tableToLines(table) {
  const header = table.columns.join('  |  ');
  const body = table.rows.map((row) => row.join('  |  '));
  return [`[TABLE] ${table.title}`, header, ...body];
}

/** Confidence generator biased high, with a realistic low-confidence tail. */
function lineConfidence(rng, isNoisy) {
  if (isNoisy) return rng.float(0.42, 0.78, 4);
  return rng.float(0.955, 0.999, 4);
}

/**
 * @param {object} input
 * @param {string} input.fileName
 * @param {Buffer} [input.buffer]
 * @param {string} [input.typeHint]
 * @param {number} [input.pageHint]
 */
export function analyzeWithDemoEngine({ fileName, buffer, typeHint, pageHint }) {
  const startedAt = Date.now();
  const typeId = typeHint && GENERATED_TYPE_IDS.includes(typeHint)
    ? typeHint
    : inferTypeFromFileName(fileName);

  const rng = createRandom(`analysis:${fileName}`);
  const content = generateDocumentContent(typeId, fileName);
  const detectedPdfPages = buffer ? estimatePdfPageCount(buffer) : null;
  const targetPages = Math.max(1, pageHint ?? detectedPdfPages ?? content.pageTarget);

  // Flatten content into printable lines, tracking table boundaries.
  /** @type {Array<{text:string, role:string, tableId:string|null, kvIndex:number|null}>} */
  const flowed = [];
  let keyValueCursor = 0;

  for (const block of content.blocks) {
    const isKeyValue = block.role === 'paragraph' && /^[^:]{2,48}:\s/.test(block.text);
    const kvIndex = isKeyValue && keyValueCursor < content.keyValuePairs.length ? keyValueCursor : null;
    if (kvIndex !== null) keyValueCursor += 1;
    for (const line of wrapText(block.text)) {
      flowed.push({ text: line, role: block.role, tableId: null, kvIndex });
    }
  }

  content.tables.forEach((table, index) => {
    const tableId = `tbl-${index + 1}`;
    for (const line of tableToLines(table)) {
      flowed.push({ text: line, role: 'table', tableId, kvIndex: null });
    }
  });

  // Pad or trim to reach the requested page count.
  const requiredLines = targetPages * LINES_PER_PAGE;
  const filler = [
    'This page forms part of the document and is reproduced in full for audit completeness.',
    'Continued from the previous page. Amounts are stated in Singapore dollars unless otherwise indicated.',
    'The information set out above should be read together with the accompanying notes and schedules.',
    'Internal reference maintained by VGC Group Shared Services for document retention purposes.'
  ];
  let fillerIndex = 0;
  while (flowed.length < requiredLines) {
    flowed.push({
      text: filler[fillerIndex % filler.length],
      role: 'paragraph',
      tableId: null,
      kvIndex: null
    });
    fillerIndex += 1;
  }
  flowed.length = Math.min(flowed.length, requiredLines);

  // Paginate.
  const pages = [];
  const tablePages = new Map();
  const keyValuePages = new Map();
  const noisyPages = new Set();
  const scanNoiseCount = Math.min(targetPages, Math.max(0, Math.round(targetPages * 0.08)));
  for (let index = 0; index < scanNoiseCount; index += 1) {
    noisyPages.add(rng.int(1, targetPages));
  }

  let confidenceSum = 0;
  let confidenceCount = 0;
  let lowConfidenceLines = 0;
  let wordCount = 0;

  for (let pageIndex = 0; pageIndex < targetPages; pageIndex += 1) {
    const pageNumber = pageIndex + 1;
    const isNoisyPage = noisyPages.has(pageNumber);
    const slice = flowed.slice(pageIndex * LINES_PER_PAGE, (pageIndex + 1) * LINES_PER_PAGE);
    const lines = [];

    slice.forEach((entry, lineIndex) => {
      if (!entry.text) return;
      const isNoisyLine = isNoisyPage && rng.bool(0.35);
      const confidence = lineConfidence(rng, isNoisyLine);
      confidenceSum += confidence;
      confidenceCount += 1;
      if (confidence < 0.85) lowConfidenceLines += 1;
      wordCount += entry.text.split(/\s+/).length;

      const isHeading = entry.role === 'title' || entry.role === 'sectionHeading';
      lines.push({
        content: entry.text,
        role: entry.role,
        confidence,
        box: [
          LEFT_MARGIN,
          Number((TOP_MARGIN + lineIndex * LINE_HEIGHT).toFixed(5)),
          Number(Math.min(0.86, Math.max(0.06, entry.text.length * CHARACTER_WIDTH * (isHeading ? 1.18 : 1))).toFixed(5)),
          isHeading ? 0.019 : 0.0145
        ]
      });

      if (entry.tableId && !tablePages.has(entry.tableId)) tablePages.set(entry.tableId, pageNumber);
      if (entry.kvIndex !== null && !keyValuePages.has(entry.kvIndex)) {
        keyValuePages.set(entry.kvIndex, { pageNumber, box: lines[lines.length - 1].box });
      }
    });

    lines.push({
      content: `Page ${pageNumber} of ${targetPages}`,
      role: 'pageFooter',
      confidence: 0.994,
      box: [0.45, 0.965, 0.12, 0.012]
    });

    pages.push({
      pageNumber,
      width: PAGE_WIDTH_INCHES,
      height: PAGE_HEIGHT_INCHES,
      unit: 'inch',
      angle: isNoisyPage ? rng.float(-1.8, 1.8, 2) : 0,
      quality: isNoisyPage ? 'degraded-scan' : 'clean',
      lines
    });
  }

  // Real-world capture anomalies. A predictable share of documents arrive with
  // faint print, skewed scans or a truncated field, which is exactly what the
  // review queue and exception handling exist to absorb.
  const anomalyProfile = rng.next();
  const degradeCount = anomalyProfile > 0.58 ? rng.int(1, 3) : 0;
  const degradedIndices = new Set();
  for (let index = 0; index < degradeCount; index += 1) {
    degradedIndices.add(rng.int(0, Math.max(0, content.keyValuePairs.length - 1)));
  }
  const droppedIndex =
    anomalyProfile > 0.8 && content.keyValuePairs.length > 3 ? rng.int(1, content.keyValuePairs.length - 1) : -1;

  const keyValuePairs = content.keyValuePairs.map((pair, index) => {
    const placement = keyValuePages.get(index) ?? { pageNumber: 1, box: [LEFT_MARGIN, 0.1, 0.4, 0.015] };
    const isNoisy = noisyPages.has(placement.pageNumber) || degradedIndices.has(index);
    if (index === droppedIndex) {
      return { key: pair.key, value: '', confidence: 0, pageNumber: placement.pageNumber, box: placement.box };
    }
    return {
      key: pair.key,
      value: pair.value,
      confidence: isNoisy ? rng.float(0.52, 0.79, 4) : rng.float(0.9, 0.995, 4),
      pageNumber: placement.pageNumber,
      box: placement.box
    };
  });

  const tables = content.tables.map((table, index) => {
    const tableId = `tbl-${index + 1}`;
    return {
      id: tableId,
      title: table.title,
      fieldKey: table.fieldKey ?? null,
      pageNumber: tablePages.get(tableId) ?? 1,
      columns: table.columns,
      rows: table.rows,
      rowCount: table.rows.length,
      columnCount: table.columns.length,
      confidence: rng.float(0.88, 0.985, 4)
    };
  });

  const paragraphs = pages.flatMap((page) =>
    page.lines
      .filter((line) => line.role === 'title' || line.role === 'sectionHeading')
      .map((line) => ({ role: line.role, content: line.content, pageNumber: page.pageNumber }))
  );

  const fullText = pages
    .map((page) => page.lines.map((line) => line.content).join('\n'))
    .join('\n');

  return {
    engine: 'demo',
    modelId: 'demo-layout-v1',
    apiVersion: 'local',
    durationMs: Date.now() - startedAt,
    pageCount: pages.length,
    pages,
    keyValuePairs,
    tables,
    paragraphs,
    fullText,
    languages: [
      { locale: 'en', confidence: 0.99 },
      ...(rng.bool(0.25) ? [{ locale: 'zh-Hans', confidence: rng.float(0.6, 0.85, 3) }] : [])
    ],
    handwrittenRatio: rng.bool(0.2) ? rng.float(0.01, 0.09, 3) : 0,
    ocr: {
      averageConfidence: confidenceCount > 0 ? Number((confidenceSum / confidenceCount).toFixed(4)) : 0,
      lowConfidenceLines,
      wordCount,
      degradedPages: [...noisyPages].sort((a, b) => a - b)
    },
    demoTypeId: typeId
  };
}
