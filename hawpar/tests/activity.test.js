/**
 * Unit tests for the workspace activity log: newest-first paging with an exact
 * `before` cursor, filters, field limits and JSON Lines persistence.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { describe } from 'node:test';
import './helpers/isolation.js';

const { config } = await import('../src/config/index.js');
const { flushActivityWrites, listActivity, recordActivity } = await import('../src/services/activity.service.js');
const { tenantDataDir } = await import('../src/services/tenant.service.js');

const TENANT = `activity-paging-${process.pid}`;
const OTHER_TENANT = `activity-limits-${process.pid}`;

const details = (page) => page.items.map((entry) => entry.detail);

describe('activity log', () => {
  test('should_page_backwards_with_an_exact_before_cursor', async () => {
    // Recorded back to back, several entries share a millisecond timestamp,
    // which is exactly what an id cursor has to page through without skipping.
    for (let index = 1; index <= 5; index += 1) {
      await recordActivity(TENANT, {
        actor: `user${index}@example.com`,
        action: index % 2 ? 'member.added' : 'api_key.created',
        target: `target-${index}`,
        detail: `entry ${index}`
      });
    }

    const first = await listActivity(TENANT, { limit: 2 });
    assert.deepEqual(details(first), ['entry 5', 'entry 4']);
    assert.equal(first.hasMore, true);
    assert.equal(first.total, 5);

    const second = await listActivity(TENANT, { limit: 2, before: first.items.at(-1).id });
    assert.deepEqual(details(second), ['entry 3', 'entry 2']);
    assert.equal(second.hasMore, true);

    const last = await listActivity(TENANT, { limit: 2, before: second.items.at(-1).id });
    assert.deepEqual(details(last), ['entry 1']);
    assert.equal(last.hasMore, false);

    assert.equal((await listActivity(TENANT, { limit: 5 })).hasMore, false, 'a page that ends exactly at the oldest entry has no more');
  });

  test('should_filter_by_action_prefix_actor_and_free_text', async () => {
    assert.deepEqual(details(await listActivity(TENANT, { action: 'member.' })), ['entry 5', 'entry 3', 'entry 1']);
    assert.deepEqual(details(await listActivity(TENANT, { actor: 'USER2@' })), ['entry 2']);
    assert.deepEqual(details(await listActivity(TENANT, { q: 'target-4' })), ['entry 4']);

    const filteredPage = await listActivity(TENANT, { action: 'member.', limit: 2 });
    assert.deepEqual(details(filteredPage), ['entry 5', 'entry 3']);
    assert.equal(filteredPage.hasMore, true);
    const filteredRest = await listActivity(TENANT, { action: 'member.', limit: 2, before: filteredPage.items.at(-1).id });
    assert.deepEqual(details(filteredRest), ['entry 1']);
    assert.equal(filteredRest.hasMore, false);
  });

  test('should_store_ipv4_mapped_addresses_in_dotted_form_and_clip_long_text', async () => {
    const mapped = await recordActivity(OTHER_TENANT, { actor: 'a@example.com', action: 'auth.login', ip: '::ffff:203.0.113.7', detail: 'x'.repeat(1000) });
    assert.equal(mapped.ip, '203.0.113.7');
    assert.equal(mapped.detail.length, 400);
    assert.ok(mapped.detail.endsWith('…'));

    const ipv6 = await recordActivity(OTHER_TENANT, { actor: 'a@example.com', action: 'auth.login', ip: '2001:db8::7' });
    assert.equal(ipv6.ip, '2001:db8::7');
    const missing = await recordActivity(OTHER_TENANT, { action: 'auth.login' });
    assert.equal(missing.ip, null);
    assert.equal(missing.actor, 'system');
  });

  test('should_append_entries_to_a_json_lines_file', async (t) => {
    if (config.persistence !== 'file') {
      t.skip('file persistence is not enabled');
      return;
    }
    await flushActivityWrites();
    const raw = await fs.readFile(path.join(tenantDataDir(TENANT), 'activity.jsonl'), 'utf8');
    const lines = raw.trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((entry) => entry.detail), ['entry 1', 'entry 2', 'entry 3', 'entry 4', 'entry 5']);
  });
});
