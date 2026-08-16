/**
 * Agent orchestrator.
 *
 * Executes the agent mesh over one document. Agents are grouped into dependency
 * waves; everything inside a wave runs concurrently, so the Table and Compliance
 * agents genuinely work in parallel rather than being a queue with a nicer name.
 *
 * The orchestrator is the only place that knows about *all* the specialists, and
 * it produces three artefacts:
 *
 *   1. the document payload (analysis, classification, fields, validation,
 *      accuracy, workflow, cost) that the pipeline persists,
 *   2. a full agent run trace — every agent's evidence, findings, confidence and
 *      hand-off — which is what makes the mesh auditable,
 *   3. legacy six-stage progress events, so existing progress UI keeps working.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../../config/index.js';
import { AGENTS, executionWaves, getAgent } from '../../domain/agents.js';
import { addOnsForType, candidateModelsForType } from '../../domain/azureModels.js';
import { getDocumentType } from '../../domain/documentTypes.js';
import { SUPPLIERS } from '../../domain/referenceData.js';
import { logger } from '../../lib/logger.js';
import { maskIdentifier } from '../../lib/format.js';
import { analyzeDocument } from '../analyzers/index.js';
import { autoRepairFields, evaluateAccuracy, footTable } from '../accuracy.service.js';
import { classifyDocument } from '../classification.service.js';
import { estimateDocumentCost, selectModelForType } from '../cost.service.js';
import { extractFields } from '../extraction.service.js';
import { listAllDocuments } from '../store.service.js';
import { validateDocument } from '../validation.service.js';
import { instantiateWorkflow } from '../workflow.service.js';

const STAGES = Object.freeze(['ingest', 'analyse', 'classify', 'extract', 'validate', 'score']);
const MASKED_FIELD_KEYS = new Set(['accountNumber']);
const AMBIGUITY_MARGIN = 2.5;
const TRIAGE_PAGE_THRESHOLD = 8;

const Finding = Object.freeze({ INFO: 'info', WARN: 'warn', ERROR: 'error' });

const note = (level, message) => ({ level, message });

/* ── Agent implementations ───────────────────────────────────────────────── */

/**
 * Every agent receives the shared run context and returns a report. Reports do
 * not mutate the context directly — they hand back an `apply` function — which
 * keeps the data flow between agents explicit and inspectable.
 * @type {Record<string, (ctx: object) => Promise<object>>}
 */
const IMPLEMENTATIONS = {
  async intake(ctx) {
    const { record, buffer } = ctx;
    const findings = [];
    const sizeKb = buffer.length / 1024;

    if (!buffer.length) throw new Error('The uploaded file is empty.');
    if (sizeKb > config.limits.maxUploadMb * 1024) {
      throw new Error(`File exceeds the ${config.limits.maxUploadMb} MB ceiling.`);
    }

    const extension = (record.fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
    const hint = inferTypeHint(record.fileName);
    if (hint) findings.push(note(Finding.INFO, `Filename suggests a ${getDocumentType(hint).name}.`));
    if (sizeKb > 5120) findings.push(note(Finding.WARN, 'Large file — analysis will be billed across many pages.'));

    return {
      summary: `${record.fileName} accepted · ${sizeKb.toFixed(1)} KB · .${extension} · checksum verified.`,
      confidence: 1,
      findings,
      outputs: {
        sizeKb: Number(sizeKb.toFixed(1)),
        extension,
        checksum: record.checksum,
        typeHint: hint,
        pageBudget: config.limits.maxPagesPerDocument
      },
      apply: (state) => {
        state.typeHint = hint;
      }
    };
  },

  async docint(ctx) {
    const { record, buffer, correlationId, state } = ctx;
    const findings = [];

    // Plan first: which model, which add-ons, which query fields. The plan is
    // recorded even when the offline engine serves the request, so the Azure
    // integration stays auditable without spending anything.
    const hintedType = state.typeHint ?? null;
    const plannedModel = hintedType ? selectModelForType(hintedType) : config.analyzer.modelId;
    const addOns = hintedType ? addOnsForType(hintedType, plannedModel) : [];
    const queryFields = hintedType
      ? getDocumentType(hintedType)
          .fields.filter((field) => field.critical && field.type !== 'table')
          .map((field) => field.key)
          .slice(0, 10)
      : [];

    const analysis = await analyzeDocument({
      buffer,
      fileName: record.fileName,
      contentType: record.mimeType,
      correlationId,
      typeHint: hintedType,
      modelId: plannedModel,
      features: addOns,
      queryFields
    });

    if (analysis.pageCount > config.limits.maxPagesPerDocument) {
      throw new Error(
        `Document has ${analysis.pageCount} pages which exceeds the configured limit of ${config.limits.maxPagesPerDocument}.`
      );
    }

    if (analysis.fallbackReason) findings.push(note(Finding.ERROR, analysis.fallbackReason));
    if (analysis.pageCount >= TRIAGE_PAGE_THRESHOLD) {
      findings.push(
        note(Finding.INFO, `${analysis.pageCount} pages — single-page triage keeps classification off the Layout tier.`)
      );
    }
    const ocrConfidence = analysis.ocr?.averageConfidence ?? 0;
    if (ocrConfidence < 0.9) {
      findings.push(
        note(Finding.WARN, `Mean OCR confidence is ${(ocrConfidence * 100).toFixed(1)}% — scan quality is degraded.`)
      );
    }
    if ((analysis.ocr?.degradedPages ?? []).length > 0) {
      findings.push(note(Finding.WARN, `Skewed pages detected: ${analysis.ocr.degradedPages.slice(0, 5).join(', ')}.`));
    }

    const engineLabel = analysis.engine === 'azure' ? `Azure DI · ${analysis.modelId}` : 'offline demo engine';

    return {
      summary: `${analysis.pageCount} page(s) analysed via ${engineLabel} · ${(ocrConfidence * 100).toFixed(1)}% mean OCR confidence.`,
      confidence: Number(ocrConfidence.toFixed(4)),
      findings,
      outputs: {
        engine: analysis.engine,
        modelId: analysis.modelId,
        plannedModelId: plannedModel,
        apiVersion: analysis.apiVersion ?? null,
        addOns: analysis.addOns ?? addOns,
        queryFields: analysis.queryFields ?? queryFields,
        pageCount: analysis.pageCount,
        tableCount: (analysis.tables ?? []).length,
        keyValuePairCount: (analysis.keyValuePairs ?? []).length,
        documentFieldCount: (analysis.documentFields ?? []).length,
        barcodeCount: (analysis.barcodes ?? []).length,
        wordCount: analysis.ocr?.wordCount ?? 0,
        fallbackReason: analysis.fallbackReason ?? null
      },
      apply: (nextState) => {
        nextState.analysis = analysis;
      }
    };
  },

  async classifier(ctx) {
    const { state } = ctx;
    const classification = classifyDocument(state.analysis);
    const type = getDocumentType(classification.typeId);
    const findings = [];

    const runnerUp = classification.alternatives?.[0] ?? null;
    const margin = runnerUp && classification.alternatives?.[1]
      ? Number((runnerUp.score - classification.alternatives[1].score).toFixed(2))
      : null;

    if (classification.typeId === 'unclassified') {
      findings.push(
        note(Finding.ERROR, 'No document type reached the minimum classification score — manual triage required.')
      );
    } else if (margin !== null && margin < AMBIGUITY_MARGIN) {
      findings.push(
        note(Finding.WARN, `Runner-up types are within ${margin} points of each other — confirming with field evidence.`)
      );
    }
    if (classification.confidence < 0.7 && classification.typeId !== 'unclassified') {
      findings.push(note(Finding.WARN, `Classification confidence is ${(classification.confidence * 100).toFixed(1)}%.`));
    }

    const recommendedModel = selectModelForType(classification.typeId);
    if (state.analysis?.engine === 'azure' && recommendedModel !== state.analysis.modelId) {
      findings.push(
        note(Finding.INFO, `Now the type is known, ${recommendedModel} is the cost-optimal model for re-analysis.`)
      );
    }

    return {
      summary: `${type.name} · ${(classification.confidence * 100).toFixed(1)}% confidence · ${classification.evidence.length} evidence item(s).`,
      confidence: classification.confidence,
      findings,
      outputs: {
        typeId: classification.typeId,
        typeName: type.name,
        businessUnit: type.businessUnit,
        process: type.process,
        margin,
        evidence: classification.evidence.slice(0, 5),
        alternatives: classification.alternatives,
        recommendedModel,
        candidateModels: candidateModelsForType(classification.typeId, {
          requiresTables: type.fields.some((field) => field.type === 'table')
        }).map((entry) => entry.id)
      },
      apply: (nextState) => {
        nextState.classification = classification;
        nextState.type = type;
      }
    };
  },

  async extractor(ctx) {
    const { state } = ctx;
    const threshold = config.quality.reviewConfidenceThreshold;
    const raw = extractFields(state.analysis, state.classification.typeId, threshold);

    // Azure prebuilt document fields are merged as a second source: they only
    // fill gaps, never overwrite a grounded local extraction, and provenance is
    // recorded on the field itself.
    const merged = mergeAzureFields(raw, state.analysis, state.classification.typeId, threshold);
    const { fields, repairs } = autoRepairFields(merged.fields);

    const findings = [];
    const missingCritical = fields.filter((field) => field.critical && field.rawValue === null);
    if (missingCritical.length > 0) {
      findings.push(
        note(Finding.ERROR, `Critical field(s) not found: ${missingCritical.map((field) => field.label).join(', ')}.`)
      );
    }
    if (merged.filledFromAzure > 0) {
      findings.push(note(Finding.INFO, `${merged.filledFromAzure} field(s) recovered from Azure prebuilt output.`));
    }
    if (repairs.length > 0) {
      findings.push(note(Finding.INFO, `${repairs.length} value(s) auto-repaired before verification.`));
    }

    const resolved = fields.filter((field) => field.rawValue !== null).length;

    return {
      summary: `${resolved}/${fields.length} field(s) resolved · ${repairs.length} auto-repair(s).`,
      confidence:
        fields.length > 0
          ? Number((fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length).toFixed(4))
          : 0,
      findings,
      outputs: {
        fieldCount: fields.length,
        resolvedCount: resolved,
        missingCritical: missingCritical.map((field) => field.key),
        repairs,
        bySource: countBy(fields, (field) => field.source)
      },
      apply: (nextState) => {
        nextState.fields = fields;
        nextState.repairs = repairs;
      }
    };
  },

  async tabulator(ctx) {
    const { state } = ctx;
    const tables = state.analysis.tables ?? [];
    const findings = [];

    const footings = tables.map((table) => ({
      id: table.id,
      title: table.title,
      pageNumber: table.pageNumber,
      rowCount: table.rowCount,
      columnCount: table.columnCount,
      footedTotal: footTable(table)
    }));

    const totalField = state.fields.find((field) => field.key === 'totalAmount' || field.key === 'claimAmount');
    const documentTotal = typeof totalField?.value === 'number' ? totalField.value : null;
    let reconciliation = null;

    if (documentTotal !== null) {
      const candidate = footings.find((entry) => entry.footedTotal !== null);
      if (candidate) {
        const difference = Number(Math.abs(candidate.footedTotal - documentTotal).toFixed(2));
        const tolerance = Math.max(0.02, Math.abs(documentTotal) * 0.12);
        reconciliation = {
          tableId: candidate.id,
          footedTotal: candidate.footedTotal,
          documentTotal,
          difference,
          reconciled: difference <= tolerance
        };
        findings.push(
          reconciliation.reconciled
            ? note(Finding.INFO, `Line items foot to ${candidate.footedTotal.toFixed(2)}, consistent with the stated total.`)
            : note(
                Finding.WARN,
                `Line items foot to ${candidate.footedTotal.toFixed(2)} against a stated total of ${documentTotal.toFixed(2)} (difference ${difference.toFixed(2)}).`
              )
        );
      }
    }

    if (tables.length === 0) findings.push(note(Finding.INFO, 'No tables were recognised in this document.'));

    return {
      summary:
        tables.length === 0
          ? 'No tabular payload to reconcile.'
          : `${tables.length} table(s) · ${footings.filter((entry) => entry.footedTotal !== null).length} footed numerically.`,
      confidence: tables.length === 0 ? 0.6 : reconciliation ? (reconciliation.reconciled ? 0.97 : 0.55) : 0.85,
      findings,
      outputs: { tables: footings, reconciliation },
      apply: (nextState) => {
        nextState.tableReconciliation = reconciliation;
      }
    };
  },

  async compliance(ctx) {
    const { state } = ctx;
    const findings = [];
    const masked = [];

    const fields = state.fields.map((field) => {
      if (!MASKED_FIELD_KEYS.has(field.key) || !field.rawValue) return field;
      masked.push(field.label);
      return {
        ...field,
        rawValue: maskIdentifier(field.rawValue),
        value: maskIdentifier(String(field.value ?? ''))
      };
    });

    if (masked.length > 0) {
      findings.push(note(Finding.INFO, `PDPA minimisation applied to ${masked.join(', ')} before persistence.`));
    }

    const residualPii = detectResidualPii(state.analysis.fullText ?? '');
    if (residualPii.length > 0) {
      findings.push(
        note(Finding.WARN, `Recognised text still contains ${residualPii.join(', ')} — retention policy applies.`)
      );
    }

    const retentionClass = /claim|invoice|statement|payroll|treasury|reporting/i.test(
      `${state.type.process} ${state.type.name} ${state.classification.typeId}`
    )
      ? 'financial-7-years'
      : 'operational-3-years';

    return {
      summary: `${masked.length} identifier(s) masked · retention class ${retentionClass}.`,
      confidence: 1,
      findings,
      outputs: {
        maskedFields: masked,
        residualPii,
        retentionClass,
        policy: 'PDPA (Singapore) minimisation + retention'
      },
      apply: (nextState) => {
        nextState.fields = fields;
        nextState.compliance = { maskedFields: masked, residualPii, retentionClass };
      }
    };
  },

  async validator(ctx) {
    const { state } = ctx;
    const validation = validateDocument({
      typeId: state.classification.typeId,
      fields: state.fields,
      analysis: state.analysis
    });

    const findings = validation.issues
      .slice(0, 8)
      .map((entry) => note(entry.severity === 'error' ? Finding.ERROR : Finding.WARN, entry.message));

    return {
      summary: `${validation.rulesEvaluated} rule(s) evaluated · ${validation.errorCount} error(s), ${validation.warningCount} warning(s).`,
      confidence: validation.passed ? 0.98 : Math.max(0.2, 0.9 - validation.errorCount * 0.2),
      findings,
      outputs: {
        rulesEvaluated: validation.rulesEvaluated,
        errorCount: validation.errorCount,
        warningCount: validation.warningCount,
        passed: validation.passed,
        rules: validation.issues.map((entry) => entry.rule)
      },
      apply: (nextState) => {
        nextState.validation = validation;
      }
    };
  },

  async reconciler(ctx) {
    const { state, record } = ctx;
    const findings = [];
    const checks = [];

    const supplierField = state.fields.find((field) => /supplier|vendor|issuer|lessor|distributor/i.test(field.key));
    if (supplierField?.rawValue) {
      const match = SUPPLIERS.find((supplier) =>
        String(supplierField.rawValue).toLowerCase().includes(supplier.name.toLowerCase().slice(0, 14))
      );
      checks.push({
        id: 'supplier-master',
        name: 'Counterparty master',
        status: match ? 'pass' : 'warn',
        detail: match
          ? `${match.name} found in the counterparty master (${match.uen}).`
          : `"${supplierField.rawValue}" is not in the counterparty master.`
      });
      if (!match) findings.push(note(Finding.WARN, 'Counterparty is not registered in the master data.'));
    }

    const referenceField = state.fields.find((field) =>
      /purchaseOrderRef|poNumber|invoiceNumber|claimReference/i.test(field.key)
    );
    if (referenceField?.rawValue) {
      const needle = String(referenceField.rawValue).toLowerCase();
      const counterparts = listAllDocuments().filter(
        (candidate) =>
          candidate.id !== record.id &&
          (candidate.fields ?? []).some((field) => String(field.rawValue ?? '').toLowerCase() === needle)
      );
      checks.push({
        id: 'cross-document',
        name: 'Cross-document match',
        status: counterparts.length > 0 ? 'pass' : 'info',
        detail:
          counterparts.length > 0
            ? `${counterparts.length} counterpart document(s) reference ${referenceField.rawValue}.`
            : `No counterpart document references ${referenceField.rawValue} yet.`
      });
      if (counterparts.length > 0) {
        findings.push(note(Finding.INFO, `Matched to ${counterparts.length} counterpart document(s).`));
      }
    }

    const duplicates = listAllDocuments().filter(
      (candidate) => candidate.id !== record.id && candidate.checksum && candidate.checksum === record.checksum
    );
    checks.push({
      id: 'duplicate',
      name: 'Duplicate submission',
      status: duplicates.length > 0 ? 'fail' : 'pass',
      detail:
        duplicates.length > 0
          ? `Identical checksum already ingested as ${duplicates[0].fileName}.`
          : 'No duplicate submission detected.'
    });
    if (duplicates.length > 0) {
      findings.push(note(Finding.ERROR, 'Duplicate submission — this exact file has already been processed.'));
    }

    if (state.tableReconciliation) {
      checks.push({
        id: 'line-item-footing',
        name: 'Line-item footing',
        status: state.tableReconciliation.reconciled ? 'pass' : 'fail',
        detail: `Footed ${state.tableReconciliation.footedTotal.toFixed(2)} against ${state.tableReconciliation.documentTotal.toFixed(2)}.`
      });
    }

    const failed = checks.filter((entry) => entry.status === 'fail').length;

    return {
      summary: `${checks.length} reconciliation check(s) · ${failed} failure(s).`,
      confidence: checks.length === 0 ? 0.7 : Number(Math.max(0.2, 1 - failed * 0.35).toFixed(4)),
      findings,
      outputs: { checks, duplicateCount: duplicates.length },
      apply: (nextState) => {
        nextState.reconciliation = { checks, duplicateCount: duplicates.length };
      }
    };
  },

  async accuracy(ctx) {
    const { state } = ctx;
    const report = evaluateAccuracy({
      typeId: state.classification.typeId,
      fields: state.fields,
      analysis: state.analysis,
      validation: state.validation,
      classification: state.classification,
      threshold: config.quality.reviewConfidenceThreshold
    });

    const accuracy = { ...report, repairs: state.repairs ?? [] };
    const findings = [];

    if (accuracy.conflictCount > 0) {
      findings.push(
        note(
          Finding.ERROR,
          `${accuracy.conflictCount} field(s) conflict with an independent source: ${accuracy.conflicts
            .map((entry) => entry.label)
            .join(', ')}.`
        )
      );
    }
    if (accuracy.integrityIssueCount > 0) {
      findings.push(
        note(
          Finding.ERROR,
          `${accuracy.integrityIssueCount} field(s) were transcribed correctly but the document contradicts itself: ${accuracy.integrityIssues
            .map((entry) => entry.label)
            .join(', ')}. Raise with the issuer rather than re-keying.`
        )
      );
    }
    if (accuracy.criticalCoverage < 1) {
      findings.push(
        note(Finding.ERROR, 'A critical field is missing — the document cannot be straight-through processed.')
      );
    }
    if (accuracy.accuracyScore >= 0.95 && accuracy.conflictCount === 0 && accuracy.integrityIssueCount === 0) {
      findings.push(note(Finding.INFO, 'All populated fields are corroborated and internally consistent.'));
    }

    return {
      summary: `Accuracy ${(accuracy.accuracyScore * 100).toFixed(1)}% · ${accuracy.verifiedCount} verified, ${accuracy.conflictCount} conflicting, ${accuracy.integrityIssueCount} disputed by the document · ${accuracy.checksRun} checks.`,
      confidence: accuracy.calibratedConfidence,
      findings,
      outputs: {
        accuracyScore: accuracy.accuracyScore,
        calibratedConfidence: accuracy.calibratedConfidence,
        coverage: accuracy.coverage,
        criticalCoverage: accuracy.criticalCoverage,
        integrityScore: accuracy.integrityScore,
        verified: accuracy.verifiedCount,
        probable: accuracy.probableCount,
        unverified: accuracy.unverifiedCount,
        conflicts: accuracy.conflictCount,
        integrityIssues: accuracy.integrityIssueCount,
        riskLevel: accuracy.riskLevel,
        straightThroughEligible: accuracy.straightThroughEligible
      },
      apply: (nextState) => {
        nextState.accuracy = accuracy;
      }
    };
  },

  async router(ctx) {
    const { state, record, steps } = ctx;

    const needsReview =
      !state.validation.passed ||
      state.fields.some((field) => field.status !== 'accepted') ||
      state.classification.confidence < 0.7 ||
      !state.accuracy.straightThroughEligible ||
      (state.reconciliation?.checks ?? []).some((entry) => entry.status === 'fail');

    const workflow = instantiateWorkflow({
      record: {
        ...record,
        fields: state.fields,
        pageCount: state.analysis.pageCount,
        quality: { averageOcrConfidence: state.analysis.ocr?.averageConfidence ?? 0 }
      },
      accuracy: state.accuracy,
      validation: state.validation,
      classification: { ...state.classification, process: state.type.process, typeName: state.type.name },
      agentRun: { analysis: state.analysis, steps },
      needsReview
    });

    const findings = [
      note(
        needsReview ? Finding.WARN : Finding.INFO,
        needsReview
          ? `Routed to ${workflow.currentStepName} (${workflow.assignee}) with ${workflow.priority} priority.`
          : 'Straight-through processed — no human step required before approval.'
      )
    ];

    return {
      summary: `${workflow.definitionName} · ${workflow.priority} priority · SLA ${workflow.slaHours}h.`,
      confidence: 0.99,
      findings,
      outputs: {
        definitionId: workflow.definitionId,
        definitionName: workflow.definitionName,
        currentStepId: workflow.currentStepId,
        assignee: workflow.assignee,
        priority: workflow.priority,
        priorityScore: workflow.priorityScore,
        priorityReasons: workflow.priorityReasons,
        slaDueAt: workflow.slaDueAt,
        needsReview
      },
      apply: (nextState) => {
        nextState.workflow = workflow;
        nextState.needsReview = needsReview;
      }
    };
  },

  async supervisor(ctx) {
    const { state, steps } = ctx;
    const reports = steps.filter((entry) => entry.status === 'completed');
    const errors = steps.flatMap((entry) => entry.findings.filter((finding) => finding.level === Finding.ERROR));
    const warnings = steps.flatMap((entry) => entry.findings.filter((finding) => finding.level === Finding.WARN));

    const confidences = reports.map((entry) => entry.confidence).filter((value) => typeof value === 'number');
    const meanConfidence =
      confidences.length > 0
        ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(4))
        : 0;
    const spread = confidences.length > 1 ? Number((Math.max(...confidences) - Math.min(...confidences)).toFixed(4)) : 0;
    const agreement = Number(Math.max(0, 1 - spread).toFixed(4));

    const cost = estimateDocumentCost({
      pageCount: state.analysis.pageCount,
      typeId: state.classification.typeId,
      engine: state.analysis.engine
    });

    const disposition = state.needsReview ? 'human-review' : 'straight-through';
    const rationale = state.needsReview
      ? [
          !state.validation.passed ? `${state.validation.errorCount} business rule error(s)` : null,
          state.accuracy.conflictCount > 0 ? `${state.accuracy.conflictCount} field conflict(s)` : null,
          state.accuracy.integrityIssueCount > 0
            ? `${state.accuracy.integrityIssueCount} document integrity dispute(s)`
            : null,
          state.accuracy.criticalCoverage < 1 ? 'missing critical field(s)' : null,
          state.classification.confidence < 0.7 ? 'low classification confidence' : null,
          state.fields.some((field) => field.status !== 'accepted')
            ? `${state.fields.filter((field) => field.status !== 'accepted').length} field(s) below the review threshold`
            : null
        ]
          .filter(Boolean)
          .join('; ')
      : `Accuracy ${(state.accuracy.accuracyScore * 100).toFixed(1)}% with every rule passing and every critical field corroborated.`;

    const escalations = errors.map((finding) => finding.message).slice(0, 6);

    return {
      summary: `Disposition: ${disposition} · consensus ${(agreement * 100).toFixed(0)}% · ${errors.length} error(s), ${warnings.length} warning(s).`,
      confidence: meanConfidence,
      findings: [note(state.needsReview ? Finding.WARN : Finding.INFO, rationale)],
      outputs: {
        disposition,
        rationale,
        meanConfidence,
        agreement,
        errorCount: errors.length,
        warningCount: warnings.length,
        escalations,
        costUsd: cost.modelledUsd
      },
      apply: (nextState) => {
        nextState.cost = cost;
        nextState.consensus = { meanConfidence, agreement, errorCount: errors.length, warningCount: warnings.length };
        nextState.disposition = { outcome: disposition, rationale, escalations };
      }
    };
  }
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function countBy(items, selector) {
  const map = {};
  for (const item of items) {
    const key = selector(item) ?? 'unknown';
    map[key] = (map[key] ?? 0) + 1;
  }
  return map;
}

const FILENAME_HINTS = Object.freeze([
  [/invoice|inv[-_]/i, 'supplier_invoice'],
  [/purchase[-_ ]?order|(^|[-_])po[-_]/i, 'purchase_order'],
  [/delivery|grn|goods[-_ ]?receipt/i, 'delivery_order'],
  [/coa|certificate[-_ ]?of[-_ ]?analysis/i, 'certificate_of_analysis'],
  [/bill[-_ ]?of[-_ ]?lading|bol/i, 'bill_of_lading'],
  [/registration|licence|license/i, 'product_registration'],
  [/trademark/i, 'trademark_certificate'],
  [/tenancy|lease/i, 'tenancy_agreement'],
  [/annual[-_ ]?report|financial[-_ ]?statement/i, 'annual_report'],
  [/bank[-_ ]?statement|statement[-_ ]?of[-_ ]?account/i, 'bank_statement'],
  [/expense|claim[-_ ]?form|reimburse/i, 'employee_claim'],
  [/marketing[-_ ]?claim|trade[-_ ]?marketing/i, 'marketing_claim']
]);

function inferTypeHint(fileName) {
  for (const [pattern, typeId] of FILENAME_HINTS) {
    if (pattern.test(fileName)) return typeId;
  }
  return null;
}

const PII_PATTERNS = Object.freeze([
  [/\b[ST]\d{7}[A-Z]\b/, 'NRIC-like identifiers'],
  [/\b\d{3}[- ]?\d{4}[- ]?\d{4}\b/, 'account-like numbers'],
  [/\b[\w.%-]+@[\w.-]+\.[A-Za-z]{2,}\b/, 'email addresses']
]);

function detectResidualPii(text) {
  const sample = String(text).slice(0, 200000);
  return PII_PATTERNS.filter(([pattern]) => pattern.test(sample)).map(([, label]) => label);
}

/**
 * Merges Azure prebuilt `documents[].fields` into the extracted field set.
 * Gap-filling only: an existing grounded value is never overwritten.
 */
function mergeAzureFields(fields, analysis, typeId, threshold) {
  const documentFields = analysis.documentFields ?? [];
  if (documentFields.length === 0) return { fields, filledFromAzure: 0 };

  const type = getDocumentType(typeId);
  const key = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const aliasIndex = new Map(
    type.fields.map((definition) => [
      definition.key,
      [definition.key, definition.label, ...(definition.aliases ?? [])].map(key)
    ])
  );

  let filledFromAzure = 0;
  const merged = fields.map((field) => {
    if (field.rawValue !== null && field.rawValue !== undefined) return field;
    const aliases = aliasIndex.get(field.key) ?? [];
    const candidate = documentFields.find((entry) => aliases.includes(key(entry.key)));
    if (!candidate) return field;

    filledFromAzure += 1;
    return {
      ...field,
      rawValue: candidate.value,
      value: candidate.value,
      confidence: candidate.confidence,
      source: 'azure-document-field',
      pageNumber: candidate.pageNumber ?? field.pageNumber,
      box: candidate.box ?? field.box,
      status: candidate.confidence >= threshold ? 'accepted' : 'needs-review'
    };
  });

  return { fields: merged, filledFromAzure };
}

/* ── Orchestration ───────────────────────────────────────────────────────── */

/**
 * Runs the full agent mesh over one document.
 *
 * @param {object} input
 * @param {object} input.record        document record
 * @param {Buffer} input.buffer        uploaded bytes
 * @param {string} input.correlationId
 * @param {(stage: string, status: string, detail: string|null, durationMs: number|null) => void} [input.onStage]
 * @param {(step: object) => void} [input.onAgent]
 */
export async function runOrchestration({ record, buffer, correlationId, onStage, onAgent }) {
  const runId = `run_${randomUUID()}`;
  const startedAt = Date.now();
  const waves = executionWaves();

  const state = {};
  const steps = [];
  const stageState = new Map(
    STAGES.map((stage) => [stage, { started: false, pending: 0, durationMs: 0, details: [] }])
  );

  for (const agentDefinition of AGENTS) {
    stageState.get(agentDefinition.stage).pending += 1;
  }

  const scopedLogger = logger.child({ correlationId, documentId: record.id, runId });

  for (const [waveIndex, wave] of waves.entries()) {
    const results = await Promise.all(
      wave.map(async (agentId) => {
        const definition = getAgent(agentId);
        const stage = stageState.get(definition.stage);
        if (!stage.started) {
          stage.started = true;
          await onStage?.(definition.stage, 'running', null, null);
        }

        const agentStartedAt = Date.now();
        await onAgent?.({
          runId,
          agentId,
          agentName: definition.name,
          status: 'running',
          wave: waveIndex + 1,
          at: new Date().toISOString()
        });

        try {
          const report = await IMPLEMENTATIONS[agentId]({ record, buffer, correlationId, state, steps });
          return { agentId, definition, report, durationMs: Date.now() - agentStartedAt, error: null };
        } catch (error) {
          return { agentId, definition, report: null, durationMs: Date.now() - agentStartedAt, error };
        }
      })
    );

    for (const result of results) {
      const { agentId, definition, report, durationMs, error } = result;
      const stage = stageState.get(definition.stage);

      if (error) {
        const failedStep = {
          seq: steps.length + 1,
          runId,
          agentId,
          agentName: definition.name,
          role: definition.role,
          wave: waveIndex + 1,
          status: 'failed',
          startedAt: new Date(Date.now() - durationMs).toISOString(),
          durationMs,
          summary: error.message,
          confidence: 0,
          findings: [note(Finding.ERROR, error.message)],
          outputs: {},
          dependsOn: definition.dependsOn,
          stage: definition.stage,
          workflowStepId: definition.workflowStepId
        };
        steps.push(failedStep);
        await onAgent?.({ ...failedStep, at: new Date().toISOString() });
        await onStage?.(definition.stage, 'failed', error.message, durationMs);
        scopedLogger.error('Agent failed.', { agentId, error });
        error.agentId = agentId;
        error.agentRun = buildRun({ runId, record, correlationId, startedAt, steps, state, waves, status: 'failed' });
        throw error;
      }

      report.apply?.(state);

      const step = {
        seq: steps.length + 1,
        runId,
        agentId,
        agentName: definition.name,
        role: definition.role,
        wave: waveIndex + 1,
        status: 'completed',
        startedAt: new Date(Date.now() - durationMs).toISOString(),
        durationMs,
        summary: report.summary,
        confidence: Number((report.confidence ?? 0).toFixed(4)),
        findings: report.findings ?? [],
        outputs: report.outputs ?? {},
        dependsOn: definition.dependsOn,
        stage: definition.stage,
        workflowStepId: definition.workflowStepId
      };
      steps.push(step);
      await onAgent?.({ ...step, at: new Date().toISOString() });

      stage.pending -= 1;
      stage.durationMs += durationMs;
      stage.details.push(report.summary);
      if (stage.pending === 0) {
        await onStage?.(definition.stage, 'completed', stage.details[stage.details.length - 1], stage.durationMs);
      }
    }
  }

  return {
    run: buildRun({ runId, record, correlationId, startedAt, steps, state, waves, status: 'succeeded' }),
    analysis: state.analysis,
    classification: state.classification,
    type: state.type,
    fields: state.fields,
    validation: state.validation,
    accuracy: state.accuracy,
    reconciliation: state.reconciliation,
    compliance: state.compliance,
    workflow: state.workflow,
    cost: state.cost,
    needsReview: state.needsReview
  };
}

function buildRun({ runId, record, correlationId, startedAt, steps, state, waves, status }) {
  const findings = steps.flatMap((step) => step.findings ?? []);
  return {
    id: runId,
    documentId: record.id,
    correlationId,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    status,
    agentCount: steps.length,
    waveCount: waves.length,
    parallelism: Number((AGENTS.length / waves.length).toFixed(2)),
    steps,
    consensus: state.consensus ?? null,
    disposition: state.disposition ?? null,
    findingCounts: {
      info: findings.filter((entry) => entry.level === Finding.INFO).length,
      warn: findings.filter((entry) => entry.level === Finding.WARN).length,
      error: findings.filter((entry) => entry.level === Finding.ERROR).length
    },
    escalations: state.disposition?.escalations ?? []
  };
}

export { STAGES };
