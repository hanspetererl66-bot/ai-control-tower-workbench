/**
 * Renewals Space: builds examples/renewals/renewals.json from the Sub4Me sample data (contracts, offers, invoices,
 * tickets of both customers) and embeds it with the shared design system into examples/renewals/index.html.
 * The file holds facts only; the health signals and next actions are calculated on the page (<script id="renewal-logic">).
 *   npm run sync:renewals            write
 *   npm run sync:renewals -- --check fail when the data or the page is out of date
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE = 'examples/renewals/index.html';
/** Pages that carry the data and the shared logic (examples/renewals/logic.js is the only source of the logic). */
export const PAGES = [PAGE, 'examples/renewals-analytics/index.html'];
export const LOGIC = 'examples/renewals/logic.js';
const LOGIC_BLOCK = /(<script id="renewal-logic">\n)([\s\S]*?)(\n<\/script>)/;
export const DATA = 'examples/renewals/renewals.json';
const BLOCK = /(<script type="application\/json" id="renewal-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export const AS_OF = '2026-10-19';
/** Contracts ending later than this are not renewals yet. */
export const HORIZON = '2027-12-31';
const AI_PRODUCTS = new Set(['Joule copilots', 'BTP AI Core', 'SuccessFactors AI', 'Ariba AI', 'Document AI']);
/** A ticket names the product, a contract may add a suffix in brackets ("SAP Advanced Track and Trace (serialization)"). */
const sameProduct = (ticketProduct, contractProduct) => ticketProduct === contractProduct || contractProduct.startsWith(`${ticketProduct} (`);
const OPEN_TICKET = (t) => !['Solution provided', 'Closed'].includes(t.status);
const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const addDays = (s, n) => new Date(day(s) + n * 86400000).toISOString().slice(0, 10);

/** Customer context that is not in the contract data: escalations and other topics (fictional). */
export const CUSTOMERS = [
  { id: 'muster', owner: 'Nina Kessler', escalation: { level: 'Management', since: '2026-10-14', topic: 'The AI Core quota blocks the go-live of the purchase-order skill. The CIO asked for a call this week.', owner: 'Nina Kessler' }, topics: [{ kind: 'people', text: 'New head of procurement from 1 November: introduce the renewal plan early' }, { kind: 'commercial', text: 'Asked for a comparison of Joule units and Document AI units' }] },
  { id: 'hanse', owner: 'Tom Ahlers', escalation: null, topics: [{ kind: 'people', text: 'The Head of Controlling, who championed SAP Analytics Cloud, left in September; her successor has not been introduced yet' }, { kind: 'people', text: 'New CFO since September, reviews all software spend' }, { kind: 'commercial', text: 'Wants to bundle Commerce Cloud and Integration Suite into one contract' }] },
  { id: 'lindenau', owner: 'Jonas Weber', escalation: { level: 'Account team', since: '2026-10-12', topic: 'The 2608 upgrade blocks the validation run in QAS (batch release dump). Quality Assurance cannot release the upgrade to PRD before it is fixed.', owner: 'Jonas Weber' }, topics: [{ kind: 'compliance', text: 'Every AI use case needs a validation concept from Quality Assurance before productive use' }, { kind: 'commercial', text: 'Asks to bring supplier qualification for GxP suppliers into the Ariba renewal' }] },
];

/** E-mail threads per customer for the Renewals Space: the threads of the E-Mail-Communication Space, plus fictional ones for Hanse. */
const HANSE_MAILS = [
  { id: 'H-201', subject: 'Commerce Cloud renewal: bundle with the Analytics add-on?', status: 'waiting-us', intent: 'Renewal', mood: 'mixed', contractId: 'C-2024-0611', offerId: 'OFF-2026-0402', side: 'customer', at: '2026-10-15T09:20:00+02:00', count: 3, snippet: 'Our new CFO would like one bundle for Commerce Cloud and Analytics Cloud planning. Can you send one price for both before the 30th?' },
  { id: 'H-202', subject: 'AW: Commerce Cloud renewal, price rise above the cap', status: 'waiting-customer', intent: 'Renewal', mood: 'negative', contractId: 'C-2024-0611', offerId: 'OFF-2026-0402', side: 'us', at: '2026-10-08T14:05:00+02:00', count: 4, snippet: 'We checked the contract: the uplift cap of 4 % applies. We will send a revised quote within the cap, please confirm by 22 October that you want to continue on that basis.' },
  { id: 'H-203', subject: 'Integration Suite: extra connectors approved', status: 'answered', intent: 'Offer', mood: 'positive', contractId: 'C-2023-0215', offerId: null, side: 'customer', at: '2026-10-12T16:40:00+02:00', count: 2, snippet: 'Thank you, the two extra connectors are approved by our integration lead. Please go ahead with the order form.' },
];
const LINDENAU_MAILS = [
  { id: 'L-201', subject: 'Ariba renewal: GxP supplier qualification in scope?', status: 'waiting-us', intent: 'Renewal', mood: 'mixed', contractId: 'C-2023-0344', offerId: 'OFF-2026-0510', side: 'customer', at: '2026-10-16T10:05:00+02:00', count: 3, snippet: 'Quality Assurance needs the supplier qualification workflow in the renewal. Please confirm that it is part of the offer and send the validation documents.' },
  { id: 'L-202', subject: 'Joule for Quality: validation concept before the top-up', status: 'waiting-customer', intent: 'Offer', mood: 'neutral', contractId: 'C-2026-0051', offerId: 'OFF-2026-0518', side: 'us', at: '2026-10-14T15:30:00+02:00', count: 4, snippet: 'We sent the template for the validation concept. The top-up can be ordered now, but productive use starts only after Quality Assurance approves the concept.' },
  { id: 'L-203', subject: 'Overdue invoice: SuccessFactors Learning annual fee', status: 'waiting-us', intent: 'Payment', mood: 'negative', contractId: 'C-2025-0718', offerId: null, side: 'customer', at: '2026-10-13T08:50:00+02:00', count: 2, snippet: 'The purchase order was blocked by the audit freeze. Accounts Payable will release the payment next week, please hold the reminder.' },
];
const snippetOf = (body) => { const ls = body.split('\n').map((l) => l.trim()).filter((l) => l && !/^(hello|hi|dear|thanks|thank you|best|kind regards|regards)\b/i.test(l) && !l.startsWith('>')); return (ls.find((l) => l.length > 30) ?? ls.sort((a, b) => b.length - a.length)[0] ?? '').slice(0, 190); };
const cleanSnippet = (s) => (s.length < 12 ? '' : s);
export function mailsFor(customerId, customerName) {
  if (customerId === 'hanse') return HANSE_MAILS;
  if (customerId === 'lindenau') return LINDENAU_MAILS;
  const { threads } = JSON.parse(read('examples/customer-emails/threads.json'));
  return threads.filter((th) => th.customer === customerName).map((th) => {
    const last = th.messages[th.messages.length - 1];
    return { id: th.id, subject: th.subject, status: th.status, intent: th.intent, mood: th.mood, contractId: th.links.contract, offerId: th.links.offer, side: last.side, at: last.at, count: th.messages.length, snippet: cleanSnippet(snippetOf(last.body)) };
  });
}

export function sub4meCustomers() {
  const html = read('examples/sub4me/index.html');
  const page = JSON.parse(/id="s4m-data">\n([\s\S]*?)\n<\/script>/.exec(html)[1]);
  return [{ id: 'muster', customer: page.customer, profile: page.profile, contracts: page.contracts, offers: page.offers, invoices: page.invoices, tickets: page.tickets }, ...JSON.parse(read('examples/sub4me/portfolio.json')).otherCustomers];
}

/** Illustrative assumptions for retention and customer lifetime value (CLV). Not real figures. */
export const RULES = {
  autoThresholdEur: 30000,
  marginPct: 70,
  lifetimeCapYears: 7,
  retention: { green: 0.95, yellow: 0.85, red: 0.65, lapsed: 0.25 },
  levers: { usage: 'Adoption workshop with the business owner', ticket: 'Escalate the open ticket to a named engineer', competitor: 'Executive sponsor call and a competitive battlecard', invoice: 'Payment plan agreed with the customer finance team', uplift: 'Explain the price rise with scope and volume, or hold the cap', timing: 'Joint timeline with the customer procurement', 'no-offer': 'Early value review before the offer', lapsed: 'Win-back call with the technical contact', growth: 'Roadmap session for the next scope', validity: 'Validity extension in exchange for a signing date', trend: 'Call with the business owner: why is usage falling, and who is the champion now?' },
};

/** Small add-on contracts (illustrative, not in the Sub4Me sample data): they show the automatic path below the threshold. */
const ADDONS = [
  { customerId: 'muster', id: 'C-2026-0901', product: 'SAP Signavio Process Manager add-on', annualEur: 24000, end: '2027-05-31', noticeDays: 60, used: 41, licensed: 50, unit: 'seats' },
  { customerId: 'muster', id: 'C-2026-0902', product: 'SAP Work Zone add-on', annualEur: 12600, end: '2026-12-31', noticeDays: 30, used: 180, licensed: 200, unit: 'users' },
  { customerId: 'muster', id: 'C-2026-0903', product: 'BTP extra storage package', annualEur: 31500, end: '2027-07-31', noticeDays: 60, used: 8.2, licensed: 10, unit: 'TB' },
  { customerId: 'hanse', id: 'C-2026-0911', product: 'SAP Analytics Cloud planning add-on', annualEur: 27900, end: '2027-05-31', noticeDays: 60, used: 96, licensed: 120, unit: 'users' },
  { customerId: 'hanse', id: 'C-2026-0912', product: 'Commerce Cloud sandbox', annualEur: 21000, end: '2026-12-31', noticeDays: 30, used: 2, licensed: 2, unit: 'sandboxes', overdue: { id: 'INV-2026-30590', grossEur: 24990, due: '2026-09-30' } },
  { customerId: 'hanse', id: 'C-2026-0913', product: 'Integration Suite extra connectors', annualEur: 9800, end: '2027-06-30', noticeDays: 30, used: 7, licensed: 8, unit: 'connectors' },
  { customerId: 'lindenau', id: 'C-2026-0921', product: 'SuccessFactors e-signature add-on (21 CFR Part 11)', annualEur: 18600, end: '2027-02-28', noticeDays: 60, used: 38, licensed: 40, unit: 'signers',
    tickets: [{ id: 'TKT-48235', title: 'e-signature add-on: the meaning of the signature is missing in the audit-trail export (21 CFR Part 11)', priority: 'Medium', status: 'In processing' }],
    invoices: [{ id: 'INV-2026-40910', status: 'Open', grossEur: 22134, due: '2026-11-15' }] },
  { customerId: 'lindenau', id: 'C-2026-0922', product: 'Integration Suite connectors for laboratory systems', annualEur: 14400, end: '2026-12-31', noticeDays: 30, used: 5, licensed: 6, unit: 'connectors', overdue: { id: 'INV-2026-40890', grossEur: 17136, due: '2026-09-30' },
    tickets: [
      { id: 'TKT-48231', title: 'Integration Suite: the connector to the laboratory information system (LIMS) drops messages above 2 MB', priority: 'High', status: 'In processing' },
      { id: 'TKT-48233', title: 'Integration Suite: the certificate of the LIMS endpoint expires on 2026-11-09', priority: 'Medium', status: 'Waiting for customer' },
    ],
    invoices: [{ id: 'INV-2026-40912', status: 'Overdue', grossEur: 2856, due: '2026-10-05' }] },
  { customerId: 'lindenau', id: 'C-2026-0923', product: 'BTP extra storage package (batch-record archive)', annualEur: 26400, end: '2027-04-30', noticeDays: 60, used: 6.1, licensed: 8, unit: 'TB',
    tickets: [{ id: 'TKT-48237', title: 'Archive package: the retention rule for batch records is not yet confirmed by Quality Assurance', priority: 'Low', status: 'Waiting for customer' }],
    invoices: [{ id: 'INV-2026-40911', status: 'Open', grossEur: 31416, due: '2026-12-01' }] },
  // Demo story (illustrative): healthy and growing contracts, so the portfolio is not one shade of yellow.
  { customerId: 'muster', id: 'C-2026-0904', product: 'Joule copilot seats for Sales', annualEur: 96000, end: '2027-06-30', noticeDays: 60, used: 132, licensed: 120, unit: 'seats' },
  { customerId: 'muster', id: 'C-2026-0905', product: 'Ariba Network enablement', annualEur: 58000, end: '2027-09-30', noticeDays: 60, used: 47, licensed: 50, unit: 'suppliers' },
  { customerId: 'hanse', id: 'C-2026-0914', product: 'SAP Datasphere', annualEur: 88000, end: '2027-08-31', noticeDays: 60, used: 14, licensed: 16, unit: 'TB' },
  { customerId: 'lindenau', id: 'C-2026-0924', product: 'Joule for Quality (12-month pilot)', annualEur: 64000, end: '2027-05-31', noticeDays: 60, used: 24, licensed: 25, unit: 'seats' },
];

/** Renewal offers that are not in the Sub4Me sample data (illustrative): they give the manager dashboard more than one offer stage, a price above the cap and a second competitor. */
const EXTRA_OFFERS = {
  'C-2026-0012': { id: 'OFF-2026-0530', annualEur: 360000, currentAnnualEur: 360000, discountPct: 0, validUntil: '2026-11-20', stage: 'Proposal sent', probabilityPct: 50, competitor: 'None', nextStep: 'Talk to the new head of procurement before the notice date on 2026-11-01', termMonths: 12, priceGuaranteeMonths: 12, approval: 'Deal desk approved' },
  'C-2024-0233': { id: 'OFF-2026-0531', annualEur: 656000, currentAnnualEur: 640000, discountPct: 0, validUntil: '2026-12-15', stage: 'Negotiation', probabilityPct: 75, competitor: 'None', nextStep: 'Commercial review with procurement by 2026-11-20', termMonths: 36, priceGuaranteeMonths: 36, approval: 'Deal desk approved' },
  'C-2026-0051': { id: 'OFF-2026-0540', annualEur: 185400, currentAnnualEur: 180000, discountPct: 0, validUntil: '2026-11-30', stage: 'Negotiation', probabilityPct: 55, competitor: 'None', nextStep: 'Validation concept from Quality Assurance by 2026-11-06 (condition of the top-up)', termMonths: 12, priceGuaranteeMonths: 12, approval: 'Pending deal desk' },
  'C-2026-0922': { id: 'OFF-2026-0541', annualEur: 14832, currentAnnualEur: 14400, discountPct: 0, validUntil: '2026-11-20', stage: 'Proposal sent', probabilityPct: 65, competitor: 'None', nextStep: 'Clear the open tickets on the LIMS connector before the deadline', termMonths: 12, priceGuaranteeMonths: 12, approval: 'Deal desk approved' },
  'C-2026-0921': { id: 'OFF-2026-0542', annualEur: 19158, currentAnnualEur: 18600, discountPct: 0, validUntil: '2026-12-15', stage: 'Proposal sent', probabilityPct: 70, competitor: 'None', nextStep: 'Confirm the meaning of the signature in the audit-trail export', termMonths: 12, priceGuaranteeMonths: 12, approval: 'Deal desk approved' },
  'C-2026-0044': { id: 'OFF-2026-0532', annualEur: 252000, currentAnnualEur: 240000, discountPct: 0, validUntil: '2026-11-27', stage: 'Negotiation', probabilityPct: 45, competitor: 'Microsoft Copilot (evaluation)', nextStep: 'Decide with the CFO whether to hold the contract cap', termMonths: 24, priceGuaranteeMonths: 24, approval: 'Pending deal desk (price above the contract cap)' },
};

/**
 * Usage over the last six months in percent of the licence (illustrative). The last value is replaced by the real usage of the
 * contract, so the trend always ends where the snapshot is. They tell what the snapshot hides.
 */
const TRENDS = {
  'C-2024-0702': [119, 113, 107, 100, 95, 90], // Hanse, Analytics Cloud: looks fine (90 %), but fell from 119 %; the champion left
  'C-2024-0233': [91, 88, 84, 79, 74, 69],     // Muster, BTP: falls while the AI Core quota blocks the go-live
  'C-2025-0833': [72, 78, 85, 91, 96, 100],    // Lindenau, Advanced Track and Trace: grows fast, room for more
  'C-2026-0904': [70, 78, 88, 97, 104, 110],   // Muster, Joule copilot seats: over the licence, upsell
  'C-2026-0924': [40, 52, 66, 78, 90, 96],     // Lindenau, Joule for Quality pilot: a success, expand
};

export function buildRenewals() {
  const cases = [];
  for (const c of sub4meCustomers()) {
    for (const k of c.contracts) {
      const lapsed = k.status === 'Expired';
      const offer = c.offers.find((o) => o.contractId === k.id && o.type === 'Renewal') ?? (lapsed ? c.offers.find((o) => o.contractId === k.id) : null);
      if (!lapsed && k.end > HORIZON) continue;
      const isAi = /^AI units/.test(k.product);
      const tickets = c.tickets.filter((t) => OPEN_TICKET(t) && (isAi ? AI_PRODUCTS.has(t.product) : sameProduct(t.product, k.product))).map((t) => ({ id: t.id, title: t.title, priority: t.priority, status: t.status }));
      const invoices = c.invoices.filter((i) => i.contractId === k.id && ['Open', 'Overdue'].includes(i.status)).map((i) => ({ id: i.id, status: i.status, grossEur: i.grossEur, due: i.due }));
      const active = c.contracts.filter((x) => x.status !== 'Expired');
      cases.push({
        customerSince: c.profile.customerSince, customerAnnualEur: active.reduce((a, x) => a + x.annualEur, 0),
        id: `R-${k.id}`, customerId: c.id, customer: c.customer.name, sapCustomerId: c.customer.sapCustomerId,
        contractId: k.id, product: k.product, status: lapsed ? 'Lapsed' : k.status === 'Renewal due' ? 'Renewal due' : 'Running', end: k.end,
        noticeDays: k.noticeDays, decisionDate: addDays(k.end, -k.noticeDays), autoRenew: k.autoRenew, annualEur: k.annualEur, upliftCapPct: k.priceUpliftCapPct, termination: k.termination,
        used: k.usedUnits, licensed: k.licensedUnits, unit: k.unit, owner: k.sapOwner.name, csm: k.csm.name, customerOwner: k.customerOwner.name,
        offer: offer ? { id: offer.id, annualEur: offer.annualEur, currentAnnualEur: offer.currentAnnualEur, discountPct: offer.discountPct, validUntil: offer.validUntil, stage: offer.stage, probabilityPct: offer.probabilityPct, competitor: offer.competitor, nextStep: offer.nextStep, termMonths: offer.termMonths, priceGuaranteeMonths: offer.priceGuaranteeMonths, approval: offer.approval } : null,
        tickets, invoices,
      });
    }
  }
  for (const a of ADDONS) {
    const main = cases.find((c) => c.customerId === a.customerId);
    cases.push({
      id: `R-${a.id}`, customerId: a.customerId, customer: main.customer, sapCustomerId: main.sapCustomerId, customerSince: main.customerSince, customerAnnualEur: main.customerAnnualEur,
      contractId: a.id, product: a.product, status: 'Running', end: a.end, noticeDays: a.noticeDays, decisionDate: addDays(a.end, -a.noticeDays), autoRenew: false, annualEur: a.annualEur,
      upliftCapPct: 3, termination: 'Ends on the end date; renewal requires a new order.', used: a.used, licensed: a.licensed, unit: a.unit,
      owner: main.owner, csm: main.csm, customerOwner: main.customerOwner, offer: null, tickets: (a.tickets ?? []).map((t) => ({ ...t })),
      invoices: [...(a.overdue ? [{ id: a.overdue.id, status: 'Overdue', grossEur: a.overdue.grossEur, due: a.overdue.due }] : []), ...(a.invoices ?? []).map((i) => ({ ...i }))], addon: true,
    });
  }
  for (const c of cases) if (!c.offer && EXTRA_OFFERS[c.contractId]) c.offer = { ...EXTRA_OFFERS[c.contractId] };
  for (const c of cases) if (TRENDS[c.contractId]) c.usageTrend = [...TRENDS[c.contractId].slice(0, -1), Math.round((c.used / c.licensed) * 100)];
  cases.sort((a, b) => a.decisionDate.localeCompare(b.decisionDate) || a.id.localeCompare(b.id));
  return {
    asOf: AS_OF,
    rules: RULES,
    note: 'Fictional data derived from the Sub4Me sample data of Muster Industrie AG, Hanse Handelsgruppe AG and Lindenau Pharma AG (scripts/sync-renewals.mjs). The decision date is the contract end minus the notice period: by then the renewal must be agreed or the contract ends.',
    cases,
    customers: CUSTOMERS.map((c) => ({ ...c, annualEur: cases.find((x) => x.customerId === c.id)?.customerAnnualEur ?? 0, since: cases.find((x) => x.customerId === c.id)?.customerSince ?? null, name: cases.find((x) => x.customerId === c.id)?.customer ?? c.id, mails: [] })).map((c) => ({ ...c, mails: mailsFor(c.id, c.name).sort((x, y) => y.at.localeCompare(x.at)) })),
  };
}

export function embedRenewals(html, data, css, logic) {
  if (!BLOCK.test(html)) throw new Error('page has no <script id="renewal-data"> block');
  const body = JSON.stringify(data, null, 1).replaceAll('<', '\\u003c');
  let out = html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`);
  if (logic !== undefined) {
    if (!LOGIC_BLOCK.test(out)) throw new Error('page has no <script id="renewal-logic"> block');
    out = out.replace(LOGIC_BLOCK, (_m, open, _b, close) => `${open}${logic.replace(/\n$/, '')}${close}`);
  }
  return embedDesignSystem(out, css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = buildRenewals();
  const dataText = JSON.stringify(data, null, 2) + '\n';
  const css = read('examples/shared/design-system.css'), logic = read(LOGIC);
  const pages = PAGES.filter((p) => existsSync(join(ROOT, p))).map((p) => ({ p, html: read(p), next: embedRenewals(read(p), data, css, logic) }));
  if (process.argv.includes('--check')) {
    const stale = pages.filter(({ html, next }) => next !== html).map(({ p }) => p);
    if (read(DATA) !== dataText || stale.length) { console.error(`Renewals data or page is out of sync (${stale.join(', ') || DATA}) — run: npm run sync:renewals`); process.exit(1); }
    console.log('Renewals pages are in sync.');
  } else { writeFileSync(join(ROOT, DATA), dataText); for (const { p, next } of pages) writeFileSync(join(ROOT, p), next); console.log(`Wrote ${data.cases.length} renewal cases and embedded them and the shared logic into ${pages.length} page(s).`); }
}
