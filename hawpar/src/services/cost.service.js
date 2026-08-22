/**
 * Azure cost model.
 *
 * Two jobs:
 *  1. Estimate the marginal cost of each processed document.
 *  2. Produce a monthly total-cost-of-ownership projection for the customer.
 *
 * All unit prices are pay-as-you-go list prices for the Southeast Asia region
 * and are declared as data so Finance can update them without a code change.
 */

export const PRICE_BOOK = Object.freeze({
  currency: 'USD',
  region: 'Southeast Asia (Singapore)',
  lastReviewed: '2026-07-01',
  documentIntelligence: Object.freeze({
    free: { id: 'F0', label: 'Free (F0)', pricePerThousandPages: 0, monthlyPageAllowance: 500 },
    read: { id: 'prebuilt-read', label: 'Read (OCR only)', pricePerThousandPages: 1.5 },
    layout: { id: 'prebuilt-layout', label: 'Layout (tables + structure)', pricePerThousandPages: 10 },
    prebuilt: { id: 'prebuilt-invoice', label: 'Prebuilt domain model', pricePerThousandPages: 10 },
    custom: { id: 'custom-neural', label: 'Custom neural model', pricePerThousandPages: 50 }
  }),
  appService: Object.freeze({
    B1: { label: 'App Service Linux B1 (1 vCPU, 1.75 GB)', monthlyUsd: 12.41, productionReady: false },
    B2: { label: 'App Service Linux B2 (2 vCPU, 3.5 GB)', monthlyUsd: 24.82, productionReady: false },
    P0v3: { label: 'App Service Linux P0v3 (1 vCPU, 4 GB)', monthlyUsd: 48.91, productionReady: true },
    P1v3: { label: 'App Service Linux P1v3 (2 vCPU, 8 GB)', monthlyUsd: 110.96, productionReady: true },
    P2v3: { label: 'App Service Linux P2v3 (4 vCPU, 16 GB)', monthlyUsd: 221.92, productionReady: true }
  }),
  storage: Object.freeze({
    hotPerGbMonthUsd: 0.021,
    transactionsPer10kUsd: 0.005
  }),
  monitoring: Object.freeze({
    logAnalyticsPerGbUsd: 2.99,
    freeGbPerMonth: 5
  }),
  serviceBus: Object.freeze({
    standard: { label: 'Service Bus Standard (ingestion queue)', monthlyUsd: 9.81 }
  }),
  networking: Object.freeze({
    privateEndpointMonthlyUsd: 7.3
  }),
  keyVault: Object.freeze({ per10kOperationsUsd: 0.03 })
});

/**
 * The agreed monthly run-rate for the VGC production deployment.
 * REFERENCE_PROFILE below is sized to land on this figure, and the Cost & Value
 * screen reports live variance against it.
 */
export const MONTHLY_BUDGET_SGD = 1690;

/**
 * The quoted production configuration. Every default in projectMonthlyCost()
 * comes from here so the screen opens on the number the customer signed off.
 */
export const REFERENCE_PROFILE = Object.freeze({
  documentsPerMonth: 18000,
  averagePages: 12,
  appServiceSku: 'P1v3',
  appServiceInstances: 2,
  storageGb: 435,
  logGb: 25,
  privateEndpoints: 3,
  adaptiveRouting: true,
  layoutSharePercent: 32
});

/**
 * Model routing policy — the core cost lever.
 *
 * Layout (10x the price of Read) is only used for document types where the
 * table structure is genuinely required. Everything else is served by Read plus
 * VGC's local rules engine, which costs nothing per page.
 */
const LAYOUT_REQUIRED_TYPES = new Set([
  'supplier_invoice',
  'purchase_order',
  'delivery_order',
  'certificate_of_analysis',
  'bank_statement',
  'employee_claim'
]);

/** @param {string} typeId @returns {'prebuilt-read'|'prebuilt-layout'} */
export function selectModelForType(typeId) {
  return LAYOUT_REQUIRED_TYPES.has(typeId) ? 'prebuilt-layout' : 'prebuilt-read';
}

const TRIAGE_PAGES = 1;
const MANUAL_SECONDS_PER_PAGE = 42;
const FULLY_LOADED_HOURLY_RATE_SGD = 28;
const SGD_PER_USD = 1.34;

function pricePerPage(modelId) {
  const catalogue = PRICE_BOOK.documentIntelligence;
  if (modelId === catalogue.read.id) return catalogue.read.pricePerThousandPages / 1000;
  if (modelId === catalogue.custom.id) return catalogue.custom.pricePerThousandPages / 1000;
  if (modelId === catalogue.layout.id) return catalogue.layout.pricePerThousandPages / 1000;
  return catalogue.prebuilt.pricePerThousandPages / 1000;
}

/**
 * Marginal cost of one processed document.
 * @param {object} input
 * @param {number} input.pageCount
 * @param {string} input.typeId
 * @param {string} input.engine     'azure' | 'demo'
 * @param {boolean} [input.adaptiveRouting]
 */
export function estimateDocumentCost({ pageCount, typeId, engine, adaptiveRouting = true }) {
  const pages = Math.max(1, Number(pageCount) || 1);
  const selectedModel = adaptiveRouting ? selectModelForType(typeId) : PRICE_BOOK.documentIntelligence.layout.id;

  const triageCost = adaptiveRouting && pages > 5 ? TRIAGE_PAGES * pricePerPage('prebuilt-read') : 0;
  const analysisCost = pages * pricePerPage(selectedModel);
  const baselineCost = pages * pricePerPage(PRICE_BOOK.documentIntelligence.prebuilt.id);

  const estimatedUsd = engine === 'azure' ? Number((triageCost + analysisCost).toFixed(5)) : 0;
  // What the run *would* cost on Azure. Always populated so analytics stay
  // meaningful when the offline demo engine is in use (which bills nothing).
  const modelledUsd = Number((triageCost + analysisCost).toFixed(5));
  const manualMinutes = Number(((pages * MANUAL_SECONDS_PER_PAGE) / 60).toFixed(1));
  const manualCostSgd = Number(((manualMinutes / 60) * FULLY_LOADED_HOURLY_RATE_SGD).toFixed(2));

  return {
    pages,
    selectedModel,
    engine,
    estimatedUsd,
    modelledUsd,
    baselineUsd: Number(baselineCost.toFixed(5)),
    savingVsPrebuiltUsd: Number((baselineCost - (triageCost + analysisCost)).toFixed(5)),
    manualEffortMinutes: manualMinutes,
    manualCostSgd,
    netBenefitSgd: Number((manualCostSgd - estimatedUsd * SGD_PER_USD).toFixed(2))
  };
}

/**
 * Monthly TCO projection for the production deployment.
 *
 * Defaults are the signed-off REFERENCE_PROFILE, which is sized to land on
 * MONTHLY_BUDGET_SGD. Every argument is overridable so the customer can model
 * their own volumes on the Cost & Value screen.
 *
 * @param {object} [input]
 * @param {number} [input.documentsPerMonth]
 * @param {number} [input.averagePages]
 * @param {string} [input.appServiceSku]
 * @param {number} [input.appServiceInstances] Instances in the plan (>=2 for zone redundancy).
 * @param {number} [input.storageGb]
 * @param {number} [input.logGb]
 * @param {number} [input.privateEndpoints]
 * @param {boolean} [input.adaptiveRouting]
 * @param {number} [input.layoutSharePercent] Share of pages that genuinely need Layout.
 */
export function projectMonthlyCost({
  documentsPerMonth = REFERENCE_PROFILE.documentsPerMonth,
  averagePages = REFERENCE_PROFILE.averagePages,
  appServiceSku = REFERENCE_PROFILE.appServiceSku,
  appServiceInstances = REFERENCE_PROFILE.appServiceInstances,
  storageGb = REFERENCE_PROFILE.storageGb,
  logGb = REFERENCE_PROFILE.logGb,
  privateEndpoints = REFERENCE_PROFILE.privateEndpoints,
  adaptiveRouting = REFERENCE_PROFILE.adaptiveRouting,
  layoutSharePercent = REFERENCE_PROFILE.layoutSharePercent
} = {}) {
  const totalPages = Math.max(0, documentsPerMonth * averagePages);
  const layoutShare = Math.min(100, Math.max(0, layoutSharePercent)) / 100;

  const layoutPages = adaptiveRouting ? totalPages * layoutShare : totalPages;
  const readPages = totalPages - layoutPages;
  const triagePages = adaptiveRouting ? documentsPerMonth : 0;

  const docIntUsd =
    layoutPages * pricePerPage('prebuilt-layout') +
    readPages * pricePerPage('prebuilt-read') +
    triagePages * pricePerPage('prebuilt-read');

  const baselineUsd = totalPages * pricePerPage('prebuilt-invoice');

  const plan = PRICE_BOOK.appService[appServiceSku] ?? PRICE_BOOK.appService.P1v3;
  const instances = Math.max(1, Math.round(appServiceInstances));
  const appServiceUsd = plan.monthlyUsd * instances;

  const storageUsd =
    storageGb * PRICE_BOOK.storage.hotPerGbMonthUsd +
    ((documentsPerMonth * 6) / 10000) * PRICE_BOOK.storage.transactionsPer10kUsd;
  const billableLogGb = Math.max(0, logGb - PRICE_BOOK.monitoring.freeGbPerMonth);
  const monitoringUsd = billableLogGb * PRICE_BOOK.monitoring.logAnalyticsPerGbUsd;
  const serviceBusUsd = PRICE_BOOK.serviceBus.standard.monthlyUsd;
  const networkingUsd = Math.max(0, privateEndpoints) * PRICE_BOOK.networking.privateEndpointMonthlyUsd;
  const keyVaultUsd = PRICE_BOOK.keyVault.per10kOperationsUsd;

  const totalUsd = docIntUsd + appServiceUsd + storageUsd + monitoringUsd + serviceBusUsd + networkingUsd + keyVaultUsd;
  const totalSgd = totalUsd * SGD_PER_USD;

  const manualHours = (totalPages * MANUAL_SECONDS_PER_PAGE) / 3600;
  const manualCostSgd = manualHours * FULLY_LOADED_HOURLY_RATE_SGD;

  const lineItems = [
    {
      service: 'Azure AI Document Intelligence',
      detail: adaptiveRouting ? 'Adaptive Read/Layout routing' : 'Layout for every page',
      monthlyUsd: round(docIntUsd)
    },
    {
      service: 'Azure App Service (Linux)',
      detail: `${plan.label} × ${instances}${instances >= 2 ? ' (zone redundant)' : ''}`,
      monthlyUsd: round(appServiceUsd)
    },
    { service: 'Azure Blob Storage', detail: `${storageGb} GB hot tier + transactions`, monthlyUsd: round(storageUsd) },
    {
      service: 'Azure Monitor / Log Analytics',
      detail: `${logGb} GB ingest (${PRICE_BOOK.monitoring.freeGbPerMonth} GB free)`,
      monthlyUsd: round(monitoringUsd)
    },
    { service: 'Azure Service Bus', detail: PRICE_BOOK.serviceBus.standard.label, monthlyUsd: round(serviceBusUsd) },
    { service: 'Private networking', detail: `${privateEndpoints} private endpoints`, monthlyUsd: round(networkingUsd) },
    { service: 'Azure Key Vault', detail: 'Secret operations', monthlyUsd: round(keyVaultUsd) }
  ];

  const budgetVarianceSgd = round(totalSgd - MONTHLY_BUDGET_SGD);

  return {
    assumptions: {
      documentsPerMonth,
      averagePages,
      appServiceSku,
      appServiceInstances: instances,
      storageGb,
      logGb,
      privateEndpoints,
      adaptiveRouting,
      layoutSharePercent
    },
    totalPages,
    lineItems,
    totalMonthlyUsd: round(totalUsd),
    totalMonthlySgd: round(totalSgd),
    budgetSgd: MONTHLY_BUDGET_SGD,
    budgetVarianceSgd,
    budgetVariancePercent: round((budgetVarianceSgd / MONTHLY_BUDGET_SGD) * 100),
    withinBudget: totalSgd <= MONTHLY_BUDGET_SGD,
    annualSgd: round(totalSgd * 12),
    costPerDocumentUsd: documentsPerMonth > 0 ? Number((totalUsd / documentsPerMonth).toFixed(4)) : 0,
    costPerDocumentSgd: documentsPerMonth > 0 ? Number(((totalUsd * SGD_PER_USD) / documentsPerMonth).toFixed(4)) : 0,
    costPerPageSgd: totalPages > 0 ? Number(((totalUsd * SGD_PER_USD) / totalPages).toFixed(5)) : 0,
    baselineDocumentIntelligenceUsd: round(baselineUsd),
    routingSavingUsd: round(baselineUsd - docIntUsd),
    routingSavingPercent: baselineUsd > 0 ? Number((((baselineUsd - docIntUsd) / baselineUsd) * 100).toFixed(1)) : 0,
    manualBaselineSgd: round(manualCostSgd),
    manualHoursPerMonth: round(manualHours),
    netMonthlyBenefitSgd: round(manualCostSgd - totalSgd),
    roiMultiple: totalSgd > 0 ? round(manualCostSgd / totalSgd) : 0,
    currency: PRICE_BOOK.currency,
    region: PRICE_BOOK.region
  };
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

export const COST_CONSTANTS = Object.freeze({
  MANUAL_SECONDS_PER_PAGE,
  FULLY_LOADED_HOURLY_RATE_SGD,
  SGD_PER_USD,
  MONTHLY_BUDGET_SGD
});
