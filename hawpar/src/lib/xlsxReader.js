/**
 * Minimal, dependency-free XLSX (Office Open XML) reader.
 *
 * Mirrors the philosophy of `xlsx.js`: no third-party spreadsheet package is
 * installed (the popular ones pull in large transitive trees with recurring
 * CVEs), so this hand-rolled reader only needs Node's built-in zlib to unzip
 * the package and a handful of regex-based XML extractors for the handful of
 * parts we actually need (shared strings + the first worksheet's rows). It is
 * intentionally narrow: it is used to discover a customer-supplied Excel
 * template's column headers so extraction output can be shaped to match, not
 * to support the full OOXML spec (formulas, styles, charts, etc. are ignored).
 */
import { inflateRawSync } from 'node:zlib';
import { badRequest } from './errors.js';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const MAX_HEADER_COLUMNS = 200;
const MAX_PREVIEW_ROWS = 5;

function findEndOfCentralDirectory(buffer) {
  const maxCommentLength = 0xffff;
  const searchFloor = Math.max(0, buffer.length - 22 - maxCommentLength);
  for (let offset = buffer.length - 22; offset >= searchFloor; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw badRequest('The uploaded file is not a valid .xlsx workbook (ZIP end-of-directory marker not found).');
}

function readCentralDirectory(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw badRequest('The uploaded .xlsx file has a corrupt archive directory.');
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function extractEntry(buffer, entry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== LOCAL_HEADER_SIGNATURE) {
    throw badRequest('The uploaded .xlsx file has a corrupt archive entry.');
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return Buffer.from(data);
  if (entry.compressionMethod === 8) return inflateRawSync(data);
  throw badRequest(`The uploaded .xlsx file uses an unsupported compression method (${entry.compressionMethod}).`);
}

/** @returns {Map<string, Buffer>} archive entry path -> raw (decompressed) bytes. */
function unzip(buffer) {
  const files = new Map();
  for (const entry of readCentralDirectory(buffer)) {
    if (entry.name.endsWith('/')) continue;
    files.set(entry.name, extractEntry(buffer, entry));
  }
  return files;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (unused, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (unused, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siRegex.exec(xml))) {
    const block = match[1];
    const parts = [...block.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((textMatch) => decodeXmlEntities(textMatch[1]));
    strings.push(parts.join(''));
  }
  return strings;
}

/** @returns {string} the column letters from a cell reference like "AB12" -> "AB". */
function columnLetters(cellRef) {
  return (cellRef.match(/^[A-Z]+/) ?? [''])[0];
}

function columnIndexFromLetters(letters) {
  let index = 0;
  for (let position = 0; position < letters.length; position += 1) {
    index = index * 26 + (letters.charCodeAt(position) - 64);
  }
  return index - 1;
}

function parseCellValue(cellXml, sharedStrings) {
  const typeMatch = cellXml.match(/\st="([^"]+)"/);
  const type = typeMatch ? typeMatch[1] : 'n';

  if (type === 'inlineStr') {
    const textMatch = cellXml.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
    return textMatch ? decodeXmlEntities(textMatch[1]) : '';
  }

  const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
  if (!valueMatch) return '';
  const raw = valueMatch[1];

  if (type === 's') {
    const index = Number(raw);
    return sharedStrings[index] ?? '';
  }
  if (type === 'str') return decodeXmlEntities(raw);
  if (type === 'b') return raw === '1';
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
}

function parseRows(sheetXml, sharedStrings, maxRows) {
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(sheetXml)) && rows.length < maxRows) {
    const rowXml = rowMatch[1];
    const cells = [];
    const cellRegex = /<c\b[^>]*r="([A-Z]+\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowXml))) {
      const [fullTag, cellRef, innerXml] = cellMatch;
      if (!innerXml) continue; // self-closing <c r="A1"/> is an empty cell.
      const columnIndex = columnIndexFromLetters(columnLetters(cellRef));
      if (columnIndex < 0 || columnIndex >= MAX_HEADER_COLUMNS) continue;
      const value = parseCellValue(fullTag, sharedStrings);
      cells[columnIndex] = value;
    }
    rows.push(cells);
  }
  return rows;
}

function resolveFirstWorksheetPath(files) {
  const workbookXml = files.get('xl/workbook.xml')?.toString('utf8');
  const relsXml = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (workbookXml && relsXml) {
    const sheetMatch = workbookXml.match(/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"[^>]*\/>/);
    if (sheetMatch) {
      const [, sheetName, relId] = sheetMatch;
      const relMatch = new RegExp(`<Relationship\\b[^>]*Id="${relId}"[^>]*Target="([^"]+)"`).exec(relsXml);
      if (relMatch) {
        const target = relMatch[1].replace(/^\/?/, '');
        const resolved = target.startsWith('worksheets/') ? `xl/${target}` : target;
        if (files.has(resolved)) return { path: resolved, sheetName };
      }
    }
  }
  // Fall back to the conventional first-sheet path used by every writer we've
  // encountered (including our own `xlsx.js`).
  const fallback = [...files.keys()].find((name) => /^xl\/worksheets\/sheet1\.xml$/i.test(name));
  return { path: fallback, sheetName: 'Sheet1' };
}

/**
 * Reads a customer-supplied .xlsx template and returns its header row (and a
 * small data preview) so the UI can let the customer map extraction fields
 * onto their own column layout.
 *
 * @param {Buffer} buffer raw uploaded file bytes
 * @returns {{ sheetName: string, columns: Array<{column: string, index: number, header: string}>, previewRows: Array<Array<string>>, rowCount: number }}
 */
export function readXlsxTemplate(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw badRequest('The uploaded Excel template appears to be empty or corrupt.');
  }

  const files = unzip(buffer);
  const { path: sheetPath, sheetName } = resolveFirstWorksheetPath(files);
  if (!sheetPath || !files.has(sheetPath)) {
    throw badRequest('Could not find a worksheet inside the uploaded Excel template.');
  }

  const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml')?.toString('utf8'));
  const sheetXml = files.get(sheetPath).toString('utf8');
  const rows = parseRows(sheetXml, sharedStrings, MAX_PREVIEW_ROWS + 1);

  if (rows.length === 0) {
    throw badRequest('The uploaded Excel template has no rows — add a header row with your column names.');
  }

  const headerRow = rows[0];
  const columnCount = headerRow.length;
  const columns = [];
  for (let index = 0; index < columnCount; index += 1) {
    const header = headerRow[index];
    if (header === undefined || header === null || String(header).trim() === '') continue;
    columns.push({ column: excelColumnName(index), index, header: String(header).trim() });
  }

  if (columns.length === 0) {
    throw badRequest('The uploaded Excel template has an empty header row — the first row must contain column names.');
  }

  const previewRows = rows
    .slice(1)
    .map((row) => columns.map(({ index }) => (row[index] === undefined || row[index] === null ? '' : String(row[index]))));

  // Count of populated rows below the header (best-effort — used only for a UI hint, not extraction).
  const rowCount = countDataRows(sheetXml);

  return { sheetName, columns, previewRows, rowCount };
}

function excelColumnName(index) {
  let dividend = index + 1;
  let name = '';
  while (dividend > 0) {
    const remainder = (dividend - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    dividend = Math.floor((dividend - remainder - 1) / 26);
  }
  return name;
}

function countDataRows(sheetXml) {
  const rowRefs = [...sheetXml.matchAll(/<row\b[^>]*\sr="(\d+)"/g)].map((match) => Number(match[1]));
  if (rowRefs.length === 0) return Math.max(0, (sheetXml.match(/<row\b/g) ?? []).length - 1);
  return Math.max(0, Math.max(...rowRefs) - 1);
}
