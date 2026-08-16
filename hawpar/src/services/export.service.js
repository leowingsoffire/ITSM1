/**
 * Export service — JSON, CSV and XLSX renditions of the extracted data.
 *
 * CSV output is guarded against formula injection (a field beginning with
 * =, +, - or @ is prefixed with an apostrophe) because these files are opened
 * directly in Excel by finance users.
 */
import { buildWorkbook } from '../lib/xlsx.js';
import { DOCUMENT_TYPES, RULE_CATALOGUE } from '../domain/documentTypes.js';
import { listAllDocuments } from './store.service.js';
import { listClaims, getClaim } from './claims.service.js';

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function fieldValueForExport(field) {
  if (field.value === null || field.value === undefined) return field.rawValue ?? '';
  return field.value;
}

/** Flat, one-row-per-field extract — the shape finance teams reconcile against. */
export function buildFieldRows(records) {
  const rows = [
    [
      'Document ID',
      'File Name',
      'Document Type',
      'Business Unit',
      'Process',
      'Pages',
      'Status',
      'Field',
      'Value',
      'Raw OCR Value',
      'Data Type',
      'Critical',
      'Confidence',
      'Field Status',
      'Source',
      'Page',
      'Human Edited',
      'Processed At'
    ]
  ];

  for (const record of records) {
    if (record.fields.length === 0) {
      rows.push([
        record.id,
        record.fileName,
        record.classification?.typeName ?? 'Unclassified',
        record.classification?.businessUnit ?? '',
        record.classification?.process ?? '',
        record.pageCount ?? 0,
        record.status,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        record.completedAt ?? ''
      ]);
      continue;
    }
    for (const field of record.fields) {
      rows.push([
        record.id,
        record.fileName,
        record.classification?.typeName ?? 'Unclassified',
        record.classification?.businessUnit ?? '',
        record.classification?.process ?? '',
        record.pageCount ?? 0,
        record.status,
        field.label,
        fieldValueForExport(field),
        field.rawValue ?? '',
        field.type,
        field.critical ? 'Yes' : 'No',
        field.confidence,
        field.status,
        field.source,
        field.pageNumber ?? '',
        field.edited ? 'Yes' : 'No',
        record.completedAt ?? ''
      ]);
    }
  }
  return rows;
}

/** One row per document — the executive/reporting view. */
export function buildDocumentRows(records) {
  const rows = [
    [
      'Document ID',
      'File Name',
      'Document Type',
      'Business Unit',
      'Process',
      'Status',
      'Pages',
      'Engine',
      'Model',
      'Classification Confidence',
      'Avg Field Confidence',
      'OCR Confidence',
      'Fields Extracted',
      'Fields To Review',
      'Validation Errors',
      'Validation Warnings',
      'Processing Seconds',
      'Azure Cost (USD)',
      'Manual Baseline (SGD)',
      'Uploaded At',
      'Completed At'
    ]
  ];

  for (const record of records) {
    const scored = record.fields.filter((field) => field.confidence > 0);
    rows.push([
      record.id,
      record.fileName,
      record.classification?.typeName ?? 'Unclassified',
      record.classification?.businessUnit ?? '',
      record.classification?.process ?? '',
      record.status,
      record.pageCount ?? 0,
      record.engine ?? '',
      record.modelId ?? '',
      record.classification?.confidence ?? '',
      scored.length > 0
        ? Number((scored.reduce((sum, field) => sum + field.confidence, 0) / scored.length).toFixed(4))
        : '',
      record.quality?.averageOcrConfidence ?? '',
      record.fields.length,
      record.fields.filter((field) => field.status !== 'accepted').length,
      record.validation?.errorCount ?? 0,
      record.validation?.warningCount ?? 0,
      record.durationMs ? Number((record.durationMs / 1000).toFixed(2)) : '',
      record.cost?.estimatedUsd ?? 0,
      record.cost?.manualCostSgd ?? 0,
      record.uploadedAt,
      record.completedAt ?? ''
    ]);
  }
  return rows;
}

function buildIssueRows(records) {
  const rows = [['Document ID', 'File Name', 'Document Type', 'Rule', 'Severity', 'Message', 'Rule Description', 'Fields']];
  for (const record of records) {
    for (const issue of record.validation?.issues ?? []) {
      rows.push([
        record.id,
        record.fileName,
        record.classification?.typeName ?? '',
        issue.rule,
        issue.severity,
        issue.message,
        issue.description,
        (issue.fieldKeys ?? []).join(', ')
      ]);
    }
  }
  return rows.length > 1 ? rows : [...rows, ['—', 'No validation issues raised', '', '', '', '', '', '']];
}

function buildTableRows(record) {
  const sheets = [];
  for (const table of record.tables ?? []) {
    sheets.push({
      name: `${table.title}`.slice(0, 28),
      rows: [table.columns, ...table.rows]
    });
  }
  return sheets;
}

function buildRequirementsRows() {
  const rows = [['Ref', 'Requirement', 'Category', 'Priority', 'Status', 'Delivered By']];
  REQUIREMENTS.forEach((requirement, index) => {
    rows.push([
      `REQ-${String(index + 1).padStart(3, '0')}`,
      requirement.requirement,
      requirement.category,
      requirement.priority,
      requirement.status,
      requirement.deliveredBy
    ]);
  });
  return rows;
}

export const REQUIREMENTS = Object.freeze([
  { requirement: 'Ingest documents exceeding 100 pages without splitting or manual intervention', category: 'Ingestion', priority: 'Must', status: 'Delivered', deliveredBy: 'Pipeline + Azure DI long-running operation polling (up to 2,000 pages)' },
  { requirement: 'Support mixed layouts and formats (PDF, scans, images, Office files)', category: 'Ingestion', priority: 'Must', status: 'Delivered', deliveredBy: 'MIME + magic-byte allow-list covering 9 formats' },
  { requirement: 'Batch upload of multiple documents at once', category: 'Ingestion', priority: 'Must', status: 'Delivered', deliveredBy: 'Multi-file upload, batch tracking, bounded-concurrency worker pool' },
  { requirement: 'Automatically identify the document type and route to the owning business process', category: 'Classification', priority: 'Must', status: 'Delivered', deliveredBy: 'Explainable weighted-evidence classifier across 11 VGC document types' },
  { requirement: 'Extract structured business fields with per-field confidence', category: 'Extraction', priority: 'Must', status: 'Delivered', deliveredBy: 'Four-layer extractor: exact KV, fuzzy KV, regex, table binding' },
  { requirement: 'Extract tables (line items, QC results, transactions) preserving row/column structure', category: 'Extraction', priority: 'Must', status: 'Delivered', deliveredBy: 'Azure DI Layout table model normalised into a typed grid' },
  { requirement: 'Detect handwriting, multiple languages and poor-quality scans', category: 'Extraction', priority: 'Should', status: 'Delivered', deliveredBy: 'Quality panel: handwriting ratio, language detection, degraded-page list' },
  { requirement: 'Apply business validation rules and raise exceptions', category: 'Validation', priority: 'Must', status: 'Delivered', deliveredBy: '26 configurable rules incl. GST, three-way match, QC spec, balance-sheet ties' },
  { requirement: 'Route low-confidence results to a human review queue with prioritisation', category: 'Review', priority: 'Must', status: 'Delivered', deliveredBy: 'Priority-scored review queue and side-by-side verification workspace' },
  { requirement: 'Allow reviewers to correct values with full audit trail', category: 'Review', priority: 'Must', status: 'Delivered', deliveredBy: 'Inline field correction, approve/reject actions, immutable audit log' },
  { requirement: 'Full-text search across all processed documents', category: 'Search', priority: 'Should', status: 'Delivered', deliveredBy: 'Corpus-wide search with page-anchored snippets' },
  { requirement: 'Export extracted data to Excel, CSV and JSON for downstream systems', category: 'Integration', priority: 'Must', status: 'Delivered', deliveredBy: 'Multi-sheet XLSX, injection-safe CSV, and JSON API' },
  { requirement: 'Expose a REST API for ERP / RPA integration', category: 'Integration', priority: 'Should', status: 'Delivered', deliveredBy: '20+ documented JSON endpoints with API-key authentication' },
  { requirement: 'Provide operational dashboards (volume, STP rate, exceptions, quality)', category: 'Reporting', priority: 'Must', status: 'Delivered', deliveredBy: 'Live command centre with throughput, quality and exception analytics' },
  { requirement: 'Demonstrate measurable cost effectiveness versus manual processing', category: 'Commercial', priority: 'Must', status: 'Delivered', deliveredBy: 'Adaptive Read/Layout model routing plus an interactive TCO calculator' },
  { requirement: 'Protect personal and financial data (PDPA)', category: 'Security', priority: 'Must', status: 'Delivered', deliveredBy: 'Field masking at rest, log redaction, managed identity, no secrets in code' },
  { requirement: 'Deployable to Azure at low cost with infrastructure as code', category: 'Deployment', priority: 'Must', status: 'Delivered', deliveredBy: 'Bicep template: App Service B1 + Document Intelligence S0 + Key Vault + Monitor' }
]);

/** @returns {{buffer: Buffer, fileName: string, contentType: string}} */
export function exportCorpusWorkbook() {
  const records = listAllDocuments().filter((record) => record.fields.length > 0 || record.status === 'failed');
  const dateStamp = new Date().toISOString().slice(0, 10);

  const typeRows = [['Type ID', 'Document Type', 'Business Unit', 'Process', 'Fields', 'Validation Rules', 'Typical Pages']];
  for (const type of DOCUMENT_TYPES) {
    if (type.id === 'unclassified') continue;
    typeRows.push([
      type.id,
      type.name,
      type.businessUnit,
      type.process,
      type.fields.length,
      type.rules.length,
      `${type.typicalPages[0]}–${type.typicalPages[1]}`
    ]);
  }

  const ruleRows = [['Rule ID', 'Description']];
  for (const [rule, description] of Object.entries(RULE_CATALOGUE)) ruleRows.push([rule, description]);

  const workbook = buildWorkbook([
    { name: 'Requirements', rows: buildRequirementsRows() },
    { name: 'Documents', rows: buildDocumentRows(records) },
    { name: 'Extracted Fields', rows: buildFieldRows(records) },
    { name: 'Validation Issues', rows: buildIssueRows(records) },
    { name: 'Document Types', rows: typeRows },
    { name: 'Business Rules', rows: ruleRows }
  ]);

  return {
    buffer: workbook,
    fileName: `VGC-OCR-AI-OCR-Extract-${dateStamp}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
}

/** @param {object} record */
export function exportDocumentWorkbook(record) {
  const summaryRows = [
    ['Attribute', 'Value'],
    ['Document ID', record.id],
    ['File Name', record.fileName],
    ['Document Type', record.classification?.typeName ?? 'Unclassified'],
    ['Business Unit', record.classification?.businessUnit ?? ''],
    ['Owning Process', record.classification?.process ?? ''],
    ['Status', record.status],
    ['Pages', record.pageCount ?? 0],
    ['Analysis Engine', record.engine ?? ''],
    ['Model', record.modelId ?? ''],
    ['Classification Confidence', record.classification?.confidence ?? ''],
    ['OCR Confidence', record.quality?.averageOcrConfidence ?? ''],
    ['Validation Errors', record.validation?.errorCount ?? 0],
    ['Validation Warnings', record.validation?.warningCount ?? 0],
    ['Processing Seconds', record.durationMs ? Number((record.durationMs / 1000).toFixed(2)) : ''],
    ['Azure Cost (USD)', record.cost?.estimatedUsd ?? 0],
    ['Manual Baseline (SGD)', record.cost?.manualCostSgd ?? 0],
    ['Uploaded At', record.uploadedAt],
    ['Completed At', record.completedAt ?? '']
  ];

  const auditRows = [['Timestamp', 'Actor', 'Action', 'Detail']];
  for (const entry of record.audit ?? []) auditRows.push([entry.at, entry.actor, entry.action, entry.detail]);

  const workbook = buildWorkbook([
    { name: 'Summary', rows: summaryRows },
    { name: 'Fields', rows: buildFieldRows([record]) },
    { name: 'Validation', rows: buildIssueRows([record]) },
    ...buildTableRows(record),
    { name: 'Audit Trail', rows: auditRows }
  ]);

  const safeName = record.fileName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.[^.]+$/, '');
  return {
    buffer: workbook,
    fileName: `${safeName}-extract.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
}

export function exportCorpusCsv() {
  const records = listAllDocuments().filter((record) => record.fields.length > 0);
  return {
    body: toCsv(buildFieldRows(records)),
    fileName: `VGC-OCR-AI-OCR-Fields-${new Date().toISOString().slice(0, 10)}.csv`,
    contentType: 'text/csv; charset=utf-8'
  };
}

export function exportRequirementsWorkbook() {
  const workbook = buildWorkbook([{ name: 'Requirements Traceability', rows: buildRequirementsRows() }]);
  return {
    buffer: workbook,
    fileName: 'VGC-OCR-AI-OCR-Requirements-Traceability.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
}

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const numberOrBlank = (value) => (value === null || value === undefined ? '' : value);

function buildClaimsSummaryRows(claims) {
  const rows = [
    [
      'Claim ID',
      'Claim Number',
      'Distributor',
      'A&P Code',
      'A&P Category',
      'Campaign',
      'Claim Date',
      'Currency',
      'Claim Amount',
      'Supporting Total',
      'Variance',
      'Supporting Docs',
      'Reconciliation',
      'Errors',
      'Warnings',
      'Exceptions'
    ]
  ];
  for (const claim of claims) {
    rows.push([
      claim.id,
      claim.claimNumber ?? '',
      claim.distributor ?? '',
      claim.apCode ?? '',
      claim.apCodeName ?? '',
      claim.campaign ?? '',
      claim.claimDate ?? '',
      claim.currency ?? '',
      numberOrBlank(claim.claimAmount),
      numberOrBlank(claim.supportTotal),
      numberOrBlank(claim.amountVariance),
      claim.supportingCount,
      claim.reconciliationStatus === 'review' ? 'Needs review' : 'Clear',
      claim.errorCount,
      claim.warningCount,
      claim.exceptionCount
    ]);
  }
  return rows;
}

/** Corpus-wide claims export. @returns {{buffer: Buffer, fileName: string, contentType: string}} */
export function exportClaimsWorkbook() {
  const claims = listClaims();
  const dateStamp = new Date().toISOString().slice(0, 10);

  const checkRows = [['Claim Number', 'A&P Code', 'Check', 'Severity', 'Result', 'Message']];
  for (const summary of claims) {
    const detail = getClaim(summary.id);
    if (!detail) continue;
    for (const item of detail.reconciliation.checks) {
      checkRows.push([
        summary.claimNumber ?? summary.id,
        summary.apCode ?? '',
        item.label,
        item.severity,
        item.status === 'fail' ? 'Fail' : item.status === 'pass' ? 'Pass' : 'Info',
        item.message
      ]);
    }
  }

  const workbook = buildWorkbook([
    { name: 'Claims', rows: buildClaimsSummaryRows(claims) },
    { name: 'Reconciliation Checks', rows: checkRows }
  ]);

  return {
    buffer: workbook,
    fileName: `VGC-OCR-Marketing-Claims-${dateStamp}.xlsx`,
    contentType: XLSX_CONTENT_TYPE
  };
}

/** Single-claim reconciliation export. @param {string} claimId */
export function exportClaimWorkbook(claimId) {
  const detail = getClaim(claimId);
  if (!detail) return null;
  const { summary, claim, supportingDocuments, reconciliation } = detail;
  const currency = reconciliation.currency ?? summary.currency ?? '';

  const summaryRows = [
    ['Attribute', 'Value'],
    ['Claim Number', summary.claimNumber ?? ''],
    ['Distributor', summary.distributor ?? ''],
    ['A&P Code', summary.apCode ?? ''],
    ['A&P Category', summary.apCodeName ?? ''],
    ['Campaign', summary.campaign ?? ''],
    ['Claim Date', summary.claimDate ?? ''],
    ['Currency', currency],
    ['Claim Amount', numberOrBlank(summary.claimAmount)],
    ['Supporting Total', numberOrBlank(summary.supportTotal)],
    ['Variance', numberOrBlank(summary.amountVariance)],
    ['Supporting Documents', summary.supportingCount],
    ['Reconciliation Status', summary.reconciliationStatus === 'review' ? 'Needs review' : 'Clear'],
    ['Errors', summary.errorCount],
    ['Warnings', summary.warningCount]
  ];

  const checkRows = [['Check', 'Severity', 'Result', 'Message', 'Description']];
  for (const item of reconciliation.checks) {
    checkRows.push([
      item.label,
      item.severity,
      item.status === 'fail' ? 'Fail' : item.status === 'pass' ? 'Pass' : 'Info',
      item.message,
      item.description ?? ''
    ]);
  }

  const supportRows = [['Document', 'Kind', 'Vendor', 'Reference', 'Product', 'Date', `Amount (${currency || 'CUR'})`, 'A&P Code', 'A&P Match']];
  for (const support of supportingDocuments) {
    supportRows.push([
      support.fileName,
      support.documentKind ?? '',
      support.vendor ?? '',
      support.reference ?? '',
      support.productType ?? '',
      support.documentDate ?? '',
      numberOrBlank(support.amount),
      support.apCode ?? '',
      support.apCodeMatches ? 'Yes' : 'No'
    ]);
  }

  // Per-invoice line comparison: page-one summary vs the actual attachment.
  const lineRows = [
    ['Vendor', 'Invoice Ref', 'Product', 'Summary Date', 'Attachment Date', 'Date OK', `Summary Amount (${currency || 'CUR'})`, `Attachment Amount (${currency || 'CUR'})`, 'Amount OK', 'Mark-up']
  ];
  for (const line of reconciliation.lineComparison ?? []) {
    lineRows.push([
      line.vendor ?? '',
      line.invoiceRef ?? '',
      line.productType ?? '',
      line.summaryDate ?? '',
      line.attachmentDate ?? '',
      line.dateOk === null ? 'n/a' : line.dateOk ? 'Yes' : 'No',
      numberOrBlank(line.summaryAmount),
      numberOrBlank(line.attachmentAmount),
      line.amountOk === null ? 'n/a' : line.amountOk ? 'Yes' : 'No',
      line.annotation ?? ''
    ]);
  }

  // Product-type summation: page-one subtotal vs highlighted attachment lines.
  const summationRows = [
    ['Product Type', `Page-One Subtotal (${currency || 'CUR'})`, `Highlighted Lines (${currency || 'CUR'})`, 'Variance', 'Result']
  ];
  for (const row of reconciliation.productSummation ?? []) {
    summationRows.push([
      row.productType,
      numberOrBlank(row.stated),
      numberOrBlank(row.actual),
      numberOrBlank(row.delta),
      row.status === 'ok' ? 'Match' : row.status === 'mismatch' ? 'Mismatch' : 'Unverified'
    ]);
  }

  const fieldRows = [['Field', 'Value', 'Raw OCR Value', 'Type', 'Confidence']];
  for (const field of claim.fields) {
    fieldRows.push([
      field.label,
      field.value ?? '',
      field.rawValue ?? '',
      field.type,
      numberOrBlank(field.confidence)
    ]);
  }

  const sheets = [
    { name: 'Claim Summary', rows: summaryRows },
    { name: 'Reconciliation Checks', rows: checkRows },
    { name: 'Line Comparison', rows: lineRows }
  ];
  if (summationRows.length > 1) sheets.push({ name: 'Product Type Summation', rows: summationRows });

  // A&P annual budget consumption.
  if (reconciliation.budget) {
    const b = reconciliation.budget;
    sheets.push({
      name: 'A&P Budget',
      rows: [
        ['Attribute', 'Value'],
        ['A&P Code', b.code],
        ['Category', b.name],
        ['Budget Currency', b.currency],
        ['Annual Budget', numberOrBlank(b.annualBudget)],
        ['Spent To Date', numberOrBlank(b.spentToDate)],
        ['Remaining', numberOrBlank(b.remaining)],
        ['Utilisation', b.utilisation !== undefined ? `${(b.utilisation * 100).toFixed(1)}%` : ''],
        ['Claim Currency', b.claimCurrency ?? ''],
        ['Claim Amount', numberOrBlank(b.claimAmount)]
      ]
    });
  }

  sheets.push({ name: 'Supporting Documents', rows: supportRows });
  sheets.push({ name: 'Claim Fields', rows: fieldRows });

  const workbook = buildWorkbook(sheets);

  const safeName = (summary.claimNumber ?? claim.id).replace(/[^A-Za-z0-9._-]+/g, '_');
  return {
    buffer: workbook,
    fileName: `${safeName}-reconciliation.xlsx`,
    contentType: XLSX_CONTENT_TYPE
  };
}
