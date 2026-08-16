/**
 * Distributor A&P (Advertising & Promotion) claim validation engine.
 *
 * A claim is a page-one summary document plus a variable set of supporting
 * attachments (vendor invoices such as a Google Ads bill, agency letters,
 * annotated notes). The A&P code (A1–A9) is the join key. This service links the
 * documents already in the store and runs the exact validations the marketing
 * team performs by hand before releasing payment:
 *
 *   • claim total reconciles to the sum of the supporting invoices;
 *   • each invoice amount on the summary matches the amount on the attachment
 *     (catches the 13,349-vs-13,348 dollar mismatch);
 *   • each invoice date on the summary matches the attachment date;
 *   • the A&P code is consistent across every document (A6 vs A7);
 *   • highlighted lines per product type (TBO, TBMP, …) sum back to the
 *     page-one product-type subtotal;
 *   • the claimed amount fits within the remaining annual budget for the code.
 *
 * Everything is read from the fields and tables the extraction pipeline produced
 * for real (demo or Azure) documents — nothing is fabricated here.
 */
import { RULE_CATALOGUE } from '../domain/documentTypes.js';
import { AP_BUDGET_CURRENCY, getApBudget, normaliseProductType } from '../domain/apBudget.js';
import { listAllDocuments, tryGetDocument } from './store.service.js';
import { parseDate } from '../lib/format.js';

const AMOUNT_TOLERANCE = 0.02;

const Severity = Object.freeze({ ERROR: 'error', WARNING: 'warning', INFO: 'info' });
const CheckStatus = Object.freeze({ PASS: 'pass', FAIL: 'fail', INFO: 'info' });

const RULE_LABELS = Object.freeze({
  claim_amount_matches_support: 'Claim total reconciles to attachments',
  line_invoice_amounts_match: 'Invoice amounts match attachments',
  line_invoice_dates_match: 'Invoice dates match attachments',
  support_ap_code_matches: 'A&P code consistent across documents',
  product_type_summation: 'Product-type lines sum to page-one subtotals',
  ap_code_within_budget: 'Claim fits within A&P annual budget',
  support_dates_align: 'Attachment dates align with claim date',
  distributor_referenced: 'Distributor referenced in attachments'
});

const ruleLabel = (rule) => RULE_LABELS[rule] ?? rule;
const ruleDescription = (rule) => RULE_CATALOGUE[rule] ?? '';

// ── Field / value helpers ────────────────────────────────────────────────────
function fieldValue(record, keys) {
  for (const key of keys) {
    const field = record?.fields?.find((item) => item.key === key);
    if (field && field.value !== null && field.value !== undefined && field.value !== '') return field.value;
  }
  return null;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value) {
  if (!value) return null;
  const parsed = parseDate(String(value).replace(/^[^0-9]*/, '').trim());
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function sameDay(left, right) {
  const a = toDate(left);
  const b = toDate(right);
  if (!a || !b) return null;
  return a.getTime() === b.getTime();
}

function apCodeOf(record) {
  return (fieldValue(record, ['apCode', 'apCodeRef']) ?? '').toString().trim().toUpperCase();
}

function claimCurrency(claim) {
  const amountField = claim?.fields?.find((item) => item.key === 'claimAmount');
  if (amountField?.currency) return String(amountField.currency).toUpperCase();
  const declared = fieldValue(claim, ['claimCurrency']);
  return declared ? String(declared).toUpperCase() : null;
}

const normaliseRef = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ── Table helpers ────────────────────────────────────────────────────────────
function getTable(record, fieldKey, titleNeedles = []) {
  const tables = record?.tables ?? [];
  const byKey = tables.find((table) => table.fieldKey === fieldKey);
  if (byKey) return byKey;
  const needles = titleNeedles.map((needle) => needle.toLowerCase());
  return tables.find((table) => needles.some((needle) => String(table.title ?? '').toLowerCase().includes(needle))) ?? null;
}

function columnIndex(columns, names) {
  const lower = (columns ?? []).map((column) => String(column ?? '').toLowerCase());
  for (const name of names) {
    const index = lower.findIndex((column) => column.includes(name.toLowerCase()));
    if (index !== -1) return index;
  }
  return -1;
}

/** Page-one claim line items: one row per attached invoice. */
function parseClaimLines(claim) {
  const table = getTable(claim, 'lineItems', ['claim line', 'line item', 'breakdown']);
  if (!table) return [];
  const cols = table.columns ?? [];
  const iVendor = columnIndex(cols, ['vendor', 'supplier']);
  const iRef = columnIndex(cols, ['invoice no', 'invoice number', 'invoice ref', 'reference', 'ref']);
  const iDate = columnIndex(cols, ['invoice date', 'date']);
  const iAp = columnIndex(cols, ['a&p', 'ap code']);
  const iProduct = columnIndex(cols, ['product']);
  const iAmount = columnIndex(cols, ['amount', 'total']);
  const iMarkup = columnIndex(cols, ['mark-up', 'markup', 'annotation']);
  return (table.rows ?? []).map((row) => ({
    vendor: iVendor >= 0 ? String(row[iVendor] ?? '').trim() : null,
    invoiceRef: iRef >= 0 ? String(row[iRef] ?? '').trim() : null,
    invoiceDate: iDate >= 0 ? String(row[iDate] ?? '').trim() : null,
    apCode: iAp >= 0 ? String(row[iAp] ?? '').trim().toUpperCase() : null,
    productType: iProduct >= 0 ? String(row[iProduct] ?? '').trim() : null,
    amount: iAmount >= 0 ? toNumber(row[iAmount]) : null,
    annotation: iMarkup >= 0 ? String(row[iMarkup] ?? '').trim() : null
  }));
}

/** Page-one product-type spend summary: Product Type → stated amount. */
function parseProductSummary(claim) {
  const table = getTable(claim, 'productSummary', ['product type summary', 'product summary']);
  if (!table) return [];
  const iProduct = columnIndex(table.columns, ['product']);
  const iAmount = columnIndex(table.columns, ['amount', 'total']);
  return (table.rows ?? [])
    .map((row) => ({
      productType: iProduct >= 0 ? normaliseProductType(row[iProduct]) : null,
      amount: iAmount >= 0 ? toNumber(row[iAmount]) : null
    }))
    .filter((entry) => entry.productType && entry.amount !== null);
}

/** Highlighted line items on a supporting attachment: Product → amount. */
function parseSupportLines(record) {
  const table = getTable(record, 'lineItems', ['highlighted line', 'line item', 'charges']);
  if (!table) return [];
  const iProduct = columnIndex(table.columns, ['product']);
  const iAmount = columnIndex(table.columns, ['amount', 'total']);
  const iMarkup = columnIndex(table.columns, ['mark-up', 'markup', 'annotation']);
  return (table.rows ?? [])
    .map((row) => ({
      productType: iProduct >= 0 ? normaliseProductType(row[iProduct]) : null,
      amount: iAmount >= 0 ? toNumber(row[iAmount]) : null,
      annotation: iMarkup >= 0 ? String(row[iMarkup] ?? '').trim() : null
    }))
    .filter((entry) => entry.productType && entry.amount !== null);
}

/** Build a normalised view of a supporting document. */
function describeSupport(record, claimApCode) {
  return {
    id: record.id,
    fileName: record.fileName,
    typeName: record.classification?.typeName ?? null,
    vendor: fieldValue(record, ['vendorName', 'supplier']) ?? null,
    reference: fieldValue(record, ['documentReference', 'invoiceNumber']) ?? null,
    documentKind: fieldValue(record, ['documentKind']) ?? record.classification?.typeName ?? 'Supporting document',
    productType: fieldValue(record, ['productType']) ?? null,
    apCode: apCodeOf(record),
    apCodeMatches: apCodeOf(record) === claimApCode,
    documentDate: fieldValue(record, ['documentDate', 'invoiceDate', 'date']) ?? null,
    amount: toNumber(fieldValue(record, ['amount', 'totalAmount', 'claimAmount'])),
    lines: parseSupportLines(record),
    fullText: record.fullText ?? ''
  };
}

/** Find supporting documents for a claim by A&P code, with a full-text fallback. */
function findSupportingDocuments(claim, allDocuments) {
  const claimApCode = apCodeOf(claim);
  if (!claimApCode) return [];
  const claimNumber = String(fieldValue(claim, ['claimNumber']) ?? '').toUpperCase();
  return allDocuments
    .filter((record) => record.id !== claim.id && record.classification?.typeId === 'marketing_support')
    .filter((record) => {
      if (apCodeOf(record) === claimApCode) return true;
      // An attachment with a mis-keyed A&P code (e.g. A7 vs A6) still belongs to
      // the claim — link it via the claim number or A&P code in its full text.
      const haystack = String(record.fullText ?? '').toUpperCase();
      return (claimNumber && haystack.includes(claimNumber)) || haystack.includes(claimApCode);
    })
    .map((record) => describeSupport(record, claimApCode));
}

function check(rule, severity, status, message, extra = {}) {
  return { rule, label: ruleLabel(rule), description: ruleDescription(rule), severity, status, message, ...extra };
}

function sumSupportingByProduct(supporting) {
  const totals = new Map();
  for (const support of supporting) {
    for (const line of support.lines ?? []) {
      totals.set(line.productType, Number(((totals.get(line.productType) ?? 0) + line.amount).toFixed(2)));
    }
  }
  return totals;
}

/** Match page-one summary lines to their supporting attachments by reference. */
function matchLines(claimLines, supporting) {
  const byRef = new Map();
  for (const support of supporting) {
    if (support.reference) byRef.set(normaliseRef(support.reference), support);
  }
  return claimLines.map((line) => ({
    line,
    support: line.invoiceRef ? byRef.get(normaliseRef(line.invoiceRef)) ?? null : null
  }));
}

// ── Reconciliation ───────────────────────────────────────────────────────────
function reconcile(claim, supporting) {
  const checks = [];
  const claimApCode = apCodeOf(claim);
  const currency = claimCurrency(claim);
  const claimAmount = toNumber(fieldValue(claim, ['claimAmount', 'amount']));
  const claimDate = fieldValue(claim, ['claimDate']);
  const distributor = (fieldValue(claim, ['distributorName']) ?? '').toString().trim();

  const claimLines = parseClaimLines(claim);
  const productSummary = parseProductSummary(claim);
  const matched = matchLines(claimLines, supporting);

  const invoiceSupports = supporting.filter((support) => support.amount !== null);
  const supportTotal = Number(invoiceSupports.reduce((sum, support) => sum + support.amount, 0).toFixed(2));
  const amountVariance = claimAmount === null ? null : Number((claimAmount - supportTotal).toFixed(2));

  // 1 — Claim total reconciles to the sum of supporting invoices.
  if (claimAmount === null) {
    checks.push(check('claim_amount_matches_support', Severity.ERROR, CheckStatus.FAIL, 'Claim amount could not be read from the summary.'));
  } else if (invoiceSupports.length === 0) {
    checks.push(check('claim_amount_matches_support', Severity.ERROR, CheckStatus.FAIL, 'No supporting invoices with an amount were found to substantiate the claim.', { expected: claimAmount, actual: 0 }));
  } else if (Math.abs(amountVariance) <= AMOUNT_TOLERANCE) {
    checks.push(check('claim_amount_matches_support', Severity.ERROR, CheckStatus.PASS, `Claim total ${claimAmount.toFixed(2)} matches attachments (${supportTotal.toFixed(2)}).`, { expected: claimAmount, actual: supportTotal, delta: amountVariance }));
  } else {
    checks.push(check('claim_amount_matches_support', Severity.ERROR, CheckStatus.FAIL, `Claim total ${claimAmount.toFixed(2)} does not match attachments total ${supportTotal.toFixed(2)} (variance ${amountVariance.toFixed(2)}).`, { expected: claimAmount, actual: supportTotal, delta: amountVariance }));
  }

  // 2 — Each invoice amount on the summary matches the attachment amount.
  const amountMismatches = [];
  let amountComparisons = 0;
  for (const { line, support } of matched) {
    if (!support || line.amount === null || support.amount === null) continue;
    amountComparisons += 1;
    const delta = Number((line.amount - support.amount).toFixed(2));
    if (Math.abs(delta) > AMOUNT_TOLERANCE) {
      amountMismatches.push({ reference: line.invoiceRef, stated: line.amount, actual: support.amount, delta });
    }
  }
  if (amountComparisons > 0) {
    if (amountMismatches.length === 0) {
      checks.push(check('line_invoice_amounts_match', Severity.ERROR, CheckStatus.PASS, `All ${amountComparisons} invoice amount(s) match their attachments.`));
    } else {
      const detail = amountMismatches.map((m) => `${m.reference}: summary ${m.stated.toFixed(2)} vs attachment ${m.actual.toFixed(2)} (Δ ${m.delta.toFixed(2)})`).join('; ');
      checks.push(check('line_invoice_amounts_match', Severity.ERROR, CheckStatus.FAIL, `Invoice amount mismatch — ${detail}.`, { mismatches: amountMismatches }));
    }
  }

  // 3 — Each invoice date on the summary matches the attachment date.
  const dateMismatches = [];
  let dateComparisons = 0;
  for (const { line, support } of matched) {
    if (!support || !line.invoiceDate || !support.documentDate) continue;
    dateComparisons += 1;
    if (sameDay(line.invoiceDate, support.documentDate) === false) {
      dateMismatches.push({ reference: line.invoiceRef, stated: line.invoiceDate, actual: support.documentDate });
    }
  }
  if (dateComparisons > 0) {
    if (dateMismatches.length === 0) {
      checks.push(check('line_invoice_dates_match', Severity.WARNING, CheckStatus.PASS, `All ${dateComparisons} invoice date(s) match their attachments.`));
    } else {
      const detail = dateMismatches.map((m) => `${m.reference}: summary ${m.stated} vs attachment ${m.actual}`).join('; ');
      checks.push(check('line_invoice_dates_match', Severity.WARNING, CheckStatus.FAIL, `Invoice date mismatch — ${detail}.`, { mismatches: dateMismatches }));
    }
  }

  // 4 — A&P code consistent across every attachment.
  const apMismatched = supporting.filter((support) => support.apCode && !support.apCodeMatches);
  if (supporting.length === 0) {
    checks.push(check('support_ap_code_matches', Severity.ERROR, CheckStatus.FAIL, `No supporting documents were found for A&P code ${claimApCode || '(missing)'}.`));
  } else if (apMismatched.length === 0) {
    checks.push(check('support_ap_code_matches', Severity.ERROR, CheckStatus.PASS, `All ${supporting.length} attachment(s) reference A&P code ${claimApCode}.`));
  } else {
    const detail = apMismatched.map((support) => `${support.reference ?? support.fileName} → ${support.apCode}`).join(', ');
    checks.push(check('support_ap_code_matches', Severity.ERROR, CheckStatus.FAIL, `A&P code mismatch — claim is ${claimApCode} but attachment(s) show: ${detail}.`, { claimApCode }));
  }

  // 5 — Product-type summation: highlighted lines sum back to page-one subtotals.
  const productActuals = sumSupportingByProduct(supporting);
  const summationRows = [];
  const summationFailures = [];
  for (const entry of productSummary) {
    const actual = productActuals.has(entry.productType) ? productActuals.get(entry.productType) : null;
    const delta = actual === null ? null : Number((entry.amount - actual).toFixed(2));
    const ok = delta !== null && Math.abs(delta) <= AMOUNT_TOLERANCE;
    summationRows.push({ productType: entry.productType, stated: entry.amount, actual, delta, status: actual === null ? 'unverified' : ok ? 'ok' : 'mismatch' });
    if (actual !== null && !ok) summationFailures.push({ productType: entry.productType, stated: entry.amount, actual, delta });
  }
  if (productSummary.length > 0) {
    if (productActuals.size === 0) {
      checks.push(check('product_type_summation', Severity.INFO, CheckStatus.INFO, 'No highlighted product-type lines were detected on the attachments to sum against the page-one subtotals.', { rows: summationRows }));
    } else if (summationFailures.length === 0) {
      checks.push(check('product_type_summation', Severity.ERROR, CheckStatus.PASS, 'Highlighted lines sum back to every page-one product-type subtotal.', { rows: summationRows }));
    } else {
      const detail = summationFailures.map((f) => `${f.productType}: page-one ${f.stated.toFixed(2)} vs highlighted lines ${f.actual.toFixed(2)} (Δ ${f.delta.toFixed(2)})`).join('; ');
      checks.push(check('product_type_summation', Severity.ERROR, CheckStatus.FAIL, `Product-type summation error — ${detail}.`, { rows: summationRows }));
    }
  }

  // 6 — Claim fits within the remaining annual A&P budget.
  const budget = getApBudget(claimApCode);
  let budgetInfo = null;
  if (budget) {
    budgetInfo = { ...budget, currency: AP_BUDGET_CURRENCY, claimAmount, claimCurrency: currency };
    if (currency && currency !== AP_BUDGET_CURRENCY) {
      checks.push(check('ap_code_within_budget', Severity.INFO, CheckStatus.INFO, `${budget.code} (${budget.name}) has ${AP_BUDGET_CURRENCY} ${budget.remaining.toFixed(2)} remaining of ${AP_BUDGET_CURRENCY} ${budget.annualBudget.toFixed(2)}. Claim is in ${currency} — convert (FX) before drawing down the budget.`, { budget: budgetInfo }));
    } else if (claimAmount !== null && claimAmount > budget.remaining + AMOUNT_TOLERANCE) {
      checks.push(check('ap_code_within_budget', Severity.WARNING, CheckStatus.FAIL, `Claim ${claimAmount.toFixed(2)} exceeds the ${budget.remaining.toFixed(2)} remaining for ${budget.code} (${budget.name}) — annual ${budget.annualBudget.toFixed(2)}, already spent ${budget.spentToDate.toFixed(2)}.`, { budget: budgetInfo }));
    } else if (claimAmount !== null) {
      checks.push(check('ap_code_within_budget', Severity.WARNING, CheckStatus.PASS, `Claim ${claimAmount.toFixed(2)} fits within the ${budget.remaining.toFixed(2)} remaining for ${budget.code} (${budget.name}).`, { budget: budgetInfo }));
    }
  } else if (claimApCode) {
    checks.push(check('ap_code_within_budget', Severity.WARNING, CheckStatus.FAIL, `A&P code ${claimApCode} is not in the annual budget table (expected A1–A9).`));
  }

  // 7 — Attachment dates should not fall after the claim date (freshness).
  if (claimDate) {
    const claimDateObj = toDate(claimDate);
    const late = supporting.filter((support) => {
      const supportDate = toDate(support.documentDate);
      return claimDateObj && supportDate && supportDate.getTime() > claimDateObj.getTime();
    });
    if (late.length === 0) {
      checks.push(check('support_dates_align', Severity.WARNING, CheckStatus.PASS, 'All attachment dates fall on or before the claim date.'));
    } else {
      const names = late.map((support) => `${support.reference ?? support.fileName} (${support.documentDate})`).join(', ');
      checks.push(check('support_dates_align', Severity.WARNING, CheckStatus.FAIL, `Attachment date(s) fall after the claim date of ${claimDate}: ${names}.`));
    }
  }

  // 8 — Distributor referenced (informational context only).
  if (distributor) {
    const referenced = supporting.some(
      (support) =>
        (support.vendor ?? '').toLowerCase().includes(distributor.toLowerCase()) ||
        (support.fullText ?? '').toLowerCase().includes(distributor.toLowerCase())
    );
    checks.push(check('distributor_referenced', Severity.INFO, CheckStatus.INFO, referenced ? `Distributor "${distributor}" is referenced in the attachments.` : `Distributor "${distributor}" is not named on the vendor attachments — linked by A&P code.`));
  }

  const exceptions = checks.filter(
    (item) => item.status === CheckStatus.FAIL && (item.severity === Severity.ERROR || item.severity === Severity.WARNING)
  );
  const errorCount = exceptions.filter((item) => item.severity === Severity.ERROR).length;
  const warningCount = exceptions.filter((item) => item.severity === Severity.WARNING).length;

  return {
    status: exceptions.length === 0 ? 'clear' : 'review',
    checks,
    exceptions,
    errorCount,
    warningCount,
    currency,
    claimAmount,
    supportTotal,
    amountVariance,
    productSummation: summationRows,
    lineComparison: matched.map(({ line, support }) => ({
      vendor: line.vendor,
      invoiceRef: line.invoiceRef,
      productType: line.productType,
      annotation: line.annotation,
      summaryDate: line.invoiceDate,
      attachmentDate: support?.documentDate ?? null,
      summaryAmount: line.amount,
      attachmentAmount: support?.amount ?? null,
      matched: Boolean(support),
      amountOk: support && line.amount !== null && support.amount !== null ? Math.abs(line.amount - support.amount) <= AMOUNT_TOLERANCE : null,
      dateOk: support && line.invoiceDate && support.documentDate ? sameDay(line.invoiceDate, support.documentDate) : null
    })),
    budget: budgetInfo
  };
}

function claimSummary(claim, supporting, reconciliation) {
  const budget = getApBudget(apCodeOf(claim));
  return {
    id: claim.id,
    fileName: claim.fileName,
    claimNumber: fieldValue(claim, ['claimNumber']) ?? null,
    distributor: fieldValue(claim, ['distributorName']) ?? null,
    apCode: apCodeOf(claim) || null,
    apCodeName: budget?.name ?? null,
    campaign: fieldValue(claim, ['campaignName']) ?? null,
    claimDate: fieldValue(claim, ['claimDate']) ?? null,
    currency: reconciliation.currency,
    claimAmount: reconciliation.claimAmount,
    supportTotal: reconciliation.supportTotal,
    amountVariance: reconciliation.amountVariance,
    supportingCount: supporting.length,
    reconciliationStatus: reconciliation.status,
    errorCount: reconciliation.errorCount,
    warningCount: reconciliation.warningCount,
    exceptionCount: reconciliation.exceptions.length
  };
}

function buildClaim(claim, allDocuments) {
  const supporting = findSupportingDocuments(claim, allDocuments);
  const reconciliation = reconcile(claim, supporting);
  return { claim, supporting, reconciliation };
}

/** @returns {Array} claim summaries with reconciliation status. */
export function listClaims() {
  const allDocuments = listAllDocuments();
  const claims = allDocuments.filter((record) => record.classification?.typeId === 'marketing_claim');
  return claims
    .map((claim) => {
      const { supporting, reconciliation } = buildClaim(claim, allDocuments);
      return claimSummary(claim, supporting, reconciliation);
    })
    .sort((left, right) => {
      if (left.reconciliationStatus !== right.reconciliationStatus) {
        return left.reconciliationStatus === 'review' ? -1 : 1;
      }
      return String(right.claimDate).localeCompare(String(left.claimDate));
    });
}

/**
 * @param {string} claimId Primary marketing_claim document id.
 * @returns {object|null} Full validation detail or null when not found.
 */
export function getClaim(claimId) {
  const claim = tryGetDocument(claimId);
  if (!claim || claim.classification?.typeId !== 'marketing_claim') return null;
  const allDocuments = listAllDocuments();
  const { supporting, reconciliation } = buildClaim(claim, allDocuments);

  return {
    summary: claimSummary(claim, supporting, reconciliation),
    claim: {
      id: claim.id,
      fileName: claim.fileName,
      typeName: claim.classification?.typeName ?? null,
      fields: claim.fields.map((field) => ({
        key: field.key,
        label: field.label,
        value: field.value,
        rawValue: field.rawValue,
        type: field.type,
        confidence: field.confidence
      }))
    },
    supportingDocuments: supporting.map((support) => ({
      id: support.id,
      fileName: support.fileName,
      typeName: support.typeName,
      documentKind: support.documentKind,
      vendor: support.vendor,
      reference: support.reference,
      productType: support.productType,
      documentDate: support.documentDate,
      amount: support.amount,
      apCode: support.apCode,
      apCodeMatches: support.apCodeMatches,
      lines: support.lines
    })),
    reconciliation: {
      status: reconciliation.status,
      errorCount: reconciliation.errorCount,
      warningCount: reconciliation.warningCount,
      currency: reconciliation.currency,
      claimAmount: reconciliation.claimAmount,
      supportTotal: reconciliation.supportTotal,
      amountVariance: reconciliation.amountVariance,
      productSummation: reconciliation.productSummation,
      lineComparison: reconciliation.lineComparison,
      budget: reconciliation.budget,
      checks: reconciliation.checks,
      exceptions: reconciliation.exceptions
    }
  };
}

/** Aggregate metrics for the claims dashboard header. */
export function claimsOverview() {
  const claims = listClaims();
  const review = claims.filter((claim) => claim.reconciliationStatus === 'review');
  return {
    totalClaims: claims.length,
    clearClaims: claims.length - review.length,
    reviewClaims: review.length,
    totalExceptions: claims.reduce((sum, claim) => sum + claim.exceptionCount, 0),
    totalClaimValue: Number(claims.reduce((sum, claim) => sum + (claim.claimAmount ?? 0), 0).toFixed(2))
  };
}
