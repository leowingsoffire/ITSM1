/**
 * Webhook safety tests with production defaults: destinations must be public
 * https endpoints, and private, loopback, link-local and metadata addresses
 * are refused (SSRF guard). Signatures follow the documented scheme.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test, { describe } from 'node:test';
import './helpers/isolation.js';

delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;

const { isPrivateAddress, signPayload, validateWebhookUrl, WEBHOOK_EVENTS } = await import('../src/services/webhooks.service.js');

describe('webhook SSRF guard', () => {
  test('should_classify_private_and_reserved_addresses', () => {
    for (const address of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1'
    ]) {
      assert.equal(isPrivateAddress(address), true, `${address} must be treated as private`);
    }
    for (const address of ['8.8.8.8', '1.1.1.1', '52.239.1.1', '172.32.0.1', '2606:4700:4700::1111']) {
      assert.equal(isPrivateAddress(address), false, `${address} is a public address`);
    }
  });

  test('should_refuse_destinations_that_are_not_public_https', () => {
    for (const url of [
      'http://example.com/hook',
      'https://localhost/hook',
      'https://127.0.0.1/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/hook',
      'https://10.0.0.5/hook',
      'https://user:secret@example.com/hook',
      'ftp://example.com/hook',
      'not a url',
      ''
    ]) {
      assert.throws(() => validateWebhookUrl(url), (error) => error.status === 400, `${url || '(empty)'} must be refused`);
    }
  });

  test('should_accept_a_public_https_endpoint_and_drop_the_fragment', () => {
    assert.equal(validateWebhookUrl(' https://hooks.example.com/vgc?source=ocr#ignored '), 'https://hooks.example.com/vgc?source=ocr');
  });
});

describe('webhook signatures', () => {
  test('should_sign_the_timestamp_and_raw_body_with_hmac_sha256', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'document.processed' });
    const expected = createHmac('sha256', 'whsec_test').update(`1700000000.${body}`).digest('hex');
    assert.equal(signPayload('whsec_test', 1700000000, body), expected);
    assert.notEqual(signPayload('whsec_other', 1700000000, body), expected);
  });

  test('should_publish_the_document_lifecycle_events', () => {
    assert.deepEqual(
      [...WEBHOOK_EVENTS].sort(),
      ['document.approved', 'document.deleted', 'document.failed', 'document.processed', 'document.rejected', 'document.review_required']
    );
  });
});
