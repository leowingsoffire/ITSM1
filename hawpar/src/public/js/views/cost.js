/**
 * Cost & Value — interactive Azure TCO model for the VGC rollout.
 *
 * Opens on the signed-off reference profile, which is sized to the agreed
 * S$1,690 monthly run-rate, and reports live variance as assumptions change.
 */
import { api } from '../api.js';
import { azureLogo, logoKeyForService } from '../azure-logos.js';
import { icon } from '../icons.js';
import { debounce, el, formatNumber, formatPercent, formatSgd, formatUsd, toast } from '../util.js';
import { card, dataTable, kpi, numberInput, pageHeader, select } from './common.js';

const APP_SERVICE_OPTIONS = [
  { value: 'B1', label: 'B1 — 1 vCPU / 1.75 GB (dev/test)' },
  { value: 'B2', label: 'B2 — 2 vCPU / 3.5 GB (dev/test)' },
  { value: 'P0v3', label: 'P0v3 — 1 vCPU / 4 GB' },
  { value: 'P1v3', label: 'P1v3 — 2 vCPU / 8 GB (recommended)' },
  { value: 'P2v3', label: 'P2v3 — 4 vCPU / 16 GB' }
];

const SGD = (value) => `S$${formatNumber(Math.round(value))}`;

/** Budget meter: projected spend against the agreed monthly run-rate. */
function budgetMeter(projection) {
  const ratio = Math.min(1.35, projection.totalMonthlySgd / projection.budgetSgd);
  const over = !projection.withinBudget;
  const fill = el(`div.budget__fill${over ? '.budget__fill--over' : ''}`);

  // Paint on the next frame so the width transition actually runs.
  requestAnimationFrame(() => {
    fill.style.width = `${Math.min(100, ratio * 100).toFixed(1)}%`;
  });

  const varianceText = over
    ? `${SGD(Math.abs(projection.budgetVarianceSgd))} over plan`
    : `${SGD(Math.abs(projection.budgetVarianceSgd))} under plan`;

  return el('div.budget', {}, [
    el('div.budget__head', {}, [
      el('span.budget__value', { text: SGD(projection.totalMonthlySgd) }),
      el('span.budget__of', { text: `of ${SGD(projection.budgetSgd)} agreed monthly budget` }),
      el(`span.badge.badge--${over ? 'danger' : 'success'}`, { style: { marginLeft: 'auto' } }, [
        icon(over ? 'alert' : 'checkCircle', { size: 12 }),
        el('span', { text: over ? 'Over budget' : 'Within budget' })
      ])
    ]),
    el('div.budget__track', {}, [fill]),
    el('div.budget__legend', {}, [
      el('span', { text: `${formatUsd(projection.totalMonthlyUsd)} · ${projection.region}` }),
      el('span', { text: `${varianceText} · ${SGD(projection.annualSgd)} per year` })
    ])
  ]);
}

/** Service name cell, badged with the official Azure product icon where one exists. */
function serviceCell(name) {
  const logo = azureLogo(logoKeyForService(name), { size: 18, decorative: true });
  return el('span.service-cell', {}, [logo, el('span', { text: name })]);
}

/** Horizontal split of the monthly bill by service, with animated fills. */
function costSplit(lineItems) {
  const total = lineItems.reduce((sum, item) => sum + item.monthlyUsd, 0) || 1;
  const palette = ['var(--navy-600)', 'var(--amber-500)', 'var(--jade-500)', 'var(--violet-500)', 'var(--teal-500)', 'var(--crimson-500)', 'var(--slate-400)'];

  return el(
    'div.cost-split',
    {},
    lineItems.map((item, index) => {
      const share = (item.monthlyUsd / total) * 100;
      const fill = el('div.cost-split__fill', { style: { background: palette[index % palette.length] } });
      requestAnimationFrame(() => {
        fill.style.width = `${share.toFixed(1)}%`;
      });
      return el('div.cost-split__row', {}, [
        el('span.cost-split__name', {}, [
          azureLogo(logoKeyForService(item.service), { size: 16, decorative: true })
            ?? el('span.dot', { style: { background: palette[index % palette.length] } }),
          el('span', { text: item.service })
        ]),
        el('span.cost-split__amount', { text: `${formatUsd(item.monthlyUsd)} · ${share.toFixed(1)}%` }),
        el('div.cost-split__track', {}, [fill])
      ]);
    })
  );
}

export async function render() {
  const node = el('div.view');
  const priceBook = await api.priceBook();

  // Seeded from the server so the screen opens on the signed-off configuration.
  const reference = await api.estimateCost({});
  const inputs = { ...reference.assumptions };

  const resultHost = el('div');

  const recalculate = debounce(async () => {
    let projection;
    try {
      projection = await api.estimateCost(inputs);
    } catch (error) {
      toast('Could not recalculate the projection.', 'error');
      return;
    }

    resultHost.replaceChildren(
      budgetMeter(projection),
      el('div', { style: { height: '16px' } }),
      el('div.grid.grid--kpi.stagger', { style: { marginBottom: '16px' } }, [
        kpi({
          label: 'Monthly Azure cost',
          value: formatSgd(projection.totalMonthlySgd),
          hint: `${formatUsd(projection.totalMonthlyUsd)} · ${formatNumber(projection.totalPages)} pages/month`,
          tone: projection.withinBudget ? 'good' : 'bad',
          icon: 'wallet',
          countTo: projection.totalMonthlySgd,
          format: (value) => formatSgd(value)
        }),
        kpi({
          label: 'Cost per document',
          value: formatSgd(projection.costPerDocumentSgd),
          hint: `${formatUsd(projection.costPerDocumentUsd)} · S$${projection.costPerPageSgd.toFixed(4)} per page`,
          icon: 'documents'
        }),
        kpi({
          label: 'Saved by adaptive routing',
          value: formatUsd(projection.routingSavingUsd),
          hint: `${formatPercent(projection.routingSavingPercent)} vs prebuilt-only`,
          tone: 'good',
          icon: 'route',
          trend: { direction: 'down', text: `${formatPercent(projection.routingSavingPercent)} cheaper` }
        }),
        kpi({
          label: 'Manual baseline',
          value: formatSgd(projection.manualBaselineSgd),
          hint: `${formatNumber(projection.manualHoursPerMonth)} hours of keying avoided`,
          icon: 'clock'
        }),
        kpi({
          label: 'Net monthly benefit',
          value: formatSgd(projection.netMonthlyBenefitSgd),
          hint: `${projection.roiMultiple.toFixed(1)}× return on Azure spend`,
          tone: 'good',
          icon: 'trendUp',
          trend: { direction: 'up', text: `${projection.roiMultiple.toFixed(1)}× ROI` }
        })
      ]),
      el('div.grid.grid--2', {}, [
        card({
          title: 'Monthly line items',
          subtitle: `${priceBook.region} · pay-as-you-go list prices reviewed ${priceBook.lastReviewed}`,
          icon: 'scale',
          body: dataTable(
            [{ label: 'Service' }, { label: 'Detail' }, { label: 'Monthly (USD)', numeric: true }],
            projection.lineItems.map((item) => [serviceCell(item.service), item.detail, formatUsd(item.monthlyUsd)]),
            { label: 'Monthly cost line items' }
          ),
          flush: true
        }),
        card({
          title: 'Cost distribution',
          subtitle: 'Share of the monthly bill by service',
          icon: 'layers',
          tone: 'violet',
          body: costSplit(projection.lineItems)
        })
      ])
    );
  }, 200);

  const controls = el('div.grid.grid--3', {}, [
    numberInput({ id: 'cost-docs', label: 'Documents per month', value: inputs.documentsPerMonth, min: 0, max: 5000000, step: 100, onChange: (value) => { inputs.documentsPerMonth = value; recalculate(); } }),
    numberInput({ id: 'cost-pages', label: 'Average pages per document', value: inputs.averagePages, min: 1, max: 2000, onChange: (value) => { inputs.averagePages = value; recalculate(); } }),
    select({ id: 'cost-sku', label: 'App Service plan', value: inputs.appServiceSku, options: APP_SERVICE_OPTIONS, onChange: (value) => { inputs.appServiceSku = value; recalculate(); } }),
    numberInput({ id: 'cost-instances', label: 'App Service instances', value: inputs.appServiceInstances, min: 1, max: 20, onChange: (value) => { inputs.appServiceInstances = value; recalculate(); } }),
    numberInput({ id: 'cost-storage', label: 'Blob storage (GB)', value: inputs.storageGb, min: 0, max: 100000, step: 5, onChange: (value) => { inputs.storageGb = value; recalculate(); } }),
    numberInput({ id: 'cost-logs', label: 'Log Analytics ingest (GB)', value: inputs.logGb, min: 0, max: 10000, onChange: (value) => { inputs.logGb = value; recalculate(); } }),
    numberInput({ id: 'cost-endpoints', label: 'Private endpoints', value: inputs.privateEndpoints, min: 0, max: 30, onChange: (value) => { inputs.privateEndpoints = value; recalculate(); } }),
    numberInput({ id: 'cost-layout', label: 'Pages needing Layout (%)', value: inputs.layoutSharePercent, min: 0, max: 100, onChange: (value) => { inputs.layoutSharePercent = value; recalculate(); } }),
    el('div.field', {}, [
      el('label', { text: 'Model routing' }),
      el('label.switch', {}, [
        el('input', {
          type: 'checkbox',
          checked: inputs.adaptiveRouting,
          on: { change: (event) => { inputs.adaptiveRouting = event.target.checked; recalculate(); } }
        }),
        el('span', { text: 'Adaptive Read/Layout routing' })
      ])
    ])
  ]);

  const resetButton = el('button.btn.btn--ghost.btn--sm', {
    type: 'button',
    on: {
      click: () => {
        Object.assign(inputs, reference.assumptions);
        // Push the reference values back into the bound controls.
        for (const [id, key] of Object.entries({
          'cost-docs': 'documentsPerMonth',
          'cost-pages': 'averagePages',
          'cost-instances': 'appServiceInstances',
          'cost-storage': 'storageGb',
          'cost-logs': 'logGb',
          'cost-endpoints': 'privateEndpoints',
          'cost-layout': 'layoutSharePercent'
        })) {
          const field = controls.querySelector(`#${id}`);
          if (field) field.value = String(inputs[key]);
        }
        const sku = controls.querySelector('#cost-sku');
        if (sku) sku.value = inputs.appServiceSku;
        const routing = controls.querySelector('.switch input');
        if (routing) routing.checked = inputs.adaptiveRouting;
        recalculate();
        toast('Restored the signed-off reference profile.', 'success');
      }
    }
  }, [icon('refresh', { size: 14 }), el('span', { text: 'Reset to agreed plan' })]);

  // Every row here is a Document Intelligence model, so they all carry that product icon.
  const catalogue = Object.values(priceBook.documentIntelligence).map((entry) => [
    el('span.service-cell', {}, [
      azureLogo('document-intelligence', { size: 18, decorative: true }),
      el('span', { text: entry.label })
    ]),
    entry.id,
    entry.pricePerThousandPages === 0 ? 'Free tier' : formatUsd(entry.pricePerThousandPages)
  ]);

  node.append(
    pageHeader({
      title: 'Cost & Value',
      subtitle: 'Model the monthly Azure bill for VGC and quantify the saving delivered by adaptive model routing.',
      icon: 'cost',
      actions: [resetButton]
    }),
    el('div.inline-note', {}, [
      icon('info', { size: 16 }),
      el('span', {
        text: 'Cost lever: text-centric documents are analysed with prebuilt-read at US$1.50 per 1,000 pages instead of prebuilt-layout at US$10. VGC business rules then run locally at zero marginal cost.'
      })
    ]),
    card({ title: 'Assumptions', subtitle: 'Signed-off reference profile — adjust to model your own volumes', icon: 'gauge', tone: 'teal', body: controls }),
    el('div', { style: { height: '16px' } }),
    resultHost,
    el('div', { style: { height: '16px' } }),
    el('div.grid.grid--2', {}, [
      card({
        title: 'Document Intelligence price book',
        subtitle: 'Per 1,000 pages, pay-as-you-go',
        icon: 'database',
        body: dataTable([{ label: 'Model' }, { label: 'Model id' }, { label: 'Per 1,000 pages', numeric: true }], catalogue, {
          label: 'Document Intelligence price book'
        }),
        flush: true
      }),
      card({
        title: 'How we keep the bill low',
        subtitle: 'Seven levers built into the platform',
        icon: 'sparkles',
        tone: 'amber',
        body: el('ul', { style: { margin: 0, paddingLeft: '18px', fontSize: '13px', lineHeight: '1.7' } }, [
          el('li', { text: 'Adaptive routing: Layout only for table-critical documents; Read for everything else.' }),
          el('li', { text: 'One-page triage on long documents so classification never pays for full Layout twice.' }),
          el('li', { text: 'Business rules, classification and validation execute in-process — no per-call AI charges.' }),
          el('li', { text: 'Linux App Service on P1v3 with autoscale; scale-out only during month-end peaks.' }),
          el('li', { text: 'Managed identity instead of stored keys removes Key Vault secret-rotation overhead.' }),
          el('li', { text: 'Blob lifecycle policy moves processed originals to cool storage after 30 days.' }),
          el('li', { text: 'Log Analytics sampling keeps ingest predictable against the agreed monthly budget.' })
        ])
      })
    ])
  );

  recalculate();
  return { node };
}
