/**
 * Shared HTTP + authentication plumbing for the Azure AI Document Intelligence
 * REST surface.
 *
 * Kept dependency-free on purpose: no Azure SDK means no transitive packages to
 * patch, and the two supported credential flows (resource key, managed identity)
 * are both a handful of lines.
 */
import { AppError, ErrorCode, analyzerFailed } from '../../lib/errors.js';

export const COGNITIVE_SERVICES_SCOPE = 'https://cognitiveservices.azure.com/.default';
export const DEFAULT_REQUEST_TIMEOUT_MS = 120000;

/** @type {{token: string, expiresAtMs: number}|null} */
let cachedToken = null;

/** Test/diagnostic hook — drops the cached managed-identity token. */
export function resetTokenCache() {
  cachedToken = null;
}

export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'invalid-url';
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AppError({
        code: ErrorCode.ANALYZER_TIMEOUT,
        message: `Azure Document Intelligence did not respond within ${timeoutMs / 1000}s.`,
        status: 504,
        cause: error
      });
    }
    throw analyzerFailed('Unable to reach Azure Document Intelligence.', { url: safeUrl(url) }, error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Acquires a managed identity token from the platform IMDS endpoint.
 * Works on Azure App Service, Container Apps and Azure Functions without an SDK.
 */
export async function getManagedIdentityToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now + 60000) return cachedToken.token;

  const identityEndpoint = process.env.IDENTITY_ENDPOINT;
  const identityHeader = process.env.IDENTITY_HEADER;

  const url = identityEndpoint
    ? `${identityEndpoint}?resource=${encodeURIComponent(COGNITIVE_SERVICES_SCOPE.replace('/.default', ''))}&api-version=2019-08-01`
    : `http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=${encodeURIComponent('https://cognitiveservices.azure.com')}`;

  const headers = identityEndpoint ? { 'X-IDENTITY-HEADER': identityHeader ?? '' } : { Metadata: 'true' };

  const response = await fetchWithTimeout(url, { headers }, 10000);
  if (!response.ok) {
    throw analyzerFailed('Managed identity token request failed.', {
      status: response.status,
      hint: 'Assign the "Cognitive Services User" role to the app identity.'
    });
  }

  const payload = await response.json();
  const expiresInSeconds = Number(payload.expires_in ?? 3000);
  cachedToken = { token: payload.access_token, expiresAtMs: now + expiresInSeconds * 1000 };
  return cachedToken.token;
}

/**
 * @param {{apiKey?: string}} analyzerConfig
 * @returns {Promise<Record<string,string>>}
 */
export async function buildAuthHeaders(analyzerConfig) {
  if (analyzerConfig.apiKey) return { 'Ocp-Apim-Subscription-Key': analyzerConfig.apiKey };
  const token = await getManagedIdentityToken();
  return { Authorization: `Bearer ${token}` };
}

export function throttleError(retryAfterSeconds) {
  return new AppError({
    code: ErrorCode.ANALYZER_THROTTLED,
    message: 'Azure Document Intelligence throttled the request (HTTP 429).',
    status: 429,
    meta: { retryAfterSeconds }
  });
}
