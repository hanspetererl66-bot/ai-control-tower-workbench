import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embedMockupData } from '../scripts/sync-mockup-spaces.mjs';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/hiring-approvals/index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/hiring-approvals/data.json'), 'utf8'));
const space = JSON.parse(readFileSync(join(ROOT, 'examples/hiring-approvals/space.json'), 'utf8'));
const code = page.match(/\/\/ @logic-start\n([\s\S]*?)\n\s*\/\/ @logic-end/)[1];
const L = new Function(`${code}\nreturn { stepNow, isMine, bucket, counts, progress, decideLocal };`)();

const HR = 'hr.lead@hanse.example';
const byId = (id) => structuredClone(data.requests.find((r) => r.id === id));

test('page embeds the current sample data and has a space.json', () => {
  assert.equal(embedMockupData(page, data), page, 'run: npm run sync:mockups');
  assert.equal(space.title, 'Hiring Approvals');
});

test('sample data: chains are consistent with status and current step', () => {
  for (const r of data.requests) {
    assert.match(r.candidate, /^C-\d+$/);
    assert.equal(new Set(r.steps.map((s) => s.approver.toLowerCase())).size, r.steps.length, `${r.id}: nobody holds two steps`);
    assert.deepEqual(r.steps.map((s) => s.ord), r.steps.map((_, i) => i + 1));
    assert.ok(['hiring_manager', 'hr', 'finance'].every((role, i) => r.steps[i].role === role), `${r.id}: order`);
    const decided = r.steps.filter((s) => s.status !== 'waiting');
    if (r.status === 'approved') assert.ok(r.steps.every((s) => s.status === 'approved'));
    if (r.status === 'pending') assert.equal(decided.length, r.currentStep - 1, `${r.id}: steps before the current one are decided`);
    if (r.status === 'returned' || r.status === 'declined') assert.ok(r.steps.find((s) => s.ord === r.currentStep).note, `${r.id}: a reason`);
    assert.ok(!JSON.stringify(r).match(/salary|€|EUR|\d{2,3}[.,]\d{3}/i), `${r.id}: no amounts`);
  }
  assert.ok(data.viewers.some((v) => v.email === data.defaultViewer));
});

test('buckets and counts follow whose turn it is', () => {
  assert.equal(L.bucket(byId(1), HR), 'mine');
  assert.equal(L.bucket(byId(2), HR), 'progress');
  assert.equal(L.bucket(byId(3), HR), 'decided');
  assert.deepEqual(L.counts(data.requests, HR), { mine: 1, progress: 1, decided: 3 });
  assert.match(L.progress(byId(2)), /Step 3 of 3 · waiting for Finance/);
});

test('approve passes on, the last approval is final', () => {
  const a = L.decideLocal(byId(1), HR, 'approve', '', '2026-11-07T10:00');
  assert.ok(a.ok && !a.final);
  assert.equal(a.request.currentStep, 3);
  assert.equal(a.request.events.at(-1).event, 'approved');
  const last = L.decideLocal(byId(2), 'finance.bp@hanse.example', 'approve', '', '2026-11-07T10:00');
  assert.ok(last.ok && last.final);
  assert.equal(last.request.status, 'approved');
});

test('return and decline need a reason and end the request', () => {
  assert.match(L.decideLocal(byId(1), HR, 'return', '  ', 'x').error, /reason/);
  const r = L.decideLocal(byId(1), HR, 'return', 'Check the band', '2026-11-07T10:00');
  assert.equal(r.request.status, 'returned');
  assert.ok(r.final);
  assert.equal(L.decideLocal(r.request, HR, 'approve', '', 'x').error, 'This request is already decided.');
});

test('only the approver whose turn it is can decide; the input is not changed', () => {
  const r = byId(1);
  const before = JSON.stringify(r);
  assert.match(L.decideLocal(r, 'finance.bp@hanse.example', 'approve', '', 'x').error, /not your turn/);
  assert.match(L.decideLocal(r, HR, 'release', '', 'x').error, /Unknown/);
  L.decideLocal(r, HR, 'approve', '', 'x');
  assert.equal(JSON.stringify(r), before);
});

test('the page keeps the Space rules: no network, no storage, tokens only, only the three bridge messages', () => {
  const own = page.replace(/<style id="design-system">[\s\S]*?<\/style>/, '');
  assert.ok(!/localStorage|sessionStorage|fetch\(|XMLHttpRequest|https?:\/\//.test(own.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '')));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(own.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '')), 'colours only as tokens');
  const types = [...own.matchAll(/type: '(ha:[a-z-]+|wb:ask)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(types)], ['ha:decide-request', 'ha:list-request', 'ha:open-tools', 'wb:ask']);
});
