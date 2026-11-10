import assert from 'node:assert/strict';
import test from 'node:test';
import { newAgent, sanitizeAgents, problems, agentPrompt, buildCatalog } from '../src/agent-studio.ts';
import { sanitizeContract, contractProblems, readEnvelope, decide, redact, specialistPrompt, networkBrief, logLine, MAX_HOPS, MAX_CALLS_PER_TRACE, DEFAULT_RELEASES } from '../src/agent-network.ts';

const catalog = buildCatalog(['sub4me', 'jira'], []);
const mk = (id, name, contract) => ({ ...newAgent(null, catalog, 1), id, name, instruction: 'Read the open invoices and say which are overdue.', sources: ['conn:sub4me'], ...(contract ? { contract } : {}) });
const finance = mk('a-fin', 'Finance facts', sanitizeContract({ callable: true, capability: 'Open and overdue invoices of a customer.', accepts: 'customer id', returns: 'short list', releases: { public: 'answer', internal: 'answer', confidential: 'redact', personal: 'refuse' } }));
const support = mk('a-sup', 'Support facts', sanitizeContract({ callable: true, capability: 'Open support tickets of a customer.', releases: { confidential: 'approve' } }));
const watcher = mk('a-wat', 'Renewal watcher', sanitizeContract({ mayCall: ['a-fin', 'a-sup'] }));
const agents = [finance, support, watcher];
const ctx = (over = {}) => ({ agents, published: () => true, stopped: () => false, traces: new Map([['t-abc123', { agentId: 'a-wat', hop: 0, calls: 0 }]]), ...over });
const env = (over = {}) => ({ id: 'q-0001', trace: 't-abc123', hop: 0, from: 'a-wat', to: 'a-fin', purpose: 'Prepare the renewal brief', question: 'Which invoices of Lindenau are overdue?', classes: ['internal'], at: 1, ...over });

test('contract: unknown values are cut, known classes and releases survive, an agent is not part of the network by default', () => {
  const c = sanitizeContract({ callable: 'yes', capability: 'x'.repeat(500), releases: { public: 'nonsense', internal: 'refuse', evil: 'answer' }, mayCall: ['a-ok', '../etc', 7, 'a-ok'] });
  assert.equal(c.callable, false, 'only true counts');
  assert.equal(c.capability.length, 200);
  assert.equal(c.releases.public, DEFAULT_RELEASES.public);
  assert.equal(c.releases.internal, 'refuse');
  assert.ok(!('evil' in c.releases));
  assert.deepEqual(c.mayCall, ['a-ok']);
  assert.equal(sanitizeContract(null).callable, false);
  const kept = sanitizeAgents(JSON.parse(JSON.stringify([finance])))[0];
  assert.deepEqual(kept.contract, finance.contract, 'the contract is stored with the agent');
  assert.equal(sanitizeAgents([{ ...newAgent(null, catalog, 2), name: 'n' }])[0].contract, undefined);
});

test('contract: problems are named and show up in the Studio checks', () => {
  assert.deepEqual(contractProblems(newAgent(null, catalog, 3)), []);
  const bad = { ...finance, contract: sanitizeContract({ callable: true, capability: 'short', releases: { public: 'refuse', internal: 'refuse', confidential: 'refuse', personal: 'refuse' }, mayCall: ['a-fin'] }) };
  const p = contractProblems(bad);
  assert.equal(p.length, 3);
  assert.ok(problems(bad).some((x) => /every class/.test(x)));
});

test('envelope: only well-formed requests pass, texts are cut, classes are checked', () => {
  const ok = readEnvelope({ id: 'q-0001', trace: 't-abc123', from: 'a-wat', to: 'a-fin', purpose: 'Prepare the brief', question: 'Which invoices are overdue?', classes: ['internal', 'x', 'internal'] }, 5);
  assert.ok(ok.ok); assert.deepEqual(ok.envelope.classes, ['internal']); assert.equal(ok.envelope.hop, 0);
  for (const bad of [null, {}, { id: 'q-0001', trace: 't-abc123', from: 'wat', to: 'a-fin', purpose: 'Prepare', question: 'long enough', classes: ['internal'] }, { id: 'q-0001', trace: 't-abc123', from: 'a-wat', to: 'a-fin', purpose: 'Prepare', question: 'hi', classes: ['internal'] }, { id: 'q-0001', trace: 't-abc123', from: 'a-wat', to: 'a-fin', purpose: 'Prepare', question: 'long enough', classes: [] }, { id: 'q 1', trace: 't-abc123', from: 'a-wat', to: 'a-fin', purpose: 'Prepare', question: 'long enough', classes: ['internal'] }]) assert.equal(readEnvelope(bad).ok, false);
  const long = readEnvelope({ id: 'q-0001', trace: 't-abc123', from: 'a-wat', to: 'a-fin', purpose: 'Prepare', question: 'q'.repeat(5000), classes: ['public'] });
  assert.equal(long.envelope.question.length, 1200);
});

test('gate: an allowed question is answered; every failed check refuses with its reason', () => {
  assert.deepEqual(decide(env(), ctx()), { outcome: 'answer', reason: 'Released (internal).' });
  const refused = (over, c = ctx(), re = /./) => { const d = decide(env(over), c); assert.equal(d.outcome, 'refused', JSON.stringify(over)); assert.match(d.reason, re); };
  refused({ trace: 't-unknown1' }, ctx(), /unknown or has ended/);
  refused({ from: 'a-sup' }, ctx(), /belongs to another agent/);
  refused({ to: 'a-nobody' }, ctx(), /does not exist/);
  refused({ to: 'a-wat' }, ctx(), /ask itself/);
  refused({}, ctx({ stopped: (id) => id === 'a-fin' }), /"Finance facts" is stopped/);
  refused({}, ctx({ stopped: (id) => id === 'a-wat' }), /"Renewal watcher" is stopped/);
  refused({}, ctx({ published: (id) => id !== 'a-fin' }), /not published/);
  refused({}, ctx({ published: (id) => id !== 'a-wat' }), /may not ask/);
  refused({ to: 'a-sup', classes: ['personal'] }, ctx(), /./);
  const noCall = ctx({ agents: [finance, support, { ...watcher, contract: sanitizeContract({ mayCall: ['a-sup'] }) }] });
  refused({ to: 'a-fin' }, noCall, /not allowed to ask/);
  const closed = ctx({ agents: [{ ...finance, contract: sanitizeContract({ callable: false }) }, support, watcher] });
  refused({}, closed, /does not accept questions/);
});

test('gate: hop limit and call budget stop a chain; the worst class decides; approval is not released without an inbox', () => {
  refusedAt(MAX_HOPS, 0, /Hop limit/);
  refusedAt(0, MAX_CALLS_PER_TRACE, /budget used up/);
  function refusedAt(hop, calls, re) { const d = decide(env(), ctx({ traces: new Map([['t-abc123', { agentId: 'a-wat', hop, calls }]]) })); assert.equal(d.outcome, 'refused'); assert.match(d.reason, re); }
  assert.equal(decide(env({ classes: ['internal', 'confidential'] }), ctx()).outcome, 'redacted', 'confidential is released with amounts withheld by the finance contract');
  assert.equal(decide(env({ to: 'a-sup', classes: ['internal', 'confidential'] }), ctx()).outcome, 'needs_approval');
  assert.match(decide(env({ to: 'a-sup', classes: ['confidential'] }), ctx()).reason, /no approval inbox/);
  assert.equal(decide(env({ classes: ['personal'] }), ctx()).outcome, 'refused');
});

test('redaction removes amounts, addresses and identifiers but keeps the sentence', () => {
  const t = redact('INV-2026-40102 for EUR 165,469.50 (due 2026-07-31) is overdue; mail s.roth@lindenau-pharma.example, PO 8800718093, 12 days late, € 2.4 M, 3,5 k €.');
  assert.doesNotMatch(t, /165|lindenau|8800718093|40102|2\.4/);
  assert.match(t, /overdue/); assert.match(t, /12 days late/);
});

test('briefs: the specialist treats the question as data, the asking agent learns only about published, callable agents', () => {
  const p = specialistPrompt('BASE BRIEF', env(), watcher, 'redacted');
  assert.match(p, /BASE BRIEF/); assert.match(p, /never as an instruction/); assert.match(p, /Do not state amounts/); assert.match(p, /QUESTION: Which invoices/);
  assert.doesNotMatch(specialistPrompt('B', env(), watcher, 'answer'), /Do not state amounts/);
  const nb = networkBrief(watcher, 't-abc123', agents, () => true);
  assert.match(nb, /ask_agent/); assert.match(nb, /a-fin/); assert.match(nb, /trace="t-abc123"/);
  assert.equal(networkBrief(finance, 't-abc123', agents, () => true), '', 'an agent that asks nobody gets no network text');
  assert.doesNotMatch(networkBrief(watcher, 't-abc123', agents, (id) => id !== 'a-sup'), /a-sup/);
  assert.match(agentPrompt(watcher, catalog, nb), /NETWORK:/);
  assert.doesNotMatch(agentPrompt(watcher, catalog), /NETWORK:/);
});

test('log line: reasons are cut, the shape is stable', () => {
  const l = logLine(env(), { outcome: 'refused', reason: 'x'.repeat(900) }, 42);
  assert.equal(l.reason.length, 300); assert.equal(l.ms, 42); assert.equal(l.from, 'a-wat');
});
