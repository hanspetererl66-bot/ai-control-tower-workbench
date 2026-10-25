/**
 * Customer AI Briefing Space: pulls customer, contracts, AI units, offers, tickets and invoices from the Sub4Me data and the
 * renewals from the Renewals data, adds the hand-written agents (examples/customer-ai-briefing/agents.json) and embeds the result
 * and the shared design system into the page.
 *   npm run sync:customer-briefing            write
 *   npm run sync:customer-briefing -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE = 'examples/customer-ai-briefing/index.html';
export const DATA = 'examples/customer-ai-briefing/agents.json';
const BLOCK = /(<script type="application\/json" id="cab-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const ID_MAP = { muster: 'muster', hanse: 'hanse' };
const openOffer = (o) => o.status === 'Open' || o.status === 'In negotiation';

/** Everything that comes from other Spaces, per customer. */
export function buildBriefing(authored = JSON.parse(read(DATA))) {
  const sub = /<script type="application\/json" id="s4m-data">([\s\S]*?)<\/script>/.exec(read('examples/sub4me/index.html'));
  const page = JSON.parse(sub[1]);
  const portfolio = JSON.parse(read('examples/sub4me/portfolio.json'));
  const renewals = JSON.parse(read('examples/renewals/renewals.json'));
  const sources = [{ id: 'muster', ...page }, ...portfolio.otherCustomers.map((o) => ({ ...o }))];
  const customers = authored.customers.map((a) => {
    const s = sources.find((x) => ID_MAP[x.id ?? x.customer?.id] === a.id || (x.customer && x.customer.id === a.id));
    if (!s) throw new Error(`no Sub4Me data for customer "${a.id}"`);
    const cu = s.customer, pr = s.profile;
    return {
      id: a.id, name: cu.name, sapCustomerId: cu.sapCustomerId, industry: `${pr.industry}, ${Number(pr.employees).toLocaleString('en-US')} employees`, landscape: pr.landscape,
      allotment: s.aiUnits.allotment, aiHistory: s.aiUnits.history?.[0] ?? null, products: s.products.map((p) => ({ name: p.name, allotment: p.allotment, consumed: p.consumed, meters: p.meters, monthly: p.monthly })),
      contracts: s.contracts.map((c) => ({ id: c.id, product: c.product, scope: c.scope, end: c.end, annualEur: c.annualEur, status: c.status, type: c.contractType })),
      offers: s.offers.filter(openOffer).map((o) => ({ id: o.id, type: o.type, product: o.product, annualEur: o.annualEur, validUntil: o.validUntil, status: o.status, stage: o.stage ?? '', probabilityPct: o.probabilityPct ?? null })),
      tickets: s.tickets.filter((t) => t.status !== 'Closed').map((t) => ({ id: t.id, title: t.title, product: t.product, priority: t.priority, status: t.status })),
      overdue: s.invoices.filter((i) => i.status === 'Overdue').map((i) => ({ id: i.id, grossEur: i.grossEur, due: i.due })),
      renewals: renewals.cases.filter((r) => r.customerId === a.id && r.status !== 'Signed').map((r) => ({ id: r.id, product: r.product, status: r.status, decisionDate: r.decisionDate, annualEur: r.annualEur })),
      agents: a.agents, decisions: a.decisions, contractModels: a.contractModels,
    };
  });
  return {
    asOf: page.asOf,
    sources: [
      { block: 'Customer, contracts, open offers, open tickets, overdue invoices', from: 'Sub4Me Space' },
      { block: 'AI units per product and month', from: 'Sub4Me Space (AI units and products)' },
      { block: 'Renewal decision dates', from: 'Renewals Space' },
      { block: 'Agents, roadmap, decisions, AI-credit contract terms', from: 'written by hand for this demo (no system of record yet)' },
    ],
    customers,
  };
}

export function embedBriefing(html, data, css) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="cab-data"> block`);
  const body = JSON.stringify(data).replaceAll('<', '\\u003c');
  return embedDesignSystem(html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = buildBriefing();
  const html = read(PAGE);
  const next = embedBriefing(html, data, read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('Customer AI Briefing page is out of sync — run: npm run sync:customer-briefing'); process.exit(1); }
    console.log('Customer AI Briefing page is in sync.');
  } else { writeFileSync(join(ROOT, PAGE), next); console.log(`Embedded the data (${data.customers.length} customers).`); }
}
