import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embedMockupData } from '../scripts/sync-mockup-spaces.mjs';
import { MAX_ASK_LENGTH } from '../src/space-ask.ts';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/order-to-cash/index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/order-to-cash/data.json'), 'utf8'));

// The page logic sits between two markers, so the test runs the real code, not a copy.
const src = /\/\/ @logic-start([\s\S]*?)\/\/ @logic-end/.exec(page)[1];
const makeLogic = new Function(`${src}; return makeLogic;`)();
const L = makeLogic(data);

test('order-to-cash page embeds the current sample data', () => {
  assert.equal(embedMockupData(page, data), page, 'run: npm run sync:mockups');
});

test('order-to-cash sample data is internally consistent', () => {
  const docIds = new Set(data.docs.map((d) => d.id));
  assert.equal(docIds.size, data.docs.length, 'document ids are unique');
  const pids = data.proposals.map((p) => p.id);
  assert.equal(new Set(pids).size, pids.length, 'proposal ids are unique');
  for (const p of data.proposals) for (const r of p.requires) assert.ok(pids.includes(r), `${p.id} needs unknown ${r}`);
  for (const f of data.findings) {
    for (const c of f.checks) if (c.kind === 'line') {
      assert.ok(docIds.has(c.doc), `${f.id} cites unknown document ${c.doc}`);
      assert.ok(c.line >= 1 && c.line <= L.doc(c.doc).lines.length, `${f.id} cites a line that does not exist`);
    }
  }
  // Every delivery item is either billed or blocked: the gap has exactly one reason.
  const billed = new Set(data.s4.billing.items.map((i) => i.deliveryItem));
  for (const i of data.s4.delivery.items) assert.ok(billed.has(i.item) || i.billingBlock, `delivery item ${i.item} is neither billed nor blocked`);
});

test('order-to-cash amounts are computed from the documents and add up', () => {
  const A = L.amounts();
  assert.equal(A.delivered, 200);
  assert.equal(A.billedQty, 160);
  assert.equal(A.gap, 40);
  assert.equal(A.credit, 1000);
  assert.equal(A.extra, 4750);
  assert.equal(A.net, 3750);
  assert.equal(A.corrected, 23750);
  assert.equal(A.invoiced + A.net, A.corrected, 'invoice plus net equals the corrected total');
  // Delivery note and sales order agree with the delivery in the system.
  assert.match(L.doc('D1').lines[3], /200 PC/);
  assert.equal(data.s4.salesOrder.items[0].qty, A.delivered);
});

test('order-to-cash findings are verified against their proof lines', () => {
  const fs = L.findings();
  assert.equal(fs.length, data.findings.length);
  for (const f of fs) assert.ok(f.verified, `${f.finding.id} is not verified`);
  assert.equal(fs.filter((f) => f.finding.inference).length, 1, 'exactly one finding is an inference');
});

test('order-to-cash flags a finding whose proof line is missing', () => {
  const broken = structuredClone(data);
  broken.docs.find((d) => d.id === 'C1').lines[2] = '3.1 Price HP-4400: 120.00 EUR per piece, net';
  const f = makeLogic(broken).findings().find((x) => x.finding.id === 'F4');
  assert.equal(f.verified, false);
  const moved = structuredClone(data);
  moved.s4.salesOrder.date = '2026-05-01';
  assert.equal(makeLogic(moved).findings().find((x) => x.finding.id === 'F5').verified, false, 'an order before the term does not verify');
});

test('order-to-cash answers quote the computed numbers', () => {
  const A = L.amounts();
  const all = data.questions.map((q) => q.answer.join(' ')).join(' ');
  for (const v of [A.credit, A.extra, A.net, A.corrected]) assert.ok(all.includes(L.money(v)), `answers should mention ${L.money(v)}`);
  assert.match(all, /500\.00/);
  for (const q of data.questions) {
    assert.ok(q.calls.length > 0 && q.answer.length > 0);
    for (const c of q.calls) JSON.parse(c.args);
    assert.ok(`Order-to-Cash case ${data.case.id} (${data.case.customer}): ${q.q} Use the connected S/4 tools read-only and give the proof line for each statement.`.length <= MAX_ASK_LENGTH, 'ask prompt fits the limit');
  }
});

test('order-to-cash: AI actors can release nothing', () => {
  for (const who of ['claude', 'joule']) {
    for (const p of data.proposals) {
      const r = L.release({}, p.id, who);
      assert.equal(r.ok, false);
      assert.equal(r.code, 'agent');
    }
  }
});

test('order-to-cash: order and limits are enforced', () => {
  const rel = {};
  assert.equal(L.release(rel, 'P2', 'lena').code, 'dependency', 'billing waits for the block release');
  assert.equal(L.applyRelease(rel, 'P1', 'lena').ok, true);
  assert.equal(L.release(rel, 'P1', 'lena').code, 'done', 'a proposal is released once');
  assert.equal(L.applyRelease(rel, 'P2', 'lena').ok, true, '4,750.00 is within the clerk limit of 10,000.00');
  const credit = L.proposals().find((p) => p.id === 'P3');
  assert.ok(credit.amount > data.persons.lena.limits.credit, 'the credit memo is above the clerk limit');
  const r = L.release(rel, 'P3', 'lena');
  assert.equal(r.code, 'limit');
  assert.match(r.reason, /Jonas Meier/);
  assert.equal(L.release(rel, 'P4', 'jonas').code, 'dependency', 'the reply waits for billing and credit');
  assert.equal(L.applyRelease(rel, 'P3', 'jonas').ok, true);
  assert.equal(L.applyRelease(rel, 'P4', 'lena').ok, true);
  assert.equal(Object.keys(rel).length, data.proposals.length);
});

test('order-to-cash: only the team lead can release the credit memo', () => {
  assert.deepEqual(L.whoCan('credit', L.amounts().credit), ['Jonas Meier (Team lead)']);
  assert.equal(L.whoCan('credit', 100).length, 2, 'a small credit memo is within both limits');
});

test('order-to-cash: the scripted attempts end as intended', () => {
  const a = L.attempts();
  assert.deepEqual(a.map((x) => x.code), ['agent', 'dependency', 'released', 'limit', 'released', 'dependency']);
});

test('order-to-cash is a static, sandbox-safe page', () => {
  assert.doesNotMatch(page, /\bfetch\(|XMLHttpRequest|localStorage|type="submit"/);
  assert.match(page, /wb:ask/);
  assert.match(page, /does not call an SAP system/);
  assert.match(page, /window\.parent !== window/);
});
