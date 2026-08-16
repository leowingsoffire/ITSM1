/**
 * Unit tests for classification, extraction, validation and cost modelling.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { classifyDocument } from '../src/services/classification.service.js';
import {
  MONTHLY_BUDGET_SGD,
  REFERENCE_PROFILE,
  estimateDocumentCost,
  projectMonthlyCost,
  selectModelForType
} from '../src/services/cost.service.js';
import { extractFields } from '../src/services/extraction.service.js';
import { validateDocument } from '../src/services/validation.service.js';
import { analyzeWithDemoEngine } from '../src/services/analyzers/demoAnalyzer.js';

const REVIEW_THRESHOLD = 0.8;

function analyse(typeId, fileName) {
  return analyzeWithDemoEngine({ fileName, typeHint: typeId });
}

describe('classification service', () => {
  test('should_classify_a_generated_supplier_invoice_as_a_supplier_invoice', () => {
    const result = classifyDocument(analyse('supplier_invoice', 'invoice-a.pdf'));
    assert.equal(result.typeId, 'supplier_invoice');
    assert.ok(result.confidence > 0.5);
  });

  test('should_classify_a_generated_certificate_of_analysis_correctly', () => {
    const result = classifyDocument(analyse('certificate_of_analysis', 'coa-a.pdf'));
    assert.equal(result.typeId, 'certificate_of_analysis');
  });

  test('should_classify_a_document_exceeding_one_hundred_pages_as_an_annual_report', () => {
    const analysis = analyse('annual_report', 'annual-report.pdf');
    assert.ok(analysis.pageCount > 100, `expected more than 100 pages, got ${analysis.pageCount}`);
    assert.equal(classifyDocument(analysis).typeId, 'annual_report');
  });

  test('should_expose_human_readable_evidence_for_every_decision', () => {
    const result = classifyDocument(analyse('bill_of_lading', 'bl-a.pdf'));
    assert.ok(Array.isArray(result.evidence));
    assert.ok(result.evidence.length > 0);
    assert.ok(Array.isArray(result.alternatives));
  });

  test('should_fall_back_to_unclassified_when_there_is_no_recognisable_content', () => {
    const result = classifyDocument({ pages: [], paragraphs: [], keyValuePairs: [], tables: [], fullText: 'zzz', pageCount: 1 });
    assert.equal(result.typeId, 'unclassified');
  });
});

describe('extraction service', () => {
  test('should_extract_the_critical_invoice_fields_from_key_value_pairs', () => {
    const analysis = analyse('supplier_invoice', 'invoice-b.pdf');
    const fields = extractFields(analysis, 'supplier_invoice', REVIEW_THRESHOLD);
    const byKey = new Map(fields.map((field) => [field.key, field]));

    assert.ok(byKey.get('invoiceNumber').rawValue);
    assert.equal(typeof byKey.get('totalAmount').value, 'number');
    assert.match(byKey.get('invoiceDate').value, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('should_assign_a_status_to_every_field', () => {
    const analysis = analyse('purchase_order', 'po-b.pdf');
    const fields = extractFields(analysis, 'purchase_order', REVIEW_THRESHOLD);
    assert.ok(fields.length > 0);
    for (const field of fields) {
      assert.ok(['accepted', 'needs-review', 'missing'].includes(field.status), field.status);
    }
  });

  test('should_flag_fields_below_the_review_threshold_for_verification', () => {
    const analysis = analyse('bank_statement', 'bank-b.pdf');
    const fields = extractFields(analysis, 'bank_statement', 0.999);
    assert.ok(fields.every((field) => field.status !== 'accepted'));
  });

  test('should_bind_table_fields_to_the_detected_table', () => {
    const analysis = analyse('supplier_invoice', 'invoice-c.pdf');
    const fields = extractFields(analysis, 'supplier_invoice', REVIEW_THRESHOLD);
    const lineItems = fields.find((field) => field.key === 'lineItems');
    assert.ok(lineItems);
    assert.equal(lineItems.source, 'table');
  });
});

describe('validation service', () => {
  test('should_evaluate_every_rule_configured_for_the_document_type', () => {
    const analysis = analyse('supplier_invoice', 'invoice-d.pdf');
    const fields = extractFields(analysis, 'supplier_invoice', REVIEW_THRESHOLD);
    const result = validateDocument({ typeId: 'supplier_invoice', fields, analysis });
    assert.ok(result.rulesEvaluated > 0);
    assert.equal(result.errorCount + result.warningCount, result.issues.length);
  });

  test('should_raise_an_error_when_the_stated_total_does_not_reconcile', () => {
    const analysis = analyse('supplier_invoice', 'invoice-e.pdf');
    const fields = extractFields(analysis, 'supplier_invoice', REVIEW_THRESHOLD)
      .map((field) => (field.key === 'totalAmount' ? { ...field, value: 999999.99, rawValue: '999999.99' } : field));

    const result = validateDocument({ typeId: 'supplier_invoice', fields, analysis });
    assert.equal(result.passed, false);
    assert.ok(result.issues.some((issue) => issue.rule === 'totals_reconcile'));
  });

  test('should_raise_an_error_when_a_purchase_order_delivery_date_precedes_the_order_date', () => {
    const analysis = analyse('purchase_order', 'po-e.pdf');
    const fields = extractFields(analysis, 'purchase_order', REVIEW_THRESHOLD).map((field) => {
      if (field.key === 'orderDate') return { ...field, value: '2026-06-01' };
      if (field.key === 'deliveryDate') return { ...field, value: '2026-01-01' };
      return field;
    });

    const result = validateDocument({ typeId: 'purchase_order', fields, analysis });
    assert.ok(result.issues.some((issue) => issue.rule === 'delivery_after_order_date'));
  });

  test('should_never_throw_when_a_rule_encounters_unexpected_data', () => {
    const result = validateDocument({ typeId: 'supplier_invoice', fields: [], analysis: { tables: [], pages: [], fullText: '' } });
    assert.ok(result.rulesEvaluated > 0);
  });
});

describe('cost service', () => {
  test('should_route_table_critical_types_to_layout_and_everything_else_to_read', () => {
    assert.equal(selectModelForType('supplier_invoice'), 'prebuilt-layout');
    assert.equal(selectModelForType('annual_report'), 'prebuilt-read');
    assert.equal(selectModelForType('trademark_certificate'), 'prebuilt-read');
  });

  test('should_charge_nothing_when_the_offline_demo_engine_produced_the_result', () => {
    const cost = estimateDocumentCost({ pageCount: 120, typeId: 'annual_report', engine: 'demo' });
    assert.equal(cost.estimatedUsd, 0);
    assert.ok(cost.manualCostSgd > 0);
  });

  test('should_still_model_the_azure_price_when_running_on_the_demo_engine', () => {
    const demo = estimateDocumentCost({ pageCount: 120, typeId: 'annual_report', engine: 'demo' });
    const live = estimateDocumentCost({ pageCount: 120, typeId: 'annual_report', engine: 'azure' });
    assert.ok(demo.modelledUsd > 0, 'demo runs must still report what Azure would have charged');
    assert.equal(demo.modelledUsd, live.modelledUsd);
    assert.equal(live.modelledUsd, live.estimatedUsd);
  });

  test('should_price_a_read_routed_document_far_below_the_prebuilt_baseline', () => {
    const cost = estimateDocumentCost({ pageCount: 150, typeId: 'annual_report', engine: 'azure' });
    assert.ok(cost.estimatedUsd > 0);
    assert.ok(cost.estimatedUsd < cost.baselineUsd / 5);
    assert.ok(cost.savingVsPrebuiltUsd > 0);
  });

  test('should_project_a_lower_monthly_bill_with_adaptive_routing_enabled', () => {
    const adaptive = projectMonthlyCost({ documentsPerMonth: 5000, averagePages: 14, adaptiveRouting: true });
    const naive = projectMonthlyCost({ documentsPerMonth: 5000, averagePages: 14, adaptiveRouting: false });
    assert.ok(adaptive.totalMonthlyUsd < naive.totalMonthlyUsd);
    assert.ok(adaptive.routingSavingPercent > 0);
    assert.equal(adaptive.lineItems.length, 7);
  });

  test('should_land_the_reference_profile_on_the_agreed_monthly_budget', () => {
    const projection = projectMonthlyCost();
    assert.equal(projection.budgetSgd, MONTHLY_BUDGET_SGD);
    assert.equal(Math.round(projection.totalMonthlySgd), 1690);
    assert.equal(projection.withinBudget, true);
    assert.ok(Math.abs(projection.budgetVarianceSgd) < 1, 'variance should be under one dollar');
  });

  test('should_default_every_assumption_to_the_signed_off_reference_profile', () => {
    const projection = projectMonthlyCost();
    for (const [key, expected] of Object.entries(REFERENCE_PROFILE)) {
      assert.equal(projection.assumptions[key], expected, `assumption ${key} should match the reference profile`);
    }
  });

  test('should_report_a_positive_return_against_the_manual_baseline', () => {
    const projection = projectMonthlyCost();
    assert.ok(projection.manualBaselineSgd > projection.totalMonthlySgd);
    assert.ok(projection.netMonthlyBenefitSgd > 0);
    assert.ok(projection.roiMultiple > 1);
    // annualSgd is derived from the unrounded monthly figure, so allow for the
    // cent-level difference against the rounded monthly value.
    assert.ok(Math.abs(projection.annualSgd - projection.totalMonthlySgd * 12) < 1);
  });

  test('should_scale_the_app_service_line_item_with_instance_count', () => {
    const single = projectMonthlyCost({ appServiceInstances: 1 });
    const paired = projectMonthlyCost({ appServiceInstances: 2 });
    const lineOf = (projection) => projection.lineItems.find((item) => item.service === 'Azure App Service (Linux)');
    assert.equal(round2(lineOf(paired).monthlyUsd), round2(lineOf(single).monthlyUsd * 2));
    assert.match(lineOf(paired).detail, /zone redundant/);
  });
});

function round2(value) {
  return Number(Number(value).toFixed(2));
}
