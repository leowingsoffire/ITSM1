/**
 * Azure AI Document Intelligence integration service.
 *
 * The analyser talks to the *data plane* (`:analyze`). This module covers the
 * rest of the integration surface the operations team needs:
 *
 *  - a live connectivity + authentication probe against the configured resource
 *  - discovery of the models that actually exist on that resource
 *  - the resource/service information document (custom model quota, api version)
 *  - the platform's model & add-on catalogue joined with routing decisions
 *
 * Everything degrades gracefully: with no Azure resource configured the console
 * still reports exactly what *would* be called, so the integration is auditable
 * before any spend is incurred.
 */
import { config } from '../config/index.js';
import {
  AZURE_ADD_ONS,
  AZURE_MODELS,
  addOnsForType,
  candidateModelsForType,
  getAzureModel
} from '../domain/azureModels.js';
import { DOCUMENT_TYPES } from '../domain/documentTypes.js';
import { logger } from '../lib/logger.js';
import { buildAuthHeaders, fetchWithTimeout } from './analyzers/azureHttp.js';
import { selectModelForType } from './cost.service.js';

const PROBE_TIMEOUT_MS = 12000;
const STATUS_CACHE_MS = 30000;

/** @type {{at: number, payload: object}|null} */
let cachedStatus = null;

export function authenticationMode() {
  if (config.analyzer.apiKey) return 'resource-key';
  if (config.analyzer.useManagedIdentity) return 'managed-identity';
  return 'none';
}

/**
 * Static description of how the platform is wired to Document Intelligence.
 * Contains no secrets — only whether a credential is present.
 */
export function integrationProfile() {
  const configuredModel = getAzureModel(config.analyzer.modelId);
  return {
    mode: config.analyzer.mode,
    live: config.analyzer.mode === 'azure',
    endpoint: config.analyzer.endpoint || null,
    endpointConfigured: Boolean(config.analyzer.endpoint),
    apiVersion: config.analyzer.apiVersion,
    authentication: authenticationMode(),
    credentialPresent: Boolean(config.analyzer.apiKey) || config.analyzer.useManagedIdentity,
    defaultModelId: config.analyzer.modelId,
    defaultModelName: configuredModel?.name ?? config.analyzer.modelId,
    dataPlanePath: '/documentintelligence/documentModels/{modelId}:analyze',
    capabilities: {
      adaptiveModelRouting: true,
      singlePageTriage: true,
      addOnFeatures: AZURE_ADD_ONS.map((addOn) => addOn.id),
      queryFields: true,
      longRunningOperationPolling: true,
      throttleBackoff: true,
      explicitFallback: true
    }
  };
}

/**
 * Model catalogue joined with the routing decision the platform would make for
 * every document type — this is the "why this model" evidence for auditors.
 */
export function modelCatalogue() {
  const routing = DOCUMENT_TYPES.filter((type) => type.id !== 'unclassified').map((type) => {
    const selected = selectModelForType(type.id);
    const candidates = candidateModelsForType(type.id, {
      requiresTables: type.fields.some((field) => field.type === 'table')
    });
    return {
      typeId: type.id,
      typeName: type.name,
      process: type.process,
      businessUnit: type.businessUnit,
      selectedModelId: selected,
      selectedModelName: getAzureModel(selected)?.name ?? selected,
      addOns: addOnsForType(type.id, selected),
      queryFieldCount: type.fields.filter((field) => field.type !== 'table').length,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        pricePerThousandPages: candidate.pricePerThousandPages
      }))
    };
  });

  return {
    apiVersion: config.analyzer.apiVersion,
    models: AZURE_MODELS.map((entry) => ({
      id: entry.id,
      name: entry.name,
      tier: entry.tier,
      description: entry.description,
      outputs: entry.outputs,
      pricePerThousandPages: entry.pricePerThousandPages,
      recommendedFor: entry.recommendedFor,
      inUse: routing.some((route) => route.selectedModelId === entry.id),
      documentTypes: entry.documentTypes
    })),
    addOns: AZURE_ADD_ONS.map((addOn) => ({
      ...addOn,
      appliesTo: [...addOn.appliesTo],
      enabledTypeCount: addOn.appliesTo.length
    })),
    routing
  };
}

/**
 * Live probe of the configured Document Intelligence resource.
 * Never throws: a failure is a *result*, because the console has to be able to
 * show a red light rather than an error page.
 * @param {{ force?: boolean }} [options]
 */
export async function probeService({ force = false } = {}) {
  const profile = integrationProfile();

  if (config.analyzer.mode !== 'azure' || !config.analyzer.endpoint) {
    return {
      ...profile,
      reachable: false,
      state: config.analyzer.mode === 'azure' ? 'not-configured' : 'offline-demo',
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      resourceModels: [],
      customModelCount: 0,
      message:
        config.analyzer.mode === 'azure'
          ? 'ANALYZER_MODE=azure but no endpoint is configured.'
          : 'Running on the offline demo engine — no Azure calls are made and nothing is billed.'
    };
  }

  if (!force && cachedStatus && Date.now() - cachedStatus.at < STATUS_CACHE_MS) {
    return cachedStatus.payload;
  }

  const url =
    `${config.analyzer.endpoint}/documentintelligence/documentModels` +
    `?api-version=${encodeURIComponent(config.analyzer.apiVersion)}`;
  const startedAt = Date.now();

  let payload;
  try {
    const headers = await buildAuthHeaders(config.analyzer);
    const response = await fetchWithTimeout(url, { headers }, PROBE_TIMEOUT_MS);
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      payload = {
        ...profile,
        reachable: false,
        state: response.status === 401 || response.status === 403 ? 'unauthorised' : 'error',
        checkedAt: new Date().toISOString(),
        latencyMs,
        resourceModels: [],
        customModelCount: 0,
        message:
          response.status === 401 || response.status === 403
            ? 'Azure rejected the credential. Check AZURE_DOCINT_KEY or the "Cognitive Services User" role.'
            : `Document Intelligence returned HTTP ${response.status}.`
      };
    } else {
      const body = await response.json();
      const models = (body.value ?? []).map((entry) => ({
        modelId: entry.modelId,
        description: entry.description ?? null,
        createdDateTime: entry.createdDateTime ?? null,
        apiVersion: entry.apiVersion ?? null,
        custom: !String(entry.modelId ?? '').startsWith('prebuilt-')
      }));
      payload = {
        ...profile,
        reachable: true,
        state: 'connected',
        checkedAt: new Date().toISOString(),
        latencyMs,
        resourceModels: models.slice(0, 50),
        customModelCount: models.filter((entry) => entry.custom).length,
        message: `Connected. ${models.length} model(s) visible on the resource.`
      };
    }
  } catch (error) {
    logger.warn('Document Intelligence probe failed.', { error });
    payload = {
      ...profile,
      reachable: false,
      state: 'unreachable',
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      resourceModels: [],
      customModelCount: 0,
      message: error.message ?? 'The Document Intelligence endpoint could not be reached.'
    };
  }

  cachedStatus = { at: Date.now(), payload };
  return payload;
}

/** Test hook — clears the probe cache. */
export function resetProbeCache() {
  cachedStatus = null;
}
