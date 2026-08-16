/**
 * Official Microsoft Azure service icons.
 *
 * The SVGs in `/assets/azure` are the Azure architecture icons published by
 * Microsoft (https://learn.microsoft.com/azure/architecture/icons/), sourced via
 * the community mirror at https://github.com/loryanstrant/MicrosoftCloudLogos.
 * They are used unmodified to identify the Azure services in this solution's
 * architecture and cost breakdown. All logos remain the property of Microsoft
 * Corporation — see /assets/azure/ATTRIBUTION.md.
 *
 * They are rendered with <img> rather than inlined, which keeps the gradient ids
 * inside each file scoped to its own document (no cross-icon id collisions) and
 * means the markup can never execute — CSP allows `img-src 'self'`.
 */
import { el } from './util.js';

/** Service key → { file, label } */
export const AZURE_SERVICES = Object.freeze({
  'document-intelligence': { file: 'document-intelligence.svg', label: 'Azure AI Document Intelligence' },
  'app-service': { file: 'app-service.svg', label: 'Azure App Service' },
  'entra-id': { file: 'entra-id.svg', label: 'Microsoft Entra ID' },
  'blob-storage': { file: 'blob-storage.svg', label: 'Azure Blob Storage' },
  'cosmos-db': { file: 'cosmos-db.svg', label: 'Azure Cosmos DB' },
  'key-vault': { file: 'key-vault.svg', label: 'Azure Key Vault' },
  monitor: { file: 'monitor.svg', label: 'Azure Monitor' },
  'app-insights': { file: 'app-insights.svg', label: 'Application Insights' },
  'service-bus': { file: 'service-bus.svg', label: 'Azure Service Bus' },
  'private-link': { file: 'private-link.svg', label: 'Azure Private Link' }
});

/**
 * Builds an Azure service logo.
 * @param {keyof AZURE_SERVICES} key
 * @param {{size?: number, className?: string, decorative?: boolean}} [options]
 * @returns {HTMLImageElement|null} `null` when the key is unknown, so callers can
 *   fall back to a generic icon without a broken image ever reaching the page.
 */
export function azureLogo(key, { size = 20, className = '', decorative = false } = {}) {
  const service = AZURE_SERVICES[key];
  if (!service) return null;

  return el(`img.azure-logo${className ? `.${className}` : ''}`, {
    src: `/assets/azure/${service.file}`,
    width: size,
    height: size,
    // Deliberately NOT lazy: these are ~2 KB local files rendered inside the
    // scrolling content pane, where lazy loading leaves them permanently blank.
    decoding: 'async',
    alt: decorative ? '' : service.label,
    'aria-hidden': decorative ? 'true' : null,
    title: decorative ? null : service.label
  });
}

/** Matches a free-text service name (line items, price book) to a logo key. */
export function logoKeyForService(name = '') {
  const value = String(name).toLowerCase();
  if (value.includes('document intelligence') || value.includes('form recognizer')) return 'document-intelligence';
  if (value.includes('app service')) return 'app-service';
  if (value.includes('blob') || value.includes('storage')) return 'blob-storage';
  if (value.includes('log analytics') || value.includes('monitor')) return 'monitor';
  if (value.includes('service bus')) return 'service-bus';
  if (value.includes('private') || value.includes('networking')) return 'private-link';
  if (value.includes('key vault')) return 'key-vault';
  if (value.includes('cosmos')) return 'cosmos-db';
  if (value.includes('entra') || value.includes('identity')) return 'entra-id';
  if (value.includes('insights')) return 'app-insights';
  return null;
}
