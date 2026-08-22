/**
 * Template Studio — template detail: field summary, Excel mapping, run new
 * documents through the trained extractor, and download prior runs.
 */
import { api, ApiError } from '../api.js';
import { el, formatTime, toast } from '../util.js';
import { icon } from '../icons.js';
import { card, dataTable, emptyState, pageHeader } from './common.js';

function dropzoneMulti(onFiles) {
  const input = el('input', {
    type: 'file',
    multiple: true,
    accept: '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp',
    style: { display: 'none' },
    on: {
      change: (event) => {
        const files = [...event.target.files];
        event.target.value = '';
        if (files.length > 0) onFiles(files);
      }
    }
  });
  const zone = el('div.dropzone.dropzone--compact', { role: 'button', tabIndex: 0 }, [
    el('div.dropzone__icon', {}, [icon('upload', { size: 22 })]),
    el('p', { text: 'Drag one or more new documents here, or click to browse' }),
    el('p.text-muted', { text: 'Each file is analysed and every trained field is extracted automatically.' }),
    input
  ]);
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  ['dragenter', 'dragover'].forEach((name) =>
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.add('is-dragging');
    })
  );
  ['dragleave', 'drop'].forEach((name) =>
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.remove('is-dragging');
    })
  );
  zone.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length > 0) onFiles(files);
  });
  return zone;
}

export async function render(params) {
  const node = el('div.view');
  const templateId = params.id;

  let template;
  try {
    template = await api.getTemplate(templateId);
  } catch (error) {
    node.append(
      emptyState('Template not found', error instanceof ApiError ? error.message : 'This template could not be loaded.', null, 'alert')
    );
    return { node, cleanup: () => {} };
  }

  const runResultBody = el('div');
  const runHistoryBody = el('div');

  function confidenceBadge(value) {
    const tier = value >= 0.75 ? 'success' : value >= 0.4 ? 'warn' : 'danger';
    return el(`span.badge.badge--${tier}`, { text: `${Math.round((value ?? 0) * 100)}%` });
  }

  function paintRunResult(run) {
    const rows = run.documents.flatMap((document) =>
      document.fields.map((field) => [
        document.fileName,
        field.label,
        field.displayValue || field.rawText || '—',
        confidenceBadge(field.confidence)
      ])
    );
    runResultBody.replaceChildren(
      el('div', {}, [
        el('div.row', { style: { justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' } }, [
          el('span.badge.badge--success', { text: `${run.documents.length} document(s) processed` }),
          el('a.btn.btn--primary.btn--sm', {
            href: `/api/templates/${encodeURIComponent(template.id)}/runs/${encodeURIComponent(run.id)}/export.xlsx`,
            text: 'Download Excel export'
          })
        ]),
        dataTable(
          [{ label: 'Document' }, { label: 'Field' }, { label: 'Extracted value' }, { label: 'Confidence' }],
          rows,
          { emptyMessage: 'No fields were configured on this template.', label: 'Run results' }
        )
      ])
    );
  }

  async function paintRunHistory() {
    try {
      const { items } = await api.listTemplateRuns(template.id);
      if (items.length === 0) {
        runHistoryBody.replaceChildren(el('p.text-muted', { text: 'No extraction runs yet.' }));
        return;
      }
      runHistoryBody.replaceChildren(
        dataTable(
          [{ label: 'Run' }, { label: 'Documents', numeric: true }, { label: 'Created' }, { label: '' }],
          items.map((run) => [
            run.id.slice(0, 8),
            String(run.documentCount),
            formatTime(run.createdAt),
            el('a.btn.btn--ghost.btn--sm', {
              href: `/api/templates/${encodeURIComponent(template.id)}/runs/${encodeURIComponent(run.id)}/export.xlsx`,
              text: 'Download'
            })
          ]),
          { emptyMessage: 'No extraction runs yet.', label: 'Run history' }
        )
      );
    } catch (error) {
      runHistoryBody.replaceChildren(el('p.text-muted', { text: 'Could not load run history.' }));
    }
  }

  async function runFiles(files) {
    toast(`Extracting ${files.length} document(s)…`, 'info');
    try {
      const run = await api.runTemplate(template.id, files);
      toast('Extraction complete.', 'success');
      paintRunResult(run);
      await paintRunHistory();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Extraction failed.', 'error', 7000);
    }
  }

  const fieldsTable = dataTable(
    [{ label: 'Field' }, { label: 'Key' }, { label: 'Type' }, { label: 'Page', numeric: true }, { label: 'Critical' }],
    template.regions.map((region) => [
      region.label,
      region.key,
      region.type,
      String(region.pageNumber),
      region.critical ? el('span.badge.badge--warn', { text: 'Yes' }) : el('span.text-muted', { text: 'No' })
    ]),
    { emptyMessage: 'No fields trained yet.', label: 'Trained fields' }
  );

  const excelSummary = template.excelTemplate
    ? el('div', {}, [
        el('p', { text: `Matches "${template.excelTemplate.fileName}" — sheet "${template.excelTemplate.sheetName}".` }),
        dataTable(
          [{ label: 'Column' }, { label: 'Maps to' }],
          template.excelTemplate.columns.map((column) => {
            const target = template.excelTemplate.mappings[column.index];
            const region = template.regions.find((candidate) => candidate.key === target);
            return [`${column.column} — "${column.header}"`, region ? region.label : target ? target.replace('__', 'System: ') : '— Not mapped —'];
          }),
          { label: 'Excel mapping' }
        )
      ])
    : el('p.text-muted', { text: 'No Excel layout attached — exports use the trained field order as columns.' });

  node.append(
    pageHeader({
      title: template.name,
      icon: 'crop',
      subtitle: template.description || `Trained from ${template.sourceFileName ?? 'a sample document'} · ${template.regions.length} field(s)`,
      actions: [
        el('a.btn.btn--ghost', { href: '#/templates', text: '← All templates' }),
        el('a.btn.btn--primary', { href: `#/templates/edit/${encodeURIComponent(template.id)}`, text: 'Edit template' })
      ]
    }),
    card({ title: 'Trained fields', icon: 'target', body: fieldsTable }),
    el('div', { style: { height: '14px' } }),
    card({ title: 'Excel/requirement template match', icon: 'table', tone: 'violet', body: excelSummary }),
    el('div', { style: { height: '14px' } }),
    card({
      title: 'Run extraction on new documents',
      icon: 'bolt',
      tone: 'amber',
      body: el('div', {}, [dropzoneMulti(runFiles), el('div', { style: { height: '12px' } }), runResultBody])
    }),
    el('div', { style: { height: '14px' } }),
    card({ title: 'Run history', icon: 'history', body: runHistoryBody })
  );

  await paintRunHistory();

  return { node, cleanup: () => {} };
}
