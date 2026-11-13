import assert from 'node:assert/strict';
import test from 'node:test';
import { shadowStart, shadowSummary, shadowVerdict, SHADOW_REASONS } from '../connectors/_lib/server/autonomy.mjs';
import { handleShadowMessage, pickDecisions } from '../src/shadow-bridge.ts';

const ME = 'hp@example.com';
const D = (o = {}) => ({ findingId: 'L-1', host: 'gw-01', kind: 'cert-expiry', template: 'renew-certificate', env: 'PRD', customer: 'mi', deadlineDays: 14, mode: 'auto', customerNeeded: false, floors: [], windowStart: '2026-11-17T21:00', windowEnd: '2026-11-17T22:00', why: 'Low risk, no floor.', ...o });
const RUN = { adapter: 'zabbix', fetchedAt: '2026-11-13T08:30', alerts: 7, skipped: 3, withheld: 1 };
const rpcOf = (calls, answer = {}) => async (name, args) => { calls.push([name, args]); return answer; };

test('shadowStart sends one run with its decisions to the database function, as the stored e-mail, with the number of findings counted from the decisions', async () => {
  const calls = [];
  const r = await shadowStart(rpcOf(calls, { runId: 5, decisions: { 'L-1': 11 } }), ME, RUN, [D()]);
  assert.deepEqual(r, { runId: 5, decisions: { 'L-1': 11 } });
  assert.equal(calls[0][0], 'autonomy_shadow_start');
  assert.equal(calls[0][1].p_actor, ME);
  assert.deepEqual(calls[0][1].p_run, { adapter: 'zabbix', fetchedAt: '2026-11-13T08:30', alerts: 7, findings: 1, skipped: 3, withheld: 1 });
  assert.deepEqual(calls[0][1].p_decisions, [D()]);
});

test('shadowStart refuses what the database would refuse: unknown kind, task, environment, mode, deadline, a double finding, an empty run, a missing time', async () => {
  const rpc = rpcOf([]);
  for (const bad of [D({ kind: 'weird' }), D({ template: 'drop-all' }), D({ env: 'LIVE' }), D({ mode: 'maybe' }), D({ deadlineDays: 0 }), D({ deadlineDays: 400 }), D({ findingId: 'bad id' }), D({ host: 'bad host' }), null]) await assert.rejects(shadowStart(rpc, ME, RUN, [bad]));
  await assert.rejects(shadowStart(rpc, ME, RUN, [D(), D()]), /each finding appears once/);
  await assert.rejects(shadowStart(rpc, ME, RUN, []), /1 to 100/);
  await assert.rejects(shadowStart(rpc, ME, RUN, Array.from({ length: 101 }, (_, i) => D({ findingId: 'L-' + i }))), /1 to 100/);
  await assert.rejects(shadowStart(rpc, ME, { ...RUN, fetchedAt: 'today' }, [D()]), /fetch time/);
  await assert.rejects(shadowStart(rpc, ME, null, [D()]), /run must be an object/);
});

test('shadowStart cleans the free text and the optional fields', async () => {
  const calls = [];
  await shadowStart(rpcOf(calls, {}), ME, RUN, [D({ why: 'a\nb\u0007' + 'x'.repeat(400), customer: 'BAD ID', windowStart: 'soon', floors: ['risk', '', 'x'.repeat(50), 'a', 'b', 'c', 'd'] })]);
  const d = calls[0][1].p_decisions[0];
  assert.ok(!/[\n\u0007]/.test(d.why) && d.why.length <= 300);
  assert.equal(d.customer, '');
  assert.equal(d.windowStart, '');
  assert.ok(d.floors.length <= 5 && d.floors.every((f) => f.length <= 20));
});

test('shadowVerdict: agree has no reason, disagree needs a known one, the note is cut; a changed mind is just another call', async () => {
  const calls = [];
  const rpc = rpcOf(calls, { verdictId: 1 });
  await shadowVerdict(rpc, ME, 11, 'agree', '', 'fine');
  assert.deepEqual(calls[0], ['autonomy_shadow_verdict', { p_actor: ME, p_decision: 11, p_verdict: 'agree', p_reason: null, p_note: 'fine' }]);
  await shadowVerdict(rpc, ME, 11, 'disagree', 'floor-missed', 'x'.repeat(500));
  assert.equal(calls[1][1].p_reason, 'floor-missed');
  assert.equal(calls[1][1].p_note.length, 300);
  await assert.rejects(shadowVerdict(rpc, ME, 11, 'agree', 'other'), /no reason/);
  await assert.rejects(shadowVerdict(rpc, ME, 11, 'disagree', ''), /known reason/);
  await assert.rejects(shadowVerdict(rpc, ME, 11, 'disagree', 'because'), /known reason/);
  await assert.rejects(shadowVerdict(rpc, ME, 0, 'agree'), /unknown decision/);
  await assert.rejects(shadowVerdict(rpc, ME, 11, 'maybe'), /agree or disagree/);
  assert.equal(calls.length, 2, 'nothing refused was sent');
  assert.deepEqual(SHADOW_REASONS, ['floor-missed', 'over-cautious', 'wrong-window', 'wrong-customer-rule', 'wrong-plan', 'other']);
});

test('shadowSummary asks for the numbers as the stored e-mail', async () => {
  const calls = [];
  assert.deepEqual(await shadowSummary(rpcOf(calls, { runs: 1 }), ME), { runs: 1 });
  assert.deepEqual(calls[0], ['autonomy_shadow_summary', { p_actor: ME }]);
});

/* ---- the bridge ---- */
const host = (over = {}) => { const calls = []; return { calls, start: async (run, d) => { calls.push(['start', run, d]); return { ok: true, data: { runId: 5, decisions: { 'L-1': 11, 'bad id': 3 }, secret: 'x' } }; },
  verdict: async (...a) => { calls.push(['verdict', ...a]); return { ok: true, data: {} }; }, summary: async () => ({ ok: true, data: { runs: 2, decisions: 9, auto: 4, judged: 6, agree: 5, disagree: 1, floorMissed: 1, byReason: { 'floor-missed': 1, evil: 9 }, extra: 1 } }), ...over }; };

test('bridge: only the three fixed requests are answered', async () => {
  assert.equal(await handleShadowMessage({ type: 'x' }, host()), null);
  assert.equal(await handleShadowMessage({ type: 'sh:summary-request', requestId: 'bad id!' }, host()), null);
  assert.equal((await handleShadowMessage({ type: 'sh:summary-request', requestId: 'r' }, undefined)).type, 'ct:error');
});

test('bridge: start passes the cut-down run and decisions, and answers with the ids of the decisions only', async () => {
  const h = host();
  const r = await handleShadowMessage({ type: 'sh:start-request', requestId: 'r', run: { ...RUN, login: 'x' }, decisions: [{ ...D(), secret: 'y' }, { findingId: 'bad id' }, 'x'] }, h);
  assert.deepEqual(h.calls[0][1], RUN);
  assert.deepEqual(h.calls[0][2], [D()]);
  assert.deepEqual(r, { type: 'sh:started', requestId: 'r', runId: 5, decisions: { 'L-1': 11 } });
  assert.match((await handleShadowMessage({ type: 'sh:start-request', requestId: 'r', run: RUN, decisions: [] }, h)).message, /at least one decision/);
  assert.deepEqual(pickDecisions('nope'), []);
});

test('bridge: a verdict needs a known decision, agree or disagree, and a reason for a disagreement; the answer repeats only that', async () => {
  const h = host();
  const ok = await handleShadowMessage({ type: 'sh:verdict-request', requestId: 'r', decisionId: 11, verdict: 'disagree', reason: 'floor-missed', note: 'n' }, h);
  assert.deepEqual(ok, { type: 'sh:verdict', requestId: 'r', decisionId: 11, verdict: 'disagree', reason: 'floor-missed' });
  assert.deepEqual(h.calls.at(-1), ['verdict', 11, 'disagree', 'floor-missed', 'n']);
  assert.deepEqual(await handleShadowMessage({ type: 'sh:verdict-request', requestId: 'r', decisionId: 12, verdict: 'agree', reason: 'ignored' }, h), { type: 'sh:verdict', requestId: 'r', decisionId: 12, verdict: 'agree', reason: '' });
  for (const bad of [{ decisionId: 0, verdict: 'agree' }, { decisionId: '11', verdict: 'agree' }, { decisionId: 11, verdict: 'maybe' }, { decisionId: 11, verdict: 'disagree' }, { decisionId: 11, verdict: 'disagree', reason: 'because' }]) {
    assert.equal((await handleShadowMessage({ type: 'sh:verdict-request', requestId: 'r', ...bad }, h)).type, 'ct:error', JSON.stringify(bad));
  }
});

test('bridge: the summary is cut down to the known numbers and reasons; a failing host becomes an error message', async () => {
  const r = await handleShadowMessage({ type: 'sh:summary-request', requestId: 'r' }, host());
  assert.deepEqual(r.summary, { runs: 2, decisions: 9, auto: 4, judged: 6, agree: 5, disagree: 1, floorMissed: 1, byReason: { 'floor-missed': 1 } });
  const fail = host({ summary: async () => ({ ok: false, error: 'The database is not connected.' }) });
  assert.equal((await handleShadowMessage({ type: 'sh:summary-request', requestId: 'r' }, fail)).message, 'The database is not connected.');
  const boom = host({ start: async () => { throw new Error('boom'); } });
  assert.equal((await handleShadowMessage({ type: 'sh:start-request', requestId: 'r', run: RUN, decisions: [D()] }, boom)).message, 'boom');
});
