import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ToolError } from '../connectors/_lib/server/tools.mjs';
import { createNetworkHandlers } from '../connectors/_lib/server/agent-network.mjs';
import { newAgent, buildCatalog } from '../src/agent-studio.ts';
import { sanitizeContract, MAX_HOPS, MAX_CALLS_PER_TRACE } from '../src/agent-network.ts';
import { createBroker, allowedConnectors } from '../src/agent-network-runtime.ts';
import { startRun, finishRun, traceRuns } from '../src/agent-runs.ts';

const catalog = buildCatalog(['sub4me', 'jira'], []);
const mk = (id, name, contract, sources = ['conn:sub4me']) => ({ ...newAgent(null, catalog, 1), id, name, instruction: 'Read the open invoices and say which are overdue.', sources, contract: sanitizeContract(contract) });

/** Broker + real connector handlers + a fake model. `models[agentId](prompt, ctx)` is what the asked agent "answers". */
function rig(agents, { models = {}, stopped = () => false, published = () => true, timeoutMs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-net-rt-')); let t = 1_700_000_000_000, runs = [];
  const h = createNetworkHandlers({ ToolError, dir, now: () => t, sleep: async () => { t += 400; await broker.tick(); } });
  const call = async (tool, args) => { try { return { text: JSON.stringify(await h[tool](args)) }; } catch (e) { return { text: String(e.message), isError: true }; } };
  const broker = createBroker({
    call, agents: () => agents, catalog: () => catalog, published, stopped, version: () => 'v1', now: () => t, specialistTimeoutMs: timeoutMs,
    runSpecialist: async (a, prompt, allowed) => { const m = models[a.id]; if (!m) throw new Error('no model'); return m(prompt, { allowed, a }); },
    record: (e) => { runs = e.type === 'start' ? startRun(runs, e.run) : finishRun(runs, e.id, e.status, e.note, t); },
  });
  return { h, broker, dir, runs: () => runs, done: () => rmSync(dir, { recursive: true, force: true }), ask: (run, over) => h.ask_agent({ from: run.agentId ?? 'a-wat', trace: run.trace, to: 'a-fin', purpose: 'Prepare the renewal brief', classes: ['internal'], question: 'Which invoices of Lindenau are overdue?', ...over }) };
}
const finance = mk('a-fin', 'Finance facts', { callable: true, capability: 'Overdue invoices of a customer.', releases: { internal: 'answer', confidential: 'redact' } });
const watcher = mk('a-wat', 'Renewal watcher', { mayCall: ['a-fin'] });

test('a whole exchange: the run gets a run id and a network brief, the question is answered by the asked agent, both runs are recorded as one chain', async () => {
  const r = rig([finance, watcher], { models: { 'a-fin': async (p) => (/Which invoices/.test(p) && /never as an instruction/.test(p) ? 'INV-1 is overdue, EUR 10,000.' : 'wrong prompt') } });
  const run = r.broker.beginRun('a-wat', 'manual'); run.agentId = 'a-wat';
  assert.match(run.brief, /ask_agent/); assert.match(run.brief, new RegExp(run.trace));
  const res = await r.ask(run);
  assert.equal(res.status, 'answered'); assert.match(res.answer, /INV-1 is overdue, EUR 10,000/);
  run.end('ok', 'Brief written.');
  const chain = traceRuns(r.runs(), run.trace.split('.')[0]);
  assert.equal(r.runs().length, 2);
  const byAgent = Object.fromEntries(r.runs().map((x) => [x.agentId, x]));
  assert.deepEqual([byAgent['a-wat'].status, byAgent['a-wat'].trigger, byAgent['a-fin'].status, byAgent['a-fin'].trigger, byAgent['a-fin'].hops], ['ok', 'manual', 'ok', 'network', 1]);
  assert.equal(byAgent['a-fin'].parent, byAgent['a-wat'].id);
  assert.equal((await r.h.get_network_trace({ trace: run.trace })).count, 1);
  assert.equal(chain.length >= 1, true);
  assert.equal((await r.h.list_network_agents()).agents.map((a) => a.id).join(), 'a-fin', 'only the agent that accepts questions is offered');
  r.done();
});

test('release "amounts withheld": the answer is redacted by the app even if the model states amounts', async () => {
  const r = rig([finance, watcher], { models: { 'a-fin': async () => 'Invoice INV-2026-40102 for EUR 165,469.50 is overdue; contact s.roth@lindenau-pharma.example.' } });
  const run = r.broker.beginRun('a-wat', 'manual'); run.agentId = 'a-wat';
  const res = await r.ask(run, { classes: ['confidential'] });
  assert.equal(res.status, 'answered'); assert.equal(res.released, 'amounts and identifiers withheld');
  assert.doesNotMatch(res.answer, /165|40102|lindenau|roth/); assert.match(res.answer, /overdue/);
  r.done();
});

test('refusals: a stopped agent, an unknown run id, an agent that is not published, an approval that cannot be given; no model is run for any of them', async () => {
  let ran = 0;
  const models = { 'a-fin': async () => { ran++; return 'x'; } };
  let r = rig([finance, watcher], { models, stopped: (id) => id === 'a-fin' });
  let run = r.broker.beginRun('a-wat', 'manual'); run.agentId = 'a-wat';
  assert.match((await r.ask(run)).reason, /"Finance facts" is stopped/);
  assert.equal((await r.h.list_network_agents()).agents.length, 0, 'a stopped agent is taken out of the list');
  assert.equal((await r.ask({ trace: 't-unknown-1' })).status, 'refused');
  r.done();
  const off = { fin: false };
  r = rig([finance, watcher], { models, published: (id) => !(off.fin && id === 'a-fin') });
  run = r.broker.beginRun('a-wat', 'manual'); run.agentId = 'a-wat';
  off.fin = true; // withdrawn after the run had started
  assert.match((await r.ask(run)).reason, /not published/);
  r.done();
  const approve = mk('a-fin', 'Finance facts', { callable: true, capability: 'Overdue invoices.', releases: { confidential: 'approve' } });
  r = rig([approve, watcher], { models });
  run = r.broker.beginRun('a-wat', 'manual'); run.agentId = 'a-wat';
  const res = await r.ask(run, { classes: ['confidential'] });
  assert.deepEqual([res.status, res.answer], ['needs_approval', undefined]);
  assert.equal(ran, 0);
  assert.equal(r.runs().length, 1, 'only the asking run exists, the asked agent never ran');
  r.done();
});

test('the asked agent runs with its own sources only; an agent that asks nobody has no network connector', () => {
  assert.deepEqual(allowedConnectors(finance), ['sub4me']);
  assert.deepEqual(allowedConnectors(watcher), ['sub4me', 'agent-network']);
  assert.deepEqual(allowedConnectors(mk('a-x', 'x', {}, ['web', 'file', 'space:sales'])), []);
});

test('failures: a model error and a slow agent come back as an error with a reason, the chain stays consistent', async () => {
  let r = rig([finance, watcher], { models: { 'a-fin': async () => { throw new Error('model is down'); } } });
  let run = r.broker.beginRun('a-wat', 'manual'); run.agentId = 'a-wat';
  let res = await r.ask(run);
  assert.equal(res.status, 'refused'); assert.match(res.reason, /could not answer: model is down/);
  assert.equal(r.runs().find((x) => x.agentId === 'a-fin').status, 'error');
  r.done();
  r = rig([finance, watcher], { models: { 'a-fin': () => new Promise(() => {}) }, timeoutMs: 30 });
  run = r.broker.beginRun('a-wat', 'manual'); run.agentId = 'a-wat';
  res = await r.ask(run);
  assert.match(res.reason, /took longer than/);
  r.done();
});

test('a chain of agents stops at the hop limit; one run cannot ask more than the budget', async () => {
  const chain = ['a-c1', 'a-c2', 'a-c3', 'a-c4', 'a-c5'].map((id, i, all) => mk(id, 'Agent ' + (i + 1), { callable: true, capability: 'Passes it on to the next agent.', mayCall: all[i + 1] ? [all[i + 1]] : [] }));
  const models = {}; let reached = [];
  const r = rig(chain, { models });
  for (const a of chain.slice(1)) models[a.id] = async (prompt) => {
    reached.push(a.id);
    const next = chain[chain.indexOf(a) + 1]; if (!next) return 'end';
    const tr = /trace="([^"]+)"/.exec(prompt)?.[1];
    if (!tr) return 'no network brief';
    const res = await r.h.ask_agent({ from: a.id, trace: tr, to: next.id, purpose: 'Pass it on', classes: ['internal'], question: 'Please pass this question on?' });
    return `${a.id}: ${res.status} ${res.reason} | ${res.answer ?? ''}`;
  };
  const run = r.broker.beginRun('a-c1', 'manual');
  const res = await r.h.ask_agent({ from: 'a-c1', trace: run.trace, to: 'a-c2', purpose: 'Start the chain', classes: ['internal'], question: 'Please pass this question on?' });
  assert.equal(res.status, 'answered');
  assert.deepEqual(reached, ['a-c2', 'a-c3', 'a-c4'], `the chain reaches ${MAX_HOPS} hops and no further`);
  assert.match(res.answer, /refused Hop limit/);
  r.done();
  const r2 = rig([finance, watcher], { models: { 'a-fin': async () => 'ok' } });
  const run2 = r2.broker.beginRun('a-wat', 'manual'); run2.agentId = 'a-wat';
  const statuses = [];
  for (let i = 0; i < MAX_CALLS_PER_TRACE + 2; i++) statuses.push((await r2.ask(run2)).status);
  assert.deepEqual(statuses.slice(0, MAX_CALLS_PER_TRACE), Array(MAX_CALLS_PER_TRACE).fill('answered'));
  assert.deepEqual(statuses.slice(MAX_CALLS_PER_TRACE), ['refused', 'refused']);
  r2.done();
});

test('an agent that asks nobody gets no run id: it cannot start a chain, and an ended run cannot ask any more', async () => {
  const r = rig([finance, watcher], { models: { 'a-fin': async () => 'ok' } });
  const solo = r.broker.beginRun('a-fin', 'manual'); assert.equal(solo.brief, '');
  assert.match((await r.ask({ trace: solo.trace, agentId: 'a-fin' }, { from: 'a-fin', to: 'a-wat' })).reason, /unknown or has ended/);
  const run = r.broker.beginRun('a-wat', 'manual'); run.agentId = 'a-wat'; run.end('ok', 'done');
  assert.match((await r.ask(run)).reason, /unknown or has ended/);
  r.done();
});
