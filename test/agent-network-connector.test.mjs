import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ToolError } from '../connectors/_lib/server/tools.mjs';
import { NETWORK_TOOL_DEFINITIONS, createNetworkHandlers } from '../connectors/_lib/server/agent-network.mjs';
import { BUNDLED_CONNECTORS } from '../connectors/_lib/bundle.mjs';
import { newAgent, buildCatalog } from '../src/agent-studio.ts';
import { sanitizeContract, readEnvelope, decide, redact, logLine } from '../src/agent-network.ts';

const ROOT = join(import.meta.dirname, '..');
const dir = () => mkdtempSync(join(tmpdir(), 'agent-net-'));
const catalog = buildCatalog(['sub4me'], []);
const mk = (id, name, contract) => ({ ...newAgent(null, catalog, 1), id, name, instruction: 'Read the open invoices and say which are overdue.', sources: ['conn:sub4me'], contract: sanitizeContract(contract) });
const finance = mk('a-fin', 'Finance facts', { callable: true, capability: 'Overdue invoices of a customer.', releases: { internal: 'answer', confidential: 'redact' } });
const watcher = mk('a-wat', 'Renewal watcher', { mayCall: ['a-fin'] });
const agents = [finance, watcher];
const ask = { from: 'a-wat', trace: 't-abc123', to: 'a-fin', purpose: 'Prepare the renewal brief', classes: ['confidential'], question: 'Which invoices of Lindenau are overdue?' };

/** The app side as the Werkbank runs it: poll, check with the gate, "run" the agent, hand the answer back. */
function appStep(h, ctxOver = {}, answerText = 'INV-2026-40102 is overdue, EUR 165,469.50.') {
  return async () => {
    const { requests } = await h.poll_requests({});
    for (const raw of requests) {
      const shape = readEnvelope(raw);
      if (!shape.ok) { await h.submit_response({ id: raw.id, outcome: 'refused', reason: shape.reason }); continue; }
      const env = shape.envelope, traces = new Map([['t-abc123', { agentId: 'a-wat', hop: 0, calls: 0 }]]);
      const d = decide(env, { agents, published: () => true, stopped: () => false, traces, ...ctxOver });
      const answer = d.outcome === 'answer' ? answerText : d.outcome === 'redacted' ? redact(answerText) : '';
      await h.submit_response({ id: env.id, outcome: d.outcome, reason: d.reason, answer, ms: 5, message: logLine(env, d, 5) });
    }
  };
}
function fakeTime() { let t = 1_700_000_000_000; return { now: () => t, advance: (ms) => { t += ms; } }; }

test('registered: the connector is bundled, its manifest lists the same six tools, three for agents and three for the app', () => {
  assert.ok(BUNDLED_CONNECTORS.includes('agent-network'));
  const manifest = JSON.parse(readFileSync(join(ROOT, 'connectors/agent-network/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.tools.map((t) => t.name), NETWORK_TOOL_DEFINITIONS.map((t) => t.name));
  assert.deepEqual(NETWORK_TOOL_DEFINITIONS.map((t) => t.name), ['list_network_agents', 'ask_agent', 'get_network_trace', 'sync_agents', 'poll_requests', 'submit_response']);
  for (const t of NETWORK_TOOL_DEFINITIONS.slice(3)) assert.match(t.description, /Werkbank app only, not for agents/);
});

test('a question travels: ask, the app checks and answers, the asking agent gets the answer, the trace shows it without texts', async () => {
  const d = dir(), clock = fakeTime();
  const h = createNetworkHandlers({ ToolError, dir: d, now: clock.now, sleep: async () => { clock.advance(400); await appStep(h)(); } });
  await h.sync_agents({ agents: [{ id: 'a-fin', name: 'Finance facts', capability: finance.contract.capability, accepts: 'customer id', returns: 'short list' }, { id: 'bad', name: 'x' }] });
  assert.deepEqual((await h.list_network_agents()).agents.map((a) => a.id), ['a-fin']);
  const res = await h.ask_agent({ ...ask });
  assert.equal(res.status, 'answered');
  assert.equal(res.released, 'amounts and identifiers withheld', 'confidential is released with amounts withheld by the finance contract');
  assert.doesNotMatch(res.answer, /165|40102/);
  assert.match(res.answer, /overdue/);
  const tr = await h.get_network_trace({ trace: 't-abc123' });
  assert.equal(tr.count, 1);
  assert.deepEqual([tr.messages[0].from, tr.messages[0].to, tr.messages[0].outcome], ['a-wat', 'a-fin', 'redacted']);
  assert.ok(!JSON.stringify(tr).includes('Lindenau'), 'the trace has no question text');
  assert.deepEqual(readdirSync(join(d, 'requests')), [], 'nothing is left in the mailbox');
  rmSync(d, { recursive: true });
});

test('refusals come back with their reason; an unknown run id, a stopped agent and a missing approval release nothing', async () => {
  const d = dir(), clock = fakeTime();
  let over = {};
  const h = createNetworkHandlers({ ToolError, dir: d, now: clock.now, sleep: async () => { clock.advance(400); await appStep(h, over)(); } });
  over = { traces: new Map() };
  let r = await h.ask_agent({ ...ask });
  assert.deepEqual([r.status, /unknown or has ended/.test(r.reason), r.answer], ['refused', true, undefined]);
  over = { stopped: (id) => id === 'a-fin' };
  r = await h.ask_agent({ ...ask }); assert.match(r.reason, /is stopped/);
  over = { agents: [mk('a-fin', 'Finance facts', { callable: true, capability: 'Overdue invoices.', releases: { confidential: 'approve' } }), watcher] };
  r = await h.ask_agent({ ...ask });
  assert.deepEqual([r.status, r.answer], ['needs_approval', undefined]); assert.match(r.reason, /no approval inbox/);
  rmSync(d, { recursive: true });
});

test('nobody answers: the asking agent gets a timeout that says what to do, and the request is removed', async () => {
  const d = dir(), clock = fakeTime();
  const h = createNetworkHandlers({ ToolError, dir: d, now: clock.now, sleep: async () => clock.advance(5000) });
  const r = await h.ask_agent({ ...ask, timeout_seconds: 10 });
  assert.equal(r.status, 'timeout'); assert.match(r.reason, /must be open/); assert.match(r.reason, /do not guess/);
  assert.deepEqual(readdirSync(join(d, 'requests')), []);
  assert.deepEqual((await h.poll_requests({})).requests, [], 'a late app finds nothing to answer');
  rmSync(d, { recursive: true });
});

test('bad questions are refused before anything is written; ids cannot walk out of the folder', async () => {
  const d = dir(), h = createNetworkHandlers({ ToolError, dir: d });
  for (const bad of [{ from: 'wat' }, { to: '../x' }, { trace: 'a b' }, { question: 'hi' }, { purpose: '' }, { classes: [] }, { classes: ['secret'] }]) await assert.rejects(() => h.ask_agent({ ...ask, ...bad }), ToolError, JSON.stringify(bad));
  assert.deepEqual(readdirSync(join(d, 'requests')), []);
  await assert.rejects(() => h.submit_response({ id: '../../etc/passwd', outcome: 'answer', reason: 'x' }), ToolError);
  await assert.rejects(() => h.submit_response({ id: 'q-12345', outcome: 'maybe', reason: 'x' }), ToolError);
  await assert.rejects(() => h.get_network_trace({ trace: '../x' }), ToolError);
  rmSync(d, { recursive: true });
});

test('old files are removed; the app takes a question once', async () => {
  const d = dir(), clock = fakeTime(), h = createNetworkHandlers({ ToolError, dir: d, now: clock.now, sleep: async () => clock.advance(60_000) });
  await h.ask_agent({ ...ask, timeout_seconds: 10 });
  const old = join(d, 'requests', 'q-old-0001.json'); writeFileSync(old, '{}'); const t = new Date(clock.now() - 3 * 86_400_000); utimesSync(old, t, t);
  writeFileSync(join(d, 'requests', 'q-new-0002.json'), JSON.stringify({ id: 'q-new-0002', trace: 't-abc123', from: 'a-wat', to: 'a-fin', purpose: 'Why not', question: 'A question?', classes: ['public'] }));
  const first = await h.poll_requests({}), second = await h.poll_requests({});
  assert.deepEqual(first.requests.map((r) => r.id), ['q-new-0002']);
  assert.deepEqual(second.requests, []);
  assert.ok(!readdirSync(join(d, 'requests')).includes('q-old-0001.json'));
  rmSync(d, { recursive: true });
});

test('over stdio: the server lists its six tools and answers list_network_agents from an empty mailbox', async () => {
  const d = dir();
  const child = spawn(process.execPath, [join(ROOT, 'connectors/agent-network/server/index.mjs')], { env: { ...process.env, AGENT_NETWORK_DIR: d }, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = []; let buf = '';
  child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_network_agents', arguments: {} } });
  for (let i = 0; i < 60 && lines.length < 3; i++) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  const byId = (n) => lines.find((l) => l.id === n);
  assert.equal(byId(2).result.tools.length, 6);
  assert.deepEqual(JSON.parse(byId(3).result.content[0].text).agents, []);
  assert.match(byId(1).result.instructions, /Never call sync_agents/);
  rmSync(d, { recursive: true });
});
