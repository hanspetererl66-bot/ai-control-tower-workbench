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
const L = new Function(`${code}\nreturn { stepNow, isMine, bucket, counts, progress, decideLocal, contractSteps, contractLine, eventLabel };`)();

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
  assert.deepEqual(L.counts(data.requests, HR), { mine: 1, progress: 1, decided: 4 });
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

test('notice events in the sample log are valid and every event has a label', () => {
  const labels = [...page.matchAll(/(\w+): '[A-Z][^']*'/g)].map((m) => m[1]);
  for (const r of data.requests) {
    assert.deepEqual([...r.events].sort((a, b) => a.at.localeCompare(b.at)).map((e) => e.event), r.events.map((e) => e.event), `${r.id}: log in time order`);
    for (const e of r.events) assert.ok(labels.includes(e.event), `${e.event} has a label`);
    assert.equal(r.events[0].event, 'requested');
    if (r.status === 'pending') assert.ok(!r.events.some((e) => e.event === 'informed'), 'nobody is told a result before it exists');
  }
});

test('contract: only approved requests have one, the state follows the log, and the page shows each state', () => {
  const withContract = data.requests.filter((r) => r.contract);
  assert.deepEqual(withContract.map((r) => r.contract.status).sort(), ['sent', 'signed'], 'the sample shows a signed and a waiting contract');
  for (const r of withContract) {
    const c = r.contract;
    assert.equal(r.status, 'approved', `${r.id}: a contract exists only after the last approval`);
    assert.ok(c.preparedAt >= r.decidedAt, `${r.id}: written after the last approval`);
    assert.match(c.bodySha256, /^[0-9a-f]{64}$/);
    const ev = r.events.filter((e) => e.event.startsWith('contract_') && e.event !== 'contract_informed').map((e) => e.event);
    assert.deepEqual(ev, { sent: ['contract_prepared', 'contract_sent'], signed: ['contract_prepared', 'contract_sent', 'contract_signed'] }[c.status], `${r.id}: the log says what the state says`);
    assert.equal(c.hasDocument, c.status === 'signed');
    assert.equal(!!c.signedSha256, c.status === 'signed');
    assert.equal(!!c.decidedAt, c.status === 'signed');
    assert.ok(!('body' in c) && !('signedDocument' in c), 'state only: no text and no document in the page');
  }
  const times = (r) => r.events.map((e) => e.at);
  for (const r of withContract) assert.deepEqual(times(r), [...times(r)].sort(), `${r.id}: the log is in time order`);
  const signed = byId(3), waiting = byId(6);
  assert.match(L.progress(signed), /Approved by all 4 steps · contract signed/);
  assert.match(L.progress(waiting), /Approved by all 3 steps · contract sent, waiting for the candidate/);
  assert.match(L.progress({ ...byId(3), contract: undefined }), /contract follows/);
  assert.deepEqual(L.contractSteps(signed.contract).map((x) => [x.label, x.state]), [['Written', 'approved'], ['Sent', 'approved'], ['Signed', 'approved']]);
  assert.deepEqual(L.contractSteps(waiting.contract).map((x) => [x.label, x.state]), [['Written', 'approved'], ['Sent', 'approved'], ['Waiting for the candidate', 'now']]);
  assert.deepEqual(L.contractSteps({ status: 'prepared', preparedAt: 'x' }).map((x) => x.state), ['approved', 'now']);
  assert.equal(L.contractSteps({ status: 'declined', sentAt: 'a', decidedAt: 'b' }).at(-1).state, 'declined');
  assert.equal(L.contractSteps({ status: 'expired', sentAt: 'a', decidedAt: 'b' }).at(-1).label, 'Expired unsigned');
  assert.equal(L.contractSteps(null).length, 0);
  for (const e of ['contract_prepared', 'contract_sent', 'contract_signed', 'contract_declined', 'contract_expired', 'contract_informed']) assert.doesNotMatch(L.eventLabel(e), /contract_/, `${e} has a readable label`);
  assert.match(page, /Simulation: no e-signature service was connected\. This is not a legal signature\./);
});
