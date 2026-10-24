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

export function sub4meCustomers() {
  const html = read('examples/sub4me/index.html');
  const page = JSON.parse(/id="s4m-data">\n([\s\S]*?)\n<\/script>/.exec(html)[1]);
  return [{ id: 'muster', customer: page.customer, contracts: page.contracts, offers: page.offers, invoices: page.invoices, tickets: page.tickets }, ...JSON.parse(read('examples/sub4me/portfolio.json')).otherCustomers];
}

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
      cases.push({
        id: `R-${k.id}`, customerId: c.id, customer: c.customer.name, sapCustomerId: c.customer.sapCustomerId,
        contractId: k.id, product: k.product, status: lapsed ? 'Lapsed' : k.status === 'Renewal due' ? 'Renewal due' : 'Running', end: k.end,
        noticeDays: k.noticeDays, decisionDate: addDays(k.end, -k.noticeDays), autoRenew: k.autoRenew, annualEur: k.annualEur, upliftCapPct: k.priceUpliftCapPct, termination: k.termination,
        used: k.usedUnits, licensed: k.licensedUnits, unit: k.unit, owner: k.sapOwner.name, csm: k.csm.name, customerOwner: k.customerOwner.name,
        offer: offer ? { id: offer.id, annualEur: offer.annualEur, currentAnnualEur: offer.currentAnnualEur, discountPct: offer.discountPct, validUntil: offer.validUntil, stage: offer.stage, probabilityPct: offer.probabilityPct, competitor: offer.competitor, nextStep: offer.nextStep, termMonths: offer.termMonths, priceGuaranteeMonths: offer.priceGuaranteeMonths, approval: offer.approval } : null,
        tickets, invoices,
      });
    }
  }
  cases.sort((a, b) => a.decisionDate.localeCompare(b.decisionDate) || a.id.localeCompare(b.id));
  return {
    asOf: AS_OF,
    note: 'Fictional data derived from the Sub4Me sample data of Muster Industrie AG and Hanse Handelsgruppe AG (scripts/sync-renewals.mjs). The decision date is the contract end minus the notice period: by then the renewal must be agreed or the contract ends.',
    cases,
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
