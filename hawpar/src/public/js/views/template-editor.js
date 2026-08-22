/**
 * Template Studio wizard — train (or edit) a custom zonal extraction
 * template: upload a sample document, draw a box over each field, then
 * optionally upload the customer's own Excel/requirement template so future
 * exports match its column layout exactly.
 */
import { api, ApiError } from '../api.js';
import { el, svgEl, toast } from '../util.js';
import { icon } from '../icons.js';
import { card, emptyState, pageHeader } from './common.js';

const VIEWER_WIDTH = 1000;
const FIELD_TYPES = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency amount' },
  { value: 'date', label: 'Date' }
];
const REGION_COLOURS = ['#2c4d78', '#c4791f', '#16a37b', '#a8324a', '#6d4dbf', '#0f7fa8'];
const SYSTEM_COLUMNS = [
  { value: '__fileName', label: 'System: file name' },
  { value: '__processedAt', label: 'System: processed at' },
  { value: '__pageCount', label: 'System: page count' },
  { value: '__confidence', label: 'System: confidence' }
];

function fieldKeySuggestion(label, existingKeys) {
  const base = String(label ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join('') || 'field';
  const safe = /^[a-zA-Z]/.test(base) ? base : `f${base}`;
  let candidate = safe;
  let suffix = 2;
  while (existingKeys.has(candidate)) {
    candidate = `${safe}${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * Renders the current page as an SVG: faint OCR line boxes for orientation,
 * saved region rectangles with labels, and a transparent capture layer that
 * lets the customer drag out a new rectangle.
 */
function pageViewer({ page, regions, onDraw }) {
  const ratio = page.height > 0 && page.width > 0 ? page.height / page.width : 1.414;
  const height = Math.round(VIEWER_WIDTH * ratio);

  const svg = svgEl('svg', {
    class: 'page-svg template-canvas',
    viewBox: `0 0 ${VIEWER_WIDTH} ${height}`,
    role: 'img',
    'aria-label': `Page ${page.pageNumber} — drag to draw a field region`
  });
  svg.append(svgEl('rect', { x: 0, y: 0, width: VIEWER_WIDTH, height, fill: '#ffffff' }));

  for (const line of page.lines.slice(0, 400)) {
    if (!line.box) continue;
    const [x, y, w, h] = line.box;
    const rect = svgEl('rect', {
      class: 'ocr-line',
      x: x * VIEWER_WIDTH,
      y: y * height,
      width: Math.max(2, w * VIEWER_WIDTH),
      height: Math.max(6, h * height),
      rx: 1.5
    });
    rect.append(svgEl('title', {}, line.content));
    svg.append(rect);
  }

  regions
    .filter((region) => region.pageNumber === page.pageNumber)
    .forEach((region, index) => {
      const [x, y, w, h] = region.box;
      const colour = REGION_COLOURS[index % REGION_COLOURS.length];
      svg.append(
        svgEl('rect', {
          class: 'template-region',
          x: x * VIEWER_WIDTH,
          y: y * height,
          width: Math.max(4, w * VIEWER_WIDTH),
          height: Math.max(10, h * height),
          rx: 2,
          style: `fill:${colour}22; stroke:${colour}`
        }),
        svgEl(
          'text',
          { class: 'template-region-label', x: x * VIEWER_WIDTH + 2, y: Math.max(9, y * height - 3), style: `fill:${colour}` },
          region.label
        )
      );
    });

  const capture = svgEl('rect', { class: 'template-capture', x: 0, y: 0, width: VIEWER_WIDTH, height, fill: 'transparent' });
  svg.append(capture);

  const drawPreview = svgEl('rect', { class: 'template-draw-preview', x: 0, y: 0, width: 0, height: 0, hidden: true });
  svg.append(drawPreview);

  let origin = null;

  function pointFromEvent(event) {
    const bounds = svg.getBoundingClientRect();
    const fracX = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const fracY = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    return { fracX, fracY };
  }

  capture.addEventListener('pointerdown', (event) => {
    capture.setPointerCapture(event.pointerId);
    origin = pointFromEvent(event);
    drawPreview.removeAttribute('hidden');
  });

  capture.addEventListener('pointermove', (event) => {
    if (!origin) return;
    const current = pointFromEvent(event);
    const x = Math.min(origin.fracX, current.fracX);
    const y = Math.min(origin.fracY, current.fracY);
    const w = Math.abs(current.fracX - origin.fracX);
    const h = Math.abs(current.fracY - origin.fracY);
    drawPreview.setAttribute('x', x * VIEWER_WIDTH);
    drawPreview.setAttribute('y', y * height);
    drawPreview.setAttribute('width', w * VIEWER_WIDTH);
    drawPreview.setAttribute('height', h * height);
  });

  capture.addEventListener('pointerup', (event) => {
    if (!origin) return;
    const current = pointFromEvent(event);
    const box = [
      Math.min(origin.fracX, current.fracX),
      Math.min(origin.fracY, current.fracY),
      Math.abs(current.fracX - origin.fracX),
      Math.abs(current.fracY - origin.fracY)
    ];
    origin = null;
    drawPreview.setAttribute('hidden', 'true');
    if (box[2] < 0.01 || box[3] < 0.006) return; // Too small to be a deliberate drag — ignore stray clicks.
    onDraw({ pageNumber: page.pageNumber, box });
  });

  return svg;
}

export async function render(params = {}) {
  const editingId = params.id ?? null;
  const node = el('div.view');

  /** @type {{id:string,fileName:string,mimeType:string,pageCount:number,pages:Array}|null} */
  let preview = null;
  let currentPageNumber = 1;
  let regions = [];
  let excelTemplate = null;
  let templateName = '';
  let templateDescription = '';

  if (editingId) {
    try {
      const existing = await api.getTemplate(editingId);
      templateName = existing.name;
      templateDescription = existing.description ?? '';
      regions = existing.regions.map((region) => ({ ...region }));
      excelTemplate = existing.excelTemplate;
    } catch (error) {
      node.append(
        emptyState('Template not found', error instanceof ApiError ? error.message : 'This template could not be loaded.', null, 'alert')
      );
      return { node, cleanup: () => {} };
    }
  }

  const uploadSection = el('div');
  const drawSection = el('div');
  const excelSection = el('div');
  const saveSection = el('div');

  function existingKeySet() {
    return new Set(regions.map((region) => region.key));
  }

  async function uploadSample(file) {
    try {
      preview = await api.templatePreview(file);
      currentPageNumber = 1;
      toast(`Analysed "${file.name}" — ${preview.pageCount} page(s) recognised.`, 'success');
      paintUpload();
      paintDraw();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not analyse the sample document.', 'error', 7000);
    }
  }

  async function uploadExcelTemplate(file) {
    try {
      const parsed = await api.parseExcelTemplate(file);
      excelTemplate = {
        fileName: file.name,
        sheetName: parsed.sheetName,
        columns: parsed.columns,
        mappings: Object.fromEntries(parsed.columns.map((column) => [column.index, guessMapping(column.header)]))
      };
      toast(`Loaded "${parsed.sheetName}" with ${parsed.columns.length} column(s).`, 'success');
      paintExcel();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not read that Excel file.', 'error', 7000);
    }
  }

  function guessMapping(header) {
    const needle = String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = regions.find((region) => region.key.toLowerCase() === needle || region.label.toLowerCase().replace(/[^a-z0-9]/g, '') === needle);
    return match ? match.key : null;
  }

  function dropzoneUpload(label, hint, accept, onFile) {
    const input = el('input', {
      type: 'file',
      accept,
      style: { display: 'none' },
      on: {
        change: (event) => {
          const [file] = event.target.files;
          event.target.value = '';
          if (file) onFile(file);
        }
      }
    });
    const zone = el('div.dropzone.dropzone--compact', { role: 'button', tabIndex: 0 }, [
      el('div.dropzone__icon', {}, [icon('upload', { size: 22 })]),
      el('p', { text: label }),
      el('p.text-muted', { text: hint }),
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
      const [file] = event.dataTransfer?.files ?? [];
      if (file) onFile(file);
    });
    return zone;
  }

  function paintUpload() {
    uploadSection.replaceChildren(
      preview
        ? el('div.row', { style: { alignItems: 'center', gap: '10px' } }, [
            el('span.badge.badge--success', { text: `${preview.fileName} · ${preview.pageCount} page(s)` }),
            el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              text: 'Upload a different sample',
              on: {
                click: () => {
                  preview = null;
                  paintUpload();
                  paintDraw();
                }
              }
            })
          ])
        : dropzoneUpload(
            'Drag a sample PDF or image here, or click to browse',
            'This is only used to draw regions — it is not saved as a document.',
            '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp',
            uploadSample
          )
    );
  }

  function regionForm(draft, onSave, onCancel) {
    const keySet = existingKeySet();
    const labelInput = el('input', { type: 'text', placeholder: 'e.g. Invoice Number', maxLength: 120 });
    const keyInput = el('input', {
      type: 'text',
      placeholder: 'invoiceNumber',
      pattern: '[a-zA-Z][a-zA-Z0-9_]{0,63}',
      maxLength: 64
    });
    let keyEdited = false;
    keyInput.addEventListener('input', () => {
      keyEdited = true;
    });
    labelInput.addEventListener('input', () => {
      if (!keyEdited) keyInput.value = fieldKeySuggestion(labelInput.value, keySet);
    });
    const typeSelect = el(
      'select',
      {},
      FIELD_TYPES.map((option) => el('option', { value: option.value, text: option.label }))
    );
    const criticalCheckbox = el('input', { type: 'checkbox' });

    const form = el('form.template-region-form', {
      on: {
        submit: (event) => {
          event.preventDefault();
          const key = keyInput.value.trim();
          const label = labelInput.value.trim();
          if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) return toast('Field key must start with a letter (letters, numbers, underscore only).', 'warn');
          if (keySet.has(key)) return toast('That field key is already used — pick a unique one.', 'warn');
          if (!label) return toast('Give the field a label.', 'warn');
          onSave({ ...draft, key, label, type: typeSelect.value, critical: criticalCheckbox.checked });
        }
      }
    }, [
      el('div.field', {}, [el('label', { text: 'Label' }), labelInput]),
      el('div.field', {}, [el('label', { text: 'Field key' }), keyInput]),
      el('div.field', {}, [el('label', { text: 'Data type' }), typeSelect]),
      el('label.switch', {}, [criticalCheckbox, el('span', { text: 'Critical field' })]),
      el('div.row', { style: { gap: '8px' } }, [
        el('button.btn.btn--primary.btn--sm', { type: 'submit', text: 'Save field' }),
        el('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Discard', on: { click: onCancel } })
      ])
    ]);
    return form;
  }

  function regionList() {
    if (regions.length === 0) return el('p.text-muted', { text: 'No fields drawn yet — drag a box over each field above.' });
    return el(
      'ul.template-region-list',
      {},
      regions.map((region, index) =>
        el('li', {}, [
          el('span.template-region-swatch', { style: `background:${REGION_COLOURS[index % REGION_COLOURS.length]}` }),
          el('span.template-region-list__label', { text: region.label }),
          el('span.text-muted.mono', { text: region.key }),
          el('span.badge.badge--neutral', { text: region.type }),
          region.critical ? el('span.badge.badge--warn', { text: 'Critical' }) : null,
          el('span.text-muted', { text: `p.${region.pageNumber}` }),
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Remove',
            on: {
              click: () => {
                regions = regions.filter((candidate) => candidate.key !== region.key);
                paintDraw();
                paintExcel();
              }
            }
          })
        ])
      )
    );
  }

  function paintDraw() {
    if (!preview) {
      drawSection.replaceChildren(
        regions.length > 0
          ? el('div', {}, [
              el('p.text-muted', { text: 'Sample preview expired or not loaded — existing fields are kept, but upload a sample above to draw new ones.' }),
              regionList()
            ])
          : el('p.text-muted', { text: 'Upload a sample document above to start drawing field regions.' })
      );
      return;
    }

    const page = preview.pages.find((candidate) => candidate.pageNumber === currentPageNumber) ?? preview.pages[0];
    const formHost = el('div');
    const viewer = pageViewer({
      page,
      regions,
      onDraw: (draft) => {
        const form = regionForm(
          draft,
          (region) => {
            regions = [...regions, region];
            formHost.replaceChildren();
            paintDraw();
            paintExcel();
          },
          () => formHost.replaceChildren()
        );
        formHost.replaceChildren(form);
      }
    });

    const pager =
      preview.pageCount > 1
        ? el('div.row', { style: { gap: '6px', marginBottom: '8px' } }, [
            el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              text: '← Prev page',
              disabled: currentPageNumber <= 1,
              on: {
                click: () => {
                  currentPageNumber -= 1;
                  paintDraw();
                }
              }
            }),
            el('span.text-muted', { text: `Page ${currentPageNumber} of ${preview.pageCount}` }),
            el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              text: 'Next page →',
              disabled: currentPageNumber >= preview.pageCount,
              on: {
                click: () => {
                  currentPageNumber += 1;
                  paintDraw();
                }
              }
            })
          ])
        : null;

    drawSection.replaceChildren(
      el('div', {}, [
        pager,
        el('div.template-canvas-wrap', {}, [viewer]),
        formHost,
        el('h3', { style: { marginTop: '16px' }, text: 'Trained fields' }),
        regionList()
      ])
    );
  }

  function excelMappingRow(column) {
    const options = [
      el('option', { value: '', text: '— Not mapped —' }),
      ...regions.map((region) => el('option', { value: region.key, text: `Field: ${region.label}` })),
      ...SYSTEM_COLUMNS.map((system) => el('option', { value: system.value, text: system.label }))
    ];
    const select = el('select', {
      on: {
        change: (event) => {
          excelTemplate.mappings[column.index] = event.target.value || null;
        }
      }
    }, options);
    const currentTarget = excelTemplate.mappings[column.index] ?? '';
    select.value = currentTarget ?? '';
    return el('tr', {}, [
      el('td', { text: `${column.column} — "${column.header}"` }),
      el('td', {}, [select])
    ]);
  }

  function paintExcel() {
    if (!excelTemplate) {
      excelSection.replaceChildren(
        dropzoneUpload(
          'Drag your Excel requirement/format template here (optional)',
          'The exported workbook will use this file\u2019s exact header row and column order.',
          '.xlsx',
          uploadExcelTemplate
        )
      );
      return;
    }

    excelSection.replaceChildren(
      el('div', {}, [
        el('div.row', { style: { justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' } }, [
          el('span.badge.badge--success', { text: `${excelTemplate.fileName} · sheet "${excelTemplate.sheetName}"` }),
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Remove Excel template',
            on: {
              click: () => {
                excelTemplate = null;
                paintExcel();
              }
            }
          })
        ]),
        el('p.text-muted', { text: 'Map each column in your file to a trained field (or leave unmapped to keep it blank).' }),
        el('table.data', {}, [
          el('thead', {}, [el('tr', {}, [el('th', { text: 'Your column' }), el('th', { text: 'Maps to' })])]),
          el('tbody', {}, excelTemplate.columns.map((column) => excelMappingRow(column)))
        ])
      ])
    );
  }

  const nameInput = el('input', { type: 'text', value: templateName, maxLength: 120, placeholder: 'e.g. Distributor Invoice — Acme Layout' });
  const descriptionInput = el('textarea', { rows: 2, maxLength: 500, placeholder: 'Optional notes for your team.' });
  descriptionInput.value = templateDescription;

  saveSection.append(
    el('div.field', {}, [el('label', { text: 'Template name' }), nameInput]),
    el('div.field', {}, [el('label', { text: 'Description (optional)' }), descriptionInput]),
    el('button.btn.btn--accent', {
      type: 'button',
      text: editingId ? 'Save changes' : 'Save template',
      on: {
        click: async (event) => {
          const button = event.currentTarget;
          if (!nameInput.value.trim()) return toast('Give the template a name.', 'warn');
          if (regions.length === 0) return toast('Draw at least one field before saving.', 'warn');
          button.disabled = true;
          button.textContent = 'Saving…';
          try {
            const payload = {
              name: nameInput.value.trim(),
              description: descriptionInput.value.trim(),
              regions: regions.map(({ key, label, type, pageNumber, box, critical }) => ({ key, label, type, pageNumber, box, critical })),
              excelTemplate
            };
            const saved = editingId
              ? await api.updateTemplate(editingId, payload)
              : await api.createTemplate({ ...payload, previewId: preview?.id });
            toast('Template saved.', 'success');
            location.hash = `#/templates/${saved.id}`;
          } catch (error) {
            toast(error instanceof ApiError ? error.message : 'Could not save the template.', 'error', 7000);
          } finally {
            button.disabled = false;
            button.textContent = editingId ? 'Save changes' : 'Save template';
          }
        }
      }
    })
  );

  node.append(
    pageHeader({
      title: editingId ? 'Edit template' : 'Train a new template',
      icon: 'crop',
      subtitle: 'Upload a sample, draw a box over each field, then optionally match your own Excel layout.',
      actions: [el('a.btn.btn--ghost', { href: '#/templates', text: '← Back to templates' })]
    }),
    card({ title: '1. Upload a sample document', icon: 'upload', tone: 'amber', body: uploadSection }),
    el('div', { style: { height: '14px' } }),
    card({ title: '2. Draw a box over each field', icon: 'crop', tone: 'navy', body: drawSection }),
    el('div', { style: { height: '14px' } }),
    card({ title: '3. Match your Excel template (optional)', icon: 'table', tone: 'violet', body: excelSection }),
    el('div', { style: { height: '14px' } }),
    card({ title: '4. Name and save', icon: 'checkCircle', tone: 'jade', body: saveSection })
  );

  paintUpload();
  paintDraw();
  paintExcel();

  return { node, cleanup: () => {} };
}
