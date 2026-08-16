/**
 * Agent registry.
 *
 * The platform does not run one monolithic "AI step". It runs a mesh of
 * narrow, auditable specialists that hand work to each other over an explicit
 * dependency graph. Each agent owns one decision, states its evidence, and can
 * fail or escalate without taking the rest of the run with it.
 *
 * `dependsOn` defines the execution graph. Agents with the same dependency depth
 * run concurrently, which is why the mesh is a graph rather than a queue.
 * `stage` maps an agent onto the legacy six-stage pipeline so existing progress
 * UI keeps working, and `workflowStepId` links an agent to the workflow step it
 * discharges.
 */

export const AgentRole = Object.freeze({
  INTAKE: 'intake',
  PERCEPTION: 'perception',
  REASONING: 'reasoning',
  ASSURANCE: 'assurance',
  GOVERNANCE: 'governance',
  ORCHESTRATION: 'orchestration'
});

const agent = (id, definition) => Object.freeze({ id, ...definition });

export const AGENTS = Object.freeze([
  agent('intake', {
    name: 'Intake & Triage Agent',
    role: AgentRole.INTAKE,
    mission: 'Prove the file is safe, readable and within budget, then propose an analysis plan.',
    capabilities: ['integrity-verification', 'page-budgeting', 'type-hinting', 'cost-guardrails'],
    tools: ['sha-256 checksum', 'magic-byte validation', 'filename heuristics'],
    dependsOn: [],
    stage: 'ingest',
    workflowStepId: 'capture',
    icon: 'shield',
    tone: 'navy'
  }),
  agent('docint', {
    name: 'Document Intelligence Agent',
    role: AgentRole.PERCEPTION,
    mission:
      'Drive Azure AI Document Intelligence: choose the cheapest capable model, request only the add-ons the document needs, and normalise the response.',
    capabilities: ['adaptive-model-routing', 'add-on-selection', 'query-fields', 'long-running-operations'],
    tools: ['Azure AI Document Intelligence REST 2024-11-30', 'prebuilt-read', 'prebuilt-layout', 'offline demo engine'],
    dependsOn: ['intake'],
    stage: 'analyse',
    workflowStepId: 'analyse',
    icon: 'cloud',
    tone: 'teal'
  }),
  agent('classifier', {
    name: 'Classification Agent',
    role: AgentRole.REASONING,
    mission: 'Place the document in the taxonomy with explainable evidence and an honest margin.',
    capabilities: ['weighted-evidence-scoring', 'runner-up-margin', 'ambiguity-escalation'],
    tools: ['title/heading signals', 'keyword corpus', 'field-label detection'],
    dependsOn: ['docint'],
    stage: 'classify',
    workflowStepId: null,
    icon: 'tag',
    tone: 'violet'
  }),
  agent('extractor', {
    name: 'Extraction Agent',
    role: AgentRole.REASONING,
    mission: 'Resolve every declared business field with a page anchor and a traceable source.',
    capabilities: ['key-value-binding', 'fuzzy-label-matching', 'regex-patterns', 'azure-field-merge'],
    tools: ['layout key-value pairs', 'prebuilt document fields', 'type-aware parsers'],
    dependsOn: ['classifier'],
    stage: 'extract',
    workflowStepId: 'abstract',
    icon: 'edit',
    tone: 'navy'
  }),
  agent('tabulator', {
    name: 'Table & Line-item Agent',
    role: AgentRole.REASONING,
    mission: 'Understand tabular payloads: foot the columns and prove the lines support the header totals.',
    capabilities: ['column-typing', 'table-footing', 'line-item-reconciliation'],
    tools: ['recognised tables', 'numeric column inference'],
    dependsOn: ['extractor'],
    stage: 'extract',
    workflowStepId: null,
    icon: 'table',
    tone: 'teal'
  }),
  agent('compliance', {
    name: 'Compliance & Privacy Agent',
    role: AgentRole.GOVERNANCE,
    mission: 'Enforce PDPA minimisation, retention and claim-substantiation policy before anything is stored.',
    capabilities: ['pii-detection', 'masking-verification', 'policy-caps', 'retention-classification'],
    tools: ['identifier patterns', 'policy register'],
    dependsOn: ['extractor'],
    stage: 'validate',
    workflowStepId: 'policy',
    icon: 'lock',
    tone: 'amber'
  }),
  agent('validator', {
    name: 'Validation Agent',
    role: AgentRole.ASSURANCE,
    mission: 'Apply the business rule catalogue for the document type and report every breach.',
    capabilities: ['rule-execution', 'severity-grading', 'field-attribution'],
    tools: ['rule catalogue', 'reference data'],
    dependsOn: ['tabulator', 'compliance'],
    stage: 'validate',
    workflowStepId: 'spec',
    icon: 'checkCircle',
    tone: 'jade'
  }),
  agent('reconciler', {
    name: 'Reconciliation Agent',
    role: AgentRole.ASSURANCE,
    mission: 'Cross-check the document against its counterparties: matching, footing and reference masters.',
    capabilities: ['three-way-match', 'reference-master-lookup', 'duplicate-detection'],
    tools: ['supplier master', 'document corpus', 'arithmetic proofs'],
    dependsOn: ['validator'],
    stage: 'validate',
    workflowStepId: 'match',
    icon: 'scale',
    tone: 'violet'
  }),
  agent('accuracy', {
    name: 'Accuracy Assurance Agent',
    role: AgentRole.ASSURANCE,
    mission:
      'Turn confidence claims into evidence: ground every value in the source, corroborate it, and recalibrate the score.',
    capabilities: ['source-grounding', 'independent-corroboration', 'auto-repair', 'confidence-calibration'],
    tools: ['assurance check suite', 'calibration model'],
    dependsOn: ['reconciler'],
    stage: 'score',
    workflowStepId: 'assure',
    icon: 'target',
    tone: 'jade'
  }),
  agent('router', {
    name: 'Workflow Routing Agent',
    role: AgentRole.ORCHESTRATION,
    mission: 'Select the operating workflow, score priority and open the instance on the right queue.',
    capabilities: ['process-selection', 'priority-scoring', 'sla-assignment', 'queue-routing'],
    tools: ['workflow catalogue', 'priority model'],
    dependsOn: ['accuracy'],
    stage: 'score',
    workflowStepId: null,
    icon: 'route',
    tone: 'navy'
  }),
  agent('supervisor', {
    name: 'Supervisor Agent',
    role: AgentRole.ORCHESTRATION,
    mission: 'Weigh every agent report, settle disagreements and record the final disposition with its rationale.',
    capabilities: ['consensus-scoring', 'escalation-management', 'disposition-rationale'],
    tools: ['agent reports', 'escalation policy'],
    dependsOn: ['router'],
    stage: 'score',
    workflowStepId: null,
    icon: 'brain',
    tone: 'amber'
  })
]);

const INDEX = new Map(AGENTS.map((entry) => [entry.id, entry]));

export function getAgent(agentId) {
  return INDEX.get(agentId) ?? null;
}

/**
 * Groups agents into execution waves. Everything inside a wave is independent
 * and is executed concurrently by the orchestrator.
 * @returns {string[][]} agent ids, wave by wave
 */
export function executionWaves() {
  const settled = new Set();
  const waves = [];
  let remaining = AGENTS.map((entry) => entry.id);

  while (remaining.length > 0) {
    const wave = remaining.filter((id) => (getAgent(id)?.dependsOn ?? []).every((dep) => settled.has(dep)));
    if (wave.length === 0) throw new Error('Agent graph contains a cycle.');
    for (const id of wave) settled.add(id);
    waves.push(wave);
    remaining = remaining.filter((id) => !settled.has(id));
  }

  return waves;
}

/** Static description of the mesh for the agent console. */
export function agentTopology() {
  const waves = executionWaves();
  return {
    agentCount: AGENTS.length,
    waveCount: waves.length,
    parallelWaves: waves.filter((wave) => wave.length > 1).length,
    waves: waves.map((wave, index) => ({ wave: index + 1, agentIds: wave })),
    agents: AGENTS.map((entry) => ({
      id: entry.id,
      name: entry.name,
      role: entry.role,
      mission: entry.mission,
      capabilities: entry.capabilities,
      tools: entry.tools,
      dependsOn: entry.dependsOn,
      stage: entry.stage,
      icon: entry.icon,
      tone: entry.tone,
      wave: waves.findIndex((wave) => wave.includes(entry.id)) + 1
    }))
  };
}
