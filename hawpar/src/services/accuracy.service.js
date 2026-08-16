/**
 * Accuracy & assurance engine.
 *
 * Extraction gives you a value and a model confidence. That is not an accuracy
 * outcome — it is a claim. This module turns the claim into evidence by running
 * every extracted field through independent, explainable verification checks and
 * then *recalibrating* the confidence against what the evidence actually
 * supports.
 *
 * Checks are deliberately independent of the extractor:
 *   grounding    the value can be found verbatim in the recognised page text
 *   typing       the value parses as its declared type and is in a plausible range
 *   corroboration the same value was produced by a second, independent source
 *   arithmetic   the value satisfies the document's own internal arithmetic
 *   reference    the value matches enterprise reference data
 *   rules        no business rule fired against this field
 *   confidence   the model confidence clears the review threshold
 *
 * Each check is *attributed*, because "accuracy" and "integrity" are different
 * questions and answering them together produces a misleading number:
 *
 *   extraction   did the platform read the document correctly?
 *                (grounding, typing, corroboration, reference, confidence)
 *   document     does the document agree with itself and with policy?
 *                (arithmetic, rules)
 *
 * A supplier invoice whose printed total contradicts its own line items is a
 * *document* defect. Transcribing it faithfully is an extraction success, and
 * scoring it as an OCR failure both understates platform accuracy and tells a
 * reviewer to re-key a value that was already correct. Attribution keeps the two
 * separate: the verdict and the calibrated confidence answer the extraction
 * question, while document-integrity failures raise the document's risk level,
 * priority and exception routing exactly as before.
 *
 * The result is a per-field verdict, a calibrated confidence, a document-level
 * accuracy score, and a calibration curve that shows whether the platform's
 * confidence numbers can be trusted at all.
 */
import { FieldType, getDocumentType } from '../domain/documentTypes.js';
import {
  CURRENCIES,
  GROUP_ENTITIES,
  MARKETS,
  SINGAPORE_GST_RATE,
  resolveRegistrationNumber
} from '../domain/referenceData.js';

export const Verdict = Object.freeze({
  VERIFIED: 'verified',
  PROBABLE: 'probable',
  UNVERIFIED: 'unverified',
  CONFLICT: 'conflict',
  MISSING: 'missing'
});

export const CheckStatus = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  SKIP: 'not-applicable'
});

/** What a failing check actually proves. See the module header. */
export const Attribution = Object.freeze({
  EXTRACTION: 'extraction',
  DOCUMENT: 'document'
});

/** Whether the document's own arithmetic and policy hold for this field. */
export const Integrity = Object.freeze({
  CLEAN: 'clean',
  DISPUTED: 'disputed',
  NOT_APPLICABLE: 'not-applicable'
});

const CHECK_ATTRIBUTION = Object.freeze({
  grounding: Attribution.EXTRACTION,
  typing: Attribution.EXTRACTION,
  corroboration: Attribution.EXTRACTION,
  reference: Attribution.EXTRACTION,
  confidence: Attribution.EXTRACTION,
  arithmetic: Attribution.DOCUMENT,
  rules: Attribution.DOCUMENT
});

const CHECK_WEIGHTS = Object.freeze({
  grounding: 0.16,
  typing: 0.14,
  corroboration: 0.2,
  arithmetic: 0.18,
  reference: 0.12,
  rules: 0.12,
  confidence: 0.08
});

const MONEY_TOLERANCE = 0.02;
const MIN_PLAUSIBLE_YEAR = 1980;
const MAX_FUTURE_YEARS = 30;
const CALIBRATION_BUCKETS = 10;
const MIN_REPEAT_GROUNDING_LENGTH = 4;

const CORROBORATING_SOURCES = new Set([
  'key-value-pair',
  'azure-document-field',
  'table',
  'human-verified'
]);

const check = (id, name, status, detail) => ({
  id,
  name,
  status,
  detail,
  attribution: CHECK_ATTRIBUTION[id] ?? Attribution.EXTRACTION
});

/* ── Auto-repair ─────────────────────────────────────────────────────────── */

const NUMERIC_CONFUSIONS = Object.freeze({ O: '0', o: '0', l: '1', I: '1', S: '5', B: '8', Z: '2' });

/**
 * Conservative, reversible normalisations applied before verification.
 * Every repair is recorded with the rule that produced it so a reviewer can see
 * exactly what the platform changed and why.
 * @param {object[]} fields
 * @returns {{fields: object[], repairs: Array<{key: string, label: string, from: string, to: string, rule: string}>}}
 */
export function autoRepairFields(fields) {
  const repairs = [];

  const repaired = fields.map((field) => {
    if (field.rawValue === null || field.rawValue === undefined) return field;
    if (field.edited) return field;

    const original = String(field.rawValue);
    let value = original.replace(/\s+/g, ' ').trim();
    let rule = null;

    // Labels and trailing punctuation that survived the key/value split.
    const trimmed = value.replace(/^[\s:–—-]+/, '').replace(/[\s:;,.]+$/, '');
    if (trimmed !== value && trimmed.length > 0) {
      value = trimmed;
      rule = 'strip-punctuation';
    }

    if (field.type === FieldType.CURRENCY || field.type === FieldType.NUMBER) {
      // OCR routinely reads O for 0 inside otherwise numeric strings. Only the
      // numeric body is corrected: a leading currency code such as "SGD" must
      // survive intact, otherwise the repair itself corrupts the value.
      const numeric = /^([A-Z]{0,3}\s*[$€£]?\s*)([0-9OolISBZ][0-9OolISBZ,. ]*)$/.exec(value);
      if (numeric && /[0-9]/.test(numeric[2])) {
        const digitised = numeric[2].replace(/[OolISBZ]/g, (character) => NUMERIC_CONFUSIONS[character] ?? character);
        if (digitised !== numeric[2]) {
          value = `${numeric[1]}${digitised}`;
          rule = 'ocr-digit-confusion';
        }
      }
    }

    if (field.type === FieldType.STRING && /number|no\b|ref|uen|code/i.test(field.key)) {
      const tightened = value.replace(/\s*-\s*/g, '-').replace(/\s{2,}/g, ' ');
      if (tightened !== value) {
        value = tightened;
        rule = 'normalise-identifier';
      }
    }

    if (rule === null || value === original) return field;

    repairs.push({ key: field.key, label: field.label, from: original, to: value, rule });
    return { ...field, rawValue: value, repaired: true, repairRule: rule };
  });

  return { fields: repaired, repairs };
}

/* ── Individual checks ───────────────────────────────────────────────────── */

function groundingCheck(field, haystack) {
  if (!field.rawValue) return check('grounding', 'Source grounding', CheckStatus.SKIP, 'No value to ground.');
  if (field.type === FieldType.TABLE) {
    return check('grounding', 'Source grounding', CheckStatus.SKIP, 'Table binding is grounded by its cells.');
  }
  const needle = String(field.rawValue).toLowerCase().replace(/\s+/g, ' ').trim();
  const compact = needle.replace(/[^a-z0-9.]/g, '');
  if (needle.length < 2) {
    return check('grounding', 'Source grounding', CheckStatus.SKIP, 'Value too short to ground.');
  }
  const found = haystack.text.includes(needle) || (compact.length >= 3 && haystack.compact.includes(compact));
  return found
    ? check('grounding', 'Source grounding', CheckStatus.PASS, 'Value appears verbatim in the recognised text.')
    : check(
        'grounding',
        'Source grounding',
        CheckStatus.FAIL,
        'Value could not be located in the recognised text — possible transcription drift.'
      );
}

function typingCheck(field) {
  if (field.rawValue === null) return check('typing', 'Type conformance', CheckStatus.SKIP, 'No value supplied.');
  if (field.parseFailed) {
    return check('typing', 'Type conformance', CheckStatus.FAIL, `Value does not parse as ${field.type}.`);
  }

  if (field.type === FieldType.DATE && typeof field.value === 'string') {
    const year = Number(field.value.slice(0, 4));
    const maxYear = new Date().getUTCFullYear() + MAX_FUTURE_YEARS;
    if (!Number.isFinite(year) || year < MIN_PLAUSIBLE_YEAR || year > maxYear) {
      return check('typing', 'Type conformance', CheckStatus.FAIL, `Year ${year} is outside the plausible range.`);
    }
  }

  if ((field.type === FieldType.CURRENCY || field.type === FieldType.NUMBER) && typeof field.value === 'number') {
    if (!Number.isFinite(field.value)) {
      return check('typing', 'Type conformance', CheckStatus.FAIL, 'Numeric value is not finite.');
    }
    if (field.type === FieldType.CURRENCY && field.value < 0 && !/adjust|variance|credit|balance/i.test(field.key)) {
      return check('typing', 'Type conformance', CheckStatus.FAIL, 'Negative amount on a field that should be positive.');
    }
  }

  return check('typing', 'Type conformance', CheckStatus.PASS, `Parsed cleanly as ${field.type}.`);
}

function corroborationCheck(field, corroboration) {
  if (!field.rawValue) return check('corroboration', 'Independent corroboration', CheckStatus.SKIP, 'No value.');
  const entry = corroboration.get(field.key);
  if (!entry || entry.sources.length === 0) {
    return check(
      'corroboration',
      'Independent corroboration',
      CheckStatus.SKIP,
      'Only one extraction source was available.'
    );
  }
  if (entry.agrees) {
    return check(
      'corroboration',
      'Independent corroboration',
      CheckStatus.PASS,
      `Confirmed by ${entry.sources.join(', ')}.`
    );
  }
  return check(
    'corroboration',
    'Independent corroboration',
    CheckStatus.FAIL,
    `Conflicts with ${entry.sources.join(', ')} which read "${entry.otherValue}".`
  );
}

function arithmeticCheck(field, arithmetic) {
  const entry = arithmetic.get(field.key);
  if (!entry) return check('arithmetic', 'Internal arithmetic', CheckStatus.SKIP, 'No arithmetic relation applies.');
  return entry.ok
    ? check('arithmetic', 'Internal arithmetic', CheckStatus.PASS, entry.detail)
    : check('arithmetic', 'Internal arithmetic', CheckStatus.FAIL, entry.detail);
}

const REGISTRATION_KEY_PATTERN = /uen|taxid|gstreg|companyreg|registrationno|businessreg/i;

function referenceCheck(field) {
  const value = typeof field.value === 'string' ? field.value.trim() : null;
  if (!value) return check('reference', 'Reference data', CheckStatus.SKIP, 'No comparable value.');

  if (field.key === 'currency' || field.currency) {
    const code = (field.currency ?? value).toUpperCase();
    const known = CURRENCIES.some((entry) => (entry.code ?? entry) === code);
    return known
      ? check('reference', 'Reference data', CheckStatus.PASS, `${code} is an accepted settlement currency.`)
      : check('reference', 'Reference data', CheckStatus.FAIL, `${code} is not in the approved currency list.`);
  }

  // Company registration identifiers are jurisdictional. The supplier master is
  // authoritative; only unknown counterparties fall through to format checking,
  // so a valid Japanese corporate number or Malaysian SSM number is accepted on
  // its own terms instead of being measured against the Singapore UEN.
  if (REGISTRATION_KEY_PATTERN.test(field.key.replace(/[^a-z]/gi, ''))) {
    const resolved = resolveRegistrationNumber(value);
    if (resolved.status === 'known') {
      return check(
        'reference',
        'Reference data',
        CheckStatus.PASS,
        `Matches ${resolved.supplier.name} in the supplier master (${resolved.jurisdiction}).`
      );
    }
    if (resolved.status === 'well-formed') {
      return check(
        'reference',
        'Reference data',
        CheckStatus.PASS,
        `Valid ${resolved.authority} format (${resolved.jurisdiction}) — counterparty not yet in the supplier master.`
      );
    }
    return check(
      'reference',
      'Reference data',
      CheckStatus.FAIL,
      'Does not match the supplier master or any recognised company registration format.'
    );
  }

  if (/market|country|destination|origin/i.test(field.key)) {
    const known = MARKETS.some((market) => value.toLowerCase().includes(String(market.name ?? market).toLowerCase()));
    return known
      ? check('reference', 'Reference data', CheckStatus.PASS, 'Matches a registered market.')
      : check('reference', 'Reference data', CheckStatus.SKIP, 'Market not in the reference list — informational only.');
  }

  if (/entity|company|lessor|issuer/i.test(field.key)) {
    const known = GROUP_ENTITIES.some((entity) =>
      value.toLowerCase().includes(String(entity.name ?? entity).toLowerCase().slice(0, 12))
    );
    if (known) return check('reference', 'Reference data', CheckStatus.PASS, 'Matches a group entity.');
  }

  return check('reference', 'Reference data', CheckStatus.SKIP, 'No reference set covers this field.');
}

function rulesCheck(field, ruleIndex) {
  const issues = ruleIndex.get(field.key) ?? [];
  if (issues.length === 0) {
    return check('rules', 'Business rules', CheckStatus.PASS, 'No business rule fired against this field.');
  }
  const errors = issues.filter((entry) => entry.severity === 'error');
  return check(
    'rules',
    'Business rules',
    errors.length > 0 ? CheckStatus.FAIL : CheckStatus.PASS,
    `${issues.length} rule finding(s): ${issues[0].message}`
  );
}

function confidenceCheck(field, threshold) {
  if (!field.rawValue) return check('confidence', 'Model confidence', CheckStatus.SKIP, 'No value.');
  return field.confidence >= threshold
    ? check('confidence', 'Model confidence', CheckStatus.PASS, `${Math.round(field.confidence * 100)}% ≥ threshold.`)
    : check(
        'confidence',
        'Model confidence',
        CheckStatus.FAIL,
        `${Math.round(field.confidence * 100)}% is below the ${Math.round(threshold * 100)}% review threshold.`
      );
}

/* ── Cross-field arithmetic ──────────────────────────────────────────────── */

function buildArithmeticIndex(fields, analysis) {
  const map = new Map(fields.map((field) => [field.key, field]));
  const index = new Map();
  const num = (key) => {
    const value = map.get(key)?.value;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  const subtotal = num('subtotal');
  const tax = num('taxAmount');
  const total = num('totalAmount');

  if (subtotal !== null && total !== null) {
    const expected = subtotal + (tax ?? 0);
    const ok = Math.abs(expected - total) <= MONEY_TOLERANCE;
    const detail = ok
      ? `Subtotal + tax = ${expected.toFixed(2)} matches the stated total.`
      : `Subtotal + tax = ${expected.toFixed(2)} but the total reads ${total.toFixed(2)}.`;
    for (const key of ['subtotal', 'taxAmount', 'totalAmount']) {
      if (map.has(key)) index.set(key, { ok, detail });
    }
  }

  if (subtotal !== null && tax !== null && subtotal > 0) {
    const rate = tax / subtotal;
    const currency = map.get('currency')?.value;
    if (currency === 'SGD' && tax > 0) {
      const ok = Math.abs(rate - SINGAPORE_GST_RATE) <= 0.005;
      index.set('taxAmount', {
        ok,
        detail: ok
          ? `Effective tax rate ${(rate * 100).toFixed(2)}% matches the Singapore GST rate.`
          : `Effective tax rate ${(rate * 100).toFixed(2)}% deviates from the ${(SINGAPORE_GST_RATE * 100).toFixed(0)}% GST rate.`
      });
    }
  }

  // Line-item table footing: does the table's own money column add up to the total?
  const lineItemField = fields.find((field) => field.type === FieldType.TABLE && field.tableRef);
  if (lineItemField && total !== null) {
    const table = (analysis.tables ?? []).find((entry) => entry.id === lineItemField.tableRef);
    const footed = footTable(table);
    if (footed !== null) {
      const ok = Math.abs(footed - total) <= Math.max(MONEY_TOLERANCE, total * 0.12);
      index.set(lineItemField.key, {
        ok,
        detail: ok
          ? `Line items foot to ${footed.toFixed(2)}, consistent with the document total.`
          : `Line items foot to ${footed.toFixed(2)}, which does not reconcile to the total of ${total.toFixed(2)}.`
      });
    }
  }

  return index;
}

/** Sums the right-most numeric column of a table. Returns null when it cannot. */
export function footTable(table) {
  if (!table || !Array.isArray(table.rows) || table.rows.length === 0) return null;
  const columnCount = table.columns?.length ?? table.rows[0]?.length ?? 0;
  if (columnCount === 0) return null;

  for (let column = columnCount - 1; column >= 0; column -= 1) {
    let sum = 0;
    let parsed = 0;
    for (const row of table.rows) {
      const cell = String(row?.[column] ?? '').replace(/[^0-9.,-]/g, '').replace(/,/g, '');
      if (!cell || !/^-?[0-9]+(\.[0-9]+)?$/.test(cell)) continue;
      sum += Number(cell);
      parsed += 1;
    }
    if (parsed >= Math.max(2, Math.ceil(table.rows.length * 0.6))) return Number(sum.toFixed(2));
  }
  return null;
}

/* ── Corroboration index ─────────────────────────────────────────────────── */

const looseEqual = (left, right) => {
  const normalise = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  const a = normalise(left);
  const b = normalise(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const numericA = Number(a.replace(/[^0-9.]/g, ''));
  const numericB = Number(b.replace(/[^0-9.]/g, ''));
  if (Number.isFinite(numericA) && Number.isFinite(numericB) && numericA !== 0) {
    return Math.abs(numericA - numericB) <= MONEY_TOLERANCE;
  }
  return a.includes(b) || b.includes(a);
};

/**
 * Builds the second-source index: Azure prebuilt `documents[].fields`, layout
 * key-value pairs, table cells and independent repetitions of the value inside
 * the recognised text are all produced without reference to the primary
 * extractor, so each is genuine corroboration rather than the extractor agreeing
 * with itself.
 *
 * Sources that returned nothing are excluded. A key-value pair the layout model
 * emitted with an empty value is a miss, not a second opinion — treating it as
 * a contradiction would report a conflict against a value nobody read.
 */
function buildCorroborationIndex(fields, analysis, typeId) {
  const type = getDocumentType(typeId);
  const aliasIndex = new Map(type.fields.map((definition) => [definition.key, definition.aliases ?? []]));
  const index = new Map();

  const pairs = (analysis.keyValuePairs ?? []).filter((pair) => String(pair?.value ?? '').trim() !== '');
  const documentFields = (analysis.documentFields ?? []).filter(
    (entry) => String(entry?.value ?? '').trim() !== ''
  );
  const normalise = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const fullText = String(analysis.fullText ?? '');

  for (const field of fields) {
    if (!field.rawValue) continue;
    const aliases = (aliasIndex.get(field.key) ?? []).map(normalise);
    const labels = [normalise(field.key), normalise(field.label), ...aliases].filter(Boolean);
    const sources = [];
    let conflict = null;

    // Independent source A — Azure prebuilt domain fields.
    const documentField = documentFields.find(
      (candidate) =>
        normalise(candidate.key) === normalise(field.key) ||
        aliases.some((alias) => alias && normalise(candidate.key) === alias)
    );
    if (documentField) {
      if (looseEqual(documentField.value, field.rawValue)) sources.push('Azure prebuilt field');
      else conflict = { source: 'Azure prebuilt field', value: documentField.value };
    }

    // Independent source B — a key-value pair carrying the same value. When the
    // field itself came from a key-value pair, only a *second, differently
    // labelled* pair counts, otherwise the extractor would be corroborating
    // itself.
    const matchingPairs = pairs.filter((candidate) => labels.includes(normalise(candidate.key)));
    const independentPairs =
      field.source === 'key-value-pair'
        ? matchingPairs.filter((candidate) => normalise(candidate.key) !== normalise(field.sourceKey ?? field.label))
        : matchingPairs;
    if (independentPairs.length > 0) {
      const agreeing = independentPairs.find((candidate) => looseEqual(candidate.value, field.rawValue));
      if (agreeing) sources.push('layout key-value pair');
      else if (!conflict) conflict = { source: 'layout key-value pair', value: independentPairs[0].value };
    }

    // Independent source C — the same literal inside a recognised table cell.
    if (field.type !== FieldType.TABLE) {
      const inTable = (analysis.tables ?? []).some((table) =>
        (table.rows ?? []).some((row) => (row ?? []).some((cell) => looseEqual(cell, field.rawValue)))
      );
      if (inTable) sources.push('table cell');
    }

    // Independent source D — the value is printed more than once in the
    // document (a total repeated on a payment stub, a reference repeated in a
    // footer). A single occurrence is the extractor's own source and proves
    // nothing beyond grounding, so at least two are required.
    if (field.type !== FieldType.TABLE) {
      const occurrences = countOccurrences(fullText, String(field.rawValue));
      if (occurrences >= 2) sources.push(`${occurrences} independent occurrences in the source text`);
    }

    if (conflict) {
      index.set(field.key, { agrees: false, sources: [conflict.source], otherValue: conflict.value });
    } else if (sources.length > 0) {
      index.set(field.key, { agrees: true, sources, otherValue: null });
    }
  }

  return index;
}

/**
 * Counts non-overlapping occurrences of a value in the recognised text, ignoring
 * whitespace and punctuation so "MYR 71,831.12" matches "MYR71831.12".
 */
function countOccurrences(haystack, needle) {
  const normalise = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  const target = normalise(needle);
  if (target.length < MIN_REPEAT_GROUNDING_LENGTH) return 0;
  const text = normalise(haystack);
  if (!text) return 0;

  let count = 0;
  let position = text.indexOf(target);
  while (position !== -1) {
    count += 1;
    if (count >= 3) break;
    position = text.indexOf(target, position + target.length);
  }
  return count;
}

/* ── Field verification ──────────────────────────────────────────────────── */

function scoreChecks(checks, attribution = null) {
  let weighted = 0;
  let applicable = 0;
  let failures = 0;

  for (const entry of checks) {
    if (attribution && entry.attribution !== attribution) continue;
    const weight = CHECK_WEIGHTS[entry.id] ?? 0.1;
    if (entry.status === CheckStatus.SKIP) continue;
    applicable += weight;
    if (entry.status === CheckStatus.PASS) weighted += weight;
    else failures += 1;
  }

  return {
    ratio: applicable > 0 ? weighted / applicable : 0,
    applicableWeight: applicable,
    failures
  };
}

/**
 * The verdict answers the extraction question only: did the platform read this
 * value correctly? A document that contradicts itself is reported separately by
 * `resolveIntegrity`, so a faithful transcription of a defective invoice is not
 * mislabelled as an OCR failure.
 */
function resolveVerdict(field, checks, score) {
  if (!field.rawValue) return Verdict.MISSING;
  const hard = checks.filter(
    (entry) => entry.status === CheckStatus.FAIL && ['corroboration', 'typing'].includes(entry.id)
  );
  if (hard.length > 0) return Verdict.CONFLICT;
  if (score.ratio >= 0.85 && score.failures === 0) return Verdict.VERIFIED;
  if (score.ratio >= 0.6) return Verdict.PROBABLE;
  return Verdict.UNVERIFIED;
}

/**
 * Integrity answers the second question: does the document agree with its own
 * arithmetic and with policy? A disputed field still drives risk, priority and
 * exception routing — it is never silently accepted.
 */
function resolveIntegrity(checks) {
  const documentChecks = checks.filter((entry) => entry.attribution === Attribution.DOCUMENT);
  const applicable = documentChecks.filter((entry) => entry.status !== CheckStatus.SKIP);
  if (applicable.length === 0) return Integrity.NOT_APPLICABLE;
  return applicable.some((entry) => entry.status === CheckStatus.FAIL) ? Integrity.DISPUTED : Integrity.CLEAN;
}

/**
 * Recalibrates model confidence against the evidence.
 * Evidence can only move confidence within a bounded band, so a strong prior is
 * never destroyed by one skipped check and a weak prior is never inflated to
 * certainty by circumstantial support.
 */
function calibrate(field, score, verdict) {
  if (!field.rawValue) return 0;
  const prior = Math.max(0, Math.min(1, field.confidence || 0));
  const evidence = score.applicableWeight > 0 ? score.ratio : 0.5;
  const blended = prior * 0.55 + evidence * 0.45;

  const adjustment =
    verdict === Verdict.CONFLICT ? -0.3 : verdict === Verdict.VERIFIED ? 0.05 : verdict === Verdict.UNVERIFIED ? -0.1 : 0;

  return Number(Math.max(0, Math.min(field.edited ? 1 : 0.995, blended + adjustment)).toFixed(4));
}

/**
 * Runs the full assurance pass over a document.
 *
 * @param {object} input
 * @param {string} input.typeId
 * @param {object[]} input.fields
 * @param {object} input.analysis     Normalised analysis result.
 * @param {object} input.validation   Output of the validation service.
 * @param {object} [input.classification]
 * @param {number} [input.threshold]  Review confidence threshold.
 * @returns {object} accuracy report
 */
export function evaluateAccuracy({ typeId, fields, analysis, validation, classification, threshold = 0.8 }) {
  const text = String(analysis?.fullText ?? '').toLowerCase().replace(/\s+/g, ' ');
  const haystack = { text, compact: text.replace(/[^a-z0-9.]/g, '') };

  const ruleIndex = new Map();
  for (const issueEntry of validation?.issues ?? []) {
    for (const key of issueEntry.fieldKeys ?? []) {
      ruleIndex.set(key, [...(ruleIndex.get(key) ?? []), issueEntry]);
    }
  }

  const arithmetic = buildArithmeticIndex(fields, analysis ?? {});
  const corroboration = buildCorroborationIndex(fields, analysis ?? {}, typeId);

  const verifiedFields = fields.map((field) => {
    const checks = [
      groundingCheck(field, haystack),
      typingCheck(field),
      corroborationCheck(field, corroboration),
      arithmeticCheck(field, arithmetic),
      referenceCheck(field),
      rulesCheck(field, ruleIndex),
      confidenceCheck(field, threshold)
    ];
    // Extraction fidelity drives the verdict and the calibrated confidence;
    // document integrity is scored separately so the two never contaminate
    // each other.
    const extractionScore = scoreChecks(checks, Attribution.EXTRACTION);
    const overallScore = scoreChecks(checks);
    const verdict = resolveVerdict(field, checks, extractionScore);
    const integrity = resolveIntegrity(checks);
    return {
      key: field.key,
      label: field.label,
      critical: Boolean(field.critical),
      value: field.rawValue,
      source: field.source,
      modelConfidence: field.confidence ?? 0,
      calibratedConfidence: calibrate(field, extractionScore, verdict),
      evidenceScore: Number(extractionScore.ratio.toFixed(4)),
      overallEvidenceScore: Number(overallScore.ratio.toFixed(4)),
      verdict,
      integrity,
      integrityDetail:
        integrity === Integrity.DISPUTED
          ? (checks.find(
              (entry) => entry.attribution === Attribution.DOCUMENT && entry.status === CheckStatus.FAIL
            )?.detail ?? 'The document contradicts itself.')
          : null,
      checks,
      passedChecks: checks.filter((entry) => entry.status === CheckStatus.PASS).length,
      failedChecks: checks.filter((entry) => entry.status === CheckStatus.FAIL).length,
      repaired: Boolean(field.repaired),
      repairRule: field.repairRule ?? null
    };
  });

  const populated = verifiedFields.filter((entry) => entry.verdict !== Verdict.MISSING);
  const criticalFields = verifiedFields.filter((entry) => entry.critical);
  const criticalPopulated = criticalFields.filter((entry) => entry.verdict !== Verdict.MISSING);
  const verified = populated.filter((entry) => entry.verdict === Verdict.VERIFIED);
  const conflicts = verifiedFields.filter((entry) => entry.verdict === Verdict.CONFLICT);
  const disputed = verifiedFields.filter((entry) => entry.integrity === Integrity.DISPUTED);

  const weightFor = (entry) => (entry.critical ? 2 : 1);
  const totalWeight = verifiedFields.reduce((sum, entry) => sum + weightFor(entry), 0) || 1;
  const earned = verifiedFields.reduce((sum, entry) => {
    const value =
      entry.verdict === Verdict.VERIFIED
        ? 1
        : entry.verdict === Verdict.PROBABLE
          ? 0.75
          : entry.verdict === Verdict.UNVERIFIED
            ? 0.4
            : 0;
    return sum + value * weightFor(entry);
  }, 0);

  const accuracyScore = Number((earned / totalWeight).toFixed(4));
  const coverage = verifiedFields.length > 0 ? Number((populated.length / verifiedFields.length).toFixed(4)) : 0;
  const criticalCoverage =
    criticalFields.length > 0 ? Number((criticalPopulated.length / criticalFields.length).toFixed(4)) : 1;
  const integrityAssessed = verifiedFields.filter((entry) => entry.integrity !== Integrity.NOT_APPLICABLE);
  const integrityScore =
    integrityAssessed.length > 0
      ? Number(((integrityAssessed.length - disputed.length) / integrityAssessed.length).toFixed(4))
      : 1;
  const calibratedConfidence =
    populated.length > 0
      ? Number((populated.reduce((sum, entry) => sum + entry.calibratedConfidence, 0) / populated.length).toFixed(4))
      : 0;

  // A document-integrity dispute is as serious as an extraction conflict: it
  // still blocks straight-through processing and still raises the risk level.
  const riskLevel =
    conflicts.length > 0 || disputed.length > 0 || criticalCoverage < 1
      ? 'high'
      : accuracyScore < 0.85 || (validation?.errorCount ?? 0) > 0
        ? 'medium'
        : 'low';

  const straightThroughEligible =
    riskLevel === 'low' &&
    accuracyScore >= 0.9 &&
    disputed.length === 0 &&
    (validation?.passed ?? false) &&
    (classification?.confidence ?? 0) >= 0.75;

  return {
    accuracyScore,
    calibratedConfidence,
    coverage,
    criticalCoverage,
    integrityScore,
    verifiedCount: verified.length,
    probableCount: populated.filter((entry) => entry.verdict === Verdict.PROBABLE).length,
    unverifiedCount: populated.filter((entry) => entry.verdict === Verdict.UNVERIFIED).length,
    conflictCount: conflicts.length,
    integrityIssueCount: disputed.length,
    missingCount: verifiedFields.length - populated.length,
    fieldCount: verifiedFields.length,
    riskLevel,
    straightThroughEligible,
    checksRun: verifiedFields.reduce(
      (sum, entry) => sum + entry.checks.filter((item) => item.status !== CheckStatus.SKIP).length,
      0
    ),
    fields: verifiedFields,
    conflicts: conflicts.map((entry) => ({
      key: entry.key,
      label: entry.label,
      detail:
        entry.checks.find(
          (item) => item.status === CheckStatus.FAIL && item.attribution === Attribution.EXTRACTION
        )?.detail ?? 'Unspecified conflict.'
    })),
    integrityIssues: disputed.map((entry) => ({
      key: entry.key,
      label: entry.label,
      detail: entry.integrityDetail ?? 'The document contradicts itself.'
    }))
  };
}

/* ── Corpus-level calibration & benchmark ────────────────────────────────── */

/**
 * Reliability curve: for each confidence bucket, how often was the field
 * actually verified? A well-calibrated platform sits on the diagonal.
 * Also returns expected calibration error (ECE) and a Brier score.
 *
 * The curve audits the **calibrated** confidence by default, because that is the
 * number the platform publishes and therefore the number a reviewer relies on.
 * Passing `source: 'model'` audits the raw extractor confidence instead, which
 * is what makes the improvement from recalibration measurable rather than
 * asserted.
 *
 * @param {object[]} records document records carrying `accuracy.fields`
 * @param {{ source?: 'calibrated'|'model' }} [options]
 */
export function buildCalibration(records, { source = 'calibrated' } = {}) {
  const buckets = Array.from({ length: CALIBRATION_BUCKETS }, (unused, index) => ({
    lower: index / CALIBRATION_BUCKETS,
    upper: (index + 1) / CALIBRATION_BUCKETS,
    label: `${index * 10}–${(index + 1) * 10}%`,
    predictedSum: 0,
    observedSum: 0,
    count: 0
  }));

  let brierSum = 0;
  let observations = 0;

  for (const record of records) {
    for (const field of record.accuracy?.fields ?? []) {
      if (field.verdict === Verdict.MISSING) continue;
      const claimed = source === 'model' ? field.modelConfidence : field.calibratedConfidence;
      const predicted = Math.max(0, Math.min(0.9999, claimed ?? 0));
      const observed = field.verdict === Verdict.VERIFIED ? 1 : field.verdict === Verdict.PROBABLE ? 0.5 : 0;
      const bucketIndex = Math.min(CALIBRATION_BUCKETS - 1, Math.floor(predicted * CALIBRATION_BUCKETS));
      const bucket = buckets[bucketIndex];
      bucket.predictedSum += predicted;
      bucket.observedSum += observed;
      bucket.count += 1;
      brierSum += (predicted - observed) ** 2;
      observations += 1;
    }
  }

  const populated = buckets.filter((bucket) => bucket.count > 0);
  const expectedCalibrationError =
    observations > 0
      ? Number(
          (
            populated.reduce(
              (sum, bucket) =>
                sum + (bucket.count / observations) * Math.abs(bucket.predictedSum / bucket.count - bucket.observedSum / bucket.count),
              0
            )
          ).toFixed(4)
        )
      : 0;

  return {
    source,
    observations,
    brierScore: observations > 0 ? Number((brierSum / observations).toFixed(4)) : 0,
    expectedCalibrationError,
    reliability: buckets.map((bucket) => ({
      label: bucket.label,
      lower: bucket.lower,
      upper: bucket.upper,
      count: bucket.count,
      predicted: bucket.count > 0 ? Number((bucket.predictedSum / bucket.count).toFixed(4)) : null,
      observed: bucket.count > 0 ? Number((bucket.observedSum / bucket.count).toFixed(4)) : null
    }))
  };
}

/**
 * Corpus accuracy benchmark, sliced by document type and by check.
 * @param {object[]} records
 */
export function benchmarkCorpus(records) {
  const scored = records.filter((record) => record.accuracy && record.accuracy.fieldCount > 0);

  const byType = new Map();
  const byCheck = new Map();
  let verified = 0;
  let populated = 0;
  let conflicts = 0;
  let disputed = 0;
  let repairs = 0;

  for (const record of scored) {
    const typeId = record.classification?.typeId ?? 'unclassified';
    const bucket = byType.get(typeId) ?? {
      typeId,
      typeName: record.classification?.typeName ?? 'Unclassified',
      documents: 0,
      accuracySum: 0,
      coverageSum: 0,
      calibratedSum: 0,
      conflicts: 0,
      integrityIssues: 0,
      stpEligible: 0
    };
    bucket.documents += 1;
    bucket.accuracySum += record.accuracy.accuracyScore;
    bucket.coverageSum += record.accuracy.coverage;
    bucket.calibratedSum += record.accuracy.calibratedConfidence;
    bucket.conflicts += record.accuracy.conflictCount;
    bucket.integrityIssues += record.accuracy.integrityIssueCount ?? 0;
    bucket.stpEligible += record.accuracy.straightThroughEligible ? 1 : 0;
    byType.set(typeId, bucket);

    repairs += record.accuracy.repairs?.length ?? 0;

    for (const field of record.accuracy.fields ?? []) {
      if (field.verdict === Verdict.MISSING) continue;
      populated += 1;
      if (field.verdict === Verdict.VERIFIED) verified += 1;
      if (field.verdict === Verdict.CONFLICT) conflicts += 1;
      if (field.integrity === Integrity.DISPUTED) disputed += 1;
      for (const entry of field.checks ?? []) {
        const stat = byCheck.get(entry.id) ?? {
          id: entry.id,
          name: entry.name,
          attribution: entry.attribution ?? Attribution.EXTRACTION,
          pass: 0,
          fail: 0,
          skipped: 0
        };
        if (entry.status === CheckStatus.PASS) stat.pass += 1;
        else if (entry.status === CheckStatus.FAIL) stat.fail += 1;
        else stat.skipped += 1;
        byCheck.set(entry.id, stat);
      }
    }
  }

  const average = (selector) =>
    scored.length > 0 ? Number((scored.reduce((sum, record) => sum + selector(record), 0) / scored.length).toFixed(4)) : 0;

  return {
    documentsScored: scored.length,
    fieldsScored: populated,
    verifiedFieldRatio: populated > 0 ? Number((verified / populated).toFixed(4)) : 0,
    conflictRatio: populated > 0 ? Number((conflicts / populated).toFixed(4)) : 0,
    // Reported separately from conflictRatio: these fields were transcribed
    // correctly but the source document contradicts itself.
    integrityIssueRatio: populated > 0 ? Number((disputed / populated).toFixed(4)) : 0,
    documentsWithIntegrityIssues: scored.filter((record) => (record.accuracy.integrityIssueCount ?? 0) > 0).length,
    autoRepairs: repairs,
    averageAccuracy: average((record) => record.accuracy.accuracyScore),
    averageCoverage: average((record) => record.accuracy.coverage),
    averageIntegrity: average((record) => record.accuracy.integrityScore ?? 1),
    averageCalibratedConfidence: average((record) => record.accuracy.calibratedConfidence),
    straightThroughEligibleRatio:
      scored.length > 0
        ? Number((scored.filter((record) => record.accuracy.straightThroughEligible).length / scored.length).toFixed(4))
        : 0,
    byType: [...byType.values()]
      .map((bucket) => ({
        typeId: bucket.typeId,
        typeName: bucket.typeName,
        documents: bucket.documents,
        averageAccuracy: Number((bucket.accuracySum / bucket.documents).toFixed(4)),
        averageCoverage: Number((bucket.coverageSum / bucket.documents).toFixed(4)),
        averageCalibratedConfidence: Number((bucket.calibratedSum / bucket.documents).toFixed(4)),
        conflicts: bucket.conflicts,
        integrityIssues: bucket.integrityIssues,
        stpEligibleRatio: Number((bucket.stpEligible / bucket.documents).toFixed(4))
      }))
      .sort((left, right) => right.documents - left.documents),
    byCheck: [...byCheck.values()]
      .map((stat) => ({
        ...stat,
        evaluated: stat.pass + stat.fail,
        passRate: stat.pass + stat.fail > 0 ? Number((stat.pass / (stat.pass + stat.fail)).toFixed(4)) : null
      }))
      .sort((left, right) => right.evaluated - left.evaluated),
    calibration: buildCalibration(scored),
    // The same curve over the raw extractor confidence, so the value added by
    // recalibration is demonstrated rather than claimed.
    modelCalibration: buildCalibration(scored, { source: 'model' })
  };
}
