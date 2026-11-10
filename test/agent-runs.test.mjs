import assert from 'node:assert/strict';
import test from 'node:test';
import { newTrace, newRunId, startRun, finishRun, closeOpenRuns, isStopped, stopAgent, resumeAgent, statsOf, traceRuns, sanitizeRuns, sanitizeStops, loadRuns, saveRuns, loadStops, saveStops, MAX_RUNS } from '../src/agent-runs.ts';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const base = (over = {}) => ({ id: 't-abc123.0', agentId: 'a-wat', version: 'v1', at: 1000, trigger: 'manual', trace: 't-abc123', hops: 0, ...over });

test('runs: started, finished once, kept at most MAX_RUNS, open runs close when the app restarts', () => {
  let runs = startRun([], base());
  assert.equal(runs[0].status, 'running');
  runs = finishRun(runs, 't-abc123.0', 'ok', '  done   well ', 4000);
  assert.deepEqual([runs[0].status, runs[0].ms, runs[0].note], ['ok', 3000, 'done well']);
  const again = finishRun(runs, 't-abc123.0', 'error', 'changed', 9000);
  assert.equal(again[0].status, 'ok', 'an ended run is never changed');
  let many = []; for (let i = 0; i < MAX_RUNS + 20; i++) many = startRun(many, base({ id: 'r' + i }));
  assert.equal(many.length, MAX_RUNS);
  const open = closeOpenRuns(startRun([], base()), 5000);
  assert.deepEqual([open[0].status, open[0].ms], ['error', 4000]);
  assert.match(newTrace(() => 0.5, 1), /^t-1-/);
  assert.equal(newRunId('t-abc123', 2), 't-abc123.2');
});

test('stop switch: stop, ask, resume; the reason is kept short', () => {
  let s = stopAgent({}, 'a-fin', 'Wrong numbers since version 3', 5);
  assert.ok(isStopped(s, 'a-fin')); assert.equal(isStopped(s, 'a-wat'), false);
  assert.equal(stopAgent({}, 'a-x', '', 1)['a-x'].reason, 'Stopped by the owner.');
  s = resumeAgent(s, 'a-fin'); assert.equal(isStopped(s, 'a-fin'), false);
  assert.deepEqual(sanitizeStops({ 'a-ok': { at: 1, reason: 'x' }, '../bad': { at: 1 }, 'a-fin': 5 }), { 'a-ok': { at: 1, reason: 'x' }, 'a-fin': { at: 0, reason: '' } });
});

test('stats and traces: the last seven days of one agent, one chain of questions in order', () => {
  const day = 86_400_000, now = 10 * day;
  let runs = [];
  for (const [i, st, ms, ago] of [[1, 'ok', 2000, 1], [2, 'ok', 4000, 2], [3, 'error', 1000, 3], [4, 'refused', 0, 4], [5, 'ok', 1000, 9]]) runs = finishRun(startRun(runs, base({ id: 'r' + i, at: now - ago * day, trace: 't-chain' + i })), 'r' + i, st, '', now - ago * day + ms);
  const s = statsOf(runs, 'a-wat', 7, now);
  assert.deepEqual([s.runs, s.ok, s.failed, s.refused, s.avgMs], [4, 2, 1, 1, 2333]);
  assert.equal(s.last.id, 'r1');
  let chain = startRun([], base({ id: 'c.0', at: 10, trace: 't-same1', hops: 0 }));
  chain = startRun(chain, base({ id: 'c.1', agentId: 'a-fin', at: 20, trace: 't-same1', hops: 1, parent: 'c.0', trigger: 'network' }));
  chain = startRun(chain, base({ id: 'x.0', at: 15, trace: 't-other1' }));
  assert.deepEqual(traceRuns(chain, 't-same1').map((r) => r.id), ['c.0', 'c.1']);
});

test('storage: rubbish is dropped, shapes are checked, saved runs come back and open ones are closed', () => {
  assert.deepEqual(sanitizeRuns('x'), []);
  assert.deepEqual(sanitizeRuns([{ id: 'a' }, { id: 'a', agentId: 'a-x', trace: 'bad trace!' }, base({ trigger: 'weird', status: 'weird', hops: 99 })]).map((r) => [r.trigger, r.status, r.hops]), [['manual', 'error', 20]]);
  const st = mem(); saveRuns(st, startRun([], base())); assert.equal(loadRuns(st)[0].status, 'error', 'a run that was open when the app closed did not end properly');
  saveStops(st, stopAgent({}, 'a-fin', 'x', 1)); assert.ok(isStopped(loadStops(st), 'a-fin'));
  assert.deepEqual(loadRuns({ getItem: () => 'not json' }), []);
});
