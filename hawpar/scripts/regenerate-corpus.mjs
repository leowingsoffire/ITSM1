/**
 * Regenerates the demo corpus from the sample library.
 *
 * The pipeline is asynchronous, so each batch is submitted and then drained by
 * polling the health endpoint until the queue is empty — a fixed sleep either
 * wastes time or races the workers.
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:8080';
const BATCH = 12;

async function json(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} → HTTP ${response.status}`);
  return response.json();
}

async function drain(label) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const health = await json('/api/health');
    const depth = health.pipeline?.queueDepth ?? 0;
    const active = health.pipeline?.activeCount ?? 0;
    if (depth === 0 && active === 0) return health;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label}: pipeline did not drain`);
}

const samples = (await json('/api/samples')).items ?? [];
console.log(`sample library: ${samples.length}`);

await json('/api/admin/reset', { method: 'DELETE' });
console.log('store reset');

const plans = [
  { seed: null, ids: samples.map((s) => s.id) },
  { seed: 'vgc-2026-a', ids: samples.filter((s) => !/mkt/.test(s.id)).map((s) => s.id) },
  { seed: 'vgc-2026-b', ids: samples.filter((s) => !/mkt/.test(s.id)).map((s) => s.id) }
];

for (const plan of plans) {
  for (let index = 0; index < plan.ids.length; index += BATCH) {
    const sampleIds = plan.ids.slice(index, index + BATCH);
    const body = plan.seed ? { sampleIds, seed: plan.seed } : { sampleIds };
    await json('/api/samples/run', { method: 'POST', body: JSON.stringify(body) });
    const health = await drain(`${plan.seed ?? 'default'}#${index}`);
    console.log(
      `  ${plan.seed ?? 'default'} batch ${index / BATCH + 1}: ${sampleIds.length} queued · processed ${health.pipeline?.processedCount ?? 0} · failed ${health.pipeline?.failedCount ?? 0}`
    );
  }
}

const health = await json('/api/health');
const inventory = await json('/api/documents?pageSize=1');
console.log(
  `documents: ${inventory.total ?? 0} · processed: ${health.pipeline?.processedCount ?? 0} · failed: ${health.pipeline?.failedCount ?? 0}`
);

const benchmark = await json('/api/accuracy/benchmark');
console.log(
  JSON.stringify(
    {
      documentsScored: benchmark.documentsScored,
      averageAccuracy: benchmark.averageAccuracy,
      averageCoverage: benchmark.averageCoverage,
      verifiedFieldRatio: benchmark.verifiedFieldRatio,
      conflictRatio: benchmark.conflictRatio,
      integrityIssueRatio: benchmark.integrityIssueRatio,
      stpEligibleRatio: benchmark.stpEligibleRatio,
      brier: benchmark.calibration?.brierScore
    },
    null,
    1
  )
);
console.table(
  benchmark.byType.map((entry) => ({
    type: entry.typeId,
    docs: entry.documents,
    accuracy: entry.averageAccuracy,
    coverage: entry.averageCoverage,
    conflicts: entry.conflicts,
    disputes: entry.integrityIssues,
    stp: entry.stpEligibleRatio
  }))
);
console.table(
  benchmark.byCheck.map((entry) => ({
    check: entry.name,
    proves: entry.attribution,
    evaluated: entry.evaluated,
    pass: entry.pass,
    fail: entry.fail,
    rate: entry.passRate
  }))
);
