/**
 * Unit tests for the intelligence subsystems: the agent mesh topology, the
 * Azure Document Intelligence model catalogue, the workflow engine and the
 * accuracy assurance engine.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { AGENTS, AgentRole, agentTopology, executionWaves, getAgent } from '../src/domain/agents.js';
import {
  AZURE_ADD_ONS,
  AZURE_MODELS,
  addOnsForType,
  candidateModelsForType,
  getAddOn,
  getAzureModel,
  isKnownAzureModel
} from '../src/domain/azureModels.js';
import {
  Priority,
  StepStatus,
  StepType,
  WORKFLOW_DEFINITIONS,
  WorkflowStatus,
  definitionForProcess,
  getWorkflowDefinition
} from '../src/domain/workflows.js';
import {
  Attribution,
  CheckStatus,
  Integrity,
  Verdict,
  autoRepairFields,
  buildCalibration,
  evaluateAccuracy,
  footTable
} from '../src/services/accuracy.service.js';
import { SUPPLIERS, resolveRegistrationNumber } from '../src/domain/referenceData.js';
import { instantiateWorkflow, scorePriority, slaState, workflowSummary } from '../src/services/workflow.service.js';
import { authenticationMode, integrationProfile, modelCatalogue, probeService } from '../src/services/azure.service.js';
import { analyzeWithDemoEngine } from '../src/services/analyzers/demoAnalyzer.js';
import { classifyDocument } from '../src/services/classification.service.js';
import { extractFields } from '../src/services/extraction.service.js';
import { validateDocument } from '../src/services/validation.service.js';

const HOUR_MS = 3600000;

function analysePipeline(typeId, fileName) {
  const analysis = analyzeWithDemoEngine({ fileName, typeHint: typeId });
  const classification = classifyDocument(analysis);
  const fields = extractFields(analysis, classification.typeId, 0.8);
  const validation = validateDocument({ typeId: classification.typeId, fields, analysis });
  return { analysis, classification, fields, validation };
}

/* ── Agent mesh ──────────────────────────────────────────────────────────── */

describe('agent mesh topology', () => {
  test('should_expose_a_uniquely_identified_agent_for_every_role_in_the_mesh', () => {
    const ids = AGENTS.map((agent) => agent.id);
    assert.equal(new Set(ids).size, ids.length, 'agent ids must be unique');
    assert.ok(AGENTS.length >= 10, `expected a multi-agent mesh, got ${AGENTS.length}`);
    for (const agent of AGENTS) {
      assert.ok(Object.values(AgentRole).includes(agent.role), `${agent.id} has an unknown role`);
      assert.ok(agent.name.length > 0);
      assert.ok(agent.mission.length > 0);
      assert.ok(Array.isArray(agent.capabilities) && agent.capabilities.length > 0);
    }
  });

  test('should_declare_only_dependencies_that_resolve_to_real_agents', () => {
    for (const agent of AGENTS) {
      for (const dependency of agent.dependsOn ?? []) {
        assert.ok(getAgent(dependency), `${agent.id} depends on unknown agent ${dependency}`);
      }
    }
  });

  test('should_order_execution_waves_so_every_dependency_completes_first', () => {
    const waves = executionWaves();
    const settled = new Set();
    for (const wave of waves) {
      for (const agentId of wave) {
        for (const dependency of getAgent(agentId).dependsOn ?? []) {
          assert.ok(settled.has(dependency), `${agentId} runs before its dependency ${dependency}`);
        }
      }
      for (const agentId of wave) settled.add(agentId);
    }
    assert.equal(settled.size, AGENTS.length, 'every agent must be scheduled exactly once');
  });

  test('should_publish_a_topology_the_agent_console_can_render', () => {
    const topology = agentTopology();
    assert.equal(topology.agentCount, AGENTS.length);
    assert.equal(topology.waveCount, executionWaves().length);
    assert.equal(topology.waves.reduce((sum, wave) => sum + wave.agentIds.length, 0), AGENTS.length);
    assert.ok(topology.parallelWaves >= 1, 'at least one wave should execute concurrently');
  });

  test('should_return_null_for_an_agent_that_does_not_exist', () => {
    assert.equal(getAgent('not-an-agent'), null);
  });
});

/* ── Azure Document Intelligence catalogue ───────────────────────────────── */

describe('azure document intelligence catalogue', () => {
  test('should_describe_every_model_with_the_metadata_the_console_needs', () => {
    assert.ok(AZURE_MODELS.length >= 6);
    for (const model of AZURE_MODELS) {
      assert.ok(/^(prebuilt-|custom-)/.test(model.id), `${model.id} is not a valid model id`);
      assert.ok(model.name.length > 0);
      assert.ok(Array.isArray(model.outputs) && model.outputs.length > 0);
      assert.ok(Number.isFinite(model.pricePerThousandPages), `${model.id} has no price`);
      assert.ok(model.description.length > 0);
    }
  });

  test('should_resolve_known_models_and_reject_unknown_ones', () => {
    assert.equal(isKnownAzureModel('prebuilt-layout'), true);
    assert.equal(isKnownAzureModel('prebuilt-not-real'), false);
    assert.equal(getAzureModel('prebuilt-layout').id, 'prebuilt-layout');
    assert.equal(getAzureModel('prebuilt-not-real'), null);
  });

  test('should_recommend_at_least_one_candidate_model_for_a_known_document_type', () => {
    const candidates = candidateModelsForType('supplier_invoice');
    assert.ok(candidates.length > 0);
    assert.ok(candidates.every((entry) => isKnownAzureModel(entry.id)));
    const prices = candidates.map((entry) => entry.pricePerThousandPages);
    assert.deepEqual([...prices].sort((a, b) => a - b), prices, 'candidates must be ranked cheapest first');
  });

  test('should_only_offer_candidates_that_can_read_tables_when_tables_are_required', () => {
    const candidates = candidateModelsForType('supplier_invoice', { requiresTables: true });
    assert.ok(candidates.length > 0);
    assert.ok(candidates.every((entry) => entry.outputs.includes('tables')));
  });

  test('should_resolve_add_ons_and_only_offer_ones_the_model_supports', () => {
    assert.ok(AZURE_ADD_ONS.length >= 5);
    assert.equal(getAddOn('not-an-add-on'), null);
    const layoutAddOns = addOnsForType('certificate_of_analysis', 'prebuilt-layout');
    for (const addOnId of layoutAddOns) {
      assert.ok(getAddOn(addOnId), `${addOnId} is not in the catalogue`);
    }
    // Read cannot return key/value pairs, so that add-on must never be requested.
    const readAddOns = addOnsForType('certificate_of_analysis', 'prebuilt-read');
    assert.equal(readAddOns.includes('keyValuePairs'), false);
    assert.equal(readAddOns.includes('queryFields'), false);
    assert.deepEqual(addOnsForType('certificate_of_analysis', 'prebuilt-not-real'), []);
  });
});

/* ── Workflow definitions ────────────────────────────────────────────────── */

describe('workflow definitions', () => {
  test('should_define_uniquely_identified_workflows_with_executable_steps', () => {
    const ids = WORKFLOW_DEFINITIONS.map((definition) => definition.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(WORKFLOW_DEFINITIONS.length >= 10);
    for (const definition of WORKFLOW_DEFINITIONS) {
      assert.ok(definition.steps.length >= 3, `${definition.id} needs a real step chain`);
      assert.ok(definition.slaHours > 0);
      const stepIds = definition.steps.map((step) => step.id);
      assert.equal(new Set(stepIds).size, stepIds.length, `${definition.id} has duplicate step ids`);
      for (const step of definition.steps) {
        assert.ok(Object.values(StepType).includes(step.type), `${definition.id}/${step.id} has an unknown type`);
        assert.ok(step.role.length > 0);
        assert.ok(step.exitCriteria.length > 0, `${definition.id}/${step.id} needs exit criteria`);
      }
      assert.ok(
        definition.steps.some((step) => step.type === StepType.AUTOMATED),
        `${definition.id} should automate at least one step`
      );
    }
  });

  test('should_resolve_a_definition_by_id_and_by_business_process', () => {
    const first = WORKFLOW_DEFINITIONS[0];
    assert.equal(getWorkflowDefinition(first.id).id, first.id);
    assert.equal(getWorkflowDefinition('nope'), null);
    assert.equal(definitionForProcess(first.process).id, first.id);
  });

  test('should_fall_back_to_a_definition_for_an_unmapped_process', () => {
    const fallback = definitionForProcess('A process that does not exist');
    assert.ok(fallback && fallback.steps.length > 0);
  });
});

/* ── Accuracy assurance ──────────────────────────────────────────────────── */

describe('accuracy assurance engine', () => {
  test('should_repair_ocr_digit_confusion_in_a_currency_field_and_record_the_rule', () => {
    const { fields, repairs } = autoRepairFields([
      { key: 'total', label: 'Total', type: 'currency', rawValue: 'SGD 1O,5OO.00', confidence: 0.7 }
    ]);
    assert.equal(repairs.length, 1);
    assert.equal(repairs[0].rule, 'ocr-digit-confusion');
    assert.equal(fields[0].rawValue, 'SGD 10,500.00');
    assert.equal(fields[0].repaired, true);
  });

  test('should_strip_stray_label_punctuation_left_behind_by_the_key_value_split', () => {
    const { fields, repairs } = autoRepairFields([
      { key: 'supplier', label: 'Supplier', type: 'string', rawValue: ' : Acme Chemicals Pte Ltd, ', confidence: 0.9 }
    ]);
    assert.equal(repairs[0].rule, 'strip-punctuation');
    assert.equal(fields[0].rawValue, 'Acme Chemicals Pte Ltd');
  });

  test('should_never_rewrite_a_value_a_reviewer_has_already_edited', () => {
    const { fields, repairs } = autoRepairFields([
      { key: 'total', label: 'Total', type: 'currency', rawValue: 'SGD 1O.00', edited: true }
    ]);
    assert.equal(repairs.length, 0);
    assert.equal(fields[0].rawValue, 'SGD 1O.00');
  });

  test('should_foot_a_table_by_summing_its_right_most_numeric_column', () => {
    const total = footTable({
      columns: ['Item', 'Qty', 'Amount'],
      rows: [
        ['Widget', '2', '100.00'],
        ['Gadget', '1', '250.50'],
        ['Sprocket', '3', '49.50']
      ]
    });
    assert.equal(total, 400);
  });

  test('should_return_null_when_a_table_cannot_be_footed', () => {
    assert.equal(footTable(null), null);
    assert.equal(footTable({ columns: ['A'], rows: [] }), null);
    assert.equal(footTable({ columns: ['A'], rows: [['n/a'], ['pending']] }), null);
  });

  test('should_produce_an_evidence_backed_verdict_for_every_extracted_field', () => {
    const { analysis, classification, fields, validation } = analysePipeline('supplier_invoice', 'invoice-accuracy.pdf');
    const accuracy = evaluateAccuracy({
      typeId: classification.typeId,
      fields,
      analysis,
      validation,
      classification
    });

    assert.equal(accuracy.fields.length, fields.length);
    assert.ok(accuracy.checksRun > 0);
    assert.ok(accuracy.accuracyScore >= 0 && accuracy.accuracyScore <= 1);
    assert.ok(['low', 'medium', 'high'].includes(accuracy.riskLevel));

    for (const field of accuracy.fields) {
      assert.ok(Object.values(Verdict).includes(field.verdict), `${field.key} has an unknown verdict`);
      assert.ok(field.checks.length >= 5, `${field.key} must be checked from several angles`);
      for (const entry of field.checks) {
        assert.ok(Object.values(CheckStatus).includes(entry.status));
        assert.ok(entry.detail.length > 0, `${field.key}/${entry.id} must explain itself`);
      }
      assert.ok(field.calibratedConfidence >= 0 && field.calibratedConfidence <= 1);
    }
  });

  test('should_verify_a_value_that_is_grounded_in_the_page_text_and_flag_one_that_is_not', () => {
    const analysis = analyzeWithDemoEngine({ fileName: 'invoice-grounding.pdf', typeHint: 'supplier_invoice' });
    const fields = extractFields(analysis, 'supplier_invoice', 0.8);
    const grounded = fields.find((field) => field.rawValue !== null && field.rawValue !== undefined);
    assert.ok(grounded, 'the demo invoice must extract at least one populated field');

    const hallucinated = { ...grounded, key: 'phantom_field', label: 'Phantom', rawValue: 'ZZ-NOT-ON-THE-PAGE-9182' };
    const accuracy = evaluateAccuracy({
      typeId: 'supplier_invoice',
      fields: [grounded, hallucinated],
      analysis,
      validation: { issues: [], errorCount: 0, warningCount: 0 },
      classification: { typeId: 'supplier_invoice' }
    });

    const phantom = accuracy.fields.find((field) => field.key === 'phantom_field');
    const groundingCheck = phantom.checks.find((entry) => entry.id === 'grounding');
    assert.equal(groundingCheck.status, CheckStatus.FAIL, 'a value absent from the page must fail grounding');
    assert.notEqual(phantom.verdict, Verdict.VERIFIED);
  });

  test('should_treat_an_absent_value_as_missing_rather_than_wrong', () => {    const analysis = analyzeWithDemoEngine({ fileName: 'invoice-missing.pdf', typeHint: 'supplier_invoice' });
    const accuracy = evaluateAccuracy({
      typeId: 'supplier_invoice',
      fields: [{ key: 'absent', label: 'Absent', type: 'string', rawValue: null, confidence: 0, critical: false }],
      analysis,
      validation: { issues: [], errorCount: 0, warningCount: 0 },
      classification: { typeId: 'supplier_invoice' }
    });
    assert.equal(accuracy.fields[0].verdict, Verdict.MISSING);
  });

  test('should_accept_a_foreign_supplier_registration_that_is_in_the_supplier_master', () => {
    const analysis = analyzeWithDemoEngine({ fileName: 'invoice-uen.pdf', typeHint: 'supplier_invoice' });
    const foreign = SUPPLIERS.filter((supplier) => supplier.country !== 'Singapore');
    assert.ok(foreign.length > 0, 'the supplier master must contain foreign counterparties');

    for (const supplier of foreign) {
      const accuracy = evaluateAccuracy({
        typeId: 'supplier_invoice',
        fields: [
          {
            key: 'supplierUen',
            label: 'Supplier UEN',
            type: 'string',
            rawValue: supplier.uen,
            value: supplier.uen,
            confidence: 0.95,
            critical: false
          }
        ],
        analysis,
        validation: { issues: [], errorCount: 0, warningCount: 0 },
        classification: { typeId: 'supplier_invoice' }
      });

      const reference = accuracy.fields[0].checks.find((entry) => entry.id === 'reference');
      assert.equal(
        reference.status,
        CheckStatus.PASS,
        `${supplier.country} registration ${supplier.uen} is in the supplier master and must not be failed`
      );
      assert.match(reference.detail, new RegExp(supplier.name.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  test('should_still_reject_a_registration_that_matches_no_master_and_no_jurisdiction_format', () => {
    const analysis = analyzeWithDemoEngine({ fileName: 'invoice-bad-uen.pdf', typeHint: 'supplier_invoice' });
    const accuracy = evaluateAccuracy({
      typeId: 'supplier_invoice',
      fields: [
        {
          key: 'supplierUen',
          label: 'Supplier UEN',
          type: 'string',
          rawValue: 'NOT-A-REGISTRATION',
          value: 'NOT-A-REGISTRATION',
          confidence: 0.95,
          critical: false
        }
      ],
      analysis,
      validation: { issues: [], errorCount: 0, warningCount: 0 },
      classification: { typeId: 'supplier_invoice' }
    });

    const reference = accuracy.fields[0].checks.find((entry) => entry.id === 'reference');
    assert.equal(reference.status, CheckStatus.FAIL, 'a malformed identifier must still fail');
  });

  test('should_resolve_registrations_by_master_then_jurisdiction_then_reject', () => {
    const known = resolveRegistrationNumber('JP4010001034552');
    assert.equal(known.status, 'known');
    assert.equal(known.jurisdiction, 'Japan');

    const wellFormed = resolveRegistrationNumber('201999888C');
    assert.equal(wellFormed.status, 'well-formed');
    assert.equal(wellFormed.jurisdiction, 'Singapore');

    assert.equal(resolveRegistrationNumber('¯\\_(ツ)_/¯').status, 'unrecognised');
    assert.equal(resolveRegistrationNumber('').status, 'unrecognised');
  });

  test('should_attribute_every_check_to_extraction_fidelity_or_document_integrity', () => {
    const { analysis, classification, fields, validation } = analysePipeline('supplier_invoice', 'invoice-attrib.pdf');
    const accuracy = evaluateAccuracy({
      typeId: classification.typeId,
      fields,
      analysis,
      validation,
      classification
    });

    const attributions = new Set();
    for (const field of accuracy.fields) {
      for (const entry of field.checks) {
        assert.ok(
          Object.values(Attribution).includes(entry.attribution),
          `${field.key}/${entry.id} must state what a failure proves`
        );
        attributions.add(entry.attribution);
      }
      assert.ok(Object.values(Integrity).includes(field.integrity));
    }
    assert.deepEqual([...attributions].sort(), [Attribution.DOCUMENT, Attribution.EXTRACTION].sort());
  });

  test('should_not_blame_extraction_when_the_document_contradicts_its_own_arithmetic', () => {
    const analysis = analyzeWithDemoEngine({ fileName: 'invoice-defect.pdf', typeHint: 'supplier_invoice' });
    // Both values are transcribed verbatim from the page, but the page's own
    // total does not equal subtotal + tax. The generated invoice's own pairs are
    // cleared so the assertion isolates the arithmetic relation.
    const printed = { subtotal: '1,000.00', tax: '0.00', total: '1,046.53' };
    analysis.keyValuePairs = [];
    analysis.tables = [];
    analysis.documentFields = [];
    analysis.fullText = `TAX INVOICE\nSubtotal ${printed.subtotal}\nGST ${printed.tax}\nTotal Amount Payable ${printed.total}`;

    const build = (key, label, raw, value) => ({
      key,
      label,
      type: 'currency',
      rawValue: raw,
      value,
      confidence: 0.95,
      critical: key === 'totalAmount'
    });

    const accuracy = evaluateAccuracy({
      typeId: 'supplier_invoice',
      fields: [
        build('subtotal', 'Subtotal', printed.subtotal, 1000),
        build('taxAmount', 'GST', printed.tax, 0),
        build('totalAmount', 'Total Amount Payable', printed.total, 1046.53)
      ],
      analysis,
      validation: { issues: [], errorCount: 0, warningCount: 0 },
      classification: { typeId: 'supplier_invoice', confidence: 0.95 }
    });

    const total = accuracy.fields.find((field) => field.key === 'totalAmount');
    const arithmetic = total.checks.find((entry) => entry.id === 'arithmetic');

    assert.equal(arithmetic.status, CheckStatus.FAIL, 'the arithmetic breach must still be reported');
    assert.equal(arithmetic.attribution, Attribution.DOCUMENT);
    assert.equal(total.integrity, Integrity.DISPUTED, 'the document must be recorded as disputing itself');
    assert.notEqual(total.verdict, Verdict.CONFLICT, 'a faithful transcription is not an extraction conflict');
    assert.ok(accuracy.integrityIssueCount > 0);
    assert.ok(accuracy.integrityScore < 1);

    // Nothing is weakened: the document is still high risk and still blocked
    // from straight-through processing.
    assert.equal(accuracy.riskLevel, 'high');
    assert.equal(accuracy.straightThroughEligible, false);
    assert.ok(accuracy.integrityIssues.length > 0);
    assert.ok(accuracy.integrityIssues[0].detail.length > 0);
  });

  test('should_raise_priority_for_document_integrity_disputes', () => {
    const definition = getWorkflowDefinition('invoice_to_pay');
    const clean = scorePriority({
      record: { fields: [] },
      accuracy: { conflictCount: 0, integrityIssueCount: 0, criticalCoverage: 1, straightThroughEligible: false },
      validation: { errorCount: 0 },
      definition
    });
    const disputed = scorePriority({
      record: { fields: [] },
      accuracy: { conflictCount: 0, integrityIssueCount: 2, criticalCoverage: 1, straightThroughEligible: false },
      validation: { errorCount: 0 },
      definition
    });

    assert.ok(disputed.score > clean.score, 'a self-contradicting document must outrank a clean one');
    assert.ok(disputed.reasons.some((reason) => /integrity dispute/i.test(reason)));
  });

  test('should_not_treat_an_empty_key_value_pair_as_a_contradicting_source', () => {
    const analysis = analyzeWithDemoEngine({ fileName: 'invoice-blank-pair.pdf', typeHint: 'supplier_invoice' });
    const reference = 'INV-BLANKPAIR-3021';
    analysis.tables = [];
    analysis.documentFields = [];
    // The layout model emitted the pair but read nothing from it — the exact
    // capture anomaly the demo engine reproduces.
    analysis.keyValuePairs = [{ key: 'Invoice Number', value: '', confidence: 0, pageNumber: 1, box: null }];
    analysis.fullText = `TAX INVOICE\nInvoice Number: ${reference}`;

    const accuracy = evaluateAccuracy({
      typeId: 'supplier_invoice',
      fields: [
        {
          key: 'invoiceNumber',
          label: 'Invoice Number',
          type: 'string',
          rawValue: reference,
          value: reference,
          confidence: 0.9,
          source: 'printed-label',
          sourceKey: 'Invoice Number',
          critical: true
        }
      ],
      analysis,
      validation: { issues: [], errorCount: 0, warningCount: 0 },
      classification: { typeId: 'supplier_invoice' }
    });

    const corroboration = accuracy.fields[0].checks.find((entry) => entry.id === 'corroboration');
    assert.equal(corroboration.status, CheckStatus.SKIP);
    assert.notEqual(accuracy.fields[0].verdict, Verdict.CONFLICT);
  });

  test('should_corroborate_a_value_that_the_document_prints_more_than_once', () => {
    const analysis = analyzeWithDemoEngine({ fileName: 'invoice-repeat.pdf', typeHint: 'supplier_invoice' });
    const repeated = 'REF-CORROBORATE-7781';
    analysis.keyValuePairs = [];
    analysis.tables = [];
    analysis.documentFields = [];
    analysis.fullText = `TAX INVOICE\nOur reference ${repeated}\nPlease quote ${repeated} on remittance.`;

    const accuracy = evaluateAccuracy({
      typeId: 'supplier_invoice',
      fields: [
        {
          key: 'invoiceNumber',
          label: 'Invoice Number',
          type: 'string',
          rawValue: repeated,
          value: repeated,
          confidence: 0.92,
          source: 'text-pattern',
          critical: true
        }
      ],
      analysis,
      validation: { issues: [], errorCount: 0, warningCount: 0 },
      classification: { typeId: 'supplier_invoice' }
    });

    const corroboration = accuracy.fields[0].checks.find((entry) => entry.id === 'corroboration');
    assert.equal(corroboration.status, CheckStatus.PASS);
    assert.match(corroboration.detail, /independent occurrences/i);
  });

  test('should_not_let_a_single_occurrence_corroborate_itself', () => {
    const analysis = analyzeWithDemoEngine({ fileName: 'invoice-single.pdf', typeHint: 'supplier_invoice' });
    const once = 'REF-ONLY-ONCE-4410';
    analysis.fullText = `TAX INVOICE\nOur reference ${once}`;
    analysis.keyValuePairs = [];
    analysis.tables = [];
    analysis.documentFields = [];

    const accuracy = evaluateAccuracy({
      typeId: 'supplier_invoice',
      fields: [
        {
          key: 'invoiceNumber',
          label: 'Invoice Number',
          type: 'string',
          rawValue: once,
          value: once,
          confidence: 0.92,
          source: 'text-pattern',
          critical: true
        }
      ],
      analysis,
      validation: { issues: [], errorCount: 0, warningCount: 0 },
      classification: { typeId: 'supplier_invoice' }
    });

    const corroboration = accuracy.fields[0].checks.find((entry) => entry.id === 'corroboration');
    assert.equal(corroboration.status, CheckStatus.SKIP, 'one occurrence is the extractor’s own source');
  });

  test('should_build_a_reliability_curve_that_compares_predicted_and_observed_accuracy', () => {
    const records = ['supplier_invoice', 'certificate_of_analysis', 'purchase_order'].map((typeId) => {
      const { analysis, classification, fields, validation } = analysePipeline(typeId, `${typeId}-calibration.pdf`);
      return {
        id: `doc_${typeId}`,
        typeId: classification.typeId,
        accuracy: evaluateAccuracy({ typeId: classification.typeId, fields, analysis, validation, classification })
      };
    });

    const calibration = buildCalibration(records);
    assert.ok(calibration.observations > 0);
    assert.ok(calibration.brierScore >= 0 && calibration.brierScore <= 1);
    assert.ok(calibration.expectedCalibrationError >= 0 && calibration.expectedCalibrationError <= 1);
    for (const bucket of calibration.reliability) {
      assert.ok(bucket.lower >= 0 && bucket.upper <= 1);
      assert.ok(bucket.count >= 0);
      if (bucket.count > 0) {
        assert.ok(bucket.observed >= 0 && bucket.observed <= 1);
        assert.ok(bucket.predicted >= 0 && bucket.predicted <= 1);
      }
    }
  });
});

/* ── Field extraction ────────────────────────────────────────────────────── */

describe('field extraction', () => {
  test('should_not_bind_a_field_to_a_key_value_pair_the_model_returned_empty', () => {
    const analysis = analyzeWithDemoEngine({ fileName: 'coa-blank.pdf', typeHint: 'certificate_of_analysis' });
    analysis.keyValuePairs = [{ key: 'Expiry Date', value: '', confidence: 0, pageNumber: 1, box: null }];
    analysis.pages = [];
    analysis.fullText = 'CERTIFICATE OF ANALYSIS';

    const expiry = extractFields(analysis, 'certificate_of_analysis', 0.8).find((f) => f.key === 'expiryDate');
    assert.equal(expiry.value, null);
    assert.equal(expiry.source, 'not-found');
  });

  test('should_recover_a_value_the_key_value_model_dropped_from_the_printed_line', () => {
    const analysis = analyzeWithDemoEngine({ fileName: 'coa-dropped.pdf', typeHint: 'certificate_of_analysis' });
    analysis.keyValuePairs = [{ key: 'Expiry Date', value: '', confidence: 0, pageNumber: 1, box: null }];
    analysis.tables = [];
    analysis.pages = [
      {
        pageNumber: 2,
        lines: [
          { content: 'Manufacture Date: 10 Feb 2026', confidence: 0.95, box: [0.1, 0.2, 0.3, 0.01] },
          { content: 'Expiry Date: 10 Feb 2029', confidence: 0.95, box: [0.1, 0.22, 0.3, 0.01] }
        ]
      }
    ];
    analysis.fullText = 'Manufacture Date: 10 Feb 2026\nExpiry Date: 10 Feb 2029';

    const expiry = extractFields(analysis, 'certificate_of_analysis', 0.8).find((f) => f.key === 'expiryDate');
    assert.equal(expiry.value, '2029-02-10');
    assert.equal(expiry.source, 'printed-label');
    assert.equal(expiry.pageNumber, 2);
    // A recovered value is real recognised text but was not confirmed by the
    // key-value model, so it must never outrank a clean key-value read.
    assert.ok(expiry.confidence < 0.95);
    assert.equal(expiry.sourceKey, 'Expiry Date');
  });

  test('should_not_recover_a_value_from_an_unrelated_printed_label', () => {
    const analysis = analyzeWithDemoEngine({ fileName: 'coa-unrelated.pdf', typeHint: 'certificate_of_analysis' });
    analysis.keyValuePairs = [];
    analysis.tables = [];
    analysis.pages = [
      { pageNumber: 1, lines: [{ content: 'Warehouse Bay: 10 Feb 2029', confidence: 0.95, box: null }] }
    ];
    analysis.fullText = 'Warehouse Bay: 10 Feb 2029';

    const expiry = extractFields(analysis, 'certificate_of_analysis', 0.8).find((f) => f.key === 'expiryDate');
    assert.equal(expiry.value, null);
    assert.equal(expiry.source, 'not-found');
  });

  test('should_prefer_a_key_value_pair_over_the_printed_line', () => {
    const analysis = analyzeWithDemoEngine({ fileName: 'coa-both.pdf', typeHint: 'certificate_of_analysis' });
    analysis.keyValuePairs = [
      { key: 'Expiry Date', value: '11 Mar 2030', confidence: 0.97, pageNumber: 1, box: null }
    ];
    analysis.tables = [];
    analysis.pages = [
      { pageNumber: 1, lines: [{ content: 'Expiry Date: 10 Feb 2029', confidence: 0.95, box: null }] }
    ];
    analysis.fullText = 'Expiry Date: 10 Feb 2029';

    const expiry = extractFields(analysis, 'certificate_of_analysis', 0.8).find((f) => f.key === 'expiryDate');
    assert.equal(expiry.value, '2030-03-11');
    assert.equal(expiry.source, 'key-value-pair');
  });
});

/* ── Workflow engine ─────────────────────────────────────────────────────── */

describe('workflow engine', () => {
  const definition = WORKFLOW_DEFINITIONS[0];

  test('should_raise_priority_when_rules_fail_and_accuracy_conflicts_exist', () => {
    const clean = scorePriority({
      record: { id: 'doc_a' },
      accuracy: { conflictCount: 0, accuracyScore: 0.98, riskLevel: 'low' },
      validation: { errorCount: 0, warningCount: 0 },
      definition
    });
    const dirty = scorePriority({
      record: { id: 'doc_b' },
      accuracy: { conflictCount: 3, accuracyScore: 0.4, riskLevel: 'high' },
      validation: { errorCount: 2, warningCount: 4 },
      definition
    });

    assert.ok(dirty.score > clean.score, `${dirty.score} should exceed ${clean.score}`);
    assert.ok(dirty.reasons.length > 0, 'a raised priority must be explained');
    assert.ok(Object.values(Priority).includes(dirty.level));
    assert.ok(Object.values(Priority).includes(clean.level));
  });

  test('should_complete_automated_steps_and_park_the_document_on_the_first_human_step', () => {
    const workflow = instantiateWorkflow({
      record: { id: 'doc_review', fileName: 'invoice.pdf', checksum: 'abc123def456', pageCount: 3 },
      accuracy: { accuracyScore: 0.7, conflictCount: 2, checksRun: 21, fieldCount: 9, riskLevel: 'high' },
      validation: { errorCount: 1, warningCount: 2, rulesEvaluated: 12, issues: [] },
      classification: { typeId: 'supplier_invoice', process: definition.process },
      agentRun: { steps: [] },
      needsReview: true
    });

    assert.equal(workflow.documentId, 'doc_review');
    assert.equal(workflow.status, WorkflowStatus.ACTIVE);
    assert.ok(workflow.currentStepId, 'an active workflow must have a current step');
    assert.equal(workflow.steps[workflow.currentStepIndex].status, StepStatus.IN_PROGRESS);
    assert.equal(workflow.history.length, 1);

    const before = workflow.steps.slice(0, workflow.currentStepIndex);
    assert.ok(before.length > 0, 'automated steps should already be closed out');
    for (const step of before) {
      assert.ok([StepStatus.COMPLETED, StepStatus.SKIPPED].includes(step.status));
      assert.ok(step.evidence.length > 0, `${step.id} must record why it passed`);
    }
  });

  test('should_straight_through_process_a_clean_document_by_skipping_the_review_step', () => {
    const workflow = instantiateWorkflow({
      record: { id: 'doc_stp', fileName: 'invoice.pdf', checksum: 'abc123def456', pageCount: 1 },
      accuracy: { accuracyScore: 0.99, conflictCount: 0, checksRun: 21, fieldCount: 9, riskLevel: 'low' },
      validation: { errorCount: 0, warningCount: 0, rulesEvaluated: 12, issues: [] },
      classification: { typeId: 'supplier_invoice', process: definition.process },
      agentRun: { steps: [] },
      needsReview: false
    });

    const skipped = workflow.steps.filter((step) => step.status === StepStatus.SKIPPED);
    assert.equal(skipped.length, 1, 'exactly the human review step should be skipped');
    assert.match(skipped[0].evidence, /straight-through/i);
  });

  test('should_classify_sla_state_from_the_remaining_time_on_the_clock', () => {
    const base = {
      status: WorkflowStatus.ACTIVE,
      slaDueAt: new Date(Date.now() + 24 * HOUR_MS).toISOString()
    };
    assert.equal(slaState(base), 'on-track');
    assert.equal(slaState({ ...base, slaDueAt: new Date(Date.now() + HOUR_MS).toISOString() }), 'at-risk');
    assert.equal(slaState({ ...base, slaDueAt: new Date(Date.now() - HOUR_MS).toISOString() }), 'breached');
    assert.equal(slaState({ ...base, status: WorkflowStatus.COMPLETED }), 'closed');
    assert.equal(slaState(null), 'none');
  });

  test('should_summarise_a_workflow_with_the_progress_the_board_displays', () => {
    const workflow = instantiateWorkflow({
      record: { id: 'doc_summary', fileName: 'invoice.pdf', checksum: 'abc123def456', pageCount: 2 },
      accuracy: { accuracyScore: 0.9, conflictCount: 0, checksRun: 21, fieldCount: 9, riskLevel: 'low' },
      validation: { errorCount: 0, warningCount: 1, rulesEvaluated: 12, issues: [] },
      classification: { typeId: 'supplier_invoice', process: definition.process },
      agentRun: { steps: [] },
      needsReview: true
    });

    const summary = workflowSummary(workflow, {
      id: 'doc_summary',
      fileName: 'invoice.pdf',
      classification: { typeName: 'Supplier invoice' },
      accuracy: { accuracyScore: 0.9 },
      validation: { errorCount: 0 },
      status: 'processed'
    });
    assert.equal(summary.documentId, 'doc_summary');
    assert.equal(summary.typeName, 'Supplier invoice');
    assert.ok(summary.progress >= 0 && summary.progress <= 1);
    assert.ok(summary.stepCount > 0);
    assert.ok(['on-track', 'at-risk', 'breached', 'closed', 'none'].includes(summary.slaState));
  });
});

/* ── Azure integration surface ───────────────────────────────────────────── */

describe('azure integration surface', () => {
  test('should_report_the_authentication_mode_that_matches_the_configuration', () => {
    assert.ok(['managed-identity', 'resource-key', 'none'].includes(authenticationMode()));
  });

  test('should_publish_an_integration_profile_without_leaking_the_credential', () => {
    const profile = integrationProfile();
    const serialised = JSON.stringify(profile);
    assert.ok(typeof profile.endpointConfigured === 'boolean');
    assert.ok(typeof profile.credentialPresent === 'boolean');
    assert.ok(['demo', 'azure'].includes(profile.mode));
    assert.ok(profile.dataPlanePath.includes('documentModels'));
    assert.ok(Array.isArray(profile.capabilities.addOnFeatures));
    assert.equal(Object.prototype.hasOwnProperty.call(profile, 'apiKey'), false);
    assert.equal(serialised.includes('Ocp-Apim-Subscription-Key'), false);
    assert.ok(!/[?&]sig=/.test(serialised), 'no signed URLs may be exposed');
  });

  test('should_map_every_document_type_onto_a_real_azure_model', () => {
    const catalogue = modelCatalogue();
    assert.ok(catalogue.models.length >= 6);
    assert.ok(catalogue.routing.length >= 11);
    for (const route of catalogue.routing) {
      assert.ok(isKnownAzureModel(route.selectedModelId), `${route.typeId} routes to ${route.selectedModelId}`);
      assert.equal(route.selectedModelName, getAzureModel(route.selectedModelId).name);
      assert.ok(route.candidates.length > 0, `${route.typeId} has no candidate models`);
      for (const addOnId of route.addOns) assert.ok(getAddOn(addOnId), `${route.typeId} requests unknown ${addOnId}`);
    }
    assert.ok(catalogue.models.some((entry) => entry.inUse), 'at least one model must actually be routed to');
  });

  test('should_never_throw_when_probing_an_unconfigured_service', async () => {
    const probe = await probeService({ force: true });
    assert.ok(typeof probe.reachable === 'boolean');
    assert.ok(typeof probe.checkedAt === 'string');
    assert.ok(typeof probe.message === 'string' && probe.message.length > 0);
    assert.ok(['not-configured', 'offline-demo', 'unauthorised', 'error', 'healthy'].includes(probe.state));
    assert.ok(Array.isArray(probe.resourceModels));
  });
});

describe('edge snapshot hydration', () => {
  test('should_restore_orchestration_history_from_a_hydrated_snapshot', async () => {
    const { hydrateRunHistory, listAgentRuns } = await import('../src/services/pipeline.service.js');
    const runs = [
      { fileName: 'older.pdf', classification: { typeName: 'Supplier Invoice' }, agentRun: { id: 'run_a', documentId: 'doc_a', status: 'succeeded', startedAt: '2024-01-01T00:00:00.000Z', agentCount: 11, waveCount: 10 } },
      { fileName: 'newer.pdf', classification: { typeName: 'Purchase Order' }, agentRun: { id: 'run_b', documentId: 'doc_b', status: 'succeeded', startedAt: '2024-02-01T00:00:00.000Z', agentCount: 11, waveCount: 10 } },
      { fileName: 'unprocessed.pdf', classification: null, agentRun: null }
    ];

    const restored = hydrateRunHistory(runs);
    assert.equal(restored, 2, 'only records carrying a run are restorable');

    const history = listAgentRuns(10);
    assert.equal(history[0].id, 'run_b', 'history is newest first');
    assert.equal(history[0].typeName, 'Purchase Order');
    assert.equal(history[1].id, 'run_a');

    assert.equal(hydrateRunHistory([]), 0, 'hydration replaces rather than appends');
    assert.equal(listAgentRuns(10).length, 0);
  });
});
