/**
 * Unit tests for the distributor A&P claim validation engine.
 *
 * The engine reads documents from the store, links them by A&P code and runs
 * cross-document checks: total reconciliation, per-line amount/date matching,
 * A&P-code consistency, product-type summation and annual-budget consumption.
 * We hydrate the store with hand-built records (including the tables the
 * extraction pipeline produces) so the logic can be asserted in isolation.
 */
import assert from 'node:assert/strict';
import test, { describe, beforeEach } from 'node:test';
import './helpers/isolation.js';
import { hydrateStore, clearAll } from '../src/services/store.service.js';
import { listClaims, getClaim, claimsOverview } from '../src/services/claims.service.js';

function field(key, label, type, value, extra = {}) {
  return {
    key,
    label,
    type,
    value,
    rawValue: extra.rawValue ?? String(value ?? ''),
    currency: extra.currency,
    confidence: 0.98,
    status: 'accepted'
  };
}

function claimRecord(id, { apCode, amount, currency = 'SGD', claimDate, distributor = 'POP Marketing LLC', campaign = 'Campaign', productSummary = [], lines = [] }) {
  const fields = [
    field('claimNumber', 'Claim Number', 'string', id),
    field('distributorName', 'Distributor', 'string', distributor),
    field('claimDate', 'Claim Date', 'date', claimDate),
    field('apCode', 'A&P Code', 'string', apCode),
    field('campaignName', 'Campaign', 'string', campaign),
    field('claimAmount', 'Claim Amount', 'currency', amount, { currency })
  ];
  const tables = [];
  if (productSummary.length > 0) {
    tables.push({
      id: `${id}-ps`,
      title: 'Product Type Summary',
      fieldKey: 'productSummary',
      columns: ['Product Type', `Amount (${currency})`],
      rows: productSummary.map((entry) => [entry.productType, entry.amount])
    });
  }
  if (lines.length > 0) {
    tables.push({
      id: `${id}-li`,
      title: 'Claim Line Items',
      fieldKey: 'lineItems',
      columns: ['Line', 'Vendor', 'Invoice No', 'Invoice Date', 'A&P', 'Product', `Amount (${currency})`, 'Mark-up'],
      rows: lines.map((line, index) => [index + 1, line.vendor, line.invoiceRef, line.invoiceDate, apCode, line.productType, line.amount, line.annotation ?? ''])
    });
  }
  return {
    id,
    batchId: 'batch_test',
    fileName: `${id}.pdf`,
    status: 'completed',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    classification: { typeId: 'marketing_claim', typeName: 'Marketing Claim Summary' },
    fullText: `Marketing claim ${apCode} ${campaign}`,
    fields,
    tables,
    audit: []
  };
}

function supportRecord(id, { apCodeRef, amount, currency = 'SGD', documentDate, vendor = 'Vendor Co', reference, productType, claimApCode, claimNumber, lines = [], kind = 'Vendor Tax Invoice' }) {
  const fields = [
    field('vendorName', 'Vendor', 'string', vendor),
    field('documentReference', 'Reference', 'string', reference ?? id),
    field('documentDate', 'Document Date', 'date', documentDate),
    field('amount', 'Amount', 'currency', amount, { currency }),
    field('apCodeRef', 'A&P Code', 'string', apCodeRef),
    field('productType', 'Product Type', 'string', productType ?? ''),
    field('documentKind', 'Document Kind', 'string', kind)
  ];
  const tables = [];
  if (lines.length > 0) {
    tables.push({
      id: `${id}-li`,
      title: 'Highlighted Line Items',
      fieldKey: 'lineItems',
      columns: ['Description', 'Product', `Amount (${currency})`, 'Mark-up'],
      rows: lines.map((line) => [line.description ?? line.productType, line.productType, line.amount, line.annotation ?? ''])
    });
  }
  return {
    id,
    batchId: 'batch_test',
    fileName: `${id}.pdf`,
    status: 'completed',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    classification: { typeId: 'marketing_support', typeName: 'A&P Supporting Document' },
    fullText: `Supporting document ${claimApCode ?? apCodeRef} ${claimNumber ?? ''} ${reference ?? id} from ${vendor}`,
    fields,
    tables,
    audit: []
  };
}

describe('distributor A&P claim validation', () => {
  beforeEach(async () => {
    await clearAll();
  });

  test('should_reconcile_a_matching_claim_as_clear', () => {
    hydrateStore({
      documents: [
        claimRecord('CLM-CLEAR', {
          apCode: 'A2',
          amount: 9600,
          claimDate: '2026-05-20',
          productSummary: [{ productType: 'TBO', amount: 6600 }, { productType: 'TBMP', amount: 3000 }],
          lines: [
            { vendor: 'Google', invoiceRef: 'INV-GOOG-77120', invoiceDate: '2026-05-18', productType: 'TBO', amount: 6600 },
            { vendor: 'Meta', invoiceRef: 'INV-META-4408', invoiceDate: '2026-05-19', productType: 'TBMP', amount: 3000 }
          ]
        }),
        supportRecord('SUP-GOOG', {
          apCodeRef: 'A2',
          amount: 6600,
          documentDate: '2026-05-18',
          vendor: 'Google Ireland',
          reference: 'INV-GOOG-77120',
          productType: 'TBO',
          lines: [{ productType: 'TBO', amount: 3600 }, { productType: 'TBO', amount: 3000 }]
        }),
        supportRecord('SUP-META', {
          apCodeRef: 'A2',
          amount: 3000,
          documentDate: '2026-05-19',
          vendor: 'Meta Platforms',
          reference: 'INV-META-4408',
          productType: 'TBMP',
          lines: [{ productType: 'TBMP', amount: 3000 }]
        })
      ]
    });

    const claims = listClaims();
    assert.equal(claims.length, 1);
    assert.equal(claims[0].reconciliationStatus, 'clear');
    assert.equal(claims[0].supportTotal, 9600);
    assert.equal(claims[0].amountVariance, 0);
    assert.equal(claims[0].exceptionCount, 0);
    assert.equal(claims[0].currency, 'SGD');
  });

  test('should_flag_the_four_discrepancy_classes_in_one_claim', () => {
    hydrateStore({
      documents: [
        claimRecord('CLM-US', {
          apCode: 'A2',
          amount: 13349,
          currency: 'USD',
          claimDate: '2026-06-10',
          productSummary: [{ productType: 'TBO', amount: 8000 }, { productType: 'TBMP', amount: 5349 }],
          lines: [{ vendor: 'Google', invoiceRef: 'INV-GOOG-88213', invoiceDate: '2026-06-12', productType: 'TBO', amount: 13349 }]
        }),
        supportRecord('SUP-USG', {
          apCodeRef: 'A2',
          amount: 13348,
          currency: 'USD',
          documentDate: '2026-06-05',
          vendor: 'Google LLC',
          reference: 'INV-GOOG-88213',
          lines: [
            { productType: 'TBO', amount: 4000 },
            { productType: 'TBO', amount: 3500 },
            { productType: 'TBMP', amount: 5848 }
          ]
        })
      ]
    });

    const detail = getClaim('CLM-US');
    const byRule = (rule) => detail.reconciliation.checks.find((c) => c.rule === rule);

    // (b) total to the dollar
    assert.equal(detail.reconciliation.amountVariance, 1);
    assert.equal(byRule('claim_amount_matches_support').status, 'fail');
    // (b) per-line amount
    assert.equal(byRule('line_invoice_amounts_match').status, 'fail');
    // (a) per-line date
    assert.equal(byRule('line_invoice_dates_match').status, 'fail');
    assert.equal(byRule('line_invoice_dates_match').severity, 'warning');
    // (d) product-type summation (TBO 8000 vs 7500)
    const summation = byRule('product_type_summation');
    assert.equal(summation.status, 'fail');
    const tbo = summation.rows.find((r) => r.productType === 'TBO');
    assert.equal(tbo.stated, 8000);
    assert.equal(tbo.actual, 7500);
    // budget check is FX-flagged for a USD claim against an SGD budget
    assert.equal(byRule('ap_code_within_budget').status, 'info');
    assert.equal(detail.summary.currency, 'USD');
    assert.equal(detail.reconciliation.status, 'review');
  });

  test('should_error_when_a_linked_support_carries_a_different_ap_code', () => {
    hydrateStore({
      documents: [
        claimRecord('CLM-AP', { apCode: 'A6', amount: 8000, claimDate: '2026-03-10' }),
        supportRecord('SUP-A7', { apCodeRef: 'A7', claimApCode: 'A6', amount: 8000, documentDate: '2026-03-08', reference: 'LT-AGO-2231', kind: 'Agency Cover Letter' })
      ]
    });

    const detail = getClaim('CLM-AP');
    const apCheck = detail.reconciliation.checks.find((c) => c.rule === 'support_ap_code_matches');
    assert.equal(apCheck.status, 'fail');
    assert.equal(apCheck.severity, 'error');
    assert.equal(detail.supportingDocuments[0].apCodeMatches, false);
  });

  test('should_warn_when_a_claim_exceeds_the_remaining_annual_budget', () => {
    hydrateStore({
      documents: [
        // A6 has only 10,000 remaining (200,000 annual - 190,000 spent).
        claimRecord('CLM-BUDGET', { apCode: 'A6', amount: 15000, claimDate: '2026-03-10' }),
        supportRecord('SUP-BUD', { apCodeRef: 'A6', amount: 15000, documentDate: '2026-03-08' })
      ]
    });

    const detail = getClaim('CLM-BUDGET');
    const budgetCheck = detail.reconciliation.checks.find((c) => c.rule === 'ap_code_within_budget');
    assert.equal(budgetCheck.status, 'fail');
    assert.equal(budgetCheck.severity, 'warning');
    assert.equal(detail.reconciliation.budget.remaining, 10000);
    assert.equal(detail.reconciliation.status, 'review');
  });

  test('should_warn_when_a_supporting_date_falls_after_the_claim_date', () => {
    hydrateStore({
      documents: [
        claimRecord('CLM-DATE', { apCode: 'A2', amount: 1000, claimDate: '2026-03-10' }),
        supportRecord('SUP-LATE', { apCodeRef: 'A2', amount: 1000, documentDate: '2026-03-15' })
      ]
    });

    const detail = getClaim('CLM-DATE');
    const dateCheck = detail.reconciliation.checks.find((c) => c.rule === 'support_dates_align');
    assert.equal(dateCheck.status, 'fail');
    assert.equal(dateCheck.severity, 'warning');
    assert.equal(detail.reconciliation.status, 'review');
  });

  test('should_summarise_the_corpus_overview', () => {
    hydrateStore({
      documents: [
        claimRecord('CLM-1', { apCode: 'A2', amount: 1000, claimDate: '2026-03-10' }),
        supportRecord('SUP-1', { apCodeRef: 'A2', amount: 1000, documentDate: '2026-03-08' }),
        claimRecord('CLM-2', { apCode: 'A5', amount: 2000, claimDate: '2026-03-10' }),
        supportRecord('SUP-2', { apCodeRef: 'A5', amount: 1500, documentDate: '2026-03-08' })
      ]
    });

    const overview = claimsOverview();
    assert.equal(overview.totalClaims, 2);
    assert.equal(overview.clearClaims, 1);
    assert.equal(overview.reviewClaims, 1);
    assert.equal(overview.totalClaimValue, 3000);
  });

  test('should_return_null_for_a_non_claim_document', () => {
    hydrateStore({
      documents: [supportRecord('SUP-ONLY', { apCodeRef: 'A9', amount: 100, documentDate: '2026-03-01' })]
    });
    assert.equal(getClaim('SUP-ONLY'), null);
  });
});
