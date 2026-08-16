/**
 * Azure AI Document Intelligence model & capability catalogue.
 *
 * This is reference metadata for the models and add-on capabilities the
 * platform can drive against a Document Intelligence resource (REST API
 * `2024-11-30`, the v4.0 GA surface). It powers:
 *
 *  - the Document Intelligence agent's model-routing decision,
 *  - the Azure integration console in the SPA,
 *  - cost modelling (per-page tier of the selected model).
 *
 * Nothing here calls Azure; it only describes what the platform is prepared to
 * call. Live model discovery is handled by `services/azure/docint.client.js`,
 * which lists the models that actually exist on the configured resource.
 */

export const AzureTier = Object.freeze({
  READ: 'read',
  LAYOUT: 'layout',
  PREBUILT: 'prebuilt',
  CUSTOM: 'custom',
  CLASSIFIER: 'classifier'
});

/**
 * Output shapes an analyser can return. Used by the orchestrator to decide
 * whether a model can satisfy a document type's extraction contract.
 */
export const AzureOutput = Object.freeze({
  TEXT: 'text',
  PARAGRAPHS: 'paragraphs',
  TABLES: 'tables',
  KEY_VALUE_PAIRS: 'keyValuePairs',
  SELECTION_MARKS: 'selectionMarks',
  DOCUMENT_FIELDS: 'documentFields',
  STYLES: 'styles',
  LANGUAGES: 'languages',
  FIGURES: 'figures'
});

const model = (id, options) =>
  Object.freeze({
    id,
    name: options.name,
    tier: options.tier,
    description: options.description,
    outputs: Object.freeze(options.outputs),
    pricePerThousandPages: options.pricePerThousandPages,
    apiVersion: options.apiVersion ?? '2024-11-30',
    documentTypes: Object.freeze(options.documentTypes ?? []),
    recommendedFor: options.recommendedFor ?? '',
    supportsAddOns: options.supportsAddOns !== false
  });

/**
 * The models the platform knows how to route to, cheapest first.
 * `documentTypes` maps a model onto the platform taxonomy so the routing agent
 * can explain *why* a model was chosen.
 */
export const AZURE_MODELS = Object.freeze([
  model('prebuilt-read', {
    name: 'Read (OCR)',
    tier: AzureTier.READ,
    description:
      'Text extraction, reading order, language detection and handwriting styles. The cheapest way to turn long, text-centric documents into searchable, structured text.',
    outputs: [AzureOutput.TEXT, AzureOutput.PARAGRAPHS, AzureOutput.STYLES, AzureOutput.LANGUAGES],
    pricePerThousandPages: 1.5,
    documentTypes: [
      'annual_report',
      'tenancy_agreement',
      'product_registration',
      'trademark_certificate',
      'bill_of_lading'
    ],
    recommendedFor: 'Long-form documents where tables are not the payload.'
  }),
  model('prebuilt-layout', {
    name: 'Layout',
    tier: AzureTier.LAYOUT,
    description:
      'Everything Read returns plus tables, selection marks, section hierarchy and — with the keyValuePairs add-on — labelled field pairs. The workhorse for structured business documents.',
    outputs: [
      AzureOutput.TEXT,
      AzureOutput.PARAGRAPHS,
      AzureOutput.TABLES,
      AzureOutput.SELECTION_MARKS,
      AzureOutput.KEY_VALUE_PAIRS,
      AzureOutput.STYLES,
      AzureOutput.LANGUAGES,
      AzureOutput.FIGURES
    ],
    pricePerThousandPages: 10,
    documentTypes: [
      'supplier_invoice',
      'purchase_order',
      'delivery_order',
      'certificate_of_analysis',
      'bank_statement',
      'employee_claim',
      'marketing_claim',
      'marketing_support'
    ],
    recommendedFor: 'Documents whose value is in tables and labelled fields.'
  }),
  model('prebuilt-invoice', {
    name: 'Invoice (domain)',
    tier: AzureTier.PREBUILT,
    description:
      'Domain model returning typed invoice fields (vendor, customer, totals, tax, line items) as `documents[].fields` with per-field confidence.',
    outputs: [
      AzureOutput.TEXT,
      AzureOutput.TABLES,
      AzureOutput.DOCUMENT_FIELDS,
      AzureOutput.KEY_VALUE_PAIRS
    ],
    pricePerThousandPages: 10,
    documentTypes: ['supplier_invoice'],
    recommendedFor: 'Second-opinion verification of invoice totals and vendor identity.'
  }),
  model('prebuilt-receipt', {
    name: 'Receipt (domain)',
    tier: AzureTier.PREBUILT,
    description: 'Domain model for retail receipts: merchant, transaction date, items, tax and total.',
    outputs: [AzureOutput.TEXT, AzureOutput.DOCUMENT_FIELDS],
    pricePerThousandPages: 10,
    documentTypes: ['employee_claim'],
    recommendedFor: 'Expense claim receipts attached to a staff reimbursement.'
  }),
  model('prebuilt-idDocument', {
    name: 'ID Document (domain)',
    tier: AzureTier.PREBUILT,
    description: 'Passports and identity cards. Returns identity fields with confidence and validity dates.',
    outputs: [AzureOutput.TEXT, AzureOutput.DOCUMENT_FIELDS],
    pricePerThousandPages: 10,
    documentTypes: [],
    recommendedFor: 'Identity verification packs — disabled by default under PDPA minimisation.'
  }),
  model('prebuilt-contract', {
    name: 'Contract (domain)',
    tier: AzureTier.PREBUILT,
    description: 'Domain model for contracts: parties, jurisdictions, execution and effective dates.',
    outputs: [AzureOutput.TEXT, AzureOutput.DOCUMENT_FIELDS, AzureOutput.PARAGRAPHS],
    pricePerThousandPages: 10,
    documentTypes: ['tenancy_agreement'],
    recommendedFor: 'Lease and agreement party/date verification.'
  }),
  model('prebuilt-documentClassifier', {
    name: 'Custom classifier',
    tier: AzureTier.CLASSIFIER,
    description:
      'Custom document classifier trained on your own corpus. Splits multi-document files and returns a type per segment.',
    outputs: [AzureOutput.TEXT],
    pricePerThousandPages: 3,
    documentTypes: [],
    recommendedFor: 'Mixed scan batches that need splitting before analysis.',
    supportsAddOns: false
  }),
  model('custom-neural', {
    name: 'Custom neural extraction',
    tier: AzureTier.CUSTOM,
    description:
      'Customer-trained neural extraction model for layouts the prebuilt models do not cover. Highest per-page cost; used only where the explainable local rules cannot reach the accuracy target.',
    outputs: [AzureOutput.TEXT, AzureOutput.DOCUMENT_FIELDS, AzureOutput.TABLES],
    pricePerThousandPages: 50,
    documentTypes: [],
    recommendedFor: 'Bespoke layouts after a measured accuracy shortfall.'
  })
]);

/**
 * Add-on capabilities requested through the `features` query parameter.
 * Each one is billed on top of the base model, so the platform enables them
 * per document type rather than globally.
 */
export const AZURE_ADD_ONS = Object.freeze([
  Object.freeze({
    id: 'ocr.highResolution',
    name: 'High-resolution OCR',
    description: 'Improves recognition of small print — footnotes, dense tables and stamp text on scans.',
    appliesTo: ['certificate_of_analysis', 'bank_statement', 'annual_report'],
    billed: true
  }),
  Object.freeze({
    id: 'ocr.formula',
    name: 'Formula extraction',
    description: 'Extracts mathematical expressions found in specification and QC documents.',
    appliesTo: ['certificate_of_analysis'],
    billed: true
  }),
  Object.freeze({
    id: 'barcodes',
    name: 'Barcode & QR extraction',
    description: 'Reads barcodes and QR codes — batch labels, container seals and payment codes.',
    appliesTo: ['delivery_order', 'bill_of_lading', 'certificate_of_analysis'],
    billed: true
  }),
  Object.freeze({
    id: 'ocr.font',
    name: 'Font & style detection',
    description: 'Reports font weight, style and colour, used to detect handwritten annotations on printed forms.',
    appliesTo: ['employee_claim'],
    billed: true
  }),
  Object.freeze({
    id: 'languages',
    name: 'Language detection',
    description: 'Per-span language detection for the multilingual export corpus.',
    appliesTo: ['bill_of_lading', 'product_registration'],
    billed: true
  }),
  Object.freeze({
    id: 'keyValuePairs',
    name: 'Key-value pairs',
    description: 'Returns labelled field pairs from Layout, which the extraction agent binds to business fields.',
    appliesTo: [
      'supplier_invoice',
      'purchase_order',
      'delivery_order',
      'certificate_of_analysis',
      'bank_statement',
      'employee_claim',
      'marketing_claim',
      'marketing_support'
    ],
    billed: true
  }),
  Object.freeze({
    id: 'queryFields',
    name: 'Query fields',
    description:
      'Asks the service for named values that are not part of a prebuilt schema, e.g. "TotalPayable" or "BatchNumber".',
    appliesTo: ['marketing_claim', 'marketing_support'],
    billed: true
  })
]);

const MODEL_INDEX = new Map(AZURE_MODELS.map((entry) => [entry.id, entry]));
const ADD_ON_INDEX = new Map(AZURE_ADD_ONS.map((entry) => [entry.id, entry]));

export function getAzureModel(modelId) {
  return MODEL_INDEX.get(modelId) ?? null;
}

export function isKnownAzureModel(modelId) {
  return MODEL_INDEX.has(modelId);
}

export function getAddOn(addOnId) {
  return ADD_ON_INDEX.get(addOnId) ?? null;
}

/**
 * Add-on capabilities the platform will request for a document type.
 * Only add-ons the chosen model actually supports are returned.
 * @param {string} typeId
 * @param {string} modelId
 * @returns {string[]} feature identifiers for the `features` query parameter.
 */
export function addOnsForType(typeId, modelId) {
  const target = getAzureModel(modelId);
  if (!target || target.supportsAddOns === false) return [];
  const supportsKeyValues = target.outputs.includes(AzureOutput.KEY_VALUE_PAIRS);

  return AZURE_ADD_ONS.filter((addOn) => {
    if (!addOn.appliesTo.includes(typeId)) return false;
    if (addOn.id === 'keyValuePairs' && !supportsKeyValues) return false;
    if (addOn.id === 'queryFields' && target.tier === AzureTier.READ) return false;
    return true;
  }).map((addOn) => addOn.id);
}

/**
 * Candidate models able to satisfy a document type, ordered cheapest first.
 * @param {string} typeId
 * @param {{ requiresTables?: boolean }} [requirements]
 */
export function candidateModelsForType(typeId, requirements = {}) {
  const candidates = AZURE_MODELS.filter(
    (entry) => entry.tier !== AzureTier.CLASSIFIER && entry.tier !== AzureTier.CUSTOM
  ).filter((entry) => {
    if (requirements.requiresTables && !entry.outputs.includes(AzureOutput.TABLES)) return false;
    if (entry.tier === AzureTier.PREBUILT) return entry.documentTypes.includes(typeId);
    return true;
  });
  return candidates.sort((left, right) => left.pricePerThousandPages - right.pricePerThousandPages);
}
