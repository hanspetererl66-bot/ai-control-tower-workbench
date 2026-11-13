/**
 * More example data for the Ontology Manager: four published ontologies and one more draft that follow the other Werkbank
 * example Spaces (recruiting, sales, IT operations, order-to-cash) with the same names and numbers, plus the governance
 * that goes with them (owners, declared users, lifecycle, synonyms, mappings, competency questions) and a short history.
 * All of it is fictional sample data. It is shown only while the app cannot read a real catalog, and the page says so.
 */
import type { Governance, Node, Edge, Ontology, Term, VersionEntry } from './ontology-manager.ts';

const cls = (id: string, label: string, definition: string, members: string[] = [], membersKind: Term['membersKind'] = 'instances'): Term =>
  ({ id, label, kind: 'class', definition, formula: '', owner: '', members, membersKind: members.length ? membersKind : 'none' });
const metric = (id: string, label: string, definition: string, formula: string, owner: string): Term =>
  ({ id, label, kind: 'metric', definition, formula, owner, members: [], membersKind: 'none' });
const res = (id: string, label: string, type: string, note = ''): Node => ({ id, label, type, note });
const link = (from: string, prop: string, to: string): Edge => ({ from, prop, to });
const metricNodes = (terms: Term[]): Node[] => terms.filter((t) => t.kind === 'metric').map((t) => res(t.id, t.label, 'Metric'));
const base = { owner: '', domain: '', approver: '', example: true } as const;

function recruiting(): Ontology {
  const terms: Term[] = [
    cls('Requisition', 'Requisition', 'An open position with a target number of days to fill it.', ['REQ-2201', 'REQ-2202', 'REQ-2203', 'REQ-2204', 'REQ-2205', 'REQ-2206']),
    cls('Candidate', 'Candidate', 'A person who applied. Analytics only ever see counts; the shortlist uses a pseudonym.'),
    cls('Stage', 'Stage', 'A step of the hiring process.', ['Screening', 'Online interview', 'In-person interview', 'Final conversation', 'Offer']),
    cls('HireRequest', 'Hire request', 'Approval request to hire a candidate in the stage Offer: hiring manager, HR, finance, optionally the department head.'),
    cls('Source', 'Source', 'Where an application came from.', ['Job boards', 'Career site', 'Employee referral', 'Agency', 'Universities']),
    cls('Offer', 'Offer', 'A proposal to a candidate with level, band, start date and contract type. No amounts are stored here.'),
    cls('Department', 'Department', 'The unit that owns a requisition.', ['Operations', 'Planning', 'IT', 'Service', 'HR']),
    cls('ApplicantGroup', 'Applicant group', 'A group of applicants (gender, age group) used only as a count. Groups under 10 applications are hidden.'),
    metric('TimeToFill', 'Time to fill', 'Days from opening a requisition to the day it is filled. Open positions count up to the report date.', 'filled_on - opened_on', 'HR Analytics'),
    metric('TimeToHire', 'Time to hire', 'Old name for Time to fill.', 'filled_on - opened_on', ''),
    metric('OfferAcceptance', 'Offer acceptance', 'Share of offers that candidates accepted.', 'offers_accepted / offers_made', 'Talent Acquisition'),
    metric('CostPerHire', 'Cost per hire', 'What a source cost divided by the hires it brought.', 'cost_eur / hires', 'HR Controlling'),
    metric('WaitTime', 'Wait time per stage', 'Average days applicants wait for the next step, against the stage target.', 'weighted average of wait days', 'HR Analytics'),
    metric('SelectionRate', 'Selection rate', 'Interviews divided by applications for one applicant group. Shown only for groups of at least 10 applications.', 'interviews / applications', 'HR Analytics'),
    metric('ApprovalCycleTime', 'Approval cycle time', 'Days from sending a hire request to the last approval.', 'last_approval - sent_on', 'HR Controlling'),
  ];
  return {
    slug: 'werkbank_hr', title: 'Recruiting and hiring', status: 'published', properties: 11, openProposals: 0, ...base, terms,
    nodes: [
      ...metricNodes(terms),
      res('ds_requisition', 'recruiting.requisition', 'Dataset', 'Positions with target days'),
      res('ds_funnel', 'funnel_snapshot', 'Dataset', 'recruiting_analytics: applied, screened, interviewed, waits'),
      res('ds_source', 'source_stat', 'Dataset', 'recruiting_analytics: applications, hires, cost'),
      res('ds_group', 'group_stat', 'Dataset', 'recruiting_analytics: applications and interviews per group'),
      res('ds_hire_requests', 'hiring_approvals', 'Dataset', 'Hire requests with approvers and decisions'),
      res('chk_min_group', 'Minimum group size', 'Quality Check', 'Groups under 10 applications are hidden'),
      res('chk_four_fifths', 'Four-fifths hint', 'Quality Check', 'Review hint when a rate is below 0.8 of the top group'),
    ],
    edges: [
      link('TimeToFill', 'derivedFrom', 'ds_requisition'), link('TimeToHire', 'derivedFrom', 'ds_requisition'),
      link('OfferAcceptance', 'derivedFrom', 'ds_requisition'), link('CostPerHire', 'derivedFrom', 'ds_source'),
      link('WaitTime', 'derivedFrom', 'ds_funnel'), link('SelectionRate', 'derivedFrom', 'ds_group'),
      link('chk_min_group', 'measuredBy', 'SelectionRate'), link('chk_four_fifths', 'measuredBy', 'SelectionRate'),
      link('chk_four_fifths', 'dependsOn', 'chk_min_group'), link('WaitTime', 'dependsOn', 'TimeToFill'),
      // how the things of hiring relate: a change to the target of a link reaches everything on its source side
      link('Requisition', 'partOf', 'Department'), link('Candidate', 'dependsOn', 'Requisition'), link('Candidate', 'dependsOn', 'Stage'),
      link('Candidate', 'references', 'Source'), link('Offer', 'dependsOn', 'Candidate'), link('Offer', 'dependsOn', 'Requisition'),
      link('HireRequest', 'dependsOn', 'Offer'), link('ApplicantGroup', 'dependsOn', 'Candidate'),
      link('TimeToFill', 'dependsOn', 'Requisition'), link('OfferAcceptance', 'dependsOn', 'Offer'), link('CostPerHire', 'dependsOn', 'Source'),
      link('WaitTime', 'dependsOn', 'Stage'), link('SelectionRate', 'dependsOn', 'ApplicantGroup'),
      link('ApprovalCycleTime', 'derivedFrom', 'ds_hire_requests'), link('ApprovalCycleTime', 'dependsOn', 'HireRequest'),
    ],
  };
}

function sales(): Ontology {
  const terms: Term[] = [
    cls('Customer', 'Customer', 'A company with a customer number and a bill-to party.', ['Muster Industrie AG', 'Lindenau Pharma AG', 'Nordlicht Maschinenbau GmbH']),
    cls('Deal', 'Deal', 'A sales opportunity that moves through interest, lead, opportunity, sell and contract.'),
    cls('Offer', 'Offer', 'A priced proposal with a validity date and a next step.'),
    cls('Contract', 'Contract', 'An agreement with a term, a notice period and an annual value.'),
    cls('Renewal', 'Renewal', 'A contract that ends within 180 days and needs a decision.'),
    cls('Meeting', 'Meeting', 'A customer meeting with notes, decisions and next steps.'),
    cls('Competitor', 'Competitor', 'Another vendor named in a deal.'),
    cls('ForecastCategory', 'Forecast category', 'Commit, best case or pipeline, set by a probability rule.', ['Commit', 'Best case', 'Pipeline']),
    metric('ACV', 'Annual contract value', 'Yearly value of a deal or contract in EUR. The Sales space uses an illustrative scale.', 'annual_eur * value_scale', 'Sales Operations'),
    metric('PipelineCoverage', 'Pipeline coverage', 'Open pipeline value divided by the quota.', 'open_value / quota', 'Sales Operations'),
    metric('NoticeDate', 'Notice date', 'Last day to give notice: contract end minus the notice period.', 'end - notice_days', 'Contract Management'),
    metric('DiscountShare', 'Discount share', 'Discount in percent of the list price. Above the threshold a person must approve.', 'discount / list_price', ''),
    metric('WinRate', 'Win rate', 'Won deals divided by closed deals in the period.', 'won / (won + lost)', 'Sales Operations'),
  ];
  return {
    slug: 'werkbank_sales', title: 'Sales and customers', status: 'published', properties: 9, openProposals: 0, ...base, terms,
    nodes: [
      ...metricNodes(terms),
      res('ds_pipeline', 'pipeline.json', 'Dataset', 'examples/sales (sample deals, forecast, meetings)'),
      res('ds_offers', 'Sub4Me offers', 'Dataset', 'Offers of the customer portal'),
      res('ds_contracts', 'Sub4Me contracts', 'Dataset', 'Contracts with notice periods'),
      res('ds_meetings', 'meetings.json', 'Dataset', 'examples/sales (customer meetings with notes and next steps)'),
      res('chk_discount', 'Discount approval', 'Approval Rule', 'A discount above the threshold is not cleared until approved'),
      res('chk_renewal', 'Renewal radar', 'Process Check', 'Contracts ending within 180 days'),
      res('muster', 'Muster Industrie AG', 'Customer', 'SAP customer ID 0010048211'),
    ],
    edges: [
      link('ACV', 'derivedFrom', 'ds_offers'), link('ACV', 'derivedFrom', 'ds_contracts'), link('PipelineCoverage', 'derivedFrom', 'ds_pipeline'),
      link('PipelineCoverage', 'dependsOn', 'ACV'), link('NoticeDate', 'derivedFrom', 'ds_contracts'), link('DiscountShare', 'derivedFrom', 'ds_offers'),
      link('chk_discount', 'measuredBy', 'DiscountShare'), link('chk_renewal', 'measuredBy', 'NoticeDate'), link('chk_renewal', 'appliesTo', 'muster'),
      link('chk_discount', 'appliesTo', 'muster'),
      link('Deal', 'dependsOn', 'Customer'), link('Deal', 'references', 'Competitor'), link('Offer', 'dependsOn', 'Deal'), link('Contract', 'dependsOn', 'Offer'),
      link('Renewal', 'dependsOn', 'Contract'), link('Meeting', 'references', 'Customer'), link('Meeting', 'derivedFrom', 'ds_meetings'),
      link('ForecastCategory', 'dependsOn', 'Deal'), link('PipelineCoverage', 'dependsOn', 'ForecastCategory'), link('ACV', 'dependsOn', 'Contract'),
      link('DiscountShare', 'dependsOn', 'Offer'), link('WinRate', 'dependsOn', 'Deal'), link('WinRate', 'derivedFrom', 'ds_pipeline'),
    ],
  };
}

function itOps(): Ontology {
  const terms: Term[] = [
    cls('Host', 'Host', 'A virtual machine at a customer.', ['proxy-edge-01', 'musind-int04', 'joule-gw-01']),
    cls('Alert', 'Alert', 'A signal from monitoring with a severity and a host.', ['A-506']),
    cls('Region', 'Region', 'A hosting region of a customer environment.', ['eu-central', 'eu-west']),
    cls('Certificate', 'Certificate', 'A TLS certificate with an expiry date.'),
    cls('ChangeTicket', 'Change ticket', 'A planned change. For infrastructure changes a check-mode plan comes first and a person confirms.'),
    cls('Procedure', 'Standard procedure', 'A step-by-step SOP in the internal Infra Wiki.', ['Renew a TLS certificate', 'Patch a VM']),
    metric('MTTR', 'Mean time to repair', 'Average hours from an alert opening to its resolution.', 'resolved_at - opened_at', 'Infrastructure Operations'),
    metric('CertDaysLeft', 'Certificate days left', 'Days until a certificate expires.', 'not_after - today', 'Infrastructure Operations'),
    metric('PatchCompliance', 'Patch compliance', 'Share of hosts that have every critical patch.', 'patched_hosts / hosts', 'Security Operations'),
    metric('AlertVolume', 'Alert volume', 'Alerts per host and week. A jump often means a change went wrong.', 'alerts / hosts / week', 'Infrastructure Operations'),
  ];
  return {
    slug: 'werkbank_itops', title: 'IT operations', status: 'published', properties: 8, openProposals: 0, ...base, terms,
    nodes: [
      ...metricNodes(terms),
      res('ds_alerts', 'alerts.json', 'Dataset', 'examples/infra-ops (alerts with customer and host)'),
      res('ds_fleet', 'fleet.json', 'Dataset', 'examples/it-fleet (hosts, regions, certificates)'),
      res('chk_cert', 'Certificate expiry', 'Check', 'A-506: expires in 5 days (2026-10-24)'),
      res('proxy-edge-01', 'proxy-edge-01', 'Host', 'Muster Industrie AG, SAP 0010048211'),
      res('sop_cert', 'renew-tls-certificate v3.2', 'Procedure', '10 steps in the Infra Wiki'),
      res('sop_patch', 'patch-vm v2.7', 'Procedure', '10 steps in the Infra Wiki'),
    ],
    edges: [
      link('MTTR', 'derivedFrom', 'ds_alerts'), link('CertDaysLeft', 'derivedFrom', 'ds_fleet'), link('PatchCompliance', 'derivedFrom', 'ds_fleet'),
      link('chk_cert', 'measuredBy', 'CertDaysLeft'), link('chk_cert', 'appliesTo', 'proxy-edge-01'), link('sop_cert', 'appliesTo', 'chk_cert'),
      link('sop_patch', 'dependsOn', 'PatchCompliance'), link('MTTR', 'dependsOn', 'CertDaysLeft'),
      link('Host', 'partOf', 'Region'), link('Alert', 'dependsOn', 'Host'), link('Certificate', 'dependsOn', 'Host'), link('ChangeTicket', 'dependsOn', 'Procedure'),
      link('ChangeTicket', 'references', 'Alert'), link('CertDaysLeft', 'dependsOn', 'Certificate'), link('MTTR', 'dependsOn', 'Alert'),
      link('PatchCompliance', 'dependsOn', 'Host'), link('AlertVolume', 'derivedFrom', 'ds_alerts'), link('AlertVolume', 'dependsOn', 'Alert'),
    ],
  };
}

function orderToCash(): Ontology {
  const terms: Term[] = [
    cls('SalesOrder', 'Sales order', 'The order created from a signed contract, one item per priced position.', ['SO-90412']),
    cls('BillOfMaterial', 'Bill of material', 'What is delivered, provisioned, metered or scheduled for an order.', ['BOM-90412']),
    cls('Entitlement', 'Entitlement', 'What the customer may use: licence keys, users, API quota, service days.'),
    cls('Tenant', 'Tenant', 'A customer environment in a cloud region.', ['kestrel-eu-central', 'kestrel-eu-test', 'kestrel-eu-sandbox']),
    cls('CustomerInvoice', 'Customer invoice', 'An invoice to the bill-to party with a payment term of 30 days.'),
    cls('Meter', 'Meter', 'Counts usage such as API calls and active users per month.'),
    cls('UsageRecord', 'Usage record', 'Metered usage of one month, compared with what was billed.'),
    cls('PerformanceObligation', 'Performance obligation', 'A promise to the customer that gets its own share of the price.'),
    metric('BilledAmount', 'Billed amount', 'Sum of the invoices issued up to a key date.', 'sum(invoice gross)', 'Revenue Accounting'),
    metric('RecognisedRevenue', 'Recognised revenue', 'Revenue that is earned by the rules of the standard, not by the invoice.', 'sum(revenue schedule)', 'Revenue Accounting'),
    metric('ContractAsset', 'Contract asset', 'Revenue recognised ahead of the invoice.', 'recognised - billed (if positive)', 'Revenue Accounting'),
    metric('DaysToFirstInvoice', 'Days to first invoice', 'Days from the signature to the first invoice. 13 in the example.', 'first_invoice - signed', 'Order Management'),
  ];
  return {
    slug: 'werkbank_o2c', title: 'Order-to-cash (software)', status: 'published', properties: 9, openProposals: 0, ...base, terms,
    nodes: [
      ...metricNodes(terms),
      res('ds_o2c', 'order-to-cash-software', 'Dataset', 'Contract C-4410, six positions, 14 steps'),
      res('ds_rr', 'revenue-recognition', 'Dataset', 'Allocation by stand-alone price, schedules'),
      res('chk_entitlement', 'Entitlement check', 'Check', 'Bill of material against the contract: 2 deviations'),
      res('chk_trueup', 'Usage true-up', 'Check', 'Metered against billed: 2,300,000 calls = 920.00 EUR'),
      res('kestrel', 'Kestrel Versicherung AG', 'Customer', 'Bill-to Kestrel Group Services GmbH'),
    ],
    edges: [
      link('BilledAmount', 'derivedFrom', 'ds_o2c'), link('RecognisedRevenue', 'derivedFrom', 'ds_rr'), link('ContractAsset', 'dependsOn', 'BilledAmount'),
      link('ContractAsset', 'dependsOn', 'RecognisedRevenue'), link('DaysToFirstInvoice', 'derivedFrom', 'ds_o2c'),
      link('chk_entitlement', 'measuredBy', 'DaysToFirstInvoice'), link('chk_trueup', 'measuredBy', 'BilledAmount'),
      link('chk_trueup', 'appliesTo', 'kestrel'), link('chk_entitlement', 'appliesTo', 'kestrel'),
      link('BillOfMaterial', 'dependsOn', 'SalesOrder'), link('Entitlement', 'dependsOn', 'BillOfMaterial'), link('Tenant', 'dependsOn', 'Entitlement'),
      link('CustomerInvoice', 'dependsOn', 'SalesOrder'), link('Meter', 'partOf', 'Tenant'), link('UsageRecord', 'dependsOn', 'Meter'),
      link('PerformanceObligation', 'dependsOn', 'SalesOrder'), link('BilledAmount', 'dependsOn', 'CustomerInvoice'),
      link('RecognisedRevenue', 'dependsOn', 'PerformanceObligation'), link('DaysToFirstInvoice', 'dependsOn', 'CustomerInvoice'),
      link('chk_trueup', 'dependsOn', 'UsageRecord'),
    ],
  };
}

function procurementMore(): Ontology {
  const terms: Term[] = [
    cls('GoodsReceipt', 'Goods receipt', 'Posting that goods arrived.'),
    cls('SupplierInvoice', 'Supplier invoice', ''),
    cls('PaymentTerms', 'Payment terms', ''),
  ];
  return {
    slug: 'procurement_more', title: 'Procurement terms (draft, from the handbook)', status: 'draft', properties: 3, openProposals: 0, ...base, terms,
    nodes: [res('Supplier_x', 'Supplier (see procurement_docs)', 'Reference', 'Defined in another ontology')],
    edges: [link('SupplierInvoice', 'dependsOn', 'GoodsReceipt'), link('SupplierInvoice', 'dependsOn', 'PaymentTerms')],
  };
}

/** The extra example ontologies, after the two in `exampleOntologies`. */
export function extraExampleOntologies(): Ontology[] {
  return [recruiting(), sales(), itOps(), orderToCash(), procurementMore()];
}

type Extra = Pick<Governance, 'ontologies' | 'bindings' | 'views' | 'termMeta' | 'questions'>;

const m = (slug: string, id: string) => `${slug}|${id}`;

/** Governance for the extra ontologies; merged into the example governance by `resolveCatalog`. */
export function extraExampleGovernance(): Extra {
  return {
    ontologies: {
      werkbank_hr: { owner: 'HR Analytics', domain: 'HR', approver: 'Head of Talent Acquisition' },
      werkbank_sales: { owner: 'Sales Operations', domain: 'Sales', approver: 'Head of Sales Operations' },
      werkbank_itops: { owner: 'Infrastructure Operations', domain: 'IT', approver: 'Head of Infrastructure' },
      werkbank_o2c: { owner: 'Revenue Accounting', domain: 'Finance', approver: 'Head of Revenue Accounting' },
      procurement_more: { owner: '', domain: 'Procurement', approver: '' },
    },
    bindings: [
      { slug: 'werkbank_hr', term: 'TimeToFill', kind: 'skill', name: 'recruiting-analytics-brief' },
      { slug: 'werkbank_hr', term: 'SelectionRate', kind: 'skill', name: 'recruiting-analytics-brief' },
      { slug: 'werkbank_hr', term: 'CostPerHire', kind: 'report', name: 'Recruiting Analytics space' },
      { slug: 'werkbank_hr', term: 'WaitTime', kind: 'agent', name: 'Hiring control tower' },
      { slug: 'werkbank_hr', term: 'TimeToHire', kind: 'report', name: 'Old hiring dashboard' },
      { slug: 'werkbank_sales', term: 'Deal', kind: 'skill', name: 'deal-risk-check' },
      { slug: 'werkbank_sales', term: 'NoticeDate', kind: 'skill', name: 'renewal-radar' },
      { slug: 'werkbank_sales', term: 'ACV', kind: 'report', name: 'Sales forecast' },
      { slug: 'werkbank_sales', term: 'Customer', kind: 'agent', name: 'Customer 360 briefing' },
      { slug: 'werkbank_itops', term: 'CertDaysLeft', kind: 'agent', name: 'Infrastructure Operations agent' },
      { slug: 'werkbank_itops', term: 'Procedure', kind: 'agent', name: 'Infrastructure Operations agent' },
      { slug: 'werkbank_itops', term: 'MTTR', kind: 'report', name: 'Operations review' },
      { slug: 'werkbank_o2c', term: 'RecognisedRevenue', kind: 'report', name: 'Revenue Recognition space' },
      { slug: 'werkbank_o2c', term: 'BilledAmount', kind: 'skill', name: 'board-briefing' },
      { slug: 'werkbank_hr', term: 'Stage', kind: 'agent', name: 'Interview scheduler' },
      { slug: 'werkbank_hr', term: 'Requisition', kind: 'agent', name: 'Job posting assistant' },
      { slug: 'werkbank_hr', term: 'HireRequest', kind: 'skill', name: 'hiring-approval-routing' },
      { slug: 'werkbank_hr', term: 'ApprovalCycleTime', kind: 'report', name: 'Hiring approvals board' },
      { slug: 'werkbank_hr', term: 'OfferAcceptance', kind: 'report', name: 'Offer pipeline' },
      { slug: 'werkbank_hr', term: 'Candidate', kind: 'report', name: 'Recruiting Workbench space' },
      { slug: 'werkbank_sales', term: 'Renewal', kind: 'agent', name: 'Renewal autopilot' },
      { slug: 'werkbank_sales', term: 'Renewal', kind: 'agent', name: 'Win-back agent' },
      { slug: 'werkbank_sales', term: 'Meeting', kind: 'skill', name: 'meeting-notes-summary' },
      { slug: 'werkbank_sales', term: 'PipelineCoverage', kind: 'report', name: 'Pipeline review' },
      { slug: 'werkbank_sales', term: 'Deal', kind: 'report', name: 'Sales space' },
      { slug: 'werkbank_sales', term: 'DiscountShare', kind: 'agent', name: 'Discount approval flow' },
      { slug: 'werkbank_sales', term: 'Offer', kind: 'report', name: 'Sub4Me portal space' },
      { slug: 'werkbank_itops', term: 'Alert', kind: 'agent', name: 'Alert triage agent' },
      { slug: 'werkbank_itops', term: 'Alert', kind: 'report', name: 'Infra Ops space' },
      { slug: 'werkbank_itops', term: 'Certificate', kind: 'skill', name: 'renew-tls-certificate' },
      { slug: 'werkbank_itops', term: 'PatchCompliance', kind: 'report', name: 'Fleet health' },
      { slug: 'werkbank_itops', term: 'ChangeTicket', kind: 'agent', name: 'Change approval flow' },
      { slug: 'werkbank_o2c', term: 'SalesOrder', kind: 'agent', name: 'Order-to-cash agent' },
      { slug: 'werkbank_o2c', term: 'UsageRecord', kind: 'agent', name: 'Usage true-up flow' },
      { slug: 'werkbank_o2c', term: 'Entitlement', kind: 'skill', name: 'entitlement-check' },
      { slug: 'werkbank_o2c', term: 'CustomerInvoice', kind: 'report', name: 'Order-to-Cash space' },
      { slug: 'procurement_more', term: 'SupplierInvoice', kind: 'skill', name: 'invoice-matching' },
    ],
    views: [
      { name: 'Hiring control tower', slugs: ['werkbank_hr'] },
      { name: 'Customer 360 briefing', slugs: ['werkbank_sales', 'werkbank_o2c'] },
      { name: 'Infrastructure Operations agent', slugs: ['werkbank_itops'] },
      { name: 'Renewal autopilot', slugs: ['werkbank_sales'] },
      { name: 'Order-to-cash agent', slugs: ['werkbank_o2c', 'werkbank_sales'] },
    ],
    termMeta: {
      [m('werkbank_hr', 'TimeToFill')]: { status: 'approved', replacedBy: '', synonyms: ['time to hire', 'days to fill', 'TTF'], mappings: [{ system: 'SAP SuccessFactors', ref: 'Recruiting: requisition cycle time' }] },
      [m('werkbank_hr', 'TimeToHire')]: { status: 'deprecated', replacedBy: 'TimeToFill', synonyms: [], mappings: [] },
      [m('werkbank_hr', 'OfferAcceptance')]: { status: 'approved', replacedBy: '', synonyms: ['offer accept rate'], mappings: [] },
      [m('werkbank_hr', 'Candidate')]: { status: 'approved', replacedBy: '', synonyms: ['applicant'], mappings: [{ system: 'schema.org', ref: 'Person' }] },
      [m('werkbank_hr', 'SelectionRate')]: { status: 'draft', replacedBy: '', synonyms: ['interview rate'], mappings: [] },
      [m('werkbank_sales', 'Customer')]: { status: 'approved', replacedBy: '', synonyms: ['account', 'client'], mappings: [{ system: 'SAP S/4HANA', ref: 'Business Partner (BP)' }, { system: 'schema.org', ref: 'Organization' }] },
      [m('werkbank_sales', 'ACV')]: { status: 'approved', replacedBy: '', synonyms: ['annual value', 'yearly value'], mappings: [] },
      [m('werkbank_sales', 'Contract')]: { status: 'approved', replacedBy: '', synonyms: ['agreement'], mappings: [{ system: 'SAP S/4HANA', ref: 'Sales Contract (VA41)' }] },
      [m('werkbank_itops', 'Host')]: { status: 'approved', replacedBy: '', synonyms: ['VM', 'virtual machine', 'server'], mappings: [{ system: 'AWX', ref: 'Inventory host' }] },
      [m('werkbank_itops', 'CertDaysLeft')]: { status: 'approved', replacedBy: '', synonyms: ['days to expiry'], mappings: [] },
      [m('werkbank_o2c', 'ContractAsset')]: { status: 'approved', replacedBy: '', synonyms: ['unbilled revenue'], mappings: [{ system: 'IFRS 15', ref: 'Contract asset' }] },
      [m('werkbank_o2c', 'CustomerInvoice')]: { status: 'approved', replacedBy: '', synonyms: ['bill'], mappings: [{ system: 'SAP S/4HANA', ref: 'Billing Document (VBRK)' }] },
      [m('werkbank_o2c', 'PerformanceObligation')]: { status: 'approved', replacedBy: '', synonyms: [], mappings: [{ system: 'IFRS 15', ref: 'Performance obligation' }] },
    },
    questions: [
      { id: 'q-hr-1', slug: 'werkbank_hr', text: 'Which open requisitions are past their target?', terms: ['Requisition', 'TimeToFill'] },
      { id: 'q-hr-2', slug: 'werkbank_hr', text: 'Which stage makes applicants wait longest?', terms: ['Stage', 'WaitTime'] },
      { id: 'q-hr-3', slug: 'werkbank_hr', text: 'Which source gives the cheapest hire?', terms: ['Source', 'CostPerHire'] },
      { id: 'q-hr-4', slug: 'werkbank_hr', text: 'Where does a selection rate need a second look?', terms: ['ApplicantGroup', 'SelectionRate'] },
      { id: 'q-hr-5', slug: 'werkbank_hr', text: 'How many hires does each department need next quarter?', terms: ['Requisition', 'Forecast'] },
      { id: 'q-sales-1', slug: 'werkbank_sales', text: 'Which contracts need a decision before the notice date?', terms: ['Contract', 'NoticeDate', 'Renewal'] },
      { id: 'q-sales-2', slug: 'werkbank_sales', text: 'Which deals are in the commit forecast?', terms: ['Deal', 'ForecastCategory'] },
      { id: 'q-sales-3', slug: 'werkbank_sales', text: 'How much pipeline covers the quota?', terms: ['PipelineCoverage', 'ACV'] },
      { id: 'q-sales-4', slug: 'werkbank_sales', text: 'Which offers have a discount that is not cleared?', terms: ['Offer', 'DiscountShare'] },
      { id: 'q-it-1', slug: 'werkbank_itops', text: 'Which certificates expire in the next 30 days?', terms: ['Certificate', 'CertDaysLeft', 'Host'] },
      { id: 'q-it-2', slug: 'werkbank_itops', text: 'Which procedure applies to this alert?', terms: ['Alert', 'Procedure'] },
      { id: 'q-it-3', slug: 'werkbank_itops', text: 'How long do we take to repair a failed host?', terms: ['MTTR', 'Host'] },
      { id: 'q-o2c-1', slug: 'werkbank_o2c', text: 'Is revenue ahead of the invoices this month?', terms: ['ContractAsset', 'RecognisedRevenue', 'BilledAmount'] },
      { id: 'q-o2c-2', slug: 'werkbank_o2c', text: 'Which tenants belong to this order?', terms: ['Tenant', 'SalesOrder'] },
      { id: 'q-o2c-3', slug: 'werkbank_o2c', text: 'How much cash is still open?', terms: ['CashReceipt', 'CustomerInvoice'] },
    ],
  };
}

export function extraExampleHistory(): Record<string, VersionEntry[]> {
  return {
    werkbank_hr: [
      { file: 'werkbank_hr-20261106T090000Z.ttl', at: '2026-11-06T09:00:00Z', terms: 10, added: [], removed: [] },
      { file: 'werkbank_hr-20261108T120000Z.ttl', at: '2026-11-08T12:00:00Z', terms: 12, added: ['ApplicantGroup', 'SelectionRate'], removed: [] },
      { file: 'current', at: '', terms: 12, added: [], removed: [] },
    ],
    werkbank_sales: [
      { file: 'werkbank_sales-20261102T080000Z.ttl', at: '2026-11-02T08:00:00Z', terms: 8, added: [], removed: [] },
      { file: 'current', at: '', terms: 10, added: ['Renewal', 'NoticeDate'], removed: [] },
    ],
    werkbank_itops: [
      { file: 'werkbank_itops-20261105T100000Z.ttl', at: '2026-11-05T10:00:00Z', terms: 6, added: [], removed: [] },
      { file: 'current', at: '', terms: 8, added: ['Procedure', 'PatchCompliance'], removed: [] },
    ],
    werkbank_o2c: [
      { file: 'werkbank_o2c-20261108T070000Z.ttl', at: '2026-11-08T07:00:00Z', terms: 8, added: [], removed: [] },
      { file: 'current', at: '', terms: 10, added: ['Tenant', 'DaysToFirstInvoice'], removed: [] },
    ],
  };
}
