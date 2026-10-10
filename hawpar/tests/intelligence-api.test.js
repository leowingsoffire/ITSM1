/**
 * API integration tests for the intelligence surface: the agent mesh, the
 * workflow engine, the accuracy console and the Azure Document Intelligence
 * console. Boots the real Express app, pushes a generated PDF through the full
 * orchestration and asserts on the contracts the UI depends on.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import './helpers/isolation.js';
import { createApp } from '../src/app.js';
import { generateSamplePdf } from '../src/services/sample.service.js';
import { waitForIdle } from '../src/services/pipeline.service.js';
import { clearAll, initialiseStore } from '../src/services/store.service.js';

let server;
let baseUrl;
let documentId;

const OPERATOR = 'tester@vgc.com';
const get = (path) => fetch(`${baseUrl}${path}`, { headers: { 'x-user-operator': OPERATOR } });
const postJson = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    // The test-only principal: attribution comes from the authenticated
    // caller, never from a field in the request body.
    headers: { 'Content-Type': 'application/json', 'x-user-operator': OPERATOR },
    body: JSON.stringify(body)
  });

before(async () => {
  await initialiseStore();
  await clearAll();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  const { buffer, mimeType } = await generateSamplePdf('supplier_invoice', 'intelligence-test');
  const form = new FormData();
  form.append('files', new Blob([buffer], { type: mimeType }), 'orchestrated-invoice.pdf');
  const upload = await fetch(`${baseUrl}/documents`, { method: 'POST', body: form });
  assert.equal(upload.status, 202);
  documentId = (await upload.json()).accepted[0].id;
  await waitForIdle();
});

after(async () => {
  await clearAll();
  await new Promise((resolve) => server.close(resolve));
});

describe('agent mesh API', () => {
  test('should_publish_the_whole_mesh_with_its_execution_waves', async () => {
    const response = await get('/agents');
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.total >= 10);
    assert.equal(payload.agents.length, payload.total);
    assert.equal(
      payload.waves.reduce((sum, wave) => sum + wave.agentIds.length, 0),
      payload.total,
      'every agent must appear in exactly one wave'
    );
    assert.ok(payload.topology.waveCount === payload.waveCount);
  });

  test('should_return_a_single_agent_with_the_evidence_it_produced', async () => {
    const mesh = await (await get('/agents')).json();
    const agentId = mesh.agents[0].id;
    const response = await get(`/agents/${agentId}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.agent.id, agentId);
    assert.ok(Array.isArray(payload.recent));
  });

  test('should_reject_an_unknown_agent_with_a_not_found_error', async () => {
    const response = await get('/agents/definitely-not-an-agent');
    assert.equal(response.status, 404);
    const payload = await response.json();
    assert.equal(payload.error.code, 'NOT_FOUND');
  });

  test('should_record_an_orchestration_run_for_the_processed_document', async () => {
    const runs = await (await get('/agents/runs?limit=10')).json();
    assert.ok(runs.total >= 1);
    assert.equal(runs.failedCount, 0);
    const run = runs.items.find((entry) => entry.documentId === documentId);
    assert.ok(run, 'the uploaded document must have an orchestration run');
    assert.ok(run.agentCount >= 10, 'every agent should have contributed to the run');
    assert.ok(run.waveCount >= 2, 'the mesh must execute in dependency-ordered waves');
    assert.ok(run.durationMs >= 0);
    assert.ok(run.fileName.length > 0);
  });

  test('should_expose_the_agent_run_attached_to_a_document', async () => {
    const response = await get(`/documents/${documentId}/agent-run`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.documentId, documentId);
    assert.ok(payload.run.steps.length >= 10);
    for (const step of payload.run.steps) {
      assert.ok(step.agentId.length > 0);
      assert.ok(step.summary.length > 0, `${step.agentId} produced no summary`);
      assert.ok(step.confidence >= 0 && step.confidence <= 1);
    }
  });
});

describe('workflow API', () => {
  test('should_instantiate_a_workflow_for_the_processed_document', async () => {
    const response = await get('/workflows');
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.total >= 1);
    const item = payload.items.find((entry) => entry.documentId === documentId);
    assert.ok(item, 'the processed document must appear on the workflow board');
    assert.ok(item.definitionName.length > 0);
    assert.ok(item.progress >= 0 && item.progress <= 1);
  });

  test('should_filter_search_and_sort_the_workflow_board', async () => {
    const all = await (await get('/workflows')).json();
    const active = await (await get('/workflows?status=active')).json();
    assert.ok(active.total <= all.total);
    assert.ok(active.items.every((entry) => entry.status === 'active'));

    const nothing = await (await get('/workflows?search=zzz-no-such-document-zzz')).json();
    assert.equal(nothing.total, 0);
    assert.deepEqual(nothing.items, []);

    const sorted = await (await get('/workflows?sort=priorityScore:desc')).json();
    const scores = sorted.items.map((entry) => entry.priorityScore);
    assert.deepEqual([...scores].sort((a, b) => b - a), scores);
  });

  test('should_publish_an_overview_with_queues_and_definitions', async () => {
    const overview = await (await get('/workflows/overview')).json();
    assert.ok(overview.total >= 1);
    assert.ok(overview.automationRate >= 0 && overview.automationRate <= 1);
    assert.ok(Array.isArray(overview.queues));
    assert.ok(overview.definitions.reduce((sum, entry) => sum + entry.total, 0) >= 1);
  });

  test('should_return_the_full_workflow_for_a_document', async () => {
    const workflow = await (await get(`/workflows/${documentId}`)).json();
    assert.equal(workflow.documentId, documentId);
    assert.ok(workflow.steps.length >= 3);
    assert.ok(workflow.history.length >= 1);
  });

  test('should_reject_an_unknown_workflow_with_a_not_found_error', async () => {
    const response = await get('/workflows/doc_not-a-real-document');
    assert.equal(response.status, 404);
  });

  test('should_reject_a_workflow_action_without_an_action', async () => {
    const missingAction = await postJson(`/workflows/${documentId}/actions`, { note: 'No action supplied.' });
    assert.equal(missingAction.status, 400);
  });

  test('should_reject_an_action_that_is_not_in_the_vocabulary', async () => {
    const response = await postJson(`/workflows/${documentId}/actions`, {
      action: 'obliterate'
    });
    assert.equal(response.status, 400);
  });

  test('should_advance_the_workflow_and_write_an_attributable_audit_entry', async () => {
    const before = await (await get(`/workflows/${documentId}`)).json();
    const response = await postJson(`/workflows/${documentId}/actions`, {
      action: 'comment',
      note: 'Reviewed during the integration test.'
    });
    assert.equal(response.status, 200);

    const after = await (await get(`/workflows/${documentId}`)).json();
    assert.equal(after.history.length, before.history.length + 1);
    const entry = after.history.at(-1);
    assert.equal(entry.actor, OPERATOR);
    assert.equal(entry.action, 'comment');
    assert.ok(entry.at.length > 0);
  });

  test('should_ignore_a_forged_actor_in_the_request_body', async () => {
    const response = await postJson(`/workflows/${documentId}/actions`, {
      action: 'comment',
      actor: 'someone.else@example.com',
      note: 'Attempted impersonation.'
    });
    assert.equal(response.status, 200);
    const workflow = await (await get(`/workflows/${documentId}`)).json();
    assert.equal(workflow.history.at(-1).actor, OPERATOR, 'the audit trail must name the authenticated caller');
  });

  test('should_persist_a_reassignment_so_the_queue_reflects_the_new_owner', async () => {
    const response = await postJson(`/workflows/${documentId}/actions`, {
      action: 'reassign',
      assignee: 'Finance controller'
    });
    assert.equal(response.status, 200);
    const workflow = await (await get(`/workflows/${documentId}`)).json();
    assert.equal(workflow.assignee, 'Finance controller');
  });

  test('should_require_an_assignee_when_reassigning', async () => {
    const response = await postJson(`/workflows/${documentId}/actions`, {
      action: 'reassign'
    });
    assert.equal(response.status, 400);
  });
});

describe('accuracy API', () => {
  test('should_score_the_processed_document_with_evidence_for_every_field', async () => {
    const response = await get(`/documents/${documentId}/accuracy`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.documentId, documentId);
    assert.ok(payload.accuracy.fields.length > 0);
    assert.ok(payload.accuracy.accuracyScore >= 0 && payload.accuracy.accuracyScore <= 1);
    for (const field of payload.accuracy.fields) {
      assert.ok(field.checks.length >= 5, `${field.key} needs multi-angle verification`);
    }
  });

  test('should_benchmark_the_corpus_check_by_check', async () => {
    const benchmark = await (await get('/accuracy/benchmark')).json();
    assert.ok(benchmark.documentsScored >= 1);
    assert.ok(benchmark.averageAccuracy >= 0 && benchmark.averageAccuracy <= 1);
    assert.ok(benchmark.byCheck.length >= 5);
    for (const entry of benchmark.byCheck) {
      assert.equal(entry.evaluated, entry.pass + entry.fail);
      assert.ok(entry.skipped >= 0);
      if (entry.evaluated > 0) assert.ok(entry.passRate >= 0 && entry.passRate <= 1);
    }
    assert.ok(benchmark.byType.length >= 1);
  });

  test('should_publish_a_calibration_curve_for_the_corpus', async () => {
    const calibration = await (await get('/accuracy/calibration')).json();
    assert.ok(calibration.observations >= 1);
    assert.ok(Array.isArray(calibration.reliability));
    assert.ok(calibration.brierScore >= 0 && calibration.brierScore <= 1);
  });

  test('should_return_not_found_for_the_accuracy_of_an_unknown_document', async () => {
    const response = await get('/documents/doc_not-real/accuracy');
    assert.equal(response.status, 404);
  });
});

describe('azure document intelligence API', () => {
  test('should_publish_the_integration_profile_without_a_credential', async () => {
    const profile = await (await get('/azure/profile')).json();
    assert.ok(['demo', 'azure'].includes(profile.mode));
    assert.equal(JSON.stringify(profile).toLowerCase().includes('apikey'), false);
  });

  test('should_publish_the_model_catalogue_and_the_routing_decision_per_type', async () => {
    const catalogue = await (await get('/azure/models')).json();
    const modelIds = new Set(catalogue.models.map((entry) => entry.id));
    assert.ok(catalogue.routing.length >= 11);
    for (const route of catalogue.routing) {
      assert.ok(modelIds.has(route.selectedModelId), `${route.typeId} routes outside the catalogue`);
    }
  });

  test('should_report_a_status_even_when_the_service_is_not_configured', async () => {
    const status = await (await get('/azure/status')).json();
    assert.equal(typeof status.probe.reachable, 'boolean');
    assert.ok(status.modelCount >= 6);
    assert.ok(status.addOnCount >= 5);
  });

  test('should_re_probe_on_demand_without_failing_the_request', async () => {
    const response = await get('/azure/status?refresh=true');
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.ok(status.probe.checkedAt.length > 0);
  });
});
