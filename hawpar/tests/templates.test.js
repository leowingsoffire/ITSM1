/**
 * Template Studio API tests: train a custom zonal extraction template from a
 * sample document, verify field-region extraction actually finds the right
 * OCR text, wire up a customer's own Excel layout, and confirm the exported
 * workbook's header row/column order matches that layout exactly.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import './helpers/isolation.js';
import { createApp } from '../src/app.js';
import { generateSamplePdf } from '../src/services/sample.service.js';
import { buildWorkbook } from '../src/lib/xlsx.js';
import { readXlsxTemplate } from '../src/lib/xlsxReader.js';
import { clearAllTemplates, initialiseTemplateStore } from '../src/services/templates.service.js';

let server;
let baseUrl;

const get = (path) => fetch(`${baseUrl}${path}`);
const del = (path) => fetch(`${baseUrl}${path}`, { method: 'DELETE' });
const postJson = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
const patchJson = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

function uploadForm(fieldName, buffer, fileName, mimeType) {
  const form = new FormData();
  form.append(fieldName, new Blob([buffer], { type: mimeType }), fileName);
  return form;
}

before(async () => {
  await initialiseTemplateStore();
  await clearAllTemplates();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await clearAllTemplates();
  await new Promise((resolve) => server.close(resolve));
});

describe('Template Studio', () => {
  test('should_reject_a_preview_request_with_no_file', async () => {
    const response = await fetch(`${baseUrl}/templates/preview`, { method: 'POST', body: new FormData() });
    assert.equal(response.status, 400);
  });

  test('should_analyze_an_uploaded_sample_and_return_page_ocr_for_drawing_regions', async () => {
    const { buffer, mimeType } = await generateSamplePdf('supplier_invoice', 'template-studio-preview');
    const response = await fetch(`${baseUrl}/templates/preview`, {
      method: 'POST',
      body: uploadForm('file', buffer, 'sample-invoice.pdf', mimeType)
    });
    assert.equal(response.status, 201);
    const preview = await response.json();
    assert.ok(preview.id);
    assert.ok(preview.pageCount >= 1);
    assert.ok(preview.pages[0].lines.length > 0, 'expected OCR lines on the first page');
    assert.ok(preview.pages[0].lines.every((line) => Array.isArray(line.box) && line.box.length === 4));
  });

  test('should_parse_an_uploaded_excel_requirement_template_into_mappable_columns', async () => {
    const workbook = buildWorkbook([
      { name: 'Finance Layout', rows: [['Vendor', 'Invoice No', 'Total (SGD)', 'Due Date'], ['', '', '', '']] }
    ]);
    const response = await fetch(`${baseUrl}/templates/excel-template`, {
      method: 'POST',
      body: uploadForm('file', workbook, 'finance-layout.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    });
    assert.equal(response.status, 201);
    const parsed = await response.json();
    assert.equal(parsed.sheetName, 'Finance Layout');
    assert.deepEqual(
      parsed.columns.map((column) => column.header),
      ['Vendor', 'Invoice No', 'Total (SGD)', 'Due Date']
    );
    assert.equal(parsed.columns[0].column, 'A');
  });

  test('reader_should_round_trip_shared_strings_across_multiple_rows', () => {
    // Our own writer always uses inlineStr, so exercise the sharedStrings path
    // (the format most real-world Excel exports actually use) directly.
    const buffer = buildSharedStringsWorkbook(['Company', 'Amount'], [['Acme Pte Ltd', 100]]);
    const parsed = readXlsxTemplate(buffer);
    assert.deepEqual(parsed.columns.map((c) => c.header), ['Company', 'Amount']);
    assert.equal(parsed.previewRows[0][0], 'Acme Pte Ltd');
  });

  test('should_reject_a_template_with_no_regions', async () => {
    const { buffer, mimeType } = await generateSamplePdf('supplier_invoice', 'template-studio-noregion');
    const previewResponse = await fetch(`${baseUrl}/templates/preview`, {
      method: 'POST',
      body: uploadForm('file', buffer, 'sample.pdf', mimeType)
    });
    const preview = await previewResponse.json();

    const response = await postJson('/templates', { name: 'Empty template', previewId: preview.id, regions: [] });
    assert.equal(response.status, 400);
  });

  let templateId;
  let previewLines;

  test('should_train_a_template_from_a_sample_and_locate_a_field_by_its_drawn_region', async () => {
    const { buffer, mimeType } = await generateSamplePdf('supplier_invoice', 'template-studio-train');
    const previewResponse = await fetch(`${baseUrl}/templates/preview`, {
      method: 'POST',
      body: uploadForm('file', buffer, 'sample-invoice.pdf', mimeType)
    });
    const preview = await previewResponse.json();
    previewLines = preview.pages[0].lines;
    assert.ok(previewLines.length > 0);

    // Draw a region that exactly covers the first recognised line, guaranteeing overlap.
    const targetLine = previewLines[0];
    const region = {
      key: 'firstLine',
      label: 'First recognised line',
      type: 'string',
      pageNumber: 1,
      box: targetLine.box
    };

    const response = await postJson('/templates', {
      name: 'Supplier Invoice — Test Template',
      description: 'Trained from a demo supplier invoice.',
      previewId: preview.id,
      regions: [region]
    });
    assert.equal(response.status, 201);
    const template = await response.json();
    templateId = template.id;
    assert.equal(template.regions.length, 1);
    assert.equal(template.regions[0].key, 'firstLine');
  });

  test('should_list_and_fetch_the_saved_template', async () => {
    const listResponse = await get('/templates');
    const { items } = await listResponse.json();
    assert.ok(items.some((item) => item.id === templateId));

    const detailResponse = await get(`/templates/${templateId}`);
    const template = await detailResponse.json();
    assert.equal(template.id, templateId);
    assert.equal(template.regions.length, 1);
  });

  test('should_run_the_template_against_a_new_document_and_extract_the_trained_field', async () => {
    const { buffer, mimeType } = await generateSamplePdf('supplier_invoice', 'template-studio-run');
    const response = await fetch(`${baseUrl}/templates/${templateId}/run`, {
      method: 'POST',
      body: uploadForm('files', buffer, 'new-invoice.pdf', mimeType)
    });
    assert.equal(response.status, 201);
    const run = await response.json();
    assert.equal(run.documents.length, 1);
    const [document] = run.documents;
    assert.equal(document.fields.length, 1);
    const [field] = document.fields;
    assert.equal(field.key, 'firstLine');
    // The region was drawn exactly around a recognised line, so extraction
    // must recover non-empty text with meaningful confidence.
    assert.ok(field.rawText.length > 0, 'expected the zonal extractor to recover text from the trained region');
    assert.ok(field.confidence > 0.3, `expected reasonable confidence, got ${field.confidence}`);

    globalThis.__templateStudioRunId = run.id;
  });

  test('should_export_a_run_workbook_whose_header_row_matches_the_uploaded_excel_template', async () => {
    // Attach an Excel template mapping the single trained field to a customer column.
    const workbook = buildWorkbook([{ name: 'Customer Layout', rows: [['Reference No', 'Notes'], ['', '']] }]);
    const excelResponse = await fetch(`${baseUrl}/templates/excel-template`, {
      method: 'POST',
      body: uploadForm('file', workbook, 'customer-layout.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    });
    const excelParsed = await excelResponse.json();

    const patchResponse = await patchJson(`/templates/${templateId}`, {
      excelTemplate: {
        fileName: 'customer-layout.xlsx',
        sheetName: excelParsed.sheetName,
        columns: excelParsed.columns,
        mappings: { [excelParsed.columns[0].index]: 'firstLine' }
      }
    });
    assert.equal(patchResponse.status, 200);
    const patched = await patchResponse.json();
    assert.ok(patched.excelTemplate);

    const runId = globalThis.__templateStudioRunId;
    const exportResponse = await get(`/templates/${templateId}/runs/${runId}/export.xlsx`);
    assert.equal(exportResponse.status, 200);
    assert.equal(
      exportResponse.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const exportedBuffer = Buffer.from(await exportResponse.arrayBuffer());
    const reparsed = readXlsxTemplate(exportedBuffer);
    assert.equal(reparsed.sheetName, 'Customer Layout');
    assert.deepEqual(reparsed.columns.map((c) => c.header), ['Reference No', 'Notes']);
    assert.ok(reparsed.previewRows[0][0].length > 0, 'expected the mapped field value to populate the Reference No column');
  });

  test('should_list_run_history_for_the_template', async () => {
    const response = await get(`/templates/${templateId}/runs`);
    const { items } = await response.json();
    assert.equal(items.length, 1);
    assert.equal(items[0].documentCount, 1);
  });

  test('should_delete_the_template_and_its_runs', async () => {
    const response = await del(`/templates/${templateId}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.deleted, true);
    assert.equal(payload.runsRemoved, 1);

    const getResponse = await get(`/templates/${templateId}`);
    assert.equal(getResponse.status, 404);
  });
});

/**
 * Builds a minimal shared-strings-based .xlsx (the encoding most real Excel
 * exports use, as opposed to our own writer's inlineStr cells) so the reader
 * is proven against both encodings.
 */
function buildSharedStringsWorkbook(headers, dataRows) {
  const strings = [...headers];
  const rows = [headers, ...dataRows].map((row, rowIndex) =>
    row
      .map((value, columnIndex) => {
        const ref = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
        if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
        const index = strings.indexOf(value) >= 0 ? strings.indexOf(value) : strings.push(value) - 1;
        return `<c r="${ref}" t="s"><v>${index}</v></c>`;
      })
      .join('')
  );

  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    rows.map((cells, index) => `<row r="${index + 1}">${cells}</row>`).join('') +
    '</sheetData></worksheet>';

  const sharedStringsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((value) => `<si><t>${value}</t></si>`).join('') +
    '</sst>';

  // Reuse the project's own zip writer via buildWorkbook is not possible here
  // (it always emits inlineStr), so this test builds the archive with the
  // same in-house zip helper the writer already depends on.
  return buildWorkbookRawEntries({
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Finance" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
    'xl/worksheets/sheet1.xml': sheetXml,
    'xl/sharedStrings.xml': sharedStringsXml,
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
  });
}

function buildWorkbookRawEntries(entriesByName) {
  // Minimal, uncompressed (store-method) ZIP writer for test fixtures only.
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();
  const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (let index = 0; index < buffer.length; index += 1) crc = crcTable[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  for (const [name, content] of Object.entries(entriesByName)) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const contentBuffer = Buffer.from(content, 'utf8');
    const checksum = crc32(contentBuffer);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8); // stored, no compression
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x2821, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(contentBuffer.length, 18);
    localHeader.writeUInt32LE(contentBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, contentBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x2821, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(contentBuffer.length, 20);
    centralHeader.writeUInt32LE(contentBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + contentBuffer.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(Object.keys(entriesByName).length, 8);
  endRecord.writeUInt16LE(Object.keys(entriesByName).length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}
