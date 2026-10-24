/**
 * Renewals Space: builds examples/renewals/renewals.json from the Sub4Me sample data (contracts, offers, invoices,
 * tickets of both customers) and embeds it with the shared design system into examples/renewals/index.html.
 * The file holds facts only; the health signals and next actions are calculated on the page (<script id="renewal-logic">).
 *   npm run sync:renewals            write
 *   npm run sync:renewals -- --check fail when the data or the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE = 'examples/renewals/index.html';
export const DATA = 'examples/renewals/renewals.json';
const BLOCK = /(<script type="application\/json" id="renewal-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export const AS_OF = '2026-10-19';
/** Contracts ending later than this are not renewals yet. */
export const HORIZON = '2027-12-31';
const AI_PRODUCTS = new Set(['Joule copilots', 'BTP AI Core', 'SuccessFactors AI', 'Ariba AI', 'Document AI']);
const OPEN_TICKET = (t) => !['Solution provided', 'Closed'].includes(t.status);
const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const addDays = (s, n) => new Date(day(s) + n * 86400000).toISOString().slice(0, 10);

/** Customer context that is not in the contract data: escalations and other topics (fictional). */
export const CUSTOMERS = [
  { id: 'muster', owner: 'Nina Kessler', escalation: { level: 'Management', since: '2026-10-14', topic: 'The AI Core quota blocks the go-live of the purchase-order skill. The CIO asked for a call this week.', owner: 'Nina Kessler' }, topics: [{ kind: 'people', text: 'New head of procurement from 1 November: introduce the renewal plan early' }, { kind: 'commercial', text: 'Asked for a comparison of Joule units and Document AI units' }] },
  { id: 'hanse', owner: 'Tom Ahlers', escalation: null, topics: [{ kind: 'people', text: 'New CFO since September, reviews all software spend' }, { kind: 'commercial', text: 'Wants to bundle Commerce Cloud and Integration Suite into one contract' }] },
];

/** E-mail threads per customer for the Renewals Space: the threads of the E-Mail-Communication Space, plus fictional ones for Hanse. */
const HANSE_MAILS = [
  { id: 'H-201', subject: 'Commerce Cloud renewal: bundle with the Analytics add-on?', status: 'waiting-us', intent: 'Renewal', mood: 'mixed', contractId: 'C-2024-0611', offerId: 'OFF-2026-0407', side: 'customer', at: '2026-10-15T09:20:00+02:00', count: 3, snippet: 'Our new CFO would like one bundle for Commerce Cloud and Analytics Cloud planning. Can you send one price for both before the 30th?' },
  { id: 'H-202', subject: 'AW: Ariba renewal, price rise above the cap', status: 'waiting-customer', intent: 'Renewal', mood: 'negative', contractId: 'C-2025-0458', offerId: 'OFF-2026-0402', side: 'us', at: '2026-10-08T14:05:00+02:00', count: 4, snippet: 'We checked the contract: the uplift cap of 3 % applies. The revised quote with the capped price is attached, please confirm by 22 October.' },
  { id: 'H-203', subject: 'Integration Suite: extra connectors approved', status: 'answered', intent: 'Offer', mood: 'positive', contractId: 'C-2023-0215', offerId: null, side: 'customer', at: '2026-10-12T16:40:00+02:00', count: 2, snippet: 'Thank you, the two extra connectors are approved by our integration lead. Please go ahead with the order form.' },
];
const snippetOf = (body) => { const ls = body.split('\n').map((l) => l.trim()).filter((l) => l && !/^(hello|hi|dear|thanks|thank you|best|kind regards|regards)\b/i.test(l) && !l.startsWith('>')); return (ls.find((l) => l.length > 30) ?? ls.sort((a, b) => b.length - a.length)[0] ?? '').slice(0, 190); };
const cleanSnippet = (s) => (s.length < 12 ? '' : s);
export function mailsFor(customerId, customerName) {
  if (customerId === 'hanse') return HANSE_MAILS;
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
  levers: { usage: 'Adoption workshop with the business owner', ticket: 'Escalate the open ticket to a named engineer', competitor: 'Executive sponsor call and a competitive battlecard', invoice: 'Payment plan agreed with the customer finance team', uplift: 'Explain the price rise with scope and volume, or hold the cap', timing: 'Joint timeline with the customer procurement', 'no-offer': 'Early value review before the offer', lapsed: 'Win-back call with the technical contact', growth: 'Roadmap session for the next scope', validity: 'Validity extension in exchange for a signing date' },
};

/** Small add-on contracts (illustrative, not in the Sub4Me sample data): they show the automatic path below the threshold. */
const ADDONS = [
  { customerId: 'muster', id: 'C-2026-0901', product: 'SAP Signavio Process Manager add-on', annualEur: 24000, end: '2027-01-31', noticeDays: 60, used: 41, licensed: 50, unit: 'seats' },
  { customerId: 'muster', id: 'C-2026-0902', product: 'SAP Work Zone add-on', annualEur: 12600, end: '2026-12-31', noticeDays: 30, used: 180, licensed: 200, unit: 'users' },
  { customerId: 'muster', id: 'C-2026-0903', product: 'BTP extra storage package', annualEur: 31500, end: '2027-02-28', noticeDays: 60, used: 8.2, licensed: 10, unit: 'TB' },
  { customerId: 'hanse', id: 'C-2026-0911', product: 'SAP Analytics Cloud planning add-on', annualEur: 27900, end: '2027-03-31', noticeDays: 60, used: 96, licensed: 120, unit: 'users' },
  { customerId: 'hanse', id: 'C-2026-0912', product: 'Commerce Cloud sandbox', annualEur: 21000, end: '2026-12-31', noticeDays: 30, used: 2, licensed: 2, unit: 'sandboxes', overdue: { id: 'INV-2026-30590', grossEur: 24990, due: '2026-09-30' } },
  { customerId: 'hanse', id: 'C-2026-0913', product: 'Integration Suite extra connectors', annualEur: 9800, end: '2027-06-30', noticeDays: 30, used: 7, licensed: 8, unit: 'connectors' },
];

export function buildRenewals() {
  const cases = [];
  for (const c of sub4meCustomers()) {
    for (const k of c.contracts) {
      const lapsed = k.status === 'Expired';
      const offer = c.offers.find((o) => o.contractId === k.id && o.type === 'Renewal') ?? (lapsed ? c.offers.find((o) => o.contractId === k.id) : null);
      if (!lapsed && k.end > HORIZON) continue;
      const isAi = /^AI units/.test(k.product);
      const tickets = c.tickets.filter((t) => OPEN_TICKET(t) && (isAi ? AI_PRODUCTS.has(t.product) : t.product === k.product)).map((t) => ({ id: t.id, title: t.title, priority: t.priority, status: t.status }));
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
      owner: main.owner, csm: main.csm, customerOwner: main.customerOwner, offer: null, tickets: [],
      invoices: a.overdue ? [{ id: a.overdue.id, status: 'Overdue', grossEur: a.overdue.grossEur, due: a.overdue.due }] : [], addon: true,
    });
  }
  cases.sort((a, b) => a.decisionDate.localeCompare(b.decisionDate) || a.id.localeCompare(b.id));
  return {
    asOf: AS_OF,
    rules: RULES,
    note: 'Fictional data derived from the Sub4Me sample data of Muster Industrie AG and Hanse Handelsgruppe AG (scripts/sync-renewals.mjs). The decision date is the contract end minus the notice period: by then the renewal must be agreed or the contract ends.',
    cases,
    customers: CUSTOMERS.map((c) => ({ ...c, annualEur: cases.find((x) => x.customerId === c.id)?.customerAnnualEur ?? 0, since: cases.find((x) => x.customerId === c.id)?.customerSince ?? null, name: cases.find((x) => x.customerId === c.id)?.customer ?? c.id, mails: [] })).map((c) => ({ ...c, mails: mailsFor(c.id, c.name).sort((x, y) => y.at.localeCompare(x.at)) })),
  };
}

export function embedRenewals(html, data, css) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="renewal-data"> block`);
  const body = JSON.stringify(data, null, 1).replaceAll('<', '\\u003c');
  return embedDesignSystem(html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = buildRenewals();
  const dataText = JSON.stringify(data, null, 2) + '\n';
  const html = read(PAGE);
  const next = embedRenewals(html, data, read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (read(DATA) !== dataText || next !== html) { console.error('Renewals data or page is out of sync — run: npm run sync:renewals'); process.exit(1); }
    console.log('Renewals page is in sync.');
  } else { writeFileSync(join(ROOT, DATA), dataText); writeFileSync(join(ROOT, PAGE), next); console.log(`Wrote ${data.cases.length} renewal cases and embedded them.`); }
}
