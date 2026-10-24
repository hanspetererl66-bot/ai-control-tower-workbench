/**
 * Finance Pre-Close Space: builds examples/finance-preclose/preclose.json, a fictional extract that looks like
 * S/4HANA Finance data (P&L per company code and day, close calendar, open items, accrual proposals, anomalies).
 * No MCP server and no live system: the numbers come from a seeded generator, so they are the same every time.
 * Amounts are in thousand EUR. Costs are positive numbers; EBIT = revenue - cost of revenue - operating expenses.
 */
export const PERIOD = '2026-10';
export const WORKING_DAYS = ['2026-10-01', '2026-10-02', ...[5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30].map((d) => `2026-10-${String(d).padStart(2, '0')}`)];
export const AS_OF_WD = 17;
const N = WORKING_DAYS.length;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const ENTITIES = [
  { id: 'DE10', name: 'Nordlicht Software GmbH', country: 'Germany', currency: 'EUR', revenueK: 11200 },
  { id: 'FR10', name: 'Nordlicht France SAS', country: 'France', currency: 'EUR', revenueK: 3900 },
  { id: 'UK10', name: 'Nordlicht UK Ltd', country: 'United Kingdom', currency: 'GBP', revenueK: 4600 },
  { id: 'US10', name: 'Nordlicht Inc.', country: 'United States', currency: 'USD', revenueK: 7300 },
];
/** shape: how much of the month-end value is booked by working day d (1..22). sigma: forecast uncertainty at day 0. */
const LINES = [
  { key: 'cloud', name: 'Cloud subscriptions', kind: 'revenue', shape: 'front', sigma: 0.012, method: 'Contract schedule: billed subscriptions plus the remaining ratable revenue of active contracts.', driver: 'Subscription base and price changes' },
  { key: 'license', name: 'Software licences and support', kind: 'revenue', shape: 'back', sigma: 0.12, method: 'Booked deals plus the weighted pipeline of deals that can still close this month.', driver: 'Deal timing at month end' },
  { key: 'services', name: 'Professional services', kind: 'revenue', shape: 'linear', sigma: 0.06, method: 'Run rate of booked hours times the rate card, plus the work in progress at month end.', driver: 'Utilisation and milestone acceptance' },
  { key: 'hosting', name: 'Cloud hosting and infrastructure', kind: 'cogs', shape: 'linear', sigma: 0.03, method: 'Run rate of the provider invoices plus usage accrual until month end.', driver: 'Usage and committed-use discounts' },
  { key: 'delivery', name: 'Delivery partners and subcontractors', kind: 'cogs', shape: 'back', sigma: 0.07, method: 'Purchase orders and timesheets of partners, accrual for services received but not invoiced.', driver: 'Partner hours' },
  { key: 'personnel', name: 'Personnel', kind: 'opex', shape: 'payroll', sigma: 0.008, method: 'Payroll run plus accruals for bonus, holiday and social charges.', driver: 'Headcount and bonus accrual' },
  { key: 'marketing', name: 'Sales and marketing', kind: 'opex', shape: 'back', sigma: 0.06, method: 'Committed campaign budget and commissions on forecast revenue.', driver: 'Commissions and campaigns' },
  { key: 'travel', name: 'Travel and events', kind: 'opex', shape: 'back', sigma: 0.1, method: 'Booked expenses plus events and card statements not yet posted.', driver: 'Events and card statements' },
  { key: 'it', name: 'IT and facilities', kind: 'opex', shape: 'linear', sigma: 0.04, method: 'Contract schedule of licences, rent and services.', driver: 'Contracts' },
  { key: 'legal', name: 'Legal and professional fees', kind: 'opex', shape: 'back', sigma: 0.12, method: 'Open invoices and engagement letters, accrual for work done.', driver: 'Projects and audits' },
  { key: 'da', name: 'Depreciation and amortisation', kind: 'opex', shape: 'step21', sigma: 0.005, method: 'Asset register: the depreciation run on working day 21.', driver: 'Asset additions' },
  { key: 'other', name: 'Other operating expenses', kind: 'opex', shape: 'linear', sigma: 0.08, method: 'Run rate of the last three months.', driver: 'Various' },
];
const MIX = { revenue: { cloud: 0.52, license: 0.18, services: 0.3 } };
const ratio = { hosting: 0.17, delivery: 0.22, personnel: 0.46, marketing: 0.085, travel: 0.016, it: 0.03, legal: 0.011, da: 0.028, other: 0.016 };

/** Deviation of the real month end from the budget (the story) and the working day the deviation becomes visible. */
const STORY = {
  'DE10.license': { dev: -0.43, known: 12 }, 'DE10.services': { dev: 0.04, known: 9 }, 'DE10.legal': { dev: 0.45, known: 15 },
  'FR10.cloud': { dev: 0.015, known: 4 }, 'FR10.travel': { dev: 0.3, known: 14 },
  'UK10.hosting': { dev: 0.16, known: 10 }, 'UK10.cloud': { dev: -0.025, known: 6 }, 'UK10.delivery': { dev: 0.12, known: 13 },
  'US10.services': { dev: 0.11, known: 8 }, 'US10.license': { dev: 0.09, known: 16 }, 'US10.marketing': { dev: 0.1, known: 11 },
};

function curve(shape, d) {
  const x = d / N;
  if (shape === 'front') return 0.4 + 0.6 * x;
  if (shape === 'back') return Math.pow(x, 1.7);
  if (shape === 'payroll') return d >= 20 ? 1 : 0.12 * x;
  if (shape === 'step21') return d >= 21 ? 1 : 0;
  return x;
}

function build() {
  const R = rng(20261023);
  const pl = {};
  for (const e of ENTITIES) {
    pl[e.id] = {};
    const rev = e.revenueK * (0.97 + R() * 0.06);
    const budget = {};
    for (const [k, share] of Object.entries(MIX.revenue)) budget[k] = Math.round(rev * share * (e.id === 'US10' && k === 'cloud' ? 1.08 : 1));
    budget.hosting = Math.round(budget.cloud * ratio.hosting * (0.95 + R() * 0.1));
    budget.delivery = Math.round(budget.services * ratio.delivery * (0.95 + R() * 0.1));
    const total = budget.cloud + budget.license + budget.services;
    for (const k of ['personnel', 'marketing', 'travel', 'it', 'legal', 'da', 'other']) budget[k] = Math.round(total * ratio[k] * (0.93 + R() * 0.14));
    for (const l of LINES) {
      const story = STORY[`${e.id}.${l.key}`] || { dev: (R() - 0.5) * 0.03, known: 8 + Math.floor(R() * 8) };
      const b = budget[l.key];
      const final = Math.round(b * (1 + story.dev));
      const py = Math.round(b * (0.88 + R() * 0.1));
      const actual = [], forecast = [], low = [], high = [];
      let prev = 0;
      for (let d = 1; d <= N; d++) {
        const noise = 1 + (R() - 0.5) * 0.02;
        let a = Math.round(final * curve(l.shape, d) * (d === N ? 1 : noise));
        a = d === N ? final : Math.min(Math.max(prev, a), final); prev = a; actual.push(a);
        const w = d >= story.known ? 0.12 * ((N - d) / (N - story.known + 1)) : 1 - 0.5 * (d / story.known);
        const half = final * l.sigma * Math.pow((N - d) / N, 0.8);
        const f = Math.round(final + (b - final) * w + (R() - 0.5) * half * 0.6);
        forecast.push(d === N ? final : f);
        low.push(d === N ? final : Math.round(f - half * 1.28)); high.push(d === N ? final : Math.round(f + half * 1.28));
      }
      pl[e.id][l.key] = { budget: b, py, actual, forecast, low, high };
    }
  }
  return pl;
}

const OWNERS = { gl: 'Anna Berger', fr: 'Marc Dubois', uk: 'Priya Shah', us: 'James Cole', ap: 'Lena Koch', ar: 'Tom Weber', tr: 'Sofia Ricci', tax: 'Jonas Keller', fpa: 'Mira Lang', fa: 'Ben Roth', pay: 'Ines Vogel', ic: 'Karl Heim' };
/** Close calendar. start/due/done are working days of October (1..22) or later (23 = first working day of November). */
const T = (id, phase, name, entity, owner, startWd, dueWd, doneWd, extra = {}) => ({ id, phase, name, entity, owner: OWNERS[owner], startWd, dueWd, doneWd, ...extra });
const TASKS = [
  T('T01', 'Preparation', 'Publish the close calendar and the cut-off rules', 'All', 'gl', 1, 3, 2),
  T('T02', 'Preparation', 'Update the exchange rates for revaluation (month-end rates)', 'All', 'tr', 17, 21, null),
  T('T03', 'Preparation', 'Check the open purchase orders with receipt but no invoice', 'All', 'ap', 8, 17, 16),
  T('T04', 'Preparation', 'Freeze master data changes (customers, vendors, cost centres)', 'All', 'gl', 15, 18, 17),
  T('T05', 'Preparation', 'Review the budget version and the forecast version loaded in the system', 'All', 'fpa', 3, 6, 5),
  T('T06', 'Revenue', 'Billing run for cloud subscriptions', 'All', 'ar', 1, 2, 1),
  T('T07', 'Revenue', 'Usage-based billing: load the usage files and rate them', 'US10', 'us', 13, 19, null, { blocked: { from: 16, until: 18, reason: 'Usage file of the second data centre arrived incomplete' } }),
  T('T08', 'Revenue', 'Review the revenue recognition of multi-element contracts', 'DE10', 'gl', 14, 20, null),
  T('T09', 'Revenue', 'Unbilled revenue: milestones accepted but not invoiced', 'All', 'ar', 15, 20, null),
  T('T10', 'Revenue', 'Deferred revenue release (ratable contracts)', 'All', 'gl', 20, 21, null),
  T('T11', 'Procure to pay', 'Accrue goods and services received but not invoiced (GR/IR)', 'All', 'ap', 17, 21, null),
  T('T12', 'Procure to pay', 'Approve or reject parked vendor invoices', 'All', 'ap', 12, 19, 18),
  T('T13', 'Procure to pay', 'Match the card statements and post travel expenses', 'FR10', 'fr', 14, 19, null, { blocked: { from: 17, until: 21, reason: 'Corporate card statement for the event in Lyon not yet received' } }),
  T('T14', 'Procure to pay', 'Accrue legal and audit fees from the engagement letters', 'DE10', 'gl', 16, 21, null),
  T('T15', 'People', 'Payroll cut-off and payroll run', 'All', 'pay', 17, 20, null),
  T('T16', 'People', 'Accrue bonus, holiday and overtime', 'All', 'pay', 18, 21, null),
  T('T17', 'People', 'Reconcile headcount between HR and the general ledger', 'All', 'pay', 15, 19, 18),
  T('T18', 'Treasury and tax', 'Bank reconciliation of all accounts', 'All', 'tr', 12, 20, null),
  T('T19', 'Treasury and tax', 'FX revaluation of open items and bank balances', 'UK10', 'uk', 21, 22, null),
  T('T20', 'Treasury and tax', 'FX revaluation of open items and bank balances', 'US10', 'us', 21, 22, null),
  T('T21', 'Treasury and tax', 'VAT pre-check: output and input tax against the sub-ledgers', 'DE10', 'tax', 16, 20, 19),
  T('T22', 'Treasury and tax', 'Tax provision estimate for the month', 'All', 'tax', 19, 22, null),
  T('T23', 'Intercompany', 'Confirm the intercompany balances between all company codes', 'All', 'ic', 14, 19, null),
  T('T24', 'Intercompany', 'Clear the intercompany royalty differences DE10 / US10', 'DE10', 'ic', 15, 20, null),
  T('T25', 'Intercompany', 'Post the management recharges', 'All', 'ic', 19, 21, null),
  T('T26', 'Fixed assets', 'Post asset additions and check assets under construction', 'All', 'fa', 12, 18, 17),
  T('T27', 'Fixed assets', 'Depreciation run', 'All', 'fa', 21, 21, null),
  T('T28', 'Review', 'Review manual journal entries above the approval limit', 'All', 'gl', 18, 21, null),
  T('T29', 'Review', 'Flux analysis: explain variances above 5 % and 50 k EUR', 'All', 'fpa', 19, 22, null),
  T('T30', 'Review', 'Month-end forecast sign-off with the CFO', 'All', 'fpa', 20, 22, null),
  T('T31', 'Hard close', 'Close the posting periods in the sub-ledgers', 'All', 'gl', 22, 23, null),
  T('T32', 'Hard close', 'Consolidation run and group reporting package', 'All', 'gl', 23, 25, null),
];

/** Open items: hand-made ones tell the story, the generated ones fill the lists. */
function items() {
  const R = rng(777);
  const out = [
    { id: 'OI-001', type: 'Intercompany difference', entity: 'DE10', counterparty: 'US10', amountK: 412, openedWd: 14, closedWd: null, owner: OWNERS.ic, note: 'Royalty invoice for September booked in DE10 in October and in US10 in September.', action: 'Post the cut-off correction in US10 and confirm with the controller.' },
    { id: 'OI-002', type: 'Intercompany difference', entity: 'UK10', counterparty: 'DE10', amountK: 86, openedWd: 15, closedWd: 19, owner: OWNERS.ic, note: 'Recharge in GBP and EUR converted at different rates.', action: 'Align the rate type and repost.' },
    { id: 'OI-003', type: 'Goods received, not invoiced', entity: 'UK10', counterparty: 'Cloud provider', amountK: 75, openedWd: 12, closedWd: null, owner: OWNERS.ap, note: 'October usage of the second region is not invoiced yet; credit note under discussion.', action: 'Accrue 75 k and keep the credit note as an opportunity.' },
    { id: 'OI-004', type: 'Unbilled revenue', entity: 'US10', counterparty: 'Retail customer', amountK: 295, openedWd: 16, closedWd: null, owner: OWNERS.ar, note: 'Milestone 3 accepted on WD 15, invoice not yet created.', action: 'Create the invoice before the billing cut-off.' },
    { id: 'OI-005', type: 'Manual journal pending approval', entity: 'DE10', counterparty: '', amountK: 880, openedWd: 17, closedWd: null, owner: OWNERS.gl, note: 'Reclassification of capitalised development cost, above the approval limit.', action: 'Send to the financial controller for approval today.' },
  ];
  const types = [
    ['Goods received, not invoiced', 12, 260, 'ap', 'Invoice expected, receipt confirmed.', 'Accrue at the order value.'],
    ['Unbilled revenue', 15, 190, 'ar', 'Work done, invoice not created.', 'Create the invoice or accrue the revenue.'],
    ['Bank reconciliation', 6, 40, 'tr', 'Payment without an open item.', 'Assign the payment to the invoice.'],
    ['Suspense account', 8, 60, 'gl', 'Posting without an account assignment.', 'Reclassify to the correct account.'],
    ['Manual journal pending approval', 20, 150, 'gl', 'Waiting for the second approver.', 'Remind the approver.'],
    ['Intercompany difference', 10, 120, 'ic', 'Timing difference between the partners.', 'Align the posting date.'],
    ['Open purchase order', 30, 220, 'ap', 'Order without receipt at month end.', 'Check whether the service was delivered.'],
  ];
  const ents = ENTITIES.map((e) => e.id);
  for (let i = 6; i <= 46; i++) {
    const t = types[Math.floor(R() * types.length)];
    const e = ents[Math.floor(R() * ents.length)];
    const opened = 3 + Math.floor(R() * 15);
    const closed = R() < 0.45 ? opened + 1 + Math.floor(R() * 6) : null;
    out.push({ id: `OI-${String(i).padStart(3, '0')}`, type: t[0], entity: e, counterparty: t[0] === 'Intercompany difference' ? ents.filter((x) => x !== e)[Math.floor(R() * 3)] : '', amountK: Math.round(t[1] + R() * t[2]), openedWd: opened, closedWd: closed && closed <= N ? closed : null, owner: OWNERS[t[3]], note: t[4], action: t[5] });
  }
  return out;
}

const ACCRUALS = [
  { id: 'AC-01', entity: 'UK10', line: 'hosting', amountK: 75, basis: 'October usage of the second region, provider invoice due on WD 24. Based on the usage report of WD 16.', confidence: 'high', fromWd: 16 },
  { id: 'AC-02', entity: 'DE10', line: 'legal', amountK: 60, basis: 'Audit pre-work and the arbitration case: engagement letters signed, invoices not received.', confidence: 'medium', fromWd: 15 },
  { id: 'AC-03', entity: 'DE10', line: 'personnel', amountK: 420, basis: 'Bonus accrual for the quarter at 92 % target attainment, plus unused holiday.', confidence: 'medium', fromWd: 18 },
  { id: 'AC-04', entity: 'FR10', line: 'travel', amountK: 54, basis: 'Event in Lyon: hotel and venue booked, card statement outstanding.', confidence: 'medium', fromWd: 17 },
  { id: 'AC-05', entity: 'US10', line: 'delivery', amountK: 210, basis: 'Partner timesheets for the migration project approved, invoices not yet received.', confidence: 'high', fromWd: 17 },
  { id: 'AC-06', entity: 'US10', line: 'marketing', amountK: 160, basis: 'Commissions on the forecast licence revenue of the quarter.', confidence: 'medium', fromWd: 18 },
  { id: 'AC-07', entity: 'UK10', line: 'delivery', amountK: 95, basis: 'Subcontractor hours of week 43 approved in the time system.', confidence: 'high', fromWd: 17 },
  { id: 'AC-08', entity: 'FR10', line: 'it', amountK: 22, basis: 'Annual maintenance of the office network, invoiced in November.', confidence: 'high', fromWd: 17 },
  { id: 'AC-09', entity: 'DE10', line: 'other', amountK: 35, basis: 'Utilities and services for the quarter, estimated from the last three months.', confidence: 'low', fromWd: 18 },
  { id: 'AC-10', entity: 'US10', line: 'legal', amountK: 48, basis: 'Contract review for the new reseller agreement.', confidence: 'low', fromWd: 19 },
  { id: 'AC-11', entity: 'DE10', line: 'delivery', amountK: 130, basis: 'Partner invoices for the services project are approved, goods receipt posted on WD 17.', confidence: 'high', fromWd: 17 },
  { id: 'AC-12', entity: 'UK10', line: 'travel', amountK: 26, basis: 'Corporate card statement of the second half of October, estimated.', confidence: 'low', fromWd: 19 },
];
const ANOMALIES = [
  { wd: 11, entity: 'UK10', kind: 'Cost jump', text: 'Cloud hosting is 38 % above the three-month average since WD 10.', amountK: 75, severity: 'red', action: 'Ask the provider manager for the usage breakdown.' },
  { wd: 13, entity: 'DE10', kind: 'Possible duplicate', text: 'Two vendor invoices with the same amount and invoice date for the same supplier.', amountK: 64, severity: 'yellow', action: 'Block the second invoice for payment.' },
  { wd: 14, entity: 'US10', kind: 'Missing posting', text: 'No usage billing posted since WD 12 although usage files exist.', amountK: 280, severity: 'red', action: 'Check the interface log of the billing run.' },
  { wd: 15, entity: 'FR10', kind: 'Cost jump', text: 'Travel and events is 3 times the monthly average.', amountK: 40, severity: 'yellow', action: 'Confirm the event budget with the head of marketing.' },
  { wd: 16, entity: 'DE10', kind: 'Revenue reversal', text: 'Licence order of 900 k EUR moved from October to November in the sales system.', amountK: 900, severity: 'red', action: 'Reflect it in the forecast and tell the CFO.' },
  { wd: 17, entity: 'DE10', kind: 'Large manual entry', text: 'Manual journal of 880 k EUR (capitalised development cost) without a second approver.', amountK: 880, severity: 'yellow', action: 'Route it to the financial controller.' },
  { wd: 18, entity: 'UK10', kind: 'FX movement', text: 'GBP/EUR moved by 2.1 % in a week; the open receivables in GBP are revalued at month end.', amountK: 95, severity: 'yellow', action: 'Review the exposure with treasury.' },
  { wd: 19, entity: 'US10', kind: 'Posting in closed period', text: 'Two postings to September were attempted and rejected.', amountK: 18, severity: 'yellow', action: 'Ask the cost centre owner to repost to October.' },
  { wd: 20, entity: 'FR10', kind: 'Round amount', text: 'Seven journal entries of exactly 10,000 EUR in one day.', amountK: 70, severity: 'yellow', action: 'Ask for the supporting documents.' },
];
const NOTES = [
  { wd: 4, entity: 'FR10', line: 'cloud', text: 'Price increase of 3 % on renewals is confirmed; forecast raised slightly.' },
  { wd: 8, entity: 'US10', line: 'services', text: 'Two projects ahead of plan; services forecast raised by about 8 %.' },
  { wd: 10, entity: 'UK10', line: 'hosting', text: 'Provider invoice for the second region is much higher than planned; hosting forecast raised.' },
  { wd: 12, entity: 'DE10', line: 'license', text: 'A large licence deal is at risk to slip into November; the forecast is cut by half of the risk.' },
  { wd: 15, entity: 'DE10', line: 'legal', text: 'Arbitration case adds legal fees; forecast raised.' },
  { wd: 16, entity: 'DE10', line: 'license', text: 'The deal moved to November in the sales system; the forecast now excludes it.' },
  { wd: 16, entity: 'US10', line: 'license', text: 'A reseller order of 120 k EUR was signed; forecast raised.' },
  { wd: 17, entity: 'FR10', line: 'travel', text: 'Event in Lyon is booked but the card statement is missing; accrual proposed.' },
];
const SCENARIOS = [
  { key: 'deal', label: 'The slipped DE10 licence deal is signed on WD 22 after all', entity: 'DE10', line: 'license', revenueK: 900, costK: 90, probabilityPct: 15, kind: 'opportunity' },
  { key: 'milestone', label: 'US10 services milestone 4 accepted before month end', entity: 'US10', line: 'services', revenueK: 320, costK: 70, probabilityPct: 55, kind: 'opportunity' },
  { key: 'credit', label: 'UK10 hosting provider grants the credit note', entity: 'UK10', line: 'hosting', revenueK: 0, costK: -40, probabilityPct: 35, kind: 'opportunity' },
  { key: 'usage', label: 'US10 usage billing is not fixed before the cut-off', entity: 'US10', line: 'cloud', revenueK: -280, costK: 0, probabilityPct: 30, kind: 'risk' },
  { key: 'bonus', label: 'DE10 bonus accrual rises to 100 % attainment', entity: 'DE10', line: 'personnel', revenueK: 0, costK: 160, probabilityPct: 25, kind: 'risk' },
  { key: 'fx', label: 'GBP weakens another 3 % against the euro', entity: 'UK10', line: 'cloud', revenueK: -80, costK: -50, probabilityPct: 25, kind: 'risk' },
  { key: 'partner', label: 'FR10 partner invoices arrive in October instead of November', entity: 'FR10', line: 'delivery', revenueK: 0, costK: 45, probabilityPct: 40, kind: 'risk' },
];

export function buildPreclose() {
  return {
    company: 'Nordlicht Group (fictional)', period: PERIOD, periodLabel: 'October 2026', currency: 'EUR', unit: 'thousand EUR', asOfWd: AS_OF_WD,
    source: 'Mockup extract in the shape of S/4HANA Finance (company codes, G/L accounts grouped into P&L lines). Generated, not a live system.',
    workingDays: WORKING_DAYS, entities: ENTITIES.map(({ revenueK, ...e }) => e), lines: LINES.map(({ shape, sigma, ...l }) => l),
    rules: { varianceWarnPct: 5, varianceWarnK: 50, bandPct: 80, confidence: { highBelowPct: 2, mediumBelowPct: 6 }, hardCloseWd: 23 },
    pl: build(), tasks: TASKS, items: items(), accruals: ACCRUALS, anomalies: ANOMALIES, notes: NOTES, scenarios: SCENARIOS,
  };
}
