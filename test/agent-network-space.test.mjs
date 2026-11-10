import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildNetworkData, embedNetwork } from '../scripts/sync-agent-network.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';
import { makeNetworkRules } from '../shared/agent-network-rules.mjs';
import { buildCatalog, sanitizeAgents, problems } from '../src/agent-studio.ts';
import { demoAgents, hasDemo, DEMO_TEMPLATES } from '../src/agent-network-demo.ts';
import { contractProblems, decide, networkBrief } from '../src/agent-network.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const page = read('examples/agent-network/index.html');
const css = read('examples/shared/design-system.css');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Space: registered, in sync with its data, the rules copy and the design system; no network, tokens only, reduced motion respected', () => {
  assert.equal(EXAMPLE_SPACES['agent-network'], 'agent-network');
  assert.ok(SPACE_PAGES.includes('examples/agent-network/index.html'));
  const data = buildNetworkData();
  assert.equal(embedNetwork(page, data, css), page, 'run: npm run sync:agent-network');
  assert.equal(read('examples/agent-network/data.json'), JSON.stringify(data, null, 2) + '\n');
  assert.ok(page.includes(makeNetworkRules.toString()), 'the page runs exactly the rules of the app');
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/);
  const own = page.slice(page.indexOf('</style>') + 8, page.indexOf('</style>', page.indexOf('</style>') + 8));
  assert.doesNotMatch(own, /#[0-9a-fA-F]{3,6}\b|rgba?\(/, 'only tokens in the page styles');
  assert.match(page, /prefers-reduced-motion:reduce/);
  const meta = JSON.parse(read('examples/agent-network/space.json'));
  assert.equal(meta.title, 'Agent Network');
});

test('Space data: the agents and the customers come from the demo definitions and the Renewals sample data', () => {
  const d = buildNetworkData(), renewals = JSON.parse(read('examples/renewals/renewals.json'));
  assert.deepEqual(d.agents.map((a) => a.id), ['a-watcher', 'a-finance', 'a-support']);
  assert.deepEqual(d.agents[0].contract.mayCall, ['a-finance', 'a-support']);
  assert.equal(d.agents[0].contract.callable, false);
  assert.deepEqual(d.customers.map((c) => c.id), renewals.customers.map((c) => c.id));
  for (const c of d.customers) {
    const cases = renewals.cases.filter((x) => x.customerId === c.id);
    assert.equal(c.renewals.length, cases.length);
    assert.equal(c.invoices.length, cases.reduce((n, x) => n + x.invoices.length, 0));
    assert.equal(c.tickets.length, cases.reduce((n, x) => n + x.tickets.length, 0));
    for (const i of c.invoices.filter((x) => x.status === 'Overdue')) assert.ok(i.daysOverdue > 0, i.id);
  }
});

async function open() {
  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  const dom = new JSDOM(page, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(w) { w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }); w.SVGElement.prototype.getTotalLength = () => 100; w.SVGElement.prototype.getPointAtLength = () => ({ x: 0, y: 0 }); } });
  await wait(80);
  const w = dom.window, d = w.document;
  return { w, d, q: (s) => d.querySelector(s), qa: (s) => [...d.querySelectorAll(s)], errors };
}
const tones = (p) => p.qa('#timeline li').slice(1).map((l) => l.className);
async function go(p, setup) { p.w.__net.reset(); setup?.(p); p.q('#run').click(); await wait(250); }

test('Space: the run shows every outcome of the gate, and the brief never fills a gap with a guess', async () => {
  const p = await open();
  await go(p); assert.deepEqual(tones(p), ['ok', 'ok']); assert.match(p.q('#brief').textContent, /Overdue: INV-/);
  await go(p, (x) => { x.w.__net.S.cls = 'confidential'; });
  assert.deepEqual(tones(p), ['wait', 'wait']); assert.doesNotMatch(p.q("#brief").textContent, /INV-2026|\(EUR/); assert.match(p.q('#brief').textContent, /withheld/);
  await go(p, (x) => { x.w.__net.S.cls = 'confidential'; x.q('#rel').value = 'approve'; x.q('#rel').dispatchEvent(new x.w.Event('change')); });
  assert.match(p.q('#brief').textContent, /Finance facts did not release it/); assert.match(p.q('#brief').textContent, /did not fill the gap/);
  p.q('#timeline [data-approve]').click();
  assert.match(p.q('#timeline').textContent, /approved, simulated/); assert.match(p.q('#timeline').textContent, /no approval inbox in the app yet/);
  await go(p, (x) => { x.w.__net.S.cls = 'personal'; x.q('#rel').value = 'redact'; x.q('#rel').dispatchEvent(new x.w.Event('change')); });
  assert.deepEqual(tones(p), ['no', 'no']); assert.match(p.q('#timeline').textContent, /never releases personal data/);
  await go(p, (x) => { x.w.__net.S.cls = 'internal'; x.q('#stopFin').checked = true; });
  assert.deepEqual(tones(p), ['no', 'ok']); assert.match(p.q('#timeline').textContent, /is stopped/);
  await go(p, (x) => { x.q('#stopFin').checked = false; x.q('#forge').checked = true; });
  assert.deepEqual(tones(p), ['no', 'no']); assert.match(p.q('#timeline').textContent, /unknown or has ended/);
  await go(p, (x) => { x.q('#forge').checked = false; x.q('#noMay').checked = true; });
  assert.deepEqual(tones(p), ['ok', 'no']); assert.match(p.q('#timeline').textContent, /not allowed to ask "Support facts"/);
  assert.equal(p.qa('#checks li.fail').length, 1, 'the failing check of the last question is marked');
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('Studio demo: the three agents are created as drafts with contracts that fit together, and survive storage', () => {
  const catalog = buildCatalog(['sub4me'], [{ slug: 'renewals', title: 'Renewals' }]);
  const three = demoAgents(catalog, 5000);
  assert.equal(three.length, 3); assert.ok(hasDemo(three));
  const by = Object.fromEntries(three.map((a) => [a.template, a]));
  const [w, f, s] = [by[DEMO_TEMPLATES.watcher], by[DEMO_TEMPLATES.finance], by[DEMO_TEMPLATES.support]];
  assert.deepEqual(w.contract.mayCall, [f.id, s.id]);
  assert.deepEqual(w.sources, ['space:renewals']); assert.deepEqual(f.sources, ['conn:sub4me']);
  for (const a of three) { assert.deepEqual(contractProblems(a), [], a.name); assert.deepEqual(problems(a), [], a.name); assert.equal(a.tested, false); assert.match(a.id, /^a-[a-z0-9]+$/); }
  assert.equal(new Set(three.map((a) => a.id)).size, 3);
  assert.deepEqual(sanitizeAgents(JSON.parse(JSON.stringify(three))).map((a) => a.contract), three.map((a) => a.contract));
  const traces = new Map([['t-demo-0001', { agentId: w.id, hop: 0, calls: 0 }]]);
  const env = { id: 'q-1', trace: 't-demo-0001', hop: 0, from: w.id, to: f.id, purpose: 'Prepare the renewal talk', question: 'Which invoices are overdue?', classes: ['internal'], at: 1 };
  assert.equal(decide(env, { agents: three, published: () => true, stopped: () => false, traces }).outcome, 'answer');
  assert.equal(decide({ ...env, from: f.id, to: w.id }, { agents: three, published: () => true, stopped: () => false, traces: new Map([['t-demo-0001', { agentId: f.id, hop: 0, calls: 0 }]]) }).outcome, 'refused', 'nobody may ask the watcher');
  assert.match(networkBrief(w, 't-demo-0001', three, () => true), /Finance facts/);
  assert.equal(networkBrief(f, 't-demo-0001', three, () => true), '');
});

test('App and Studio: the pieces are wired (switch off by default, run record, stop switch, narrowed second session, no open permissions)', () => {
  const app = read('src/App.tsx'), studio = read('src/ui/AgentStudio.tsx'), ops = read('src/ui/AgentOps.tsx');
  assert.match(app, /localStorage\.getItem\(NETWORK_KEY\) === '1'/, 'off unless the person switched it on');
  assert.match(app, /createBroker\(\{/); assert.match(app, /brokerRef\.current\.beginRun\(/); assert.match(app, /netRun\.end\(/);
  assert.match(app, /isStopped\(agentStops, runTarget\.id\)/); assert.match(app, /isStopped\(agentStops, id\) \? 0 : govLevelOf/, 'a stopped agent loses its schedule');
  assert.match(app, /onPermission: async \(req: PermissionRequest\) => rejectOption\(req\.options\)/);
  assert.match(app, /removeSessionExtension\(ext\.name\)/); assert.match(app, /Fail closed/);
  assert.match(app, /window\.setInterval\(\(\) => \{ void broker\.tick\(\)/);
  assert.match(studio, /Demo: renewal network/); assert.match(studio, /<NetworkSwitch ops=\{ops\} \/>/); assert.match(studio, /<BenchPanel/); assert.match(studio, /<ContractPanel/); assert.match(studio, /<RunsPanel/);
  assert.match(ops, /Stop this agent/); assert.match(ops, /Run bench \(live\)/);
});
