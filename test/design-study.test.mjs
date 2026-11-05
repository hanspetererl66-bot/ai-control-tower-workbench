import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embedMockupData } from '../scripts/sync-mockup-spaces.mjs';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/design-study/index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/design-study/data.json'), 'utf8'));
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const ids = (list) => list.map((x) => x.id);

test('design-study page embeds the current sample data', () => {
  assert.equal(embedMockupData(page, data), page, 'run: npm run sync:mockups');
});

test('design-study ids are unique and refer to each other', () => {
  for (const list of [data.tenants, data.agents, data.signals, data.runs, data.inbox, data.arena.cases]) {
    assert.equal(new Set(ids(list)).size, list.length);
  }
  const tenants = new Set(ids(data.tenants)), agents = new Set([...ids(data.agents), data.candidate.id]);
  for (const a of data.agents) assert.ok(tenants.has(a.tenant), `${a.id} has an unknown customer`);
  for (const s of data.signals) {
    assert.ok(tenants.has(s.tenant), `${s.id} has an unknown customer`);
    if (s.becomes) assert.ok(agents.has(s.becomes), `${s.id} becomes an unknown agent`);
    if (s.extends) assert.ok(agents.has(s.extends), `${s.id} extends an unknown agent`);
  }
  for (const r of data.runs) assert.ok(agents.has(r.agentId), `${r.id} belongs to an unknown agent`);
  for (const i of data.inbox) assert.ok(tenants.has(i.tenant) && agents.has(i.node), `${i.id} points at unknown things`);
  assert.ok(data.signals.some((s) => s.id === data.candidate.fromSignal));
});

test('design-study agent numbers add up', () => {
  for (const a of data.agents) {
    const runs = sum(a.weekly, (v) => v);
    assert.equal(a.ok + a.escalated + a.failed, runs, `${a.id}: outcomes must add up to the runs`);
    if (a.status === 'draft') assert.equal(runs, 0, `${a.id}: a draft has no runs`);
    assert.ok(['read', 'propose', 'act'].includes(a.autonomy));
  }
  for (const [id, budget] of Object.entries(data.budgets)) {
    const a = data.agents.find((x) => x.id === id);
    assert.ok(a && a.costEur <= budget, `${id} must stay inside its budget`);
  }
});

test('design-study radar: mentions equal the sum over sources, and the score ranks the list', () => {
  for (const s of data.signals) {
    assert.equal(sum(Object.values(s.sources), (v) => v), s.mentions, `${s.id}: sources must add up to the mentions`);
    assert.ok(s.people <= s.mentions);
    assert.ok(s.impact >= 1 && s.impact <= 5 && s.effort >= 1 && s.effort <= 5);
    assert.ok(s.evidence.length > 0);
    if (s.status === 'built') assert.ok(data.agents.some((a) => a.id === s.becomes && a.fromSignal === s.id), `${s.id}: the built agent must point back`);
  }
  const score = (s) => (s.mentions * s.impact) / s.effort;
  const top = [...data.signals].sort((a, b) => score(b) - score(a))[0];
  assert.equal(top.id, 's1', 'the built agent came from the strongest signal');
});

test('design-study runs: steps are ordered and the labels are the approval labels of the app', () => {
  for (const r of data.runs) {
    const t = r.steps.map((s) => s.t);
    assert.deepEqual(t, [...t].sort((a, b) => a - b), `${r.id}: steps must be in time order`);
    assert.equal(r.steps[0].kind, 'trigger');
    for (const s of r.steps) {
      assert.ok(['trigger', 'think', 'tool', 'approval', 'blocked', 'result', 'escalate'].includes(s.kind), `${r.id}: unknown kind ${s.kind}`);
      if (s.label) assert.ok(['read', 'changes', 'check'].includes(s.label));
      if (s.args) JSON.parse(s.args);
      if (s.kind === 'tool') assert.ok(s.label && s.system && s.ms > 0, `${r.id}: a tool step needs label, system and time`);
    }
  }
  const blocked = data.runs.find((r) => r.id === 'run-5120').steps.find((s) => s.kind === 'blocked');
  assert.equal(blocked.label, 'changes', 'the read-only profile blocks a call that changes something');
  assert.match(data.runs.find((r) => r.id === 'run-5120').profile, /read only/);
});

test('design-study arena: the failing safety case has a fix and the gates follow from the cases', () => {
  const cases = data.arena.cases;
  assert.ok(cases.every((c) => ['pass', 'warn', 'fail'].includes(c.verdict)));
  const failing = cases.filter((c) => c.verdict === 'fail');
  assert.equal(failing.length, 1);
  assert.equal(failing[0].group, 'Adversarial');
  assert.ok(failing[0].fix && failing[0].fix.text && failing[0].fix.actual);
  const pass = cases.filter((c) => c.verdict === 'pass').length, warn = cases.filter((c) => c.verdict === 'warn').length;
  const before = (pass + warn / 2) / cases.length, after = (pass + 1 + warn / 2) / cases.length;
  assert.ok(before < data.arena.thresholds.qualityGreen, 'before the fix the quality gate is not green');
  assert.ok(after >= data.arena.thresholds.qualityGreen, 'after the fix it is green');
  const avg = sum(cases, (c) => c.costMilliEur) / cases.length;
  assert.ok(avg <= data.candidate.budgetPerCaseMilliEur, 'the draft stays inside its cost budget');
  for (const t of data.candidate.tools) assert.ok(data.candidate.granted.includes(t), `${t} is not granted`);
});

test('design-study asks fit the Ask Joule limit and every function has one', async () => {
  const { MAX_ASK_LENGTH } = await import('../src/space-ask.ts');
  for (const k of ['value', 'replay', 'radar', 'arena', 'proactive']) {
    assert.ok(data.asks[k] && data.asks[k].length <= MAX_ASK_LENGTH, `${k} ask is missing or too long`);
  }
});

test('design-study stays a sandbox-safe single page with tokens for colour', () => {
  const code = page.replace(/<style id="design-system">[\s\S]*?<\/style>/, '');
  assert.doesNotMatch(code, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/);
  assert.doesNotMatch(code, /type="submit"|addEventListener\('submit'/);
  assert.doesNotMatch(code, /(?:color|background|fill|stroke|border[a-z-]*)\s*:\s*#[0-9a-fA-F]{3,8}/);
  assert.doesNotMatch(code, /(?:fill|stroke)="#/);
  assert.match(page, /prefers-reduced-motion/);
  assert.match(page, /wb:ask/);
});
