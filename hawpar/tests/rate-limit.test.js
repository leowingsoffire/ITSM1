/**
 * Rate-limit accounting.
 *
 * The API middlewares are mounted as one pipeline precisely so that a request
 * is counted once. When they were mounted on several overlapping `/api`
 * chains, a request that fell through them consumed one slot per chain, so the
 * configured budget was silently divided (a `/api/documents` read cost five
 * slots). These tests pin the contract: one request, one slot, on every route
 * regardless of how deep in the pipeline it is served.
 *
 * The limit is lowered through the environment before the application (and its
 * frozen configuration) is imported, so the suite stays fast. The application
 * modules are therefore loaded dynamically — static imports are hoisted and
 * would run before the assignment below.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import './helpers/isolation.js';

process.env.RATE_LIMIT_API_PER_MINUTE = '20';

const { createApp } = await import('../src/app.js');
const { initialiseStore, clearAll } = await import('../src/services/store.service.js');
const { config } = await import('../src/config/index.js');

const BUDGET = 20;

let server;
let baseUrl;

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

/** Sends `count` sequential requests and returns the observed status codes. */
async function drain(path, count) {
  const statuses = [];
  for (let index = 0; index < count; index += 1) {
    statuses.push((await fetch(`${baseUrl}${path}`)).status);
  }
  return statuses;
}

describe('API rate limiting', () => {
  test('should_read_the_budget_from_configuration', () => {
    assert.equal(config.security.rateLimit.apiPerMinute, BUDGET);
    assert.equal(config.security.rateLimit.uploadPerMinute, 60);
  });

  test('should_charge_exactly_one_slot_per_request_on_the_deepest_route', async () => {
    // /api/documents is served by the last router in the pipeline, so it is
    // the route that previously paid the highest multiple.
    const statuses = await drain('/documents?pageSize=1', BUDGET);
    assert.deepEqual(
      statuses.filter((status) => status !== 200),
      [],
      'every request inside the budget must be served'
    );

    const overflow = await fetch(`${baseUrl}/documents?pageSize=1`);
    assert.equal(overflow.status, 429, 'the request after the budget must be rejected');
    assert.ok(Number(overflow.headers.get('retry-after')) > 0, 'a Retry-After hint must be supplied');

    const payload = await overflow.json();
    assert.equal(payload.error.code, 'RATE_LIMITED');
  });

  test('should_reject_further_requests_on_every_route_once_the_budget_is_spent', async () => {
    // The bucket is shared per client, so a shallow route is limited too.
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 429);
  });
});
