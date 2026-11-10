import assert from 'node:assert/strict';
import test from 'node:test';
import { newAgent, buildCatalog, TEMPLATES, simulateRun } from '../src/agent-studio.ts';
import { fingerprint, starterCases, evaluate, runBench, simulationRunner, liveRunner, releaseCheck, addReport, sanitizeReports, loadReports, saveReports, INJECTION_TEXT, MAX_REPORTS_PER_AGENT } from '../src/agent-testbench.ts';

const catalog = buildCatalog(['jira', 'finance-preclose', 'sub4me'], [{ slug: 'finance-preclose', title: 'Finance Pre-Close' }, { slug: 'what-if', title: 'What-if Simulator' }]);
const agent = () => newAgent(TEMPLATES[0], catalog, 100);
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('fingerprint: changes with what decides the behaviour, not with the name or the time', () => {
  const a = agent();
  assert.equal(fingerprint(a), fingerprint({ ...a, name: 'Other name', testedAt: 5, tested: true }));
  for (const change of [{ instruction: a.instruction + ' more' }, { sources: [...a.sources, 'web'] }, { canWrite: !a.canWrite }, { maxSteps: a.maxSteps + 1 }]) assert.notEqual(fingerprint(a), fingerprint({ ...a, ...change }));
});

test('starter cases: one per allowed source, a forbidden source, the step limit, read-only and the live-only cases', () => {
  const a = agent(), cases = starterCases(a, catalog), kinds = cases.map((c) => c.kind);
  assert.equal(kinds.filter((k) => k === 'source').length, Math.min(4, a.sources.length));
  for (const k of ['forbidden-source', 'step-limit', 'no-write', 'missing-source', 'injection']) assert.ok(kinds.includes(k), k);
  assert.ok(cases.filter((c) => c.liveOnly).every((c) => ['no-write', 'missing-source', 'injection'].includes(c.kind)));
  assert.ok(!starterCases({ ...a, canWrite: true }, catalog).some((c) => c.kind === 'no-write'), 'an agent that may propose changes has no read-only case');
  assert.match(cases.find((c) => c.kind === 'injection').input, new RegExp(INJECTION_TEXT.slice(0, 30)));
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
});

test('evaluate: include, exclude, steps and sources are checked and named', () => {
  const c = { id: 'x', kind: 'custom', title: 't', input: '', expect: { include: ['Jira'], exclude: ['secret'], maxSteps: 3, touches: ['Jira'], avoids: ['Web search'] } };
  assert.deepEqual(evaluate(c, { text: 'Read Jira', steps: 3, touched: ['Jira'] }), { pass: true, notes: [] });
  const bad = evaluate(c, { text: 'the SECRET', steps: 5, touched: ['Web search'] });
  assert.equal(bad.pass, false); assert.equal(bad.notes.length, 5);
  assert.deepEqual(evaluate(c, { text: 'Jira' }), { pass: true, notes: [] }, 'what a live run cannot see is not judged');
});

test('bench simulation: every case runs three times, live-only cases are skipped, pass^3 counts only all-green cases', async () => {
  const a = agent(), report = await runBench(a, catalog, simulationRunner(a, catalog), 'simulation');
  assert.equal(report.attempts, 3);
  assert.ok(report.cases.some((c) => c.skipped));
  const ran = report.cases.filter((c) => !c.skipped);
  assert.ok(ran.every((c) => c.attempts.length === 3));
  assert.equal(report.ran, ran.length);
  assert.equal(report.passed, ran.filter((c) => c.pass).length);
  assert.equal(report.fingerprint, fingerprint(a));
  assert.ok(simulateRun(a, catalog).sources.length > 0, 'the template reads sample data');
});

test('bench: one flaky attempt fails the case, a thrown attempt counts as failed, a stop ends the run', async () => {
  const a = agent(), c = { id: 'flaky', kind: 'custom', title: 'flaky', input: '', expect: { include: ['ok'] } };
  let n = 0;
  const flaky = async () => ({ text: ++n === 2 ? 'nope' : 'ok' });
  const r = await runBench(a, catalog, flaky, 'live', { cases: [c] });
  assert.deepEqual([r.cases[0].attempts, r.cases[0].pass, r.passK], [[true, false, true], false, 0]);
  const boom = await runBench(a, catalog, async () => { throw new Error('model is down'); }, 'live', { cases: [c], attempts: 2 });
  assert.deepEqual(boom.cases[0].attempts, [false, false]); assert.match(boom.cases[0].notes[0], /model is down/);
  const stopped = await runBench(a, catalog, flaky, 'live', { cases: [c, { ...c, id: 'b' }], stop: () => true });
  assert.equal(stopped.cases.length, 0);
  const seen = []; await runBench(a, catalog, async () => ({ text: 'ok' }), 'live', { cases: [c, { ...c, id: 'b' }], attempts: 1, onProgress: (d, t) => seen.push([d, t]) });
  assert.deepEqual(seen, [[1, 2], [2, 2]]);
});

test('live runner: the brief and the test input go to the assistant, nothing else', async () => {
  const a = agent(); let sent = '';
  const out = await liveRunner(a, catalog, async (p) => { sent = p; return 'answer'; })({ id: 'x', kind: 'custom', title: 'T', input: 'Check this.', expect: {} }, 1);
  assert.equal(out.text, 'answer');
  assert.match(sent, new RegExp(`AGENT "${a.name}"`)); assert.match(sent, /attempt 2/); assert.match(sent, /change nothing, send nothing/); assert.match(sent, /Check this\./);
});

test('release check: no report, stale after a change, failed, passed', async () => {
  const a = agent();
  assert.equal(releaseCheck(a, []).state, 'none');
  const good = await runBench(a, catalog, async () => ({ text: 'ok' }), 'live', { cases: [{ id: 'g', kind: 'custom', title: 'g', input: '', expect: { include: ['ok'] } }] });
  assert.equal(releaseCheck(a, [good]).state, 'passed');
  assert.equal(releaseCheck({ ...a, instruction: a.instruction + '!' }, [good]).state, 'stale');
  const bad = await runBench(a, catalog, async () => ({ text: 'no' }), 'live', { cases: [{ id: 'g', kind: 'custom', title: 'g', input: '', expect: { include: ['ok'] } }] });
  assert.equal(releaseCheck(a, [bad]).state, 'failed');
  assert.equal(releaseCheck(a, [{ ...good, at: good.at - 5 }, { ...bad, at: good.at + 5 }]).state, 'failed', 'the newest report decides');
});

test('reports are kept per agent (last five) and survive storage', async () => {
  const a = agent(); let all = [];
  for (let i = 0; i < MAX_REPORTS_PER_AGENT + 2; i++) all = addReport(all, await runBench(a, catalog, async () => ({ text: 'ok' }), 'live', { cases: [{ id: 'g', kind: 'custom', title: 'g', input: '', expect: {} }], now: i }));
  assert.equal(all.length, MAX_REPORTS_PER_AGENT);
  assert.equal(all[0].at, MAX_REPORTS_PER_AGENT + 1);
  const st = mem(); saveReports(st, all);
  assert.deepEqual(loadReports(st).map((r) => r.at), all.map((r) => r.at));
  assert.deepEqual(sanitizeReports([{ agentId: 5 }, 'x', { agentId: 'a', fingerprint: 'f', cases: [{ pass: true, attempts: [true, 1] }] }]).map((r) => [r.ran, r.passed]), [[1, 1]]);
  assert.deepEqual(loadReports({ getItem: () => '{' }), []);
});
