/**
 * End-to-end API tests. Boots the Express app on an ephemeral port, pushes a
 * real generated PDF through the full pipeline and asserts on every surface the
 * customer-facing UI depends on.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import './helpers/isolation.js';
import { createApp } from '../src/app.js';
import { generateSamplePdf } from '../src/services/sample.service.js';
import { waitForIdle } from '../src/services/pipeline.service.js';
import { clearAll, initialiseStore } from '../src/services/store.service.js';

const ZIP_LOCAL_HEADER = 0x04034b50;

let server;
let baseUrl;

const get = (path) => fetch(`${baseUrl}${path}`);
const postJson = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

before(async () => {
  await initialiseStore();
  await clearAll();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await clearAll();
  await new Promise((resolve) => server.close(resolve));
});

describe('platform API', () => {
  test('should_report_a_healthy_status', async () => {
    const response = await get('/health');
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, 'healthy');
  });

  test('should_publish_capabilities_the_client_needs_to_boot', async () => {
    const payload = await (await get('/config')).json();
    assert.ok(payload.documentTypes.length >= 11);
    assert.ok(payload.samples.length >= 11);
    assert.ok(payload.limits.maxPagesPerDocument >= 2000);
    assert.ok(Object.keys(payload.rules).length >= 20);
  });

  test('should_return_a_requirements_traceability_matrix', async () => {
    const payload = await (await get('/requirements')).json();
    assert.ok(payload.total >= 15);
    assert.match(payload.items[0].ref, /^REQ-\d{3}$/);
  });

  test('should_reject_a_cost_estimate_with_out_of_range_inputs', async () => {
    const response = await postJson('/cost/estimate', { documentsPerMonth: -5 });
    assert.equal(response.status, 400);
  });

  test('should_project_a_monthly_cost_with_a_positive_routing_saving', async () => {
    const payload = await (await postJson('/cost/estimate', { documentsPerMonth: 4000, averagePages: 12 })).json();
    assert.ok(payload.totalMonthlyUsd > 0);
    assert.ok(payload.routingSavingUsd > 0);
  });

  test('should_return_404_for_an_unknown_route', async () => {
    const response = await get('/does-not-exist');
    assert.equal(response.status, 404);
  });
});

describe('document lifecycle', () => {
  let documentId;

  test('should_reject_an_upload_with_no_files_attached', async () => {
    const response = await fetch(`${baseUrl}/documents`, { method: 'POST', body: new FormData() });
    assert.equal(response.status, 400);
  });

  test('should_reject_a_file_whose_contents_do_not_match_its_extension', async () => {
    const form = new FormData();
    form.append('files', new Blob([Buffer.from('plain text')], { type: 'application/pdf' }), 'fake.pdf');
    const response = await fetch(`${baseUrl}/documents`, { method: 'POST', body: form });
    assert.equal(response.status, 400);
  });

  test('should_accept_a_generated_invoice_pdf_and_process_it_end_to_end', async () => {
    const { buffer, mimeType } = await generateSamplePdf('supplier_invoice', 'integration-test');
    const form = new FormData();
    form.append('files', new Blob([buffer], { type: mimeType }), 'Tax-Invoice-Integration.pdf');

    const response = await fetch(`${baseUrl}/documents`, { method: 'POST', body: form });
    assert.equal(response.status, 202);

    const payload = await response.json();
    assert.equal(payload.acceptedCount, 1);
    documentId = payload.accepted[0].id;

    await waitForIdle();

    const record = await (await get(`/documents/${documentId}`)).json();
    assert.ok(['completed', 'needs-review'].includes(record.status));
    assert.equal(record.classification.typeId, 'supplier_invoice');
    assert.ok(record.fields.length > 0);
    assert.ok(record.pageIndex.length > 0);
    assert.ok(record.textLength > 100);
    assert.equal(record.stages.every((stage) => stage.status === 'completed'), true);
  });

  test('should_return_ocr_overlay_data_for_a_page', async () => {
    const payload = await (await get(`/documents/${documentId}/pages/1`)).json();
    assert.equal(payload.page.pageNumber, 1);
    assert.ok(payload.page.lines.length > 0);
    for (const line of payload.page.lines) {
      assert.equal(line.box.length, 4);
      assert.ok(line.box.every((value) => value >= 0 && value <= 1.2));
    }
  });

  test('should_return_404_for_a_page_beyond_the_document', async () => {
    const response = await get(`/documents/${documentId}/pages/9999`);
    assert.equal(response.status, 404);
  });

  test('should_accept_a_manual_correction_and_re_run_validation', async () => {
    const before = await (await get(`/documents/${documentId}`)).json();
    const target = before.fields.find((field) => field.type === 'string');

    const response = await fetch(`${baseUrl}/documents/${documentId}/fields/${target.key}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'Corrected By Reviewer', actor: 'tester@vgc.com' })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.field.rawValue, 'Corrected By Reviewer');
    assert.equal(payload.field.status, 'accepted');
    assert.ok(payload.validation.rulesEvaluated > 0);
  });

  test('should_reject_a_correction_for_a_field_that_does_not_exist', async () => {
    const response = await fetch(`${baseUrl}/documents/${documentId}/fields/notAField`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x' })
    });
    assert.equal(response.status, 404);
  });

  test('should_record_an_approval_decision_in_the_audit_trail', async () => {
    const payload = await (await postJson(`/documents/${documentId}/decision`, {
      decision: 'approve',
      note: 'Verified against the supplier portal.',
      actor: 'tester@vgc.com'
    })).json();

    assert.equal(payload.status, 'approved');
    assert.ok(payload.audit.some((entry) => entry.action === 'approved'));
  });

  test('should_reject_an_unknown_decision', async () => {
    const response = await postJson(`/documents/${documentId}/decision`, { decision: 'maybe' });
    assert.equal(response.status, 400);
  });

  test('should_find_the_document_through_full_text_search', async () => {
    const payload = await (await get('/search?q=invoice')).json();
    assert.ok(payload.total >= 1);
    assert.ok(payload.results[0].hits.length > 0);
  });

  test('should_reject_a_search_term_that_is_too_short', async () => {
    const response = await get('/search?q=a');
    assert.equal(response.status, 400);
  });

  test('should_export_a_document_workbook', async () => {
    const response = await get(`/documents/${documentId}/export.xlsx`);
    assert.equal(response.status, 200);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(buffer.readUInt32LE(0), ZIP_LOCAL_HEADER);
  });

  test('should_export_the_corpus_workbook_and_csv', async () => {
    const workbook = Buffer.from(await (await get('/export/documents.xlsx')).arrayBuffer());
    assert.equal(workbook.readUInt32LE(0), ZIP_LOCAL_HEADER);

    const csv = await (await get('/export/fields.csv')).text();
    assert.ok(csv.split('\n').length > 1);
  });

  test('should_include_the_document_in_the_analytics_dashboard', async () => {
    const dashboard = await (await get('/analytics/dashboard')).json();
    assert.ok(dashboard.volume.processed >= 1);
    assert.ok(dashboard.volume.totalPages >= 1);
    assert.ok(Array.isArray(dashboard.throughput));
  });

  test('should_delete_the_document', async () => {
    const response = await fetch(`${baseUrl}/documents/${documentId}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.equal((await get(`/documents/${documentId}`)).status, 404);
  });
});

describe('large document handling', () => {
  test('should_process_an_annual_report_of_more_than_one_hundred_pages', async () => {
    const { buffer, mimeType } = await generateSamplePdf('annual_report', 'integration-large');
    const form = new FormData();
    form.append('files', new Blob([buffer], { type: mimeType }), 'VGC-Annual-Report-Integration.pdf');

    const response = await fetch(`${baseUrl}/documents`, { method: 'POST', body: form });
    assert.equal(response.status, 202);
    const { accepted } = await response.json();

    await waitForIdle();

    const record = await (await get(`/documents/${accepted[0].id}`)).json();
    assert.ok(record.pageCount > 100, `expected more than 100 pages, received ${record.pageCount}`);
    assert.equal(record.classification.typeId, 'annual_report');
    assert.equal(record.cost.selectedModel, 'prebuilt-read');
  });
});

describe('browser security posture', () => {
  test('should_serve_hardened_security_headers_on_the_app_shell', async () => {
    const response = await fetch(baseUrl.replace(/\/api$/, '/'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.match(response.headers.get('permissions-policy') ?? '', /camera=\(\)/);
    // Express advertises its own presence by default; disclosing the stack
    // hands an attacker free reconnaissance.
    assert.equal(response.headers.get('x-powered-by'), null);
  });

  test('should_not_relax_the_content_security_policy_with_unsafe_directives', async () => {
    const csp = (await fetch(baseUrl.replace(/\/api$/, '/'))).headers.get('content-security-policy') ?? '';
    const directives = Object.fromEntries(
      csp.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
      })
    );
    // The client ships no inline <style>, no style="" attribute and never calls
    // setAttribute('style'), so nothing needs 'unsafe-inline'. Assert it stays
    // that way: the relaxation is only ever re-added by accident.
    for (const directive of ['default-src', 'script-src', 'style-src']) {
      assert.ok(directives[directive], `${directive} must be declared`);
      assert.ok(
        !directives[directive].some((value) => /unsafe-inline|unsafe-eval/.test(value)),
        `${directive} must not allow unsafe sources, received ${directives[directive].join(' ')}`
      );
    }
    assert.deepEqual(directives['object-src'], ["'none'"]);
    assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
    assert.deepEqual(directives['base-uri'], ["'self'"]);
  });
});
