/**
 * Example register: 19 invented agents, workflows, features and code items with complete register cards, so the Solution register
 * can be shown, tested and discussed without the shared database. Every name, person, date and number is made up.
 *
 * The set is built to cover each case on purpose: all five lifecycle phases, all four criticality levels, all four verification
 * states, all three risk classes, each flag the register can raise, a replacement pair (old workflow in phase-out, new one active)
 * and an agent pair that overlaps. The cards go through the same reader (`sanitizeCard`) as real data, so the examples cannot hold
 * values the real register would reject. People use example.com addresses.
 *
 * The review dates are absolute. As time passes more of them fall into the past and more items show "Review overdue"; that is how
 * a real register ages, and the tests fix the clock.
 */
import type { RItem, Rev, RType } from './registry.ts';
import { sanitizeCard, type PolicyBrief, type Relation } from './registry-card.ts';

export const EXAMPLE_PREFIX = 'ex-';
export const isExampleId = (id: string) => id.startsWith(EXAMPLE_PREFIX);

const at = (d: string) => Date.parse(`${d}T09:00:00Z`);
const rel = (kind: Relation['kind'], name: string, access?: 'read' | 'write', note?: string): Relation => ({ kind, name, ...(access ? { access } : {}), ...(note ? { note } : {}) });

const MARA = 'mara.keller@example.com', JONAS = 'jonas.weber@example.com', TIMO = 'timo.brandt@example.com', LENA = 'lena.fischer@example.com';
const TOBIAS = 'tobias.maier@example.com', SARA = 'sara.novak@example.com';
const INES = 'Ines Vogel (Head of Finance IT)', ANDREAS = 'Andreas Roth (Head of Procurement)', KATHRIN = 'Kathrin Lang (Head of HR Operations)';
const PETRA = 'Petra Sommer (Head of IT Platform)', DAVID = 'David Klein (Head of Sales Operations)';

const AGENT = 'Werkbank agent (Goose)', N8N = 'n8n', WB = 'Werkbank';
const GENIE_POLICY: PolicyBrief = { mode: 'read-only', systems: 2, writes: false, unattended: false, gaps: 2 };

type Seed = {
  id: string; type: RType; name: string; owner: string; stage?: string; approved?: string[]; archived?: boolean;
  refs?: RItem['refs']; extendsItem?: RItem['extendsItem']; policy?: PolicyBrief | null; card: Record<string, unknown>;
  /** Oldest first: [note, author, day]. The revision number is the position. */
  history: Array<[string, string, string]>;
};

const FILES: Record<RType, number> = { agent: 6, workflow: 4, feature: 2, code: 2 };
const FLOW_ALL = ['intent', 'requirements', 'specification', 'build', 'test'];
const AGENT_DOCS = ['questions', 'prd', 'tfd', 'arch', 'risk'];

const SEEDS: Seed[] = [
  {
    id: 'ex-margin-analyst', type: 'agent', name: 'Margin analyst', owner: MARA, approved: AGENT_DOCS, policy: GENIE_POLICY,
    card: {
      purpose: 'Answers margin questions per customer, product and region from the lakehouse and names the source of every figure.', organization: 'Finance Controlling', steward: INES, provider: AGENT, discovery: 'built',
      phase: 'active', dates: { plan: '2026-06-02', 'phase-in': '2026-07-01', active: '2026-08-15' }, criticality: 'operational',
      verification: 'verified', verifiedBy: INES, verifiedAt: '2026-09-12', reviewDue: '2027-03-12',
      risk: 'minimal', riskReason: 'Reads aggregated margin data only. No personal data; every decision stays with a person.',
      relations: [rel('capability', 'Margin management'), rel('process', 'Month-end reporting'), rel('system', 'Databricks', 'read'), rel('system', 'SAP S/4HANA', 'read'), rel('data', 'Margin by customer (aggregated)'), rel('model', 'Claude Sonnet'), rel('mcp', 'Databricks connector')],
      telemetry: { runs30: 212, successPct: 97, users30: 18, costEur: 640, valueEur: 3900, lastRun: '2026-11-06' }, tags: ['finance', 'databricks', 'genie'],
    },
    history: [['Saved from the Werkbank', MARA, '2026-06-02'], ['Specification confirmed', MARA, '2026-06-24'], ['Built as a draft agent', MARA, '2026-07-01'], ['Extended: Margin by region (ABC-12)', MARA, '2026-08-04'], ['Register card: verified', INES, '2026-09-12'], ['Saved from the Werkbank', MARA, '2026-10-19']],
  },
  {
    id: 'ex-preclose', type: 'agent', name: 'Finance pre-close assistant', owner: MARA, approved: AGENT_DOCS, policy: { mode: 'act-after-approval', systems: 2, writes: true, unattended: false, gaps: 2 },
    card: {
      purpose: 'Finds open goods-receipt/invoice-receipt items and intercompany differences before the close and prepares accrual postings for a controller to approve.', organization: 'Finance Controlling', steward: INES, provider: AGENT, discovery: 'built',
      phase: 'active', dates: { plan: '2026-07-06', 'phase-in': '2026-08-03', active: '2026-09-01' }, criticality: 'critical',
      verification: 'verified', verifiedBy: INES, verifiedAt: '2026-10-08', reviewDue: '2026-12-08',
      risk: 'limited', riskReason: 'Prepares postings. A controller approves each one in two steps (draft, then submit with a token).',
      relations: [rel('capability', 'Period-end close'), rel('process', 'GR/IR clearing'), rel('process', 'Intercompany reconciliation'), rel('system', 'SAP S/4HANA', 'write', 'Drafts only, submit needs a person'), rel('system', 'Databricks', 'read'), rel('data', 'Open GR/IR items'), rel('model', 'Claude Sonnet'), rel('mcp', 'SAP connector'), rel('mcp', 'Databricks connector')],
      telemetry: { runs30: 96, successPct: 94, users30: 7, costEur: 1180, valueEur: 9400, lastRun: '2026-11-06' }, tags: ['finance', 'close', 'sap'],
    },
    history: [['Saved from the Werkbank', MARA, '2026-07-06'], ['Risk and test plan confirmed', MARA, '2026-07-28'], ['Built as a draft agent', MARA, '2026-08-03'], ['Register card: verified', INES, '2026-10-08']],
  },
  {
    id: 'ex-po-watcher', type: 'agent', name: 'PO delay watcher', owner: JONAS, approved: AGENT_DOCS, policy: { mode: 'read-only', systems: 2, writes: false, unattended: true, gaps: 2 },
    card: {
      purpose: 'Checks open purchase orders every morning and reports the ones likely to arrive late, with the supplier and the value at stake.', organization: 'Procurement', steward: ANDREAS, provider: AGENT, discovery: 'built',
      phase: 'active', dates: { plan: '2026-05-11', 'phase-in': '2026-06-01', active: '2026-06-22' }, criticality: 'operational',
      verification: 'expired', verifiedBy: ANDREAS, verifiedAt: '2026-08-20', reviewDue: '2026-10-20',
      risk: 'minimal', riskReason: 'Reads purchase orders and supplier data. No personal data.',
      relations: [rel('capability', 'Procurement'), rel('process', 'Purchase order follow-up'), rel('system', 'SAP S/4HANA', 'read'), rel('system', 'Databricks', 'read'), rel('data', 'Purchase orders'), rel('model', 'Claude Haiku'), rel('mcp', 'Databricks connector')],
      telemetry: { runs30: 144, successPct: 91, users30: 9, costEur: 210, valueEur: 1500, lastRun: '2026-11-07' }, tags: ['procurement', 'sap', 'daily'],
    },
    history: [['Saved from the Werkbank', JONAS, '2026-05-11'], ['Built as a draft agent', JONAS, '2026-06-01'], ['Schedule: every day 06:30', JONAS, '2026-06-22'], ['Register card: verified', ANDREAS, '2026-08-20']],
  },
  {
    id: 'ex-supplier-scout', type: 'agent', name: 'Supplier delay scout', owner: TIMO, approved: AGENT_DOCS, policy: { mode: 'read-only', systems: 2, writes: false, unattended: false, gaps: 3 },
    card: {
      purpose: 'Looks up late deliveries per supplier on request. Built before the PO delay watcher and since used by one person.', organization: 'Procurement', steward: ANDREAS, provider: AGENT, discovery: 'built',
      phase: 'active', dates: { plan: '2026-03-02', 'phase-in': '2026-03-16', active: '2026-04-06' }, criticality: 'administrative',
      verification: 'unverified', verifiedBy: '', verifiedAt: '', reviewDue: '',
      risk: 'not-assessed', riskReason: '',
      relations: [rel('capability', 'Procurement'), rel('process', 'Purchase order follow-up'), rel('system', 'SAP S/4HANA', 'read'), rel('system', 'Databricks', 'read'), rel('model', 'Claude Haiku')],
      telemetry: { runs30: 3, successPct: 100, users30: 1, costEur: 25, valueEur: 60, lastRun: '2026-10-29' }, tags: ['procurement'],
    },
    history: [['Saved from the Werkbank', TIMO, '2026-03-02'], ['Built as a draft agent', TIMO, '2026-03-16']],
  },
  {
    id: 'ex-abap-doc', type: 'agent', name: 'ABAP code documenter', owner: TOBIAS, approved: ['questions', 'prd', 'tfd'], policy: { mode: 'read-only', systems: 1, writes: false, unattended: false, gaps: 3 },
    card: {
      purpose: 'Reads an ABAP object through ARC-1 and writes a documentation draft with line references. Every inference is marked as such.', organization: 'IT Platform', steward: PETRA, provider: AGENT, discovery: 'built',
      phase: 'phase-in', dates: { plan: '2026-10-05', 'phase-in': '2026-11-03' }, criticality: 'administrative',
      verification: 'unverified', verifiedBy: '', verifiedAt: '', reviewDue: '',
      risk: 'minimal', riskReason: 'Reads source code only, writes nothing to the system.',
      relations: [rel('capability', 'Application development'), rel('process', 'ABAP documentation'), rel('system', 'ABAP development system', 'read'), rel('model', 'Claude Sonnet'), rel('mcp', 'ARC-1')],
      telemetry: { runs30: null, successPct: null, users30: null, costEur: null, valueEur: null, lastRun: '' }, tags: ['abap', 'arc-1'],
    },
    history: [['Saved from the Werkbank', TOBIAS, '2026-10-05'], ['Requirements confirmed', TOBIAS, '2026-10-21'], ['Specification in review', TOBIAS, '2026-11-03']],
  },
  {
    id: 'ex-renewal-watcher', type: 'agent', name: 'Renewal watcher', owner: '', approved: AGENT_DOCS, policy: { mode: 'draft', systems: 1, writes: false, unattended: true, gaps: 4 },
    card: {
      purpose: 'Lists contracts that renew within 90 days and drafts a reminder for the account owner. The author has left the team; nobody has taken it over.', organization: 'Sales Operations', steward: '', provider: AGENT, discovery: 'built',
      phase: 'active', dates: { plan: '2026-04-13', 'phase-in': '2026-05-04', active: '2026-05-25' }, criticality: 'operational',
      verification: 'unverified', verifiedBy: '', verifiedAt: '', reviewDue: '',
      risk: 'not-assessed', riskReason: '',
      relations: [rel('capability', 'Contract renewals'), rel('process', 'Renewal forecasting'), rel('system', 'Sub4Me contracts', 'read'), rel('data', 'Contracts and quotes'), rel('model', 'Claude Haiku')],
      telemetry: { runs30: 58, successPct: 88, users30: 4, costEur: 95, valueEur: 700, lastRun: '2026-11-05' }, tags: ['sales', 'renewals'],
    },
    history: [['Saved from the Werkbank', SARA, '2026-04-13'], ['Built as a draft agent', SARA, '2026-05-04'], ['Schedule: Mondays 07:00', SARA, '2026-05-25']],
  },
  {
    id: 'ex-hiring-shortlist', type: 'agent', name: 'Hiring shortlist assistant', owner: LENA, approved: AGENT_DOCS, policy: { mode: 'draft', systems: 1, writes: false, unattended: false, gaps: 2 },
    card: {
      purpose: 'Compares application text with the criteria of the hiring manager and shows the evidence line for each result. It never rejects and never moves a candidate; every change waits for the hiring manager.', organization: 'HR Operations', steward: KATHRIN, provider: AGENT, discovery: 'built',
      phase: 'active', dates: { plan: '2026-08-10', 'phase-in': '2026-09-07', active: '2026-10-05' }, criticality: 'operational',
      verification: 'verified', verifiedBy: KATHRIN, verifiedAt: '2026-10-01', reviewDue: '2027-04-01',
      risk: 'high', riskReason: 'Supports the selection of applicants, which the EU AI Act lists as high risk. Works with pseudonymised text; humans decide.',
      relations: [rel('capability', 'Talent acquisition'), rel('process', 'Shortlisting'), rel('process', 'Hiring approval'), rel('system', 'Recruiting database', 'read'), rel('data', 'Pseudonymised application text'), rel('model', 'Claude Sonnet'), rel('mcp', 'Werkbank workspace connector')],
      telemetry: { runs30: 41, successPct: 95, users30: 6, costEur: 300, valueEur: 1200, lastRun: '2026-11-04' }, tags: ['hr', 'eu-ai-act', 'high-risk'],
    },
    history: [['Saved from the Werkbank', LENA, '2026-08-10'], ['Risk, compliance and test plan confirmed', LENA, '2026-09-02'], ['Built as a draft agent', LENA, '2026-09-07'], ['Register card: verified', KATHRIN, '2026-10-01']],
  },
  {
    id: 'ex-cv-prescreen', type: 'agent', name: 'CV pre-screening pilot', owner: LENA, approved: AGENT_DOCS, policy: { mode: 'draft', systems: 1, writes: false, unattended: true, gaps: 3 },
    card: {
      purpose: 'Pilot: scores incoming applications overnight so that the hiring manager sees a ranked list in the morning.', organization: 'HR Operations', steward: KATHRIN, provider: AGENT, discovery: 'built',
      phase: 'phase-in', dates: { plan: '2026-09-21', 'phase-in': '2026-10-26' }, criticality: 'operational',
      verification: 'unverified', verifiedBy: '', verifiedAt: '', reviewDue: '2026-12-15',
      risk: 'high', riskReason: 'Ranks applicants (EU AI Act, high risk). The nightly run starts without a person.',
      relations: [rel('capability', 'Talent acquisition'), rel('process', 'Shortlisting'), rel('system', 'Recruiting database', 'read'), rel('data', 'Pseudonymised application text'), rel('model', 'Claude Sonnet')],
      telemetry: { runs30: 12, successPct: 83, users30: 2, costEur: 90, valueEur: 0, lastRun: '2026-11-06' }, tags: ['hr', 'pilot', 'high-risk'],
    },
    history: [['Saved from the Werkbank', LENA, '2026-09-21'], ['Built as a draft agent', LENA, '2026-10-26']],
  },

  {
    id: 'ex-monday-close', type: 'workflow', name: 'Monday close briefing', owner: MARA, stage: 'test', approved: FLOW_ALL, policy: { mode: 'draft', systems: 2, writes: false, unattended: true, gaps: 4 },
    card: {
      purpose: 'Every Monday 06:30: overnight load, open purchase orders, and the close position in one briefing for Finance.', organization: 'Finance Controlling', steward: INES, provider: N8N, discovery: 'built',
      phase: 'active', dates: { plan: '2026-09-14', 'phase-in': '2026-10-05', active: '2026-10-12' }, criticality: 'operational',
      verification: 'verified', verifiedBy: INES, verifiedAt: '2026-10-20', reviewDue: '2027-01-20',
      risk: 'minimal', riskReason: 'Reads and summarises. Sends nothing outside Finance.',
      relations: [rel('capability', 'Period-end close'), rel('process', 'Month-end reporting'), rel('system', 'Databricks', 'read'), rel('system', 'SAP S/4HANA', 'read'), rel('mcp', 'n8n connector'), rel('model', 'Claude Sonnet')],
      telemetry: { runs30: 5, successPct: 100, users30: 12, costEur: 38, valueEur: 520, lastRun: '2026-11-03' }, tags: ['finance', 'weekly'],
    },
    history: [['Saved from the Werkbank', MARA, '2026-09-14'], ['Specification confirmed', MARA, '2026-09-30'], ['Marked as live', MARA, '2026-10-12']],
  },
  {
    id: 'ex-payment-check', type: 'workflow', name: 'Payment proposal check', owner: MARA, stage: 'test', approved: FLOW_ALL, policy: { mode: 'act-after-approval', systems: 1, writes: true, unattended: true, gaps: 3 },
    card: {
      purpose: 'Before the bank file is released: compares the payment proposal with the open items and puts a hold on anything that looks wrong, for a person to release or reject.', organization: 'Finance Controlling', steward: INES, provider: N8N, discovery: 'built',
      phase: 'active', dates: { plan: '2026-08-17', 'phase-in': '2026-09-07', active: '2026-09-28' }, criticality: 'mission-critical',
      verification: 'verified', verifiedBy: INES, verifiedAt: '2026-10-14', reviewDue: '2027-02-10',
      risk: 'limited', riskReason: 'Can only hold a payment, never release or change one. A hold is visible and a person lifts it.',
      relations: [rel('capability', 'Payments'), rel('process', 'Payment run'), rel('system', 'SAP S/4HANA', 'write', 'Holds only'), rel('data', 'Payment proposal list'), rel('mcp', 'n8n connector'), rel('model', 'Claude Sonnet')],
      telemetry: { runs30: 22, successPct: 100, users30: 5, costEur: 31, valueEur: 1100, lastRun: '2026-11-06' }, tags: ['finance', 'payments', 'nightly'],
    },
    history: [['Saved from the Werkbank', MARA, '2026-08-17'], ['Risk, compliance and test plan confirmed', MARA, '2026-09-03'], ['Marked as live', MARA, '2026-09-28'], ['Register card: verified', INES, '2026-10-14']],
  },
  {
    id: 'ex-hire-notices', type: 'workflow', name: 'Hiring approval notices', owner: TOBIAS, stage: 'test', approved: FLOW_ALL, policy: { mode: 'act-after-approval', systems: 2, writes: true, unattended: true, gaps: 3 },
    card: {
      purpose: 'Every 15 minutes: asks the database which approvals are due, sends the first notice, a reminder after two days and an escalation after five. It cannot decide anything.', organization: 'IT Platform', steward: PETRA, provider: N8N, discovery: 'built',
      phase: 'active', dates: { plan: '2026-10-19', 'phase-in': '2026-10-26', active: '2026-11-02' }, criticality: 'operational',
      verification: 'verified', verifiedBy: PETRA, verifiedAt: '2026-11-01', reviewDue: '2027-05-01',
      risk: 'limited', riskReason: 'Sends notices about approvals that involve applicants. The decision stays in the database and with people.',
      relations: [rel('capability', 'Talent acquisition'), rel('process', 'Hiring approval'), rel('system', 'Supabase', 'read'), rel('system', 'Notification webhook', 'write'), rel('mcp', 'n8n connector')],
      telemetry: { runs30: 2880, successPct: 99, users30: 14, costEur: 12, valueEur: 400, lastRun: '2026-11-07' }, tags: ['hr', 'notices', 'n8n'],
    },
    history: [['Saved from the Werkbank', TOBIAS, '2026-10-19'], ['Imported into n8n', TOBIAS, '2026-10-26'], ['Marked as live', TOBIAS, '2026-11-02'], ['Register card: verified', PETRA, '2026-11-01']],
  },
  {
    id: 'ex-vm-maintenance', type: 'workflow', name: 'VM maintenance plan', owner: TOBIAS, stage: 'test', approved: FLOW_ALL, policy: { mode: 'draft', systems: 1, writes: false, unattended: true, gaps: 4 },
    card: {
      purpose: 'Builds the monthly maintenance plan for virtual machines from the inventory and sends it to the platform team.', organization: 'IT Platform', steward: PETRA, provider: N8N, discovery: 'imported',
      phase: 'active', dates: { plan: '2026-02-02', 'phase-in': '2026-02-23', active: '2026-03-16' }, criticality: 'administrative',
      verification: 'expired', verifiedBy: PETRA, verifiedAt: '2026-07-14', reviewDue: '2026-10-14',
      risk: 'minimal', riskReason: 'Infrastructure data only.',
      relations: [rel('capability', 'Infrastructure operations'), rel('process', 'Infrastructure maintenance'), rel('system', 'VM inventory', 'read'), rel('mcp', 'n8n connector')],
      telemetry: { runs30: 30, successPct: 100, users30: 3, costEur: 4, valueEur: 150, lastRun: '2026-11-07' }, tags: ['infrastructure', 'monthly'],
    },
    history: [['Imported from n8n', TOBIAS, '2026-02-02'], ['Marked as live', TOBIAS, '2026-03-16'], ['Register card: verified', PETRA, '2026-07-14']],
  },
  {
    id: 'ex-contract-upload', type: 'workflow', name: 'Contract upload to Icertis', owner: SARA, stage: 'specification', approved: ['intent', 'requirements'], policy: { mode: 'act-after-approval', systems: 1, writes: true, unattended: false, gaps: 4 },
    card: {
      purpose: 'Takes a signed contract from the mailbox, reads the key terms and prepares the upload to Icertis for a person to confirm.', organization: 'Sales Operations', steward: DAVID, provider: N8N, discovery: 'built',
      phase: 'plan', dates: { plan: '2026-11-02' }, criticality: null,
      verification: 'unverified', verifiedBy: '', verifiedAt: '', reviewDue: '',
      risk: 'not-assessed', riskReason: '',
      relations: [rel('capability', 'Contract management'), rel('process', 'Contract onboarding'), rel('system', 'Icertis', 'write', 'Prepared, a person confirms'), rel('model', 'Claude Sonnet')],
      telemetry: { runs30: null, successPct: null, users30: null, costEur: null, valueEur: null, lastRun: '' }, tags: ['contracts', 'icertis'],
    },
    history: [['Saved from the Werkbank', SARA, '2026-11-02'], ['Requirements confirmed', SARA, '2026-11-05']],
  },
  {
    id: 'ex-sales-report-legacy', type: 'workflow', name: 'Weekly sales report (legacy)', owner: SARA, stage: 'test', approved: FLOW_ALL, policy: { mode: 'draft', systems: 1, writes: false, unattended: true, gaps: 4 },
    card: {
      purpose: 'The old Friday report from the CRM. Replaced by the Sales pipeline briefing; switched off on the date below.', organization: 'Sales Operations', steward: DAVID, provider: N8N, discovery: 'imported',
      phase: 'phase-out', dates: { plan: '2025-11-03', 'phase-in': '2025-12-01', active: '2026-01-12', 'phase-out': '2026-10-27', 'end-of-life': '2026-12-18' }, criticality: 'operational',
      verification: 'broken', verifiedBy: DAVID, verifiedAt: '2026-03-02', reviewDue: '',
      risk: 'minimal', riskReason: 'Reads CRM aggregates.',
      relations: [rel('capability', 'Sales pipeline management'), rel('system', 'Salesforce', 'read'), rel('item', 'Sales pipeline briefing', undefined, 'replaced by'), rel('mcp', 'n8n connector')],
      telemetry: { runs30: 4, successPct: 75, users30: 9, costEur: 6, valueEur: 120, lastRun: '2026-10-30' }, tags: ['sales', 'legacy'],
    },
    history: [['Imported from n8n', SARA, '2025-11-03'], ['Marked as live', SARA, '2026-01-12'], ['Phase-out announced', SARA, '2026-10-27']],
  },
  {
    id: 'ex-sales-briefing', type: 'workflow', name: 'Sales pipeline briefing', owner: SARA, stage: 'test', approved: FLOW_ALL, policy: { mode: 'draft', systems: 2, writes: false, unattended: true, gaps: 3 },
    card: {
      purpose: 'Daily pipeline briefing for the sales team: what moved, what is stuck and which deals need attention.', organization: 'Sales Operations', steward: DAVID, provider: N8N, discovery: 'built',
      phase: 'active', dates: { plan: '2026-09-07', 'phase-in': '2026-09-28', active: '2026-10-13' }, criticality: 'operational',
      verification: 'verified', verifiedBy: DAVID, verifiedAt: '2026-10-27', reviewDue: '2027-04-27',
      risk: 'minimal', riskReason: 'Reads CRM and contract data. No personal data beyond account names.',
      relations: [rel('capability', 'Sales pipeline management'), rel('system', 'Salesforce', 'read'), rel('system', 'Sub4Me contracts', 'read'), rel('item', 'Weekly sales report (legacy)', undefined, 'replaces'), rel('mcp', 'n8n connector'), rel('model', 'Claude Haiku')],
      telemetry: { runs30: 31, successPct: 96, users30: 22, costEur: 52, valueEur: 1800, lastRun: '2026-11-07' }, tags: ['sales', 'daily'],
    },
    history: [['Saved from the Werkbank', SARA, '2026-09-07'], ['Marked as live', SARA, '2026-10-13'], ['Register card: verified', DAVID, '2026-10-27']],
  },

  {
    id: 'ex-feat-teams', type: 'feature', name: 'Microsoft Teams as a source', owner: TOBIAS, stage: 'build', approved: ['intent', 'requirements', 'specification'],
    refs: [{ source: 'jira', key: 'WB-214', title: 'Read requirements from Teams channels', url: 'https://example.atlassian.net/browse/WB-214' }],
    card: { purpose: 'Read-only connector so requirements can be loaded from Teams channels next to Jira, Slack and Notion.', organization: 'IT Platform', steward: PETRA, provider: WB, discovery: 'built', phase: 'phase-in', dates: { plan: '2026-10-28', 'phase-in': '2026-11-03' }, relations: [rel('system', 'Microsoft Graph', 'read')], tags: ['sources', 'teams'] },
    history: [['Created from a cluster (WB-214)', TOBIAS, '2026-10-28'], ['Stage: Specification & Architecture', TOBIAS, '2026-10-30'], ['Stage: Build', TOBIAS, '2026-11-03']],
  },
  {
    id: 'ex-feat-policy', type: 'feature', name: 'Policy manifest', owner: TOBIAS, stage: 'test', approved: ['intent', 'requirements', 'specification', 'build'],
    refs: [{ source: 'jira', key: 'WB-198', title: 'Show what an agent may do', url: 'https://example.atlassian.net/browse/WB-198' }],
    card: { purpose: 'Declares what an agent or workflow may do and shows what became wider between two revisions.', organization: 'IT Platform', steward: PETRA, provider: WB, discovery: 'built', phase: 'phase-in', dates: { plan: '2026-10-12', 'phase-in': '2026-10-27' }, relations: [rel('item', 'Solution register')], tags: ['governance'] },
    history: [['Created from a cluster (WB-198)', TOBIAS, '2026-10-12'], ['Stage: Build', TOBIAS, '2026-10-27'], ['Stage: Test & go live', TOBIAS, '2026-11-05']],
  },
  {
    id: 'ex-code-tabpfn', type: 'code', name: 'Late payment forecast service', owner: TOBIAS,
    card: { purpose: 'Small service that predicts late payments from invoice history. Uses a stand-in model when the real weights are not available.', organization: 'IT Platform', steward: PETRA, provider: WB, discovery: 'built', phase: 'active', dates: { plan: '2026-10-01', active: '2026-11-01' }, criticality: 'administrative', verification: 'unverified', relations: [rel('model', 'TabPFN'), rel('data', 'Invoice history (synthetic)')], tags: ['forecast', 'service'] },
    history: [['Saved from the Werkbank', TOBIAS, '2026-10-01'], ['Second forecast added', TOBIAS, '2026-11-01']],
  },
  {
    id: 'ex-slack-digest', type: 'agent', name: 'Slack digest (retired)', owner: MARA, archived: true, approved: AGENT_DOCS, policy: { mode: 'read-only', systems: 1, writes: false, unattended: true, gaps: 4 },
    card: {
      purpose: 'Posted a daily digest of finance channels. Retired: the Slack connector now answers the same question in the chat.', organization: 'Finance Controlling', steward: INES, provider: AGENT, discovery: 'built',
      phase: 'end-of-life', dates: { plan: '2026-02-09', active: '2026-03-02', 'end-of-life': '2026-09-30' }, criticality: 'administrative',
      verification: 'unverified', risk: 'minimal', relations: [rel('capability', 'Finance communication'), rel('system', 'Slack', 'read'), rel('model', 'Claude Haiku')],
      telemetry: { runs30: 0, successPct: null, users30: 0, costEur: 0, valueEur: 0, lastRun: '2026-09-29' }, tags: ['retired'],
    },
    history: [['Saved from the Werkbank', MARA, '2026-02-09'], ['Archived', MARA, '2026-09-30']],
  },
];

/** The example items (newest change first, like the real list) and the history of each one (newest revision first). */
export function exampleRegistry(): { items: RItem[]; history: Record<string, Rev[]> } {
  const history: Record<string, Rev[]> = {};
  const items = SEEDS.map((s): RItem => {
    const revs: Rev[] = s.history.map(([note, author, d], n) => ({ rev: n + 1, author, note, at: at(d), files: FILES[s.type] })).reverse();
    history[s.id] = revs;
    return {
      id: s.id, type: s.type, name: s.name, owner: s.owner, stage: s.stage ?? '', visibility: 'shared', archived: s.archived === true, rev: revs.length,
      updatedAt: revs[0].at, files: FILES[s.type], approved: s.approved ?? [], refs: s.refs ?? [], ...(s.extendsItem ? { extendsItem: s.extendsItem } : {}),
      card: sanitizeCard(s.card), policy: s.policy ?? null,
    };
  });
  return { items: items.sort((a, b) => b.updatedAt - a.updatedAt), history };
}
