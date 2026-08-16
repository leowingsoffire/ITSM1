/**
 * Advertising & Promotion (A&P) budget reference data.
 *
 * Haw Par allocates a fixed annual A&P budget across nine spend categories,
 * A1–A9. Distributors charge their marketing claims against one of these codes,
 * so validating a claim means (a) confirming the code is consistent across every
 * document and (b) checking the claimed amount against the remaining budget for
 * that code. `spentToDate` is the amount already consumed this financial year
 * before the current claim.
 *
 * Amounts are expressed in SGD, the group reporting currency. Where a claim is
 * denominated in another currency (e.g. a US distributor billing in USD) the
 * reconciliation engine flags that an FX conversion is required rather than
 * silently comparing across currencies.
 */
export const AP_BUDGET_CURRENCY = 'SGD';

export const AP_BUDGETS = Object.freeze([
  { code: 'A1', name: 'Print & Press Advertising', annualBudget: 180000, spentToDate: 96500 },
  { code: 'A2', name: 'Digital & Search (Google, Meta)', annualBudget: 420000, spentToDate: 168000 },
  { code: 'A3', name: 'Television & Radio', annualBudget: 260000, spentToDate: 142000 },
  { code: 'A4', name: 'Out-of-Home & Billboards', annualBudget: 150000, spentToDate: 61000 },
  { code: 'A5', name: 'In-Store Displays & POS', annualBudget: 240000, spentToDate: 118500 },
  { code: 'A6', name: 'Trade Promotions & Sampling', annualBudget: 200000, spentToDate: 190000 },
  { code: 'A7', name: 'Sponsorships & Events', annualBudget: 170000, spentToDate: 84000 },
  { code: 'A8', name: 'Influencer & Social Content', annualBudget: 130000, spentToDate: 47500 },
  { code: 'A9', name: 'PR & Agency Retainers', annualBudget: 110000, spentToDate: 52000 }
]);

/**
 * Tiger Balm product types used for the per-product summation checks. Claims
 * summarise spend by product type on page one; the supporting invoices carry the
 * detailed (often highlighted) lines that must sum back to those subtotals.
 */
export const PRODUCT_TYPES = Object.freeze([
  { code: 'TBO', name: 'Tiger Balm Ointment' },
  { code: 'TBMP', name: 'Tiger Balm Medicated Plaster' },
  { code: 'TBWO', name: 'Tiger Balm White Ointment' },
  { code: 'TBNS', name: 'Tiger Balm Neck & Shoulder Rub' },
  { code: 'TBMR', name: 'Tiger Balm Muscle Rub' },
  { code: 'TBPR', name: 'Tiger Balm Pain Relieving Patch' }
]);

const BUDGET_INDEX = new Map(AP_BUDGETS.map((entry) => [entry.code, entry]));
const PRODUCT_INDEX = new Map(PRODUCT_TYPES.map((entry) => [entry.code, entry]));
const PRODUCT_CODES = PRODUCT_TYPES.map((entry) => entry.code);

export function listApBudgets() {
  return AP_BUDGETS.map((entry) => ({
    ...entry,
    remaining: Number((entry.annualBudget - entry.spentToDate).toFixed(2)),
    utilisation: Number((entry.spentToDate / entry.annualBudget).toFixed(4))
  }));
}

/** @param {string} code A1–A9. @returns {object|null} */
export function getApBudget(code) {
  const entry = BUDGET_INDEX.get(String(code ?? '').trim().toUpperCase());
  if (!entry) return null;
  return {
    ...entry,
    remaining: Number((entry.annualBudget - entry.spentToDate).toFixed(2)),
    utilisation: Number((entry.spentToDate / entry.annualBudget).toFixed(4))
  };
}

export function getProductType(code) {
  return PRODUCT_INDEX.get(String(code ?? '').trim().toUpperCase()) ?? null;
}

export function listProductTypes() {
  return [...PRODUCT_TYPES];
}

/**
 * Extracts a canonical product-type code (e.g. "TBO") from a free-text cell such
 * as "TBO — Tiger Balm Ointment" or "Tiger Balm Ointment (TBO)".
 * @param {string} value
 * @returns {string|null}
 */
export function normaliseProductType(value) {
  const text = String(value ?? '').toUpperCase();
  if (!text.trim()) return null;
  // Prefer the longest matching code so TBMP is not shadowed by a TB prefix.
  const byCode = [...PRODUCT_CODES]
    .sort((a, b) => b.length - a.length)
    .find((code) => new RegExp(`\\b${code}\\b`).test(text));
  if (byCode) return byCode;
  const byName = PRODUCT_TYPES.find((entry) => text.includes(entry.name.toUpperCase()));
  return byName ? byName.code : null;
}

/** @param {string} value @returns {boolean} true for a well-formed A1–A9 code. */
export function isApCode(value) {
  return /^A[1-9]$/.test(String(value ?? '').trim().toUpperCase());
}
