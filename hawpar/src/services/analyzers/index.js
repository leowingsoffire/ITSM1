/**
 * Analyser factory.
 *
 * Selects the configured engine and, when Azure is unavailable, degrades to the
 * offline engine so a demonstration is never blocked. The degradation is always
 * reported explicitly in the result — it is never silent.
 *
 * The Document Intelligence agent drives this with a full analysis plan (model,
 * page range, add-on features, query fields) rather than the static
 * configuration, which is what makes the Azure integration adaptive.
 */
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { analyzeWithAzure } from './azureAnalyzer.js';
import { analyzeWithDemoEngine } from './demoAnalyzer.js';

/**
 * @param {object} input
 * @param {Buffer} input.buffer
 * @param {string} input.fileName
 * @param {string} input.contentType
 * @param {string} input.correlationId
 * @param {string} [input.typeHint]
 * @param {string} [input.modelId]        Adaptive model override.
 * @param {string} [input.pages]          Page range for triage passes.
 * @param {string[]} [input.features]     Azure add-on capabilities.
 * @param {string[]} [input.queryFields]  Named values requested from the service.
 */
export async function analyzeDocument({
  buffer,
  fileName,
  contentType,
  correlationId,
  typeHint,
  modelId,
  pages,
  features = [],
  queryFields = []
}) {
  if (config.analyzer.mode !== 'azure') {
    const result = analyzeWithDemoEngine({ fileName, buffer, typeHint });
    return { ...result, plannedModelId: modelId ?? null, addOns: [], queryFields: [] };
  }

  try {
    const result = await analyzeWithAzure({
      analyzerConfig: config.analyzer,
      buffer,
      contentType,
      correlationId,
      modelId,
      pages,
      features,
      queryFields
    });
    return { ...result, fallbackReason: null };
  } catch (error) {
    logger.error('Azure Document Intelligence failed; degrading to the offline engine.', {
      correlationId,
      fileName,
      errorCode: error.code,
      error
    });
    const fallback = analyzeWithDemoEngine({ fileName, buffer, typeHint });
    return {
      ...fallback,
      plannedModelId: modelId ?? null,
      addOns: [],
      queryFields: [],
      fallbackReason: `Azure Document Intelligence unavailable (${error.code ?? 'UNKNOWN'}): ${error.message}`
    };
  }
}

export { analyzeWithDemoEngine, analyzeWithAzure };
