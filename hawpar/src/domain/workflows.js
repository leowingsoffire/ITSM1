/**
 * Operational workflow catalogue.
 *
 * Every document type belongs to a business process, and every process has a
 * defined path from capture to closure. These definitions are the contract the
 * workflow engine executes: the routing agent picks one, the engine instantiates
 * it, and the review workspace drives it to completion.
 *
 * Step types
 *   automated    performed by the agent mesh; completed with machine evidence
 *   human        requires a person in the named role
 *   integration  hand-off to a downstream system of record
 */

export const StepType = Object.freeze({
  AUTOMATED: 'automated',
  HUMAN: 'human',
  INTEGRATION: 'integration'
});

export const WorkflowStatus = Object.freeze({
  ACTIVE: 'active',
  BLOCKED: 'blocked',
  ON_HOLD: 'on-hold',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
});

export const StepStatus = Object.freeze({
  PENDING: 'pending',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
  REJECTED: 'rejected'
});

export const Priority = Object.freeze({
  CRITICAL: 'critical',
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low'
});

const step = (id, name, type, role, slaHours, exitCriteria) =>
  Object.freeze({ id, name, type, role, slaHours, exitCriteria });

const CAPTURE = step(
  'capture',
  'Capture & integrity check',
  StepType.AUTOMATED,
  'Intake agent',
  0.05,
  'File accepted, checksum recorded, page budget within limits.'
);

const ANALYSE = step(
  'analyse',
  'Document Intelligence analysis',
  StepType.AUTOMATED,
  'Document Intelligence agent',
  0.1,
  'Azure AI Document Intelligence returned a normalised result for every page.'
);

const ASSURE = step(
  'assure',
  'Accuracy assurance',
  StepType.AUTOMATED,
  'Accuracy agent',
  0.1,
  'Every field carries a verdict and a calibrated confidence.'
);

/** @type {ReadonlyArray<object>} */
export const WORKFLOW_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'wf_ap_three_way',
    name: 'Accounts Payable — three-way match',
    process: 'Accounts Payable',
    description:
      'Supplier invoice matched to its purchase order and goods receipt, GST verified, then released for payment.',
    owner: 'Group Finance',
    slaHours: 24,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('match', 'Three-way match', StepType.AUTOMATED, 'Reconciliation agent', 0.1, 'Invoice, PO and GRN agree within tolerance.'),
      step('exception', 'AP exception review', StepType.HUMAN, 'AP Analyst', 8, 'Every flagged field corrected or accepted.'),
      step('approve', 'Payment approval', StepType.HUMAN, 'Finance Manager', 12, 'Approver signs off the payable.'),
      step('post', 'Post to ledger', StepType.INTEGRATION, 'Finance system', 4, 'Voucher created in the accounting system.')
    ]
  }),
  Object.freeze({
    id: 'wf_procurement',
    name: 'Procurement — order acknowledgement',
    process: 'Procurement',
    description: 'Purchase orders captured, budget-checked and acknowledged to the supplier.',
    owner: 'Supply Chain',
    slaHours: 16,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('budget', 'Budget & authority check', StepType.AUTOMATED, 'Reconciliation agent', 0.1, 'Order value within the delegated authority.'),
      step('review', 'Buyer review', StepType.HUMAN, 'Procurement Buyer', 8, 'Order lines and delivery terms confirmed.'),
      step('acknowledge', 'Supplier acknowledgement', StepType.INTEGRATION, 'Supplier portal', 8, 'Acknowledgement dispatched.')
    ]
  }),
  Object.freeze({
    id: 'wf_goods_receipt',
    name: 'Inbound logistics — goods receipt',
    process: 'Inbound Logistics',
    description: 'Delivery orders and GRNs reconciled to the purchase order before stock is put away.',
    owner: 'Supply Chain',
    slaHours: 12,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('quantities', 'Quantity reconciliation', StepType.AUTOMATED, 'Reconciliation agent', 0.1, 'Received quantities match the ordered quantities.'),
      step('warehouse', 'Warehouse confirmation', StepType.HUMAN, 'Warehouse Supervisor', 6, 'Physical receipt confirmed against the document.'),
      step('putaway', 'Stock put-away', StepType.INTEGRATION, 'Inventory system', 6, 'Stock movement posted.')
    ]
  }),
  Object.freeze({
    id: 'wf_qc_release',
    name: 'Quality assurance — batch release',
    process: 'Quality Assurance',
    description: 'Certificates of analysis checked against specification limits before a batch is released.',
    owner: 'Quality Assurance',
    slaHours: 24,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('spec', 'Specification conformance', StepType.AUTOMATED, 'Validation agent', 0.1, 'Every measured result sits inside its specification band.'),
      step('qc-review', 'QC reviewer sign-off', StepType.HUMAN, 'QC Analyst', 8, 'Out-of-specification results investigated.'),
      step('release', 'Batch release decision', StepType.HUMAN, 'QA Manager', 12, 'Batch released or quarantined.'),
      step('record', 'Update batch record', StepType.INTEGRATION, 'Quality system', 4, 'Release status written to the batch record.')
    ]
  }),
  Object.freeze({
    id: 'wf_export_shipment',
    name: 'Export logistics — shipment release',
    process: 'Export Logistics',
    description: 'Bills of lading validated (container check digit, ports, parties) before documents are released.',
    owner: 'Supply Chain',
    slaHours: 12,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('customs', 'Customs data check', StepType.AUTOMATED, 'Validation agent', 0.1, 'Container, ports and parties are internally consistent.'),
      step('freight', 'Freight desk review', StepType.HUMAN, 'Logistics Coordinator', 6, 'Shipping instructions confirmed.'),
      step('release-docs', 'Release documents', StepType.INTEGRATION, 'Forwarder', 6, 'Documents released to the forwarder.')
    ]
  }),
  Object.freeze({
    id: 'wf_regulatory_renewal',
    name: 'Regulatory affairs — licence renewal',
    process: 'Regulatory Affairs',
    description: 'Product registrations tracked to expiry with renewal windows raised automatically.',
    owner: 'Regulatory Affairs',
    slaHours: 72,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('expiry', 'Expiry & market check', StepType.AUTOMATED, 'Compliance agent', 0.1, 'Expiry date and regulator recognised.'),
      step('ra-review', 'Regulatory review', StepType.HUMAN, 'Regulatory Affairs Officer', 48, 'Renewal window and dossier confirmed.'),
      step('calendar', 'Renewal calendar update', StepType.INTEGRATION, 'Compliance register', 24, 'Renewal task scheduled.')
    ]
  }),
  Object.freeze({
    id: 'wf_ip_portfolio',
    name: 'Legal & IP — trademark portfolio',
    process: 'Legal & IP',
    description: 'Trademark certificates indexed with renewal dates and classes for the IP register.',
    owner: 'Corporate Legal',
    slaHours: 72,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('registry', 'Registry cross-check', StepType.AUTOMATED, 'Reconciliation agent', 0.1, 'Registration number and class validated.'),
      step('legal-review', 'Legal review', StepType.HUMAN, 'Legal Counsel', 48, 'Ownership and renewal date confirmed.'),
      step('register', 'Update IP register', StepType.INTEGRATION, 'IP register', 24, 'Portfolio entry updated.')
    ]
  }),
  Object.freeze({
    id: 'wf_lease_lifecycle',
    name: 'Property — lease lifecycle',
    process: 'Property Management',
    description: 'Tenancy agreements abstracted: term, rent, deposit and break clauses captured for the rent roll.',
    owner: 'Property',
    slaHours: 48,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('abstract', 'Lease abstraction', StepType.AUTOMATED, 'Extraction agent', 0.2, 'Term, rent and deposit extracted with anchors.'),
      step('property-review', 'Property manager review', StepType.HUMAN, 'Property Manager', 24, 'Commercial terms confirmed against the executed lease.'),
      step('rentroll', 'Rent roll update', StepType.INTEGRATION, 'Property system', 12, 'Rent roll and diary updated.')
    ]
  }),
  Object.freeze({
    id: 'wf_financial_reporting',
    name: 'Group reporting — financial statements',
    process: 'Group Reporting',
    description: 'Annual reports and financial statements indexed, balance-sheet ties checked and filed.',
    owner: 'Group Finance',
    slaHours: 48,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('ties', 'Balance sheet ties', StepType.AUTOMATED, 'Validation agent', 0.2, 'Assets equal liabilities plus equity within tolerance.'),
      step('analyst', 'Analyst review', StepType.HUMAN, 'Financial Analyst', 24, 'Key figures agreed to the source statements.'),
      step('publish', 'Publish to reporting pack', StepType.INTEGRATION, 'Reporting pack', 12, 'Figures released to the reporting pack.')
    ]
  }),
  Object.freeze({
    id: 'wf_bank_reconciliation',
    name: 'Treasury — bank reconciliation',
    process: 'Treasury',
    description: 'Bank statements parsed, balances proven and exceptions routed to treasury.',
    owner: 'Group Treasury',
    slaHours: 24,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('balance', 'Balance proof', StepType.AUTOMATED, 'Validation agent', 0.1, 'Opening + credits − debits equals the closing balance.'),
      step('treasury-review', 'Treasury review', StepType.HUMAN, 'Treasury Analyst', 12, 'Unmatched movements investigated.'),
      step('reconcile', 'Post reconciliation', StepType.INTEGRATION, 'Treasury system', 8, 'Reconciliation posted.')
    ]
  }),
  Object.freeze({
    id: 'wf_expense_claim',
    name: 'Human resources — expense claim',
    process: 'Human Resources',
    description: 'Employee claims checked against policy caps and receipts before reimbursement.',
    owner: 'Human Resources',
    slaHours: 24,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('policy', 'Policy cap check', StepType.AUTOMATED, 'Compliance agent', 0.1, 'Claim total within the policy cap and receipts attached.'),
      step('manager', 'Line manager approval', StepType.HUMAN, 'Line Manager', 12, 'Manager approves the claim.'),
      step('payroll', 'Reimburse via payroll', StepType.INTEGRATION, 'Payroll', 8, 'Reimbursement scheduled.')
    ]
  }),
  Object.freeze({
    id: 'wf_ap_claim_settlement',
    name: 'Trade marketing — A&P claim settlement',
    process: 'Trade Marketing (A&P)',
    description:
      'Distributor A&P claims reconciled to supporting documents and the agreed budget before settlement.',
    owner: 'Sales & Marketing',
    slaHours: 36,
    steps: [
      CAPTURE,
      ANALYSE,
      ASSURE,
      step('substantiate', 'Substantiation match', StepType.AUTOMATED, 'Reconciliation agent', 0.2, 'Every claim line is supported by a document.'),
      step('marketing-review', 'Trade marketing review', StepType.HUMAN, 'Trade Marketing Manager', 16, 'Unsupported lines resolved or rejected.'),
      step('finance-approve', 'Finance approval', StepType.HUMAN, 'Finance Manager', 12, 'Settlement value approved.'),
      step('settle', 'Settle claim', StepType.INTEGRATION, 'Finance system', 8, 'Credit note or payment issued.')
    ]
  }),
  Object.freeze({
    id: 'wf_manual_triage',
    name: 'Manual triage',
    process: 'Manual Triage',
    description: 'Documents the classifier could not place with confidence are routed to a human for typing.',
    owner: 'Shared Services',
    slaHours: 8,
    steps: [
      CAPTURE,
      ANALYSE,
      step('triage', 'Human triage', StepType.HUMAN, 'Document Controller', 4, 'Document type confirmed and re-routed.'),
      step('reroute', 'Re-route to process', StepType.INTEGRATION, 'Workflow engine', 4, 'Document placed on the correct workflow.')
    ]
  })
]);

const BY_ID = new Map(WORKFLOW_DEFINITIONS.map((definition) => [definition.id, definition]));
const BY_PROCESS = new Map(WORKFLOW_DEFINITIONS.map((definition) => [definition.process, definition]));

export function getWorkflowDefinition(definitionId) {
  return BY_ID.get(definitionId) ?? null;
}

/** Chooses the workflow for a business process, falling back to manual triage. */
export function definitionForProcess(process) {
  return BY_PROCESS.get(process) ?? BY_ID.get('wf_manual_triage');
}

export const WORKFLOW_ROLES = Object.freeze([
  ...new Set(
    WORKFLOW_DEFINITIONS.flatMap((definition) =>
      definition.steps.filter((entry) => entry.type === StepType.HUMAN).map((entry) => entry.role)
    )
  )
].sort());
