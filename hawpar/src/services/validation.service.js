/**
 * Business rule validation.
 *
 * Runs after extraction and produces reviewer-friendly issues. Each rule is a
 * pure function of the extracted fields plus the raw analysis, so rules are
 * individually unit-testable and can be enabled per document type.
 */
import { RULE_CATALOGUE, getDocumentType } from '../domain/documentTypes.js';
import { GROUP_ENTITIES, MARKETS, SINGAPORE_GST_RATE } from '../domain/referenceData.js';

export const Severity = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning'
});

const MONEY_TOLERANCE = 0.02;
const GST_TOLERANCE = 0.005;
const EXPENSE_POLICY_CAP_SGD = 5000;
const MIN_DEPOSIT_MONTHS = 1;
const MAX_DEPOSIT_MONTHS = 6;
const MAX_REPORT_AGE_YEARS = 20;

const byKey = (fields) => new Map(fields.map((field) => [field.key, field]));

const numberOf = (map, key) => {
  const value = map.get(key)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const stringOf = (map, key) => {
  const value = map.get(key)?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const dateOf = (map, key) => {
  const value = map.get(key)?.value;
  if (typeof value !== 'string') return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const issue = (rule, severity, message, fieldKeys = []) => ({
  rule,
  severity,
  message,
  description: RULE_CATALOGUE[rule] ?? '',
  fieldKeys
});

const RULES = Object.freeze({
  totals_reconcile(map) {
    const subtotal = numberOf(map, 'subtotal');
    const tax = numberOf(map, 'taxAmount') ?? 0;
    const total = numberOf(map, 'totalAmount');
    if (subtotal === null || total === null) return null;
    const difference = Math.abs(subtotal + tax - total);
    if (difference <= MONEY_TOLERANCE) return null;
    return issue(
      'totals_reconcile',
      Severity.ERROR,
      `Subtotal (${subtotal.toFixed(2)}) + tax (${tax.toFixed(2)}) = ${(subtotal + tax).toFixed(2)}, which differs from the stated total (${total.toFixed(2)}) by ${difference.toFixed(2)}.`,
      ['subtotal', 'taxAmount', 'totalAmount']
    );
  },

  gst_rate_singapore(map) {
    const currency = stringOf(map, 'currency');
    const subtotal = numberOf(map, 'subtotal');
    const tax = numberOf(map, 'taxAmount');
    if (currency !== 'SGD' || subtotal === null || tax === null || subtotal === 0) return null;
    const rate = tax / subtotal;
    if (Math.abs(rate - SINGAPORE_GST_RATE) <= GST_TOLERANCE || tax === 0) return null;
    return issue(
      'gst_rate_singapore',
      Severity.WARNING,
      `Effective GST rate is ${(rate * 100).toFixed(2)}% — expected ${(SINGAPORE_GST_RATE * 100).toFixed(0)}% for a Singapore-taxable supply.`,
      ['taxAmount']
    );
  },

  due_after_invoice_date(map) {
    const invoiceDate = dateOf(map, 'invoiceDate');
    const dueDate = dateOf(map, 'dueDate');
    if (!invoiceDate || !dueDate || dueDate >= invoiceDate) return null;
    return issue('due_after_invoice_date', Severity.ERROR, 'Payment due date precedes the invoice date.', [
      'invoiceDate',
      'dueDate'
    ]);
  },

  currency_present(map) {
    if (stringOf(map, 'currency')) return null;
    return issue('currency_present', Severity.WARNING, 'No ISO-4217 currency code was detected.', ['currency']);
  },

  delivery_after_order_date(map) {
    const orderDate = dateOf(map, 'poDate');
    const deliveryDate = dateOf(map, 'deliveryDate');
    if (!orderDate || !deliveryDate || deliveryDate >= orderDate) return null;
    return issue('delivery_after_order_date', Severity.ERROR, 'Required delivery date precedes the order date.', [
      'poDate',
      'deliveryDate'
    ]);
  },

  approval_present(map) {
    if (stringOf(map, 'approver')) return null;
    return issue('approval_present', Severity.ERROR, 'No approver was captured — segregation of duties cannot be evidenced.', [
      'approver'
    ]);
  },

  quantities_positive(map, analysis) {
    const table = (analysis.tables ?? []).find((entry) => entry.fieldKey === 'lineItems');
    if (!table) return null;
    const quantityIndex = table.columns.findIndex((column) => /qty|quantity/i.test(column));
    if (quantityIndex < 0) return null;
    const offending = table.rows.filter((row) => Number(String(row[quantityIndex]).replace(/,/g, '')) <= 0);
    if (offending.length === 0) return null;
    return issue('quantities_positive', Severity.ERROR, `${offending.length} line(s) have a non-positive quantity.`, [
      'lineItems'
    ]);
  },

  po_reference_present(map) {
    if (stringOf(map, 'purchaseOrderRef')) return null;
    return issue('po_reference_present', Severity.ERROR, 'No purchase order reference — three-way matching is not possible.', [
      'purchaseOrderRef'
    ]);
  },

  expiry_after_manufacture(map) {
    const manufacture = dateOf(map, 'manufactureDate');
    const expiry = dateOf(map, 'expiryDate');
    if (!manufacture || !expiry || expiry > manufacture) return null;
    return issue('expiry_after_manufacture', Severity.ERROR, 'Expiry date is not after the manufacture date.', [
      'manufactureDate',
      'expiryDate'
    ]);
  },

  qa_disposition_valid(map) {
    const result = stringOf(map, 'overallResult');
    if (!result) return null;
    if (/(pass|complies|conform|approved|released)/i.test(result)) return null;
    return issue('qa_disposition_valid', Severity.ERROR, `QA disposition "${result}" blocks batch release.`, [
      'overallResult'
    ]);
  },

  all_tests_within_spec(map, analysis) {
    const table = (analysis.tables ?? []).find((entry) => entry.fieldKey === 'testResults');
    if (!table) return null;
    const statusIndex = table.columns.findIndex((column) => /status|result/i.test(column));
    if (statusIndex < 0) return null;
    const failures = table.rows.filter((row) => /fail|out of spec|oos|reject/i.test(String(row[statusIndex])));
    if (failures.length === 0) return null;
    return issue(
      'all_tests_within_spec',
      Severity.ERROR,
      `${failures.length} QC test(s) are out of specification: ${failures.map((row) => row[0]).join(', ')}.`,
      ['testResults']
    );
  },

  container_format_valid(map) {
    const container = stringOf(map, 'containerNumber');
    if (!container) return null;
    if (/^[A-Z]{4}\s?\d{7}$/.test(container.toUpperCase())) return null;
    return issue('container_format_valid', Severity.WARNING, `Container number "${container}" is not ISO 6346 compliant.`, [
      'containerNumber'
    ]);
  },

  ports_present(map) {
    const missing = ['portOfLoading', 'portOfDischarge'].filter((key) => !stringOf(map, key));
    if (missing.length === 0) return null;
    return issue('ports_present', Severity.ERROR, 'Port of loading and/or discharge is missing.', missing);
  },

  expiry_in_future(map) {
    const expiry = dateOf(map, 'expiryDate');
    if (!expiry) return null;
    if (expiry.getTime() > Date.now()) return null;
    return issue('expiry_in_future', Severity.ERROR, `Registration expired on ${expiry.toISOString().slice(0, 10)}.`, [
      'expiryDate'
    ]);
  },

  jurisdiction_known(map) {
    const country = stringOf(map, 'country');
    if (!country || MARKETS.some((market) => market.toLowerCase() === country.toLowerCase())) return null;
    return issue('jurisdiction_known', Severity.WARNING, `"${country}" is not a registered VGC market.`, ['country']);
  },

  renewal_in_future(map) {
    const renewal = dateOf(map, 'renewalDueDate');
    if (!renewal) return null;
    if (renewal.getTime() > Date.now()) return null;
    return issue('renewal_in_future', Severity.ERROR, `Trademark renewal was due on ${renewal.toISOString().slice(0, 10)}.`, [
      'renewalDueDate'
    ]);
  },

  proprietor_is_group_entity(map) {
    const proprietor = stringOf(map, 'proprietor');
    if (!proprietor) return null;
    const isGroup = GROUP_ENTITIES.some((entity) =>
      proprietor.toLowerCase().includes(entity.toLowerCase().split(' ').slice(0, 2).join(' '))
    );
    if (isGroup) return null;
    return issue('proprietor_is_group_entity', Severity.WARNING, `Proprietor "${proprietor}" is not a recognised group entity.`, [
      'proprietor'
    ]);
  },

  lease_end_after_start(map) {
    const start = dateOf(map, 'leaseStartDate');
    const end = dateOf(map, 'leaseEndDate');
    if (!start || !end || end > start) return null;
    return issue('lease_end_after_start', Severity.ERROR, 'Lease expiry is not after the commencement date.', [
      'leaseStartDate',
      'leaseEndDate'
    ]);
  },

  deposit_vs_rent_ratio(map) {
    const rent = numberOf(map, 'monthlyRent');
    const deposit = numberOf(map, 'securityDeposit');
    if (rent === null || deposit === null || rent === 0) return null;
    const months = deposit / rent;
    if (months >= MIN_DEPOSIT_MONTHS && months <= MAX_DEPOSIT_MONTHS) return null;
    return issue(
      'deposit_vs_rent_ratio',
      Severity.WARNING,
      `Security deposit equals ${months.toFixed(1)} months of rent (policy range ${MIN_DEPOSIT_MONTHS}-${MAX_DEPOSIT_MONTHS}).`,
      ['securityDeposit', 'monthlyRent']
    );
  },

  rent_positive(map) {
    const rent = numberOf(map, 'monthlyRent');
    if (rent === null || rent > 0) return null;
    return issue('rent_positive', Severity.ERROR, 'Monthly rent must be greater than zero.', ['monthlyRent']);
  },

  assets_equal_liabilities_plus_equity(map) {
    const assets = numberOf(map, 'totalAssets');
    const equity = numberOf(map, 'totalEquity');
    if (assets === null || equity === null || assets >= equity) return null;
    return issue(
      'assets_equal_liabilities_plus_equity',
      Severity.ERROR,
      `Total assets (${assets}) are lower than total equity (${equity}) — the balance sheet does not tie.`,
      ['totalAssets', 'totalEquity']
    );
  },

  audit_opinion_clean(map) {
    const opinion = stringOf(map, 'auditOpinion');
    if (!opinion) return null;
    if (/unqualified|unmodified/i.test(opinion)) return null;
    return issue('audit_opinion_clean', Severity.WARNING, `Audit opinion is "${opinion}" — escalate to the Audit Committee.`, [
      'auditOpinion'
    ]);
  },

  financial_year_plausible(map) {
    const year = Number(stringOf(map, 'financialYear'));
    if (!Number.isFinite(year)) return null;
    const currentYear = new Date().getUTCFullYear();
    if (year <= currentYear && year >= currentYear - MAX_REPORT_AGE_YEARS) return null;
    return issue('financial_year_plausible', Severity.WARNING, `Financial year ${year} is outside the expected range.`, [
      'financialYear'
    ]);
  },

  bank_balance_reconciles(map) {
    const opening = numberOf(map, 'openingBalance');
    const credits = numberOf(map, 'totalCredits');
    const debits = numberOf(map, 'totalDebits');
    const closing = numberOf(map, 'closingBalance');
    if ([opening, credits, debits, closing].some((value) => value === null)) return null;
    const expected = opening + credits - debits;
    const difference = Math.abs(expected - closing);
    if (difference <= MONEY_TOLERANCE) return null;
    return issue(
      'bank_balance_reconciles',
      Severity.ERROR,
      `Opening + credits − debits = ${expected.toFixed(2)}, which differs from the closing balance (${closing.toFixed(2)}) by ${difference.toFixed(2)}.`,
      ['openingBalance', 'totalCredits', 'totalDebits', 'closingBalance']
    );
  },

  account_number_masked(map) {
    const account = stringOf(map, 'accountNumber');
    if (!account || account.includes('*')) return null;
    return issue(
      'account_number_masked',
      Severity.WARNING,
      'Bank account number is stored unmasked — PDPA requires masking at rest.',
      ['accountNumber']
    );
  },

  claim_within_policy_cap(map) {
    const total = numberOf(map, 'totalAmount');
    if (total === null || total <= EXPENSE_POLICY_CAP_SGD) return null;
    return issue(
      'claim_within_policy_cap',
      Severity.WARNING,
      `Claim of ${total.toFixed(2)} exceeds the S$${EXPENSE_POLICY_CAP_SGD} policy cap and requires CFO approval.`,
      ['totalAmount']
    );
  },

  claim_has_ap_code(map) {
    const apCode = stringOf(map, 'apCode');
    if (apCode) return null;
    return issue(
      'claim_has_ap_code',
      Severity.ERROR,
      'No Advertising & Promotion (A&P) code was captured — the claim cannot be traced to an approved campaign budget.',
      ['apCode']
    );
  },

  claim_amount_positive(map) {
    const amount = numberOf(map, 'claimAmount');
    if (amount === null) return null;
    if (amount > 0) return null;
    return issue(
      'claim_amount_positive',
      Severity.ERROR,
      `Claimed amount (${amount.toFixed(2)}) must be greater than zero.`,
      ['claimAmount']
    );
  },

  claim_products_present(map) {
    const products = stringOf(map, 'productCodes');
    if (products) return null;
    return issue(
      'claim_products_present',
      Severity.WARNING,
      'No product type codes were named on the claim, so eligible-product validation cannot be performed.',
      ['productCodes']
    );
  },

  support_has_ap_code(map) {
    const apCode = stringOf(map, 'apCodeRef');
    if (apCode) return null;
    return issue(
      'support_has_ap_code',
      Severity.WARNING,
      'This supporting document does not quote an A&P code, so it must be matched to a claim manually.',
      ['apCodeRef']
    );
  }
});

/**
 * @param {object} input
 * @param {string} input.typeId
 * @param {Array}  input.fields
 * @param {object} input.analysis
 */
export function validateDocument({ typeId, fields, analysis }) {
  const type = getDocumentType(typeId);
  const map = byKey(fields);
  const issues = [];

  for (const ruleId of type.rules) {
    const rule = RULES[ruleId];
    if (!rule) continue;
    try {
      const result = rule(map, analysis);
      if (result) issues.push(result);
    } catch (error) {
      issues.push(
        issue(ruleId, Severity.WARNING, `Rule "${ruleId}" could not be evaluated: ${error.message}.`, [])
      );
    }
  }

  const errorCount = issues.filter((entry) => entry.severity === Severity.ERROR).length;
  const warningCount = issues.length - errorCount;

  return {
    issues,
    errorCount,
    warningCount,
    passed: errorCount === 0,
    rulesEvaluated: type.rules.length
  };
}
