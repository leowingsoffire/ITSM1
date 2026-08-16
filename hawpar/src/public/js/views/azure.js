/**
 * Azure Document Intelligence — integration profile, live probe, model catalogue
 * and the per-document-type routing decision that explains every model choice.
 */
import { api } from '../api.js';
import { el, formatNumber, formatUsd, formatDateTime, toast } from '../util.js';
import { card, dataTable, kpi, loading, pageHeader } from './common.js';

const STATE_VARIANT = Object.freeze({
  connected: 'success',
  unauthorised: 'danger',
  unreachable: 'danger',
  'not-configured': 'warn',
  'offline-demo': 'info'
});

const STATE_LABEL = Object.freeze({
  connected: 'Connected',
  unauthorised: 'Credential rejected',
  unreachable: 'Unreachable',
  'not-configured': 'Not configured',
  'offline-demo': 'Offline demo engine'
});

export async function render() {
  const node = el('div.view');
  const host = el('div', {}, [loading('Contacting Azure Document Intelligence…')]);

  node.append(
    pageHeader({
      title: 'Azure Document Intelligence',
      subtitle:
        'Deep integration console — authentication, API version, model routing, add-on features and the live health of the configured resource.',
      icon: 'azure',
      actions: [
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Re-probe resource',
          on: { click: () => void paint(true) }
        })
      ]
    }),
    host
  );

  async function paint(refresh = false) {
    let status;
    let catalogue;
    try {
      [status, catalogue] = await Promise.all([api.azureStatus(refresh), api.azureModels()]);
    } catch {
      host.replaceChildren(
        card({
          title: 'Azure console unavailable',
          icon: 'alert',
          tone: 'crimson',
          body: el('p', { text: 'The Azure integration profile could not be loaded. Try re-probing the resource.' })
        })
      );
      return;
    }

    if (refresh) toast(`Probe complete — ${STATE_LABEL[status.probe.state] ?? status.probe.state}.`, 'info');

    const probe = status.probe;
    const profile = status.profile;

    host.replaceChildren(
      ...[
      el('div.grid.grid--kpi.stagger', {}, [
        kpi({
          label: 'Connection state',
          value: STATE_LABEL[probe.state] ?? probe.state,
          hint: probe.latencyMs === null ? 'No round-trip measured' : `${probe.latencyMs} ms round-trip`,
          tone: probe.state === 'connected' ? 'good' : probe.state === 'offline-demo' ? undefined : 'bad',
          icon: 'cloud'
        }),
        kpi({
          label: 'API version',
          value: profile.apiVersion,
          hint: `Authentication: ${profile.authentication}`,
          icon: 'shield'
        }),
        kpi({
          label: 'Models catalogued',
          value: formatNumber(status.modelCount),
          hint: `${formatNumber(status.addOnCount)} add-on feature(s) available`,
          icon: 'layers'
        }),
        kpi({
          label: 'Custom models',
          value: formatNumber(probe.customModelCount ?? 0),
          hint: probe.reachable ? 'Discovered on the live resource' : 'Live discovery requires a connected resource',
          icon: 'database'
        })
      ]),
      card({
        title: 'Integration profile',
        subtitle: probe.message,
        icon: 'cloud',
        tone: probe.state === 'connected' ? 'jade' : probe.state === 'offline-demo' ? 'navy' : 'crimson',
        body: [
          el('div.meta-grid', {}, [
            metaBadge('State', STATE_LABEL[probe.state] ?? probe.state, STATE_VARIANT[probe.state] ?? 'neutral'),
            metaItem('Analyzer mode', profile.mode),
            metaItem('Endpoint', profile.endpoint ?? 'not configured'),
            metaItem('Credential present', profile.credentialPresent ? 'yes' : 'no'),
            metaItem('Default model', `${profile.defaultModelName} (${profile.defaultModelId})`),
            metaItem('Data-plane path', profile.dataPlanePath),
            metaItem('Last checked', probe.checkedAt ? formatDateTime(probe.checkedAt) : '—')
          ]),
          el('h3.section-title', { text: 'Integration capabilities' }),
          el(
            'div.chip-row',
            {},
            Object.entries(profile.capabilities)
              .filter(([, value]) => value === true)
              .map(([key]) => el('span.chip.chip--on', { text: humanise(key) }))
          ),
          el('h3.section-title', { text: 'Add-on features requested per document type' }),
          el(
            'div.chip-row',
            {},
            (profile.capabilities.addOnFeatures ?? []).map((feature) => el('span.chip', { text: feature }))
          )
        ]
      }),
      probe.resourceModels && probe.resourceModels.length > 0
        ? card({
            title: 'Models on the live resource',
            subtitle: 'Discovered from the Document Intelligence management plane.',
            icon: 'database',
            tone: 'teal',
            flush: true,
            body: dataTable(
              [{ label: 'Model ID' }, { label: 'Description' }, { label: 'Created' }],
              probe.resourceModels.map((model) => [
                el('strong', { text: model.modelId }),
                model.description ?? '—',
                model.createdDateTime ? formatDateTime(model.createdDateTime) : '—'
              ]),
              { label: 'Models on the live resource' }
            )
          })
        : null,
      card({
        title: 'Model catalogue',
        subtitle: 'Every Document Intelligence model the platform can route to, with list price per 1,000 pages.',
        icon: 'layers',
        tone: 'violet',
        flush: true,
        body: dataTable(
          [
            { label: 'Model' },
            { label: 'Tier' },
            { label: 'Outputs' },
            { label: 'Price / 1k pages', numeric: true },
            { label: 'Routed to' },
            { label: 'In use' }
          ],
          catalogue.models.map((model) => [
            el('div.stack-tight', {}, [
              el('strong', { text: model.name }),
              el('span.muted', { text: model.id })
            ]),
            el('span.chip', { text: model.tier }),
            el('div.chip-row', {}, model.outputs.map((output) => el('span.chip.chip--sm', { text: output }))),
            model.pricePerThousandPages === 0 ? 'included' : formatUsd(model.pricePerThousandPages),
            `${model.documentTypes.length} type(s)`,
            model.inUse
              ? el('span.badge.badge--success', { text: 'active' })
              : el('span.badge.badge--neutral', { text: 'available' })
          ]),
          { label: 'Model catalogue' }
        )
      }),
      card({
        title: 'Add-on features',
        subtitle: 'Requested per document type via the analyze API `features` parameter.',
        icon: 'sparkles',
        tone: 'amber',
        flush: true,
        body: dataTable(
          [{ label: 'Feature' }, { label: 'What it adds' }, { label: 'Document types', numeric: true }, { label: 'Billed' }],
          catalogue.addOns.map((addOn) => [
            el('div.stack-tight', {}, [el('strong', { text: addOn.name }), el('span.muted', { text: addOn.id })]),
            addOn.description,
            formatNumber(addOn.enabledTypeCount),
            addOn.billed
              ? el('span.badge.badge--warn', { text: 'billed extra' })
              : el('span.badge.badge--neutral', { text: 'included' })
          ]),
          { label: 'Add-on features' }
        )
      }),
      card({
        title: 'Routing decisions',
        subtitle: 'The model, add-ons and query fields the platform selects for each document type — this is the audit evidence for "why this model".',
        icon: 'route',
        tone: 'navy',
        flush: true,
        body: dataTable(
          [
            { label: 'Document type' },
            { label: 'Process' },
            { label: 'Selected model' },
            { label: 'Add-ons' },
            { label: 'Query fields', numeric: true },
            { label: 'Alternatives considered' }
          ],
          catalogue.routing.map((route) => [
            el('strong', { text: route.typeName }),
            route.process,
            el('div.stack-tight', {}, [
              el('span.badge.badge--info', { text: route.selectedModelName }),
              el('span.muted', { text: route.selectedModelId })
            ]),
            route.addOns.length === 0
              ? el('span.muted', { text: 'none' })
              : el('div.chip-row', {}, route.addOns.map((addOn) => el('span.chip.chip--sm', { text: addOn }))),
            formatNumber(route.queryFieldCount),
            el(
              'div.chip-row',
              {},
              route.candidates.map((candidate) =>
                el('span.chip.chip--sm', {
                  text: `${candidate.name} · ${candidate.pricePerThousandPages === 0 ? 'included' : formatUsd(candidate.pricePerThousandPages)}`
                })
              )
            )
          ]),
          { label: 'Model routing decisions' }
        )
      })
      ].filter(Boolean)
    );
  }

  function metaItem(label, value) {
    return el('div.meta-item', {}, [
      el('span.meta-item__label', { text: label }),
      el('span.meta-item__value', { text: String(value) })
    ]);
  }

  function metaBadge(label, value, variant) {
    return el('div.meta-item', {}, [
      el('span.meta-item__label', { text: label }),
      el(`span.badge.badge--${variant}`, { text: String(value) })
    ]);
  }

  function humanise(key) {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (character) => character.toUpperCase())
      .trim();
  }

  await paint();

  const onRefresh = () => void paint();
  window.addEventListener('vgc:refresh-view', onRefresh);
  return { node, cleanup: () => window.removeEventListener('vgc:refresh-view', onRefresh) };
}
