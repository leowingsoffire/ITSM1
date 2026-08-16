/**
 * Field extraction.
 *
 * Resolves the business fields declared for a document type from the normalised
 * OCR output using a layered strategy, cheapest and most reliable first:
 *   1. exact key-value label match
 *   2. fuzzy key-value label match
 *   3. label-anchored lookup in the recognised page text
 *   4. regular expression over the document text
 *   5. table binding for tabular fields
 *
 * Step 3 exists because key-value extraction and text recognition are separate
 * models: Document Intelligence regularly recognises the line "Expiry Date: 10
 * Feb 2029" while its key-value pass returns that pair with an empty value.
 * Reporting the field as missing when the document plainly prints it is a
 * transcription failure, not an honest gap, so the printed line is consulted
 * before the field is given up on.
 *
 * Every field records how it was found so reviewers can audit the decision.
 */
import { FieldType, getDocumentType } from '../domain/documentTypes.js';
import { parseAmount, parseDate, toIsoDate } from '../lib/format.js';

export const ExtractionSource = Object.freeze({
  KEY_VALUE: 'key-value-pair',
  KEY_VALUE_FUZZY: 'key-value-pair (fuzzy)',
  TEXT_LABEL: 'printed-label',
  PATTERN: 'text-pattern',
  TABLE: 'table',
  NOT_FOUND: 'not-found'
});

export const FieldStatus = Object.freeze({
  ACCEPTED: 'accepted',
  REVIEW: 'needs-review',
  MISSING: 'missing'
});

const FUZZY_PENALTY = 0.08;
/**
 * A value recovered from a printed line is real text the recogniser returned,
 * but it was not confirmed by the key-value model, so it carries a penalty and
 * is capped below a clean key-value read.
 */
const LABEL_LINE_PENALTY = 0.05;
const LABEL_LINE_CEILING = 0.93;
const PATTERN_CONFIDENCE = 0.82;
const TABLE_MATCH_CONFIDENCE = 0.9;

const normalise = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** A pair the key-value model returned empty is a miss, not a match. */
const hasValue = (pair) => String(pair?.value ?? '').trim() !== '';

function findExactPair(pairs, aliases) {
  const wanted = new Set(aliases.map(normalise));
  return pairs.find((pair) => hasValue(pair) && wanted.has(normalise(pair.key))) ?? null;
}

/**
 * Word-boundary containment. Guards against short aliases swallowing longer,
 * more specific headers - e.g. the alias "total" must not bind to "Subtotal".
 */
function containsPhrase(haystack, needle) {
  const index = haystack.indexOf(needle);
  if (index < 0) return false;
  const before = index === 0 ? ' ' : haystack[index - 1];
  const afterIndex = index + needle.length;
  const after = afterIndex >= haystack.length ? ' ' : haystack[afterIndex];
  return before === ' ' && after === ' ';
}

/**
 * Scores every candidate pair and returns the strongest match rather than the
 * first one encountered, so document order cannot decide the binding.
 */
function findFuzzyPair(pairs, aliases) {
  const wanted = aliases.map(normalise).filter((alias) => alias.length >= 3);
  if (wanted.length === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const pair of pairs) {
    if (!hasValue(pair)) continue;
    const key = normalise(pair.key);
    if (!key) continue;

    for (const alias of wanted) {
      let score = 0;
      if (key === alias) score = 1;
      else if (containsPhrase(key, alias)) score = alias.length / key.length;
      else if (containsPhrase(alias, key)) score = key.length / alias.length;

      if (score > bestScore) {
        bestScore = score;
        best = pair;
      }
    }
  }

  return bestScore >= 0.4 ? best : null;
}

/**
 * Recovers a value from a recognised page line of the form "Label: value".
 *
 * Only lines whose label matches one of the field's declared aliases are
 * considered, and the strongest label match wins, so this cannot invent a
 * binding the key-value strategies would not also have made — it only reaches
 * values the key-value model failed to return.
 *
 * @returns {{value:string, key:string, confidence:number, pageNumber:number, box:number[]|null}|null}
 */
function findLabelledLine(analysis, aliases) {
  const wanted = aliases.map(normalise).filter(Boolean);
  if (wanted.length === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const page of analysis.pages ?? []) {
    for (const line of page.lines ?? []) {
      const content = String(line.content ?? '');
      const separator = content.indexOf(':');
      if (separator < 1 || separator > 60) continue;

      const rawLabel = content.slice(0, separator).trim();
      const rawValue = content.slice(separator + 1).trim();
      if (!rawValue) continue;

      const label = normalise(rawLabel);
      if (!label) continue;

      for (const alias of wanted) {
        let score = 0;
        if (label === alias) score = 1;
        else if (alias.length >= 3 && containsPhrase(label, alias)) score = alias.length / label.length;
        else if (alias.length >= 3 && containsPhrase(alias, label)) score = label.length / alias.length;

        if (score > bestScore) {
          bestScore = score;
          best = {
            value: rawValue,
            key: rawLabel,
            confidence: Math.min(LABEL_LINE_CEILING, Math.max(0, (line.confidence ?? 0.8) - LABEL_LINE_PENALTY)),
            pageNumber: page.pageNumber,
            box: line.box ?? null
          };
        }
      }
    }
  }

  return bestScore >= 0.6 ? best : null;
}

function findTable(tables, field) {
  const byFieldKey = tables.find((table) => table.fieldKey === field.key);
  if (byFieldKey) return byFieldKey;

  const label = normalise(field.label);
  const byTitle = tables.find((table) => normalise(table.title).includes(label) || label.includes(normalise(table.title)));
  if (byTitle) return byTitle;

  return tables.length === 1 ? tables[0] : null;
}

/** Converts a raw OCR string into a typed, comparable value. */
function normaliseValue(field, rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;

  switch (field.type) {
    case FieldType.CURRENCY:
    case FieldType.NUMBER: {
      const amount = parseAmount(rawValue);
      return amount === null ? null : amount;
    }
    case FieldType.DATE: {
      const date = parseDate(String(rawValue).replace(/^[^0-9]*/, '').trim());
      return date ? toIsoDate(date) : null;
    }
    default:
      return String(rawValue).trim();
  }
}

/** Extracts the currency code when it is embedded in the value ("SGD 1,200.00"). */
function detectCurrency(rawValue) {
  const match = /\b(SGD|USD|MYR|EUR|GBP|HKD|CNY|THB|AUD|JPY|IDR|VND|INR)\b/.exec(String(rawValue ?? ''));
  return match ? match[1] : null;
}

function buildField({ field, rawValue, confidence, source, sourceKey, pageNumber, box, tableRef }) {
  const normalisedValue = normaliseValue(field, rawValue);
  const isMissing = rawValue === null || rawValue === undefined || String(rawValue).trim() === '';
  const parseFailed =
    !isMissing && normalisedValue === null && field.type !== FieldType.STRING && field.type !== FieldType.TABLE;

  return {
    key: field.key,
    label: field.label,
    type: field.type,
    critical: field.critical,
    unit: field.unit,
    rawValue: isMissing ? null : String(rawValue),
    value: normalisedValue,
    currency: field.type === FieldType.CURRENCY ? detectCurrency(rawValue) : null,
    confidence: isMissing ? 0 : Number(confidence.toFixed(4)),
    source: isMissing ? ExtractionSource.NOT_FOUND : source,
    // The exact label this value was read from. The assurance engine needs it to
    // tell a genuinely independent second source from the extractor re-reading
    // the same key-value pair.
    sourceKey: isMissing ? null : (sourceKey ?? null),
    pageNumber: pageNumber ?? null,
    box: box ?? null,
    tableRef: tableRef ?? null,
    parseFailed,
    edited: false
  };
}

/**
 * @param {object} analysis  Normalised analysis result.
 * @param {string} typeId    Classified document type.
 * @param {number} reviewThreshold Confidence below which a field is flagged.
 */
export function extractFields(analysis, typeId, reviewThreshold) {
  const type = getDocumentType(typeId);
  const pairs = analysis.keyValuePairs ?? [];
  const tables = analysis.tables ?? [];
  const fullText = analysis.fullText ?? '';

  const fields = type.fields.map((field) => {
    if (field.type === FieldType.TABLE) {
      const table = findTable(tables, field);
      if (!table) return buildField({ field, rawValue: null, confidence: 0, source: ExtractionSource.NOT_FOUND });
      return buildField({
        field,
        rawValue: `${table.rowCount} rows × ${table.columnCount} columns`,
        confidence: table.confidence ?? TABLE_MATCH_CONFIDENCE,
        source: ExtractionSource.TABLE,
        pageNumber: table.pageNumber,
        tableRef: table.id
      });
    }

    const exact = findExactPair(pairs, field.aliases);
    if (exact) {
      return buildField({
        field,
        rawValue: exact.value,
        confidence: exact.confidence,
        source: ExtractionSource.KEY_VALUE,
        sourceKey: exact.key,
        pageNumber: exact.pageNumber,
        box: exact.box
      });
    }

    const fuzzy = findFuzzyPair(pairs, field.aliases);
    if (fuzzy) {
      return buildField({
        field,
        rawValue: fuzzy.value,
        confidence: Math.max(0, fuzzy.confidence - FUZZY_PENALTY),
        source: ExtractionSource.KEY_VALUE_FUZZY,
        sourceKey: fuzzy.key,
        pageNumber: fuzzy.pageNumber,
        box: fuzzy.box
      });
    }

    const labelled = findLabelledLine(analysis, field.aliases);
    if (labelled) {
      return buildField({
        field,
        rawValue: labelled.value,
        confidence: labelled.confidence,
        source: ExtractionSource.TEXT_LABEL,
        sourceKey: labelled.key,
        pageNumber: labelled.pageNumber,
        box: labelled.box
      });
    }

    if (field.pattern) {
      const match = field.pattern.exec(fullText);
      field.pattern.lastIndex = 0;
      if (match) {
        return buildField({
          field,
          rawValue: match[1] ?? match[0],
          confidence: PATTERN_CONFIDENCE,
          source: ExtractionSource.PATTERN,
          pageNumber: locatePage(analysis, match[0])
        });
      }
    }

    return buildField({ field, rawValue: null, confidence: 0, source: ExtractionSource.NOT_FOUND });
  });

  return fields.map((field) => ({ ...field, status: resolveStatus(field, reviewThreshold) }));
}

function resolveStatus(field, reviewThreshold) {
  if (field.rawValue === null) return field.critical ? FieldStatus.MISSING : FieldStatus.REVIEW;
  if (field.parseFailed) return FieldStatus.REVIEW;
  if (field.confidence < reviewThreshold) return FieldStatus.REVIEW;
  return FieldStatus.ACCEPTED;
}

/** Finds the first page whose text contains the snippet — used to anchor pattern hits. */
function locatePage(analysis, snippet) {
  const needle = String(snippet).toLowerCase().slice(0, 40);
  for (const page of analysis.pages ?? []) {
    if (page.lines.some((line) => line.content.toLowerCase().includes(needle))) return page.pageNumber;
  }
  return 1;
}

/** Re-evaluates a field after a human edit. */
export function applyManualCorrection(field, newRawValue) {
  const definition = {
    key: field.key,
    label: field.label,
    type: field.type,
    critical: field.critical,
    unit: field.unit,
    aliases: [],
    pattern: null
  };
  const updated = buildField({
    field: definition,
    rawValue: newRawValue,
    confidence: 1,
    source: 'human-verified',
    sourceKey: field.sourceKey ?? null,
    pageNumber: field.pageNumber,
    box: field.box,
    tableRef: field.tableRef
  });
  return { ...updated, edited: true, status: updated.rawValue === null ? FieldStatus.MISSING : FieldStatus.ACCEPTED };
}
