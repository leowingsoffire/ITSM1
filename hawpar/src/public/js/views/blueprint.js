/**
 * Solution Blueprint — architecture, requirements traceability and governance.
 */
import { api } from '../api.js';
import { azureLogo } from '../azure-logos.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { el, formatNumber } from '../util.js';
import { card, dataTable, pageHeader } from './common.js';

const TIERS = [
  {
    title: 'Experience tier',
    nodes: [
      { name: 'VGC OCR Workspace', detail: 'Single-page app · strict CSP · WCAG-minded', variant: 'accent', icon: 'blueprint' },
      { name: 'Azure App Service (Linux P1v3 × 2)', detail: 'Node.js 20 · always-on · zone redundant · deployment slots', variant: 'azure', logo: 'app-service' },
      { name: 'Microsoft Entra ID', detail: 'Staff sign-in, group-based roles', variant: 'azure', logo: 'entra-id' }
    ]
  },
  {
    title: 'Processing tier',
    nodes: [
      { name: 'Ingestion service', detail: 'MIME + magic-byte validation, SHA-256 checksum', icon: 'upload' },
      { name: 'Bounded worker pool', detail: 'ingest → analyse → classify → extract → validate → score', icon: 'route' },
      { name: 'Azure AI Document Intelligence', detail: 'prebuilt-read / prebuilt-layout, 2024-11-30', variant: 'azure', logo: 'document-intelligence' },
      { name: 'Azure Service Bus', detail: 'Ingestion queue, retry and dead-letter handling', variant: 'azure', logo: 'service-bus' },
      { name: 'Classification engine', detail: 'Explainable weighted evidence', icon: 'tag' },
      { name: 'Extraction engine', detail: 'Key-value, fuzzy, regex and table binding', icon: 'table' },
      { name: 'Rules engine', detail: '26 VGC business rules, zero marginal cost', icon: 'scale' }
    ]
  },
  {
    title: 'Data & platform tier',
    nodes: [
      { name: 'Azure Blob Storage', detail: 'Originals + lifecycle to cool tier', variant: 'azure', logo: 'blob-storage' },
      { name: 'Azure Cosmos DB (serverless)', detail: 'Document records, audit trail', variant: 'azure', logo: 'cosmos-db' },
      { name: 'Azure Key Vault', detail: 'Secrets referenced by managed identity', variant: 'azure', logo: 'key-vault' },
      { name: 'Azure Private Link', detail: 'Private endpoints for storage, vault and AI services', variant: 'azure', logo: 'private-link' },
      { name: 'Azure Monitor', detail: 'Correlation-ID traces, KQL dashboards', variant: 'azure', logo: 'monitor' },
      { name: 'Application Insights', detail: 'Request, dependency and failure telemetry', variant: 'azure', logo: 'app-insights' }
    ]
  }
];

const GOVERNANCE = [
  ['Identity', 'System-assigned managed identity on App Service; Cognitive Services User role on the Document Intelligence account. No keys in configuration.'],
  ['Data residency', 'All services provisioned in Southeast Asia. Azure AI Document Intelligence does not retain customer content for training.'],
  ['PDPA', 'Bank account numbers and identifiers are masked before persistence. Retention policy caps the retained corpus and purges originals on delete.'],
  ['Auditability', 'Every classification, correction and approval is written to an immutable audit trail with actor, action, detail and timestamp.'],
  ['Transport security', 'HTTPS-only, HSTS, strict Content-Security-Policy, X-Content-Type-Options and Referrer-Policy applied to every response.'],
  ['Abuse protection', 'Per-client rate limits on API and upload routes, upload size and page ceilings, and file-signature validation.'],
  ['Resilience', 'Long-running operation polling with exponential backoff on 429/5xx, explicit degradation reporting, graceful shutdown draining in-flight work.']
];

export async function render() {
  const node = el('div.view');
  const [requirements, config] = await Promise.all([api.requirements(), state.config ? Promise.resolve(state.config) : api.getConfig()]);

  const architecture = el(
    'div.arch',
    {},
    TIERS.map((tier) =>
      el('div.arch__tier', {}, [
        el('h4', { text: tier.title }),
        el('div.arch__nodes', {}, tier.nodes.map((entry) =>
          el(`div.arch__node${entry.variant ? `.arch__node--${entry.variant}` : ''}`, {}, [
            el('div.arch__node-head', {}, [
              entry.logo ? azureLogo(entry.logo, { size: 20, decorative: true }) : icon(entry.icon ?? 'cpu', { size: 16 }),
              el('span.arch__node-name', { text: entry.name })
            ]),
            el('span', { text: entry.detail })
          ])
        ))
      ])
    )
  );

  const requirementsTable = dataTable(
    [{ label: 'Ref' }, { label: 'Requirement' }, { label: 'Category' }, { label: 'Priority' }, { label: 'Status' }, { label: 'Delivered by' }],
    requirements.items.map((item) => [
      el('span.mono', { text: item.ref }),
      item.requirement,
      item.category,
      item.priority,
      el(`span.badge.badge--${item.status === 'Delivered' ? 'success' : 'warn'}`, { text: item.status }),
      item.deliveredBy
    ]),
    { label: 'Requirements traceability' }
  );

  const typesTable = dataTable(
    [{ label: 'Document type' }, { label: 'Business unit' }, { label: 'Process' }, { label: 'Fields', numeric: true }, { label: 'Rules', numeric: true }, { label: 'Typical pages' }],
    config.documentTypes.map((type) => [
      type.name,
      type.businessUnit,
      type.process,
      String(type.fieldCount),
      String(type.ruleCount),
      Array.isArray(type.typicalPages) ? `${type.typicalPages[0]}–${type.typicalPages[1]}` : '—'
    ]),
    { label: 'Document taxonomy' }
  );

  const rulesTable = dataTable(
    [{ label: 'Rule' }, { label: 'What it checks' }],
    Object.entries(config.rules).map(([rule, description]) => [el('span.mono', { text: rule }), description]),
    { label: 'Validation rules' }
  );

  node.append(
    pageHeader({
      title: 'Solution Blueprint',
      icon: 'blueprint',
      subtitle: 'Reference architecture, requirements traceability, document taxonomy and governance controls for the VGC rollout.',
      actions: [el('a.btn.btn--ghost', { href: '/api/export/requirements.xlsx', text: 'Export traceability (.xlsx)' })]
    }),
    card({
      title: 'Target Azure architecture',
      icon: 'cloud',
      subtitle: 'Cost-optimised, managed-identity first, single-region Southeast Asia',
      body: el('div', {}, [
        architecture,
        el('p.arch__credit', {
          text: 'Azure product icons © Microsoft Corporation, used unmodified under the Microsoft Trademark and Brand Guidelines to identify the services in this architecture.'
        })
      ])
    }),
    el('div', { style: { height: '16px' } }),
    card({
      title: `Requirements traceability (${formatNumber(requirements.total)} items)`,
      icon: 'checkCircle',
      tone: 'jade',
      subtitle: 'Each requirement mapped to the component that delivers it',
      body: requirementsTable,
      flush: true
    }),
    el('div', { style: { height: '16px' } }),
    el('div.grid.grid--2', {}, [
      card({ title: `Document taxonomy (${config.documentTypes.length} types)`, icon: 'layers', tone: 'violet', body: typesTable, flush: true }),
      card({
        title: 'Governance & compliance controls',
        icon: 'shield',
        tone: 'jade',
        body: el('dl.kv-list', {}, GOVERNANCE.flatMap(([term, detail]) => [el('dt', { text: term }), el('dd', { text: detail, style: { fontWeight: '400' } })]))
      })
    ]),
    el('div', { style: { height: '16px' } }),
    card({ title: `Business rule catalogue (${Object.keys(config.rules).length} rules)`, icon: 'scale', tone: 'amber', body: rulesTable, flush: true }),
    el('div', { style: { height: '16px' } }),
    card({
      title: 'Deployment path',
      icon: 'route',
      tone: 'teal',
      body: el('ol', { style: { margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: '1.8' } }, [
        el('li', { text: 'az deployment group create --resource-group rg-vgc-ocr --template-file infra/main.bicep' }),
        el('li', { text: 'Bicep provisions App Service (Linux P1v3, 2 zone-redundant instances), Document Intelligence S0, Storage, Key Vault, Log Analytics and Application Insights.' }),
        el('li', { text: 'The web app receives a system-assigned identity granted Cognitive Services User on the Document Intelligence account.' }),
        el('li', { text: 'Set ANALYZER_MODE=azure and AZURE_DOCINT_USE_MANAGED_IDENTITY=true in app settings — no secrets are stored.' }),
        el('li', { text: 'Deploy with: az webapp deploy --src-path ./dist.zip --type zip, or wire the provided GitHub Actions workflow.' }),
        el('li', { text: 'Validate with the /api/health probe, then run the sample pack to confirm end-to-end extraction quality.' })
      ])
    })
  );

  return { node };
}
