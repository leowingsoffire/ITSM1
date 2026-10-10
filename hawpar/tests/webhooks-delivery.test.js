/**
 * Webhook delivery tests against a real local receiver: signed test events,
 * document lifecycle events, retries with a delivery log, pausing, secret
 * rotation and deletion.
 *
 * Local receivers are private addresses, which production refuses; this
 * suite opts in with WEBHOOK_ALLOW_PRIVATE_TARGETS, exactly as a developer
 * would to test against localhost. Retries are shortened to milliseconds.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import test, { after, before, describe } from 'node:test';
import './helpers/isolation.js';

process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = 'true';
process.env.WEBHOOK_RETRY_BASE_MS = '15';

const { createApp } = await import('../src/app.js');
const { initialiseStore, clearAll } = await import('../src/services/store.service.js');
const { generateSamplePdf } = await import('../src/services/sample.service.js');
const { pipelineEvents, waitForIdle } = await import('../src/services/pipeline.service.js');
const { startWebhookDispatcher } = await import('../src/services/webhooks.service.js');

let server;
let baseUrl;
let receiver;
let receiverUrl;
/** @type {Array<{path: string, headers: object, body: string}>} */
const received = [];
let failNext = 0;

const api = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};

async function waitFor(predicate, { timeoutMs = 5000, label = 'condition' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function verify(entry, secret) {
  const header = entry.headers['x-vgc-signature'];
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header ?? '');
  assert.ok(match, `malformed signature header: ${header}`);
  const expected = createHmac('sha256', secret).update(`${match[1]}.${entry.body}`).digest('hex');
  assert.equal(match[2], expected, 'signature must verify with the webhook secret');
  assert.ok(Math.abs(Date.now() / 1000 - Number(match[1])) < 60, 'timestamp must be current');
}

before(async () => {
  await initialiseStore();
  await clearAll();
  startWebhookDispatcher(pipelineEvents);
  receiver = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      received.push({ path: request.url, headers: request.headers, body });
      if (failNext > 0) {
        failNext -= 1;
        response.writeHead(503).end('unavailable');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
  });
  receiver.listen(0, '127.0.0.1');
  await new Promise((resolve) => receiver.once('listening', resolve));
  receiverUrl = `http://127.0.0.1:${receiver.address().port}`;

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await clearAll();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => receiver.close(resolve));
});

const state = {};

describe('webhook configuration', () => {
  test('should_validate_events_and_urls', async () => {
    assert.equal((await api('POST', '/admin/webhooks', { url: `${receiverUrl}/x`, events: [] })).status, 400);
    assert.equal((await api('POST', '/admin/webhooks', { url: `${receiverUrl}/x`, events: ['document.exploded'] })).status, 400);
    assert.equal((await api('POST', '/admin/webhooks', { url: 'ftp://example.com', events: ['document.processed'] })).status, 400);
  });

  test('should_create_a_webhook_and_reveal_its_secret_once', async () => {
    const created = await api('POST', '/admin/webhooks', {
      url: `${receiverUrl}/erp`,
      events: ['document.processed', 'document.approved', 'document.deleted'],
      description: 'ERP intake'
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.match(created.json.secret, /^whsec_/);
    assert.equal(created.json.webhook.secret, undefined);
    state.hookId = created.json.webhook.id;
    state.secret = created.json.secret;
    const list = await api('GET', '/admin/webhooks');
    assert.equal(list.json.items.length, 1);
    assert.ok(!JSON.stringify(list.json).includes(state.secret), 'the secret is never listed');
    assert.ok(list.json.events.includes('document.review_required'));
  });
});

describe('webhook delivery', () => {
  test('should_send_a_signed_test_event_synchronously', async () => {
    const result = await api('POST', `/admin/webhooks/${state.hookId}/test`);
    assert.equal(result.status, 200);
    assert.equal(result.json.delivery.status, 'succeeded');
    assert.equal(result.json.delivery.responseStatus, 200);
    const entry = received.at(-1);
    assert.equal(entry.path, '/erp');
    assert.equal(entry.headers['x-vgc-event'], 'webhook.test');
    assert.equal(entry.headers['content-type'], 'application/json');
    verify(entry, state.secret);
  });

  test('should_deliver_document_processed_with_the_extracted_fields', async () => {
    const before = received.length;
    const { buffer, mimeType } = await generateSamplePdf('supplier_invoice', 'webhook-test');
    const form = new FormData();
    form.append('files', new Blob([buffer], { type: mimeType }), 'webhook-invoice.pdf');
    const upload = await fetch(`${baseUrl}/documents`, { method: 'POST', body: form });
    assert.equal(upload.status, 202);
    state.documentId = (await upload.json()).accepted[0].id;
    await waitForIdle();

    const entry = await waitFor(
      () => received.slice(before).find((item) => item.headers['x-vgc-event'] === 'document.processed'),
      { label: 'document.processed' }
    );
    verify(entry, state.secret);
    const event = JSON.parse(entry.body);
    assert.match(event.id, /^evt_/);
    assert.equal(event.type, 'document.processed');
    assert.equal(event.workspaceId, 'default');
    assert.equal(event.data.documentId, state.documentId);
    assert.equal(event.data.fileName, 'webhook-invoice.pdf');
    assert.ok(event.data.fields.length > 0, 'the payload carries the extracted fields');
    assert.ok(event.data.fields.every((field) => typeof field.key === 'string' && 'value' in field && 'confidence' in field));
    assert.ok(!received.slice(before).some((item) => item.headers['x-vgc-event'] === 'document.review_required'), 'unsubscribed events are not sent');
  });

  test('should_deliver_approval_decisions', async () => {
    const before = received.length;
    const decision = await api('POST', `/documents/${state.documentId}/decision`, { decision: 'approve' });
    assert.equal(decision.status, 200);
    const entry = await waitFor(
      () => received.slice(before).find((item) => item.headers['x-vgc-event'] === 'document.approved'),
      { label: 'document.approved' }
    );
    assert.equal(JSON.parse(entry.body).data.status, 'approved');
  });

  test('should_retry_failed_deliveries_and_log_every_attempt', async () => {
    failNext = 2;
    const before = received.length;
    const deleted = await api('DELETE', `/documents/${state.documentId}`);
    assert.equal(deleted.status, 200);
    await waitFor(() => received.length - before >= 3, { label: 'three delivery attempts' });
    const attempts = received.slice(before).filter((item) => item.headers['x-vgc-event'] === 'document.deleted');
    assert.equal(attempts.length, 3);
    const eventIds = new Set(attempts.map((item) => JSON.parse(item.body).id));
    assert.equal(eventIds.size, 1, 'retries resend the same event id so receivers can de-duplicate');
    assert.equal(new Set(attempts.map((item) => item.headers['x-vgc-delivery'])).size, 3, 'each attempt has its own delivery id');

    const log = await waitFor(async () => {
      const result = await api('GET', `/admin/webhooks/${state.hookId}/deliveries`);
      const items = result.json.items.filter((item) => item.event === 'document.deleted');
      return items.length >= 3 ? items : null;
    }, { label: 'delivery log' });
    assert.deepEqual(log.map((item) => item.status).sort(), ['retrying', 'retrying', 'succeeded']);
    assert.ok(log.some((item) => item.responseStatus === 503));
  });

  test('should_mark_a_delivery_failed_after_the_final_attempt', async () => {
    failNext = 10;
    const result = await api('POST', `/admin/webhooks/${state.hookId}/test`);
    assert.equal(result.json.delivery.status, 'failed', 'test sends are not retried');
    assert.equal(result.json.delivery.responseStatus, 503);
    failNext = 0;
  });

  test('should_stop_delivering_while_paused', async () => {
    const paused = await api('PATCH', `/admin/webhooks/${state.hookId}`, { active: false });
    assert.equal(paused.status, 200);
    assert.equal(paused.json.webhook.active, false);
    const before = received.length;
    const { buffer, mimeType } = await generateSamplePdf('supplier_invoice', 'paused-test');
    const form = new FormData();
    form.append('files', new Blob([buffer], { type: mimeType }), 'paused-invoice.pdf');
    assert.equal((await fetch(`${baseUrl}/documents`, { method: 'POST', body: form })).status, 202);
    await waitForIdle();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(received.slice(before).filter((item) => item.headers['x-vgc-event'] === 'document.processed').length, 0);
    await api('PATCH', `/admin/webhooks/${state.hookId}`, { active: true });
  });

  test('should_rotate_the_secret_so_old_signatures_stop_verifying', async () => {
    const rotated = await api('POST', `/admin/webhooks/${state.hookId}/rotate-secret`);
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.json.secret, state.secret);
    await api('POST', `/admin/webhooks/${state.hookId}/test`);
    const entry = received.at(-1);
    verify(entry, rotated.json.secret);
    assert.throws(() => verify(entry, state.secret));
  });

  test('should_delete_a_webhook', async () => {
    const removed = await api('DELETE', `/admin/webhooks/${state.hookId}`);
    assert.equal(removed.status, 200);
    assert.equal((await api('GET', '/admin/webhooks')).json.items.length, 0);
    assert.equal((await api('POST', `/admin/webhooks/${state.hookId}/test`)).status, 404);
  });
});
