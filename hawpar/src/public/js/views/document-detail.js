/**
 * Document workspace — side-by-side OCR viewer and verification panel.
 */
import { api, ApiError } from '../api.js';
import { azureLogo } from '../azure-logos.js';
import { refreshCounters } from '../store.js';
import {
  confidenceChip,
  el,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatSgd,
  formatUsd,
  statusBadge,
  svgEl,
  toast
} from '../util.js';
import { card, confirmDialog, dataTable, emptyState, pageHeader, stageStrip, tabGroup } from './common.js';

const VIEWER_WIDTH = 1000;
const LOW_CONFIDENCE_LINE = 0.85;
const MAX_RENDERED_LINES = 400;

/* ── OCR page viewer ──────────────────────────────────────────────────────── */

function renderPageSvg(payload, activeFieldKey) {
  const { page, fieldAnchors } = payload;
  const ratio = page.height > 0 && page.width > 0 ? page.height / page.width : 1.414;
  const height = Math.round(VIEWER_WIDTH * ratio);

  const svg = svgEl('svg', {
    class: 'page-svg',
    viewBox: `0 0 ${VIEWER_WIDTH} ${height}`,
    role: 'img',
    'aria-label': `Page ${page.pageNumber} optical character recognition overlay`
  });

  svg.append(svgEl('rect', { x: 0, y: 0, width: VIEWER_WIDTH, height, fill: '#ffffff' }));

  for (const line of page.lines.slice(0, MAX_RENDERED_LINES)) {
    const [x, y, w, h] = line.box;
    const boxX = x * VIEWER_WIDTH;
    const boxY = y * height;
    const boxW = Math.max(2, w * VIEWER_WIDTH);
    const boxH = Math.max(6, h * height);
    const isLow = line.confidence < LOW_CONFIDENCE_LINE;

    const rect = svgEl('rect', {
      class: `ocr-line${isLow ? ' ocr-line--low' : ''}`,
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      rx: 1.5
    });
    rect.append(svgEl('title', {}, `${line.content}  (${Math.round(line.confidence * 100)}%)`));
    svg.append(rect);

    const isHeading = line.role === 'title' || line.role === 'sectionHeading';
    svg.append(
      svgEl(
        'text',
        {
          class: 'ocr-text',
          x: boxX + 2,
          y: boxY + boxH * 0.78,
          'font-size': Math.max(7, boxH * 0.72),
          'font-weight': isHeading ? '700' : '400'
        },
        line.content
      )
    );
  }

  for (const anchor of fieldAnchors) {
    const [x, y, w, h] = anchor.box;
    const rect = svgEl('rect', {
      class: `anchor${anchor.key === activeFieldKey ? ' anchor--active' : ''}`,
      x: x * VIEWER_WIDTH - 3,
      y: y * height - 3,
      width: Math.max(6, w * VIEWER_WIDTH) + 6,
      height: Math.max(8, h * height) + 6,
      rx: 3
    });
    rect.append(svgEl('title', {}, `${anchor.label} (${anchor.status})`));
    svg.append(rect);
  }

  return svg;
}

function buildViewer(record) {
  const canvas = el('div.viewer__canvas');
  const pageInput = el('input.viewer__page-input', { type: 'number', min: 1, max: record.pageCount, value: 1 });
  const meta = el('span.text-muted');
  const stored = record.pageIndex.length;

  const viewerState = { pageNumber: 1, activeFieldKey: null, payload: null };

  async function load(pageNumber) {
    const target = Math.min(Math.max(1, Number(pageNumber) || 1), stored);
    viewerState.pageNumber = target;
    pageInput.value = String(target);
    canvas.replaceChildren(el('p.text-muted', { text: 'Rendering page…' }));
    try {
      viewerState.payload = await api.getPage(record.id, target);
      canvas.replaceChildren(renderPageSvg(viewerState.payload, viewerState.activeFieldKey));
      const page = viewerState.payload.page;
      meta.textContent = `${page.lines.length} lines · ${page.quality} · skew ${page.angle}°`;
    } catch (error) {
      canvas.replaceChildren(el('p.text-muted', { text: 'This page could not be rendered.' }));
    }
  }

  function focusField(field) {
    if (!field?.pageNumber) return;
    viewerState.activeFieldKey = field.key;
    if (field.pageNumber === viewerState.pageNumber && viewerState.payload) {
      canvas.replaceChildren(renderPageSvg(viewerState.payload, field.key));
    } else {
      load(field.pageNumber);
    }
  }

  pageInput.addEventListener('change', () => load(pageInput.value));

  const toolbar = el('div.viewer__toolbar', {}, [
    el('button.btn.btn--ghost.btn--sm', {
      type: 'button',
      text: '‹ Prev',
      on: { click: () => load(viewerState.pageNumber - 1) }
    }),
    pageInput,
    el('span.text-muted', { text: `/ ${formatNumber(stored)}${record.pagesTruncated ? ` of ${formatNumber(record.pageCount)}` : ''}` }),
    el('button.btn.btn--ghost.btn--sm', {
      type: 'button',
      text: 'Next ›',
      on: { click: () => load(viewerState.pageNumber + 1) }
    }),
    meta,
    el('a.btn.btn--ghost.btn--sm', {
      href: `/api/documents/${encodeURIComponent(record.id)}/text`,
      target: '_blank',
      rel: 'noreferrer',
      text: 'Raw text',
      style: { marginLeft: 'auto' }
    })
  ]);

  const node = el('section.card.viewer', {}, [toolbar, canvas]);
  load(1);
  return { node, focusField };
}

/* ── Field verification panel ─────────────────────────────────────────────── */

function fieldRow(record, field, onFocus, onSaved) {
  const input = el('input', { type: 'text', value: field.rawValue ?? '', 'aria-label': field.label });
  const statusVariant = { accepted: 'success', 'needs-review': 'warn', missing: 'danger' }[field.status] ?? 'neutral';
  const statusLabel = { accepted: 'Accepted', 'needs-review': 'Verify', missing: 'Missing' }[field.status] ?? field.status;
  const status = el(`span.badge.badge--${statusVariant}`, { text: statusLabel });

  const save = el('button.btn.btn--primary.btn--sm', {
    type: 'button',
    text: 'Save',
    on: {
      click: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const result = await api.updateField(record.id, field.key, input.value);
          toast(`${field.label} updated and re-validated.`, 'success');
          onSaved(result);
        } catch (error) {
          toast(error instanceof ApiError ? error.message : 'Could not save the correction.', 'error');
        } finally {
          button.disabled = false;
        }
      }
    }
  });

  const row = el(`div.field-row.is-${field.status === 'accepted' ? 'accepted' : field.status === 'missing' ? 'missing' : 'review'}`, {
    on: { click: () => onFocus(field) }
  }, [
    el('div.field-row__head', {}, [
      el('span.field-row__label', { text: field.label }),
      field.critical ? el('span.badge.badge--info', { text: 'critical' }) : null,
      status,
      el('div.field-row__meta', {}, [
        field.pageNumber ? el('span', { text: `p.${field.pageNumber}` }) : null,
        el('span', { text: field.source }),
        confidenceChip(field.confidence)
      ])
    ]),
    el('div.field-row__value', {}, [input, save]),
    el('span.field-row__raw', {
      text: `${field.type}${field.unit ? ` · ${field.unit}` : ''}${field.currency ? ` · ${field.currency}` : ''} · normalised: ${field.value ?? '—'}${field.edited ? ' · human verified' : ''}`
    })
  ]);

  return row;
}

/* ── Tab panels ───────────────────────────────────────────────────────────── */

const VERDICT_VARIANT = Object.freeze({
  verified: 'success',
  probable: 'info',
  unverified: 'warn',
  conflict: 'danger',
  missing: 'neutral'
});

const CHECK_STATUS_CLASS = Object.freeze({
  pass: 'is-pass',
  fail: 'is-fail',
  'not-applicable': 'is-skip'
});

/**
 * Per-field assurance evidence.
 *
 * This is where the platform's accuracy claim becomes auditable: every check,
 * its outcome, and — critically — what a failure proves. A failing arithmetic
 * check means the *document* disagrees with itself, so the reviewer must query
 * the issuer rather than re-key a value that was transcribed correctly.
 */
function assurancePanel(accuracy) {
  if (!accuracy || !Array.isArray(accuracy.fields) || accuracy.fields.length === 0) {
    return emptyState(
      'No assurance evidence',
      'This document has not been scored by the accuracy engine yet.',
      null,
      'target'
    );
  }

  const summary = el('div.chip-row', {}, [
    el(`span.badge.badge--${accuracy.accuracyScore >= 0.9 ? 'success' : accuracy.accuracyScore >= 0.75 ? 'warn' : 'danger'}`, {
      text: `extraction accuracy ${formatPercent(accuracy.accuracyScore * 100)}`
    }),
    el(`span.badge.badge--${(accuracy.integrityIssueCount ?? 0) === 0 ? 'success' : 'warn'}`, {
      text: `document integrity ${formatPercent((accuracy.integrityScore ?? 1) * 100)}`
    }),
    el('span.badge.badge--info', {
      text: `calibrated confidence ${formatPercent(accuracy.calibratedConfidence * 100)}`
    }),
    el('span.badge.badge--neutral', { text: `${formatNumber(accuracy.checksRun)} checks run` }),
    el(`span.badge.badge--${accuracy.straightThroughEligible ? 'success' : 'neutral'}`, {
      text: accuracy.straightThroughEligible ? 'straight-through eligible' : 'human review required'
    })
  ]);

  const fields = accuracy.fields.map((field) =>
    el('div.assurance__field', {}, [
      el('div.assurance__head', {}, [
        el('span.assurance__label', { text: field.label }),
        field.critical ? el('span.badge.badge--info', { text: 'critical' }) : null,
        el(`span.badge.badge--${VERDICT_VARIANT[field.verdict] ?? 'neutral'}`, { text: field.verdict }),
        field.integrity === 'disputed'
          ? el('span.badge.badge--warn', { text: 'document disputes this value' })
          : null,
        field.repaired ? el('span.badge.badge--warn', { text: 'auto-repaired' }) : null,
        el('span.assurance__conf', {
          text: `model ${formatPercent((field.modelConfidence ?? 0) * 100)} → calibrated ${formatPercent((field.calibratedConfidence ?? 0) * 100)}`
        })
      ]),
      el('p.assurance__value', { text: field.value ?? '— not found —' }),
      field.integrityDetail ? el('p.assurance__integrity', { text: field.integrityDetail }) : null,
      field.repairRule ? el('p.assurance__integrity', { text: `Auto-repair applied: ${field.repairRule}` }) : null,
      el(
        'ul.assurance__checks',
        {},
        (field.checks ?? []).map((entry) =>
          el(`li.assurance__check.${CHECK_STATUS_CLASS[entry.status] ?? 'is-skip'}`, {}, [
            el('span.assurance__check-name', { text: entry.name }),
            el(`span.badge.badge--${entry.attribution === 'document' ? 'warn' : 'info'}`, {
              text: entry.attribution === 'document' ? 'document' : 'extraction'
            }),
            el('span.assurance__check-detail', { text: entry.detail })
          ])
        )
      )
    ])
  );

  return el('div.assurance', {}, [summary, ...fields]);
}

function validationPanel(validation) {
  if (validation.issues.length === 0) {
    return el('div', {}, [
      el('div.inline-note', {}, [el('span', { text: `All ${validation.rulesEvaluated} business rules passed.` })])
    ]);
  }
  return el(
    'div',
    {},
    validation.issues.map((issue) =>
      el(`div.issue.issue--${issue.severity}`, {}, [
        el(`span.dot.dot--${issue.severity === 'error' ? 'danger' : 'warn'}`, { style: { marginTop: '5px' } }),
        el('div.issue__body', {}, [
          el('strong', { text: issue.message }),
          el('p', { text: issue.description || 'No further detail.' }),
          el('small', { text: `Rule: ${issue.rule}${issue.fieldKeys.length > 0 ? ` · Fields: ${issue.fieldKeys.join(', ')}` : ''}` })
        ])
      ])
    )
  );
}

function tablesPanel(tables) {
  if (tables.length === 0) return el('p.text-muted', { text: 'No tables were detected in this document.' });
  return el(
    'div',
    {},
    tables.map((table) =>
      el('div', { style: { marginBottom: '18px' } }, [
        el('h4', { text: `${table.title} — page ${table.pageNumber} (${table.rowCount}×${table.columnCount})`, style: { margin: '0 0 8px', fontSize: '13px' } }),
        dataTable(
          table.columns.map((column, index) => ({ label: column, numeric: index > 0 })),
          table.rows.slice(0, 40).map((row) => row.map((cell) => String(cell))),
          { label: `${table.title} (page ${table.pageNumber})` }
        ),
        table.rows.length > 40 ? el('p.text-muted', { text: `Showing 40 of ${table.rows.length} rows.` }) : null
      ])
    )
  );
}

function qualityPanel(record) {
  const quality = record.quality ?? {};
  return el('dl.kv-list', {}, [
    el('dt', { text: 'Analysis engine' }),
    el('dd', {}, [
      record.engine === 'azure'
        ? el('span.service-cell', {}, [
            azureLogo('document-intelligence', { size: 18, decorative: true }),
            el('span', { text: `Azure AI Document Intelligence (${record.modelId})` })
          ])
        : el('span', { text: 'Offline demo engine' })
    ]),
    el('dt', { text: 'Recommended model' }),
    el('dd', { text: record.recommendedModel ?? '—' }),
    record.fallbackReason ? el('dt', { text: 'Fallback reason' }) : null,
    record.fallbackReason ? el('dd', { text: record.fallbackReason }) : null,
    el('dt', { text: 'Average OCR confidence' }),
    el('dd', { text: formatPercent((quality.averageOcrConfidence ?? 0) * 100) }),
    el('dt', { text: 'Low-confidence lines' }),
    el('dd', { text: formatNumber(quality.lowConfidenceLines ?? 0) }),
    el('dt', { text: 'Words recognised' }),
    el('dd', { text: formatNumber(quality.wordCount ?? 0) }),
    el('dt', { text: 'Degraded scan pages' }),
    el('dd', { text: (quality.degradedPages ?? []).length > 0 ? quality.degradedPages.join(', ') : 'None' }),
    el('dt', { text: 'Handwriting detected' }),
    el('dd', { text: quality.handwrittenRatio ? formatPercent(quality.handwrittenRatio * 100) : 'None' }),
    el('dt', { text: 'Languages' }),
    el('dd', { text: (quality.languages ?? []).map((entry) => `${entry.locale} (${Math.round(entry.confidence * 100)}%)`).join(', ') || '—' }),
    el('dt', { text: 'File' }),
    el('dd', { text: `${formatBytes(record.fileSize)} · ${record.mimeType}` }),
    el('dt', { text: record.engine === 'azure' ? 'Azure cost' : 'Modelled Azure cost' }),
    el('dd', {
      text: `${formatUsd(record.cost?.modelledUsd ?? record.cost?.estimatedUsd ?? 0)} (${record.cost?.selectedModel ?? '—'})${record.engine === 'azure' ? '' : ' — not billed on the demo engine'}`
    }),
    el('dt', { text: 'Manual effort avoided' }),
    el('dd', { text: `${record.cost?.manualEffortMinutes ?? 0} min · ${formatSgd(record.cost?.manualCostSgd ?? 0)}` })
  ]);
}

function classificationPanel(record) {
  const classification = record.classification ?? {};
  return el('div', {}, [
    el('dl.kv-list', { style: { marginBottom: '14px' } }, [
      el('dt', { text: 'Type' }),
      el('dd', { text: classification.typeName ?? 'Unclassified' }),
      el('dt', { text: 'Business unit' }),
      el('dd', { text: classification.businessUnit ?? '—' }),
      el('dt', { text: 'Business process' }),
      el('dd', { text: classification.process ?? '—' }),
      el('dt', { text: 'Confidence' }),
      el('dd', {}, [confidenceChip(classification.confidence ?? 0)])
    ]),
    el('h4', { text: 'Evidence', style: { margin: '0 0 6px', fontSize: '12.5px' } }),
    el('ul', { style: { margin: '0 0 14px', paddingLeft: '18px', fontSize: '12.5px' } },
      (classification.evidence ?? []).map((entry) => el('li', { text: entry }))),
    el('h4', { text: 'Runner-up types', style: { margin: '0 0 6px', fontSize: '12.5px' } }),
    dataTable(
      [{ label: 'Type' }, { label: 'Score', numeric: true }],
      (classification.alternatives ?? []).map((entry) => [entry.name, String(entry.score)]),
      { emptyMessage: 'No close alternatives.', label: 'Runner-up document types' }
    )
  ]);
}

function auditPanel(audit) {
  return dataTable(
    [{ label: 'When' }, { label: 'Actor' }, { label: 'Action' }, { label: 'Detail' }],
    [...audit].reverse().map((entry) => [formatDateTime(entry.at), entry.actor, entry.action, entry.detail ?? '—']),
    { emptyMessage: 'No audit entries.', label: 'Audit trail' }
  );
}

/* ── View ─────────────────────────────────────────────────────────────────── */

export async function render(params) {
  const node = el('div.view');
  let record;
  try {
    record = await api.getDocument(params.id);
  } catch (error) {
    node.append(
      pageHeader({ title: 'Document not found', icon: 'alert' }),
      emptyState('We could not open that document', error.message, el('a.btn.btn--primary', { href: '#/documents', text: 'Back to library' }), 'alert')
    );
    return { node };
  }

  if (record.status === 'queued' || record.status === 'processing') {
    node.append(
      pageHeader({ title: record.fileName, icon: 'clock', subtitle: 'This document is still being processed.' }),
      card({ title: 'Pipeline progress', icon: 'route', tone: 'amber', body: stageStrip(record.stages) }),
      el('div', { style: { height: '12px' } }),
      el('button.btn.btn--primary', { type: 'button', text: 'Refresh', on: { click: () => window.dispatchEvent(new CustomEvent('vgc:refresh-view')) } })
    );
    return { node };
  }

  if (record.status === 'failed') {
    const removeFailedDocument = async () => {
      const confirmed = await confirmDialog({
        title: 'Delete this document?',
        message: `"${record.fileName}" failed processing and will be permanently removed. This cannot be undone.`,
        confirmLabel: 'Delete document',
        tone: 'danger'
      });
      if (!confirmed) return;
      try {
        await api.deleteDocument(record.id);
        toast('Document deleted.', 'success');
        await refreshCounters();
        location.hash = '#/documents';
      } catch (error) {
        toast(error instanceof ApiError ? error.message : 'Could not delete the document.', 'error');
      }
    };
    node.append(
      pageHeader({
        title: record.fileName,
        icon: 'alert',
        subtitle: 'Processing failed.',
        actions: [
          el('a.btn.btn--ghost', { href: '#/documents', text: 'Back to library' }),
          el('button.btn.btn--danger', { type: 'button', text: 'Delete', on: { click: removeFailedDocument } })
        ]
      }),
      card({ title: 'Failure detail', icon: 'alert', tone: 'crimson', body: el('div', {}, [
        el('p', { text: record.error?.message ?? 'Unknown error.' }),
        stageStrip(record.stages)
      ]) }),
      el('div', { style: { height: '16px' } }),
      card({ title: 'Audit trail', icon: 'shield', body: auditPanel(record.audit ?? []), flush: true })
    );
    return { node };
  }

  const viewer = buildViewer(record);
  const fieldsHost = el('div');
  const validationHost = el('div');
  const summaryBar = el('div.row', { style: { marginBottom: '12px' } });

  function paintSummary(current) {
    // replaceChildren() stringifies null into a literal "null" text node, so the
    // optional warning badge has to be filtered out rather than passed through.
    const badges = [
      statusBadge(current.status),
      el('span.badge.badge--neutral', { text: `${formatNumber(current.pageCount)} pages` }),
      el('span.badge.badge--neutral', { text: `${current.fieldCount ?? record.fields.length} fields` }),
      current.validationErrors > 0
        ? el('span.badge.badge--danger', { text: `${current.validationErrors} error(s)` })
        : el('span.badge.badge--success', { text: 'Rules passed' }),
      current.validationWarnings > 0 ? el('span.badge.badge--warn', { text: `${current.validationWarnings} warning(s)` }) : null
    ].filter(Boolean);
    summaryBar.replaceChildren(...badges);
  }

  // Assigned once the tab bar exists further down; corrections can fire before then.
  let updateValidationTabLabel = () => {};

  function paintFields(fields) {
    fieldsHost.replaceChildren(
      ...fields.map((field) =>
        fieldRow(record, field, viewer.focusField, (result) => {
          const index = record.fields.findIndex((candidate) => candidate.key === result.field.key);
          if (index >= 0) record.fields[index] = result.field;
          record.validation = result.validation;
          paintFields(record.fields);
          validationHost.replaceChildren(validationPanel(result.validation));
          updateValidationTabLabel(result.validation.issues.length);
          paintSummary(result.summary);
          refreshCounters().catch(() => {});
        })
      )
    );
  }

  paintFields(record.fields);
  validationHost.replaceChildren(validationPanel(record.validation));
  paintSummary(record.summary);

  const panels = [
    { id: 'fields', label: `Fields (${record.fields.length})`, render: () => fieldsHost },
    { id: 'validation', label: `Validation (${record.validation.issues.length})`, render: () => validationHost },
    {
      id: 'assurance',
      label: `Assurance (${record.accuracy?.fields?.length ?? 0})`,
      render: () => assurancePanel(record.accuracy)
    },
    { id: 'tables', label: `Tables (${record.tables.length})`, render: () => tablesPanel(record.tables) },
    { id: 'classification', label: 'Classification', render: () => classificationPanel(record) },
    { id: 'quality', label: 'Quality & cost', render: () => qualityPanel(record) },
    { id: 'audit', label: 'Audit trail', render: () => auditPanel(record.audit ?? []) }
  ];

  const documentTabs = tabGroup(panels, { label: 'Document detail sections', idPrefix: 'doc-tab' });
  const tabBar = documentTabs.tabBar;

  updateValidationTabLabel = (count) => {
    const tab = tabBar.querySelector('#doc-tab-validation');
    if (tab) tab.textContent = `Validation (${count})`;
  };

  async function decide(decision) {
    try {
      const result = await api.decide(record.id, decision, `${decision === 'approve' ? 'Approved' : 'Rejected'} in the review workspace.`);
      toast(`Document ${decision === 'approve' ? 'approved' : 'rejected'}.`, decision === 'approve' ? 'success' : 'warn');
      paintSummary(result.summary);
      record.status = result.status;
      await refreshCounters();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not record the decision.', 'error');
    }
  }

  async function removeDocument() {
    const confirmed = await confirmDialog({
      title: 'Delete this document?',
      message: `"${record.fileName}" and all of its extracted data will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete document',
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      await api.deleteDocument(record.id);
      toast('Document deleted.', 'success');
      await refreshCounters();
      location.hash = '#/documents';
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not delete the document.', 'error');
    }
  }

  node.append(
    pageHeader({
      title: record.fileName,
      icon: 'documents',
      subtitle: `${record.classification?.typeName ?? 'Unclassified'} · ${record.classification?.businessUnit ?? '—'} · ${record.classification?.process ?? '—'} · processed in ${formatDuration(record.durationMs)}`,
      actions: [
        el('a.btn.btn--ghost', { href: `/api/documents/${encodeURIComponent(record.id)}/export.xlsx`, text: 'Export .xlsx' }),
        el('button.btn.btn--danger', { type: 'button', text: 'Reject', on: { click: () => decide('reject') } }),
        el('button.btn.btn--success', { type: 'button', text: 'Approve', on: { click: () => decide('approve') } }),
        el('button.btn.btn--ghost', { type: 'button', text: 'Delete', on: { click: removeDocument } })
      ]
    }),
    summaryBar,
    stageStrip(record.stages),
    el('div.detail-layout', { style: { marginTop: '14px' } }, [
      viewer.node,
      el('section.card', {}, [documentTabs.node])
    ])
  );

  return { node };
}
