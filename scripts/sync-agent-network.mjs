/**
 * Agent Network Space: builds examples/agent-network/data.json (the three demo agents with their contracts, and the facts they own per customer,
 * taken from the Renewals sample data) and embeds it, the gate rules (shared/agent-network-rules.mjs) and the shared design system into the page.
 *   npm run sync:agent-network            write
 *   npm run sync:agent-network -- --check fail when the data or the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';
import { makeNetworkRules } from '../shared/agent-network-rules.mjs';
import { DEMO, DEMO_TEMPLATES } from '../src/agent-network-demo.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE = 'examples/agent-network/index.html';
export const DATA = 'examples/agent-network/data.json';
const BLOCK = /(<script type="application\/json" id="net-data">)([\s\S]*?)(<\/script>)/;
const RULES = /\/\/ @rules-start\n(?:[\s\S]*?\n)?\s*\/\/ @rules-end/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const between = (a, b) => Math.round((day(b) - day(a)) / 86400000);

const IDS = { watcher: 'a-watcher', finance: 'a-finance', support: 'a-support' };
const SHAPE = {
  [DEMO_TEMPLATES.watcher]: { id: IDS.watcher, short: 'Watcher', role: 'Owns the renewal dates, asks the others' },
  [DEMO_TEMPLATES.finance]: { id: IDS.finance, short: 'Finance', role: 'Owns the invoices of a customer' },
  [DEMO_TEMPLATES.support]: { id: IDS.support, short: 'Support', role: 'Owns the support tickets of a customer' },
};

export function buildNetworkData() {
  const renewals = JSON.parse(read('examples/renewals/renewals.json'));
  const customers = renewals.customers.map((cu) => {
    const mine = renewals.cases.filter((c) => c.customerId === cu.id);
    return {
      id: cu.id, name: cu.name,
      renewals: mine.map((c) => ({ contractId: c.contractId, product: c.product.replace(/\s*\(.*\)/, ''), decisionDate: c.decisionDate, days: between(renewals.asOf, c.decisionDate), annualEur: c.annualEur, status: c.status })).sort((a, b) => a.days - b.days),
      invoices: mine.flatMap((c) => c.invoices.map((i) => ({ id: i.id, status: i.status, grossEur: i.grossEur, due: i.due, daysOverdue: i.status === 'Overdue' ? between(i.due, renewals.asOf) : 0, product: c.product.replace(/\s*\(.*\)/, '') }))),
      tickets: mine.flatMap((c) => c.tickets.map((t) => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, product: c.product.replace(/\s*\(.*\)/, '') }))),
    };
  });
  const agents = DEMO.map((d) => ({ ...SHAPE[d.template], name: d.name, contract: d.contract({ finance: IDS.finance, support: IDS.support }) })).sort((a, b) => ['a-watcher', 'a-finance', 'a-support'].indexOf(a.id) - ['a-watcher', 'a-finance', 'a-support'].indexOf(b.id));
  return { asOf: renewals.asOf, note: 'Fictional data from the Renewals sample data (examples/renewals/renewals.json); the agents are defined in src/agent-network-demo.ts.', agents, customers };
}

export function embedNetwork(html, data, css, rulesSource = makeNetworkRules.toString()) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="net-data"> block`);
  if (!RULES.test(html)) throw new Error(`${PAGE} has no @rules-start / @rules-end markers`);
  const body = JSON.stringify(data, null, 1).replaceAll('<', '\\u003c');
  const withData = html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`).replace(RULES, () => `// @rules-start\n${rulesSource}\n// @rules-end`);
  return embedDesignSystem(withData, css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = buildNetworkData(), dataText = JSON.stringify(data, null, 2) + '\n', html = read(PAGE);
  const next = embedNetwork(html, data, read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (read(DATA) !== dataText || next !== html) { console.error('Agent Network data or page is out of sync — run: npm run sync:agent-network'); process.exit(1); }
    console.log('Agent Network page is in sync.');
  } else { writeFileSync(join(ROOT, DATA), dataText); writeFileSync(join(ROOT, PAGE), next); console.log(`Wrote ${data.agents.length} agents and ${data.customers.length} customers and embedded them.`); }
}
