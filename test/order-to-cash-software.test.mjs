import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embedMockupData } from '../scripts/sync-mockup-spaces.mjs';
import { MAX_ASK_LENGTH } from '../src/space-ask.ts';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/order-to-cash-software/index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/order-to-cash-software/data.json'), 'utf8'));

// The page logic sits between two markers, so the test runs the real code, not a copy.
const src = /\/\/ @logic-start([\s\S]*?)\/\/ @logic-end/.exec(page)[1];
const makeLogic = new Function(`${src}; return makeLogic;`)();
const L = makeLogic(data);

test('software order-to-cash page embeds the current sample data', () => {
  assert.equal(embedMockupData(page, data), page, 'run: npm run sync:mockups');
});

test('software order-to-cash sample data is internally consistent', () => {
  const docIds = new Set(data.docs.map((d) => d.id));
  assert.equal(docIds.size, data.docs.length, 'document ids are unique');
  const ids = data.tasks.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'step ids are unique');
  for (const t of data.tasks) for (const r of t.requires) assert.ok(ids.includes(r), `${t.id} needs unknown ${r}`);
  for (const f of data.findings) {
    for (const c of f.checks) if (c.kind === 'line') {
      assert.ok(docIds.has(c.doc), `${f.id} cites unknown document ${c.doc}`);
      assert.ok(c.line >= 1 && c.line <= L.doc(c.doc).lines.length, `${f.id} cites a line that does not exist`);
    }
  }
  // The software order has no delivery and no goods issue.
  assert.equal(data.systems.delivery, undefined);
  assert.doesNotMatch(JSON.stringify(data.tasks), /goods issue|delivery|billing block/i);
});

test('software order-to-cash amounts are computed and add up', () => {
  const A = L.amounts();
  assert.equal(A.monthly, 18900);
  assert.equal(A.yearly, 226800);
  assert.equal(A.subscription, 680400);
  assert.equal(A.total, 688400);
  assert.equal(A.exposure, 234800);
  assert.equal(A.overLimit, 34800);
  assert.equal(A.invoices, 3, 'one invoice per year of the term');
  assert.equal(A.activeMonths, 1);
  assert.equal(A.billed, 226800);
  assert.equal(A.recognised, 18900);
  assert.equal(A.deferred, 207900);
  assert.equal(A.recognised + A.deferred, A.billed, 'billed splits into recognised and deferred');
  assert.equal(A.monthly * A.months, A.subscription);
});

test('software order-to-cash months are counted from the start to the closing date', () => {
  assert.equal(L.monthsBetween('2026-12-01', '2026-12-31'), 1);
  assert.equal(L.monthsBetween('2026-12-01', '2027-02-28'), 3);
  assert.equal(L.monthsBetween('2026-12-01', '2026-11-30'), 0);
});

test('software order-to-cash findings are verified against their proof lines', () => {
  const fs = L.findings();
  assert.equal(fs.length, data.findings.length);
  for (const f of fs) assert.ok(f.verified, `${f.finding.id} is not verified`);
  assert.equal(fs.filter((f) => f.finding.inference).length, 1, 'exactly one finding is an inference');
});

test('software order-to-cash flags a finding whose evidence is missing', () => {
  const noEu = structuredClone(data);
  noEu.docs.find((d) => d.id === 'O1').lines[3] = 'Customer data may be hosted anywhere.';
  assert.equal(makeLogic(noEu).findings().find((x) => x.finding.id === 'F4').verified, false);
  const billTo = structuredClone(data);
  billTo.systems.salesOrder.billTo = billTo.systems.requestedBillTo;
  assert.equal(makeLogic(billTo).findings().find((x) => x.finding.id === 'F3').verified, false, 'a bill-to that is already right is not a finding');
  const credit = structuredClone(data);
  credit.systems.account.creditLimit = 500000;
  assert.equal(makeLogic(credit).findings().find((x) => x.finding.id === 'F5').verified, false);
});

test('software order-to-cash answers quote the computed numbers', () => {
  const A = L.amounts();
  const all = data.questions.map((q) => q.answer.join(' ')).join(' ');
  for (const v of [A.monthly, A.yearly, A.subscription, A.total, A.exposure, A.creditLimit, A.billed, A.recognised, A.deferred]) assert.ok(all.includes(L.money(v)), `answers should mention ${L.money(v)}`);
  assert.match(all, /eu-central/);
  for (const q of data.questions) {
    assert.ok(q.calls.length > 0 && q.answer.length > 0);
    for (const c of q.calls) JSON.parse(c.args);
    assert.ok(`Software order ${data.case.id} (${data.case.customer}, ${data.case.product}): ${q.q} Use the connected tools read-only and give the proof line for each statement.`.length <= MAX_ASK_LENGTH, 'ask prompt fits the limit');
  }
});

test('software order-to-cash: AI actors can release nothing', () => {
  for (const who of ['claude', 'joule']) {
    for (const t of data.tasks) {
      const r = L.release({}, t.id, who);
      assert.equal(r.ok, false);
      assert.equal(r.code, 'agent');
    }
  }
});

test('software order-to-cash: the two tracks start together and meet later', () => {
  const lv = L.waves();
  assert.equal(lv.T1, 1);
  assert.equal(lv.T4, 1, 'the commercial and the technical track both start at step 1');
  assert.deepEqual(L.ready({}).sort(), ['T1', 'T4']);
  assert.ok(lv.T6 > lv.T1 && lv.T6 > lv.T4, 'license activation waits for both tracks');
  assert.ok(lv.T7 > lv.T2 && lv.T7 > lv.T5 && lv.T7 > lv.T6, 'the reply waits for billing, access and licenses');
  const rel = {};
  L.applyRelease(rel, 'T4', 'mira');
  assert.deepEqual(L.ready(rel).sort(), ['T1', 'T5'], 'the technical track moves on while credit is open');
});

test('software order-to-cash: order, limits and the cross-track dependency are enforced', () => {
  const rel = {};
  assert.equal(L.release(rel, 'T6', 'mira').code, 'dependency', 'licenses wait for tenant and credit');
  assert.equal(L.applyRelease(rel, 'T4', 'mira').ok, true);
  assert.equal(L.release(rel, 'T6', 'tobias').code, 'dependency', 'the tenant alone is not enough');
  const credit = L.tasks().find((t) => t.id === 'T1');
  assert.ok(credit.amount > data.persons.mira.limits.credit);
  const r = L.release(rel, 'T1', 'mira');
  assert.equal(r.code, 'limit');
  assert.match(r.reason, /Tobias Krämer/);
  assert.equal(L.applyRelease(rel, 'T1', 'tobias').ok, true);
  const seats = L.release(rel, 'T6', 'mira');
  assert.equal(seats.code, 'limit', '500 licenses are above the clerk limit of 100');
  assert.equal(L.release(rel, 'T3', 'tobias').code, 'dependency', 'revenue schedule waits for the billing plan');
  assert.equal(L.applyRelease(rel, 'T2', 'mira').ok, true);
  assert.equal(L.release(rel, 'T3', 'mira').code, 'rights', 'a clerk may not create the revenue schedule');
  for (const [id, by] of [['T3', 'tobias'], ['T6', 'tobias'], ['T5', 'mira']]) assert.equal(L.applyRelease(rel, id, by).ok, true, id);
  assert.equal(L.release(rel, 'T7', 'mira').code, 'released');
  assert.equal(L.applyRelease(rel, 'T7', 'mira').ok, true);
  assert.equal(Object.keys(rel).length, data.tasks.length);
});

test('software order-to-cash: a tenant region outside the EU is blocked', () => {
  assert.equal(L.regionCheck().ok, true);
  const us = structuredClone(data);
  us.systems.tenant.planRegion = 'us-east';
  const r = makeLogic(us).release({}, 'T4', 'mira');
  assert.equal(r.code, 'region');
  const unknown = structuredClone(data);
  unknown.systems.tenant.planRegion = 'ap-south';
  assert.match(makeLogic(unknown).regionCheck().reason, /not allowed/);
});

test('software order-to-cash: the systems follow the released steps', () => {
  const none = L.records({});
  assert.deepEqual(none.map((r) => r.ok), [true, false, false, false, false, false, false]);
  const rel = {};
  for (const [id, by] of [['T4', 'mira'], ['T5', 'mira'], ['T1', 'tobias'], ['T2', 'mira']]) L.applyRelease(rel, id, by);
  const some = L.records(rel);
  assert.equal(some.find((r) => r.name === 'Tenant').note, 'region eu-central');
  assert.equal(some.find((r) => r.name === 'Billing plan').ok, true);
  assert.equal(some.find((r) => r.name === 'License entitlements').ok, false);
});

test('software order-to-cash: whoCan names only people', () => {
  assert.deepEqual(L.whoCan('credit', L.amounts().exposure), ['Tobias Krämer (Credit manager)']);
  assert.equal(L.whoCan('credit', 100).length, 2);
  assert.deepEqual(L.whoCan('revenue', 0), ['Tobias Krämer (Credit manager)']);
});

test('software order-to-cash: the scripted attempts end as intended', () => {
  assert.deepEqual(L.attempts().map((x) => x.code), ['agent', 'dependency', 'released', 'limit', 'released', 'limit', 'released']);
});

test('software order-to-cash is a static, sandbox-safe page', () => {
  assert.doesNotMatch(page, /\bfetch\(|XMLHttpRequest|localStorage|type="submit"/);
  assert.match(page, /wb:ask/);
  assert.match(page, /does not call an SAP system/);
  assert.match(page, /window\.parent !== window/);
});
