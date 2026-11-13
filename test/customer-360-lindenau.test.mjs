import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embedExtraData, embedLogic } from '../scripts/sync-mockup-spaces.mjs';
import { makeLogic, customer360Documents } from '../connectors/_lib/server/customer-360.mjs';
import { askPrompt, handleCustomer360Message, DATASETS } from '../src/customer360-bridge.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const page = read('examples/customer-360/index.html');
const data = JSON.parse(read('examples/customer-360/data-lindenau.json'));
const L = makeLogic(data);
const sub = JSON.parse(/id="s4m-data">([\s\S]*?)<\/script>/.exec(read('examples/sub4me/index.html'))[1]);
const lind = sub.otherCustomers.find((c) => c.id === 'lindenau');
const sales = JSON.parse(read('examples/sales/pipeline.json'));
const mails = JSON.parse(read('examples/customer-emails/threads.json'));

test('Lindenau: the page embeds the current Lindenau data', () => {
  assert.equal(embedExtraData(page, 'data-lindenau', data), page, 'run: npm run sync:mockups');
  assert.equal(embedLogic(page, makeLogic.toString()), page, 'run: npm run sync:mockups');
});

test('Lindenau: ids are unique, references exist, every node has a document', () => {
  const ent = new Set(data.entities.map((e) => e.id));
  assert.ok(ent.has(data.group.id));
  for (const c of data.contracts) { assert.ok(ent.has(c.entity) && ent.has(c.billTo), c.id); }
  for (const i of data.invoices) assert.ok(ent.has(i.entity) && ent.has(i.billTo), i.id);
  for (const s of data.signals) assert.ok(data.contacts.some((c) => c.id === s.contact) && ent.has(s.entity), s.id);
  const ids = new Set(L.graph.nodes.map((n) => n.id));
  assert.equal(ids.size, L.graph.nodes.length);
  for (const e of L.graph.edges) assert.ok(ids.has(e.source) && ids.has(e.target), e.id);
  assert.deepEqual(customer360Documents(data).map((d) => d.id).sort(), [...ids].sort());
  assert.ok(L.graph.edges.some((e) => e.type === 'PAYS_FOR' && e.source === 'group:ld-ag' && e.target === 'entity:ld-ch'), 'the headquarters pays for the Swiss contract');
});

test('Lindenau: contracts, invoices and tickets match the Sub4Me sample data', () => {
  for (const c of data.contracts) {
    const s = lind.contracts.find((x) => x.id === c.id);
    assert.ok(s, c.id);
    assert.equal(c.annualEur, s.annualEur, `${c.id}: annual value`);
    assert.equal(c.end, s.end, `${c.id}: end`);
    assert.equal(c.noticeDays, s.noticeDays, `${c.id}: notice period`);
  }
  const invoices = lind.invoices.filter((i) => i.type === 'Invoice');
  assert.equal(data.invoices.length, invoices.length);
  for (const i of data.invoices) {
    const s = invoices.find((x) => x.id === i.id);
    assert.ok(s, i.id);
    assert.deepEqual([i.netEur, i.status, i.dueOn, i.paidOn], [s.netEur, s.status, s.due, s.paidOn], i.id);
  }
  for (const t of data.tickets) assert.ok(lind.tickets.some((x) => x.id === t.id), t.id);
  assert.equal(data.aiUnits.used, lind.aiUnits.monthly.reduce((a, b) => a + b, 0));
  assert.equal(data.aiUnits.allotment, lind.aiUnits.allotment);
});

test('Lindenau: deals are the Sales deals, with the Sub4Me size (Sales shows ten times)', () => {
  for (const o of data.opportunities) {
    const d = sales.deals.find((x) => x.id === o.id);
    assert.ok(d, `${o.id} is a Sales deal`);
    assert.equal(d.account, 'Lindenau Pharma AG');
    assert.equal(o.acvEur * 10, d.value, `${o.id}: Sales ACV is ten times`);
    if (d.stage === 'opportunity' || d.stage === 'sell') assert.equal(o.probability, d.score, `${o.id}: probability is the Sales score`);
    if (d.closeDate) assert.equal(o.closeDate, d.closeDate);
  }
});

test('Lindenau: the signals are the e-mail conversations of the E-mail Space', () => {
  const t = (id) => mails.threads.find((x) => x.id === id);
  const names = Object.fromEntries(data.contacts.map((c) => [c.id, c.name]));
  const pairs = [['S-01', 'T-201'], ['S-02', 'T-202'], ['S-03', 'T-202'], ['S-04', 'T-203'], ['S-05', 'T-204']];
  for (const [sid, tid] of pairs) {
    const s = data.signals.find((x) => x.id === sid);
    const hit = t(tid).messages.find((m) => m.name === names[s.contact] && m.at.slice(0, 10) === s.date);
    assert.ok(hit, `${sid} is a message of ${tid} on ${s.date}`);
  }
  const s5 = data.signals.find((x) => x.id === 'S-05');
  assert.doesNotMatch(s5.text, /qa-archive|ignore your instructions/i, 'the injected instruction is not copied into the documents');
});

test('Lindenau: the story is computed from the data and its dates add up', () => {
  const r = L.recommendations();
  assert.equal(r.length, 5);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3, 4, 5]);
  const first = r[0];
  assert.equal(first.id, 'R-1');
  assert.equal(first.dueDate, '2026-11-01');
  assert.equal(first.days, 13, 'notice date minus as-of date');
  assert.equal(first.atStakeEur, 180000 + 129000, 'AI units contract plus the top-up');
  const beats = L.beats();
  assert.equal(beats.length, 10);
  for (const b of beats) for (const id of b.expect) assert.ok(L.node(id), `${b.id}: ${id} exists`);
  for (const rec of r) for (const e of rec.evidence) assert.ok(L.node(e), `${rec.id}: evidence ${e}`);
  const pay = L.paymentOf('ld-ag');
  assert.equal(pay.overdue.length, 2);
  assert.equal(pay.oldestOverdueDays, 80);
  assert.equal(L.summary('ld-ag').level, 'high');
  assert.equal(L.summary('ld-ch').level, 'low');
  const ariba = L.o2c().find((g) => g.order === 'SO-91006');
  assert.equal(ariba.netEur, Math.round(127200 / 12 * 9), 'nine months at the old annual price');
});

test('bridge: the customer decides the Cognee dataset, an unknown customer is refused', async () => {
  assert.equal(DATASETS.lindenau, 'customer-360-lindenau');
  assert.match(askPrompt('Who approves?', 'lindenau'), /"customer-360-lindenau"/);
  assert.match(askPrompt('Who approves?'), /"customer-360"/, 'no customer means Nordlicht');
  let seen = '';
  const ask = async (prompt) => { seen = prompt; return '{"answer":"x","ids":["rec:R-1"]}'; };
  const ok = await handleCustomer360Message({ type: 'c360:ask-request', requestId: 'l1', question: 'Q', customer: 'lindenau' }, { ask });
  assert.equal(ok.type, 'c360:ask-answer');
  assert.match(seen, /customer-360-lindenau/);
  const bad = await handleCustomer360Message({ type: 'c360:ask-request', requestId: 'l2', question: 'Q', customer: 'evil' }, { ask });
  assert.equal(bad.type, 'c360:error');
});

test('Lindenau: figures per company add up like the summaries (the same card as for Nordlicht)', () => {
  const g = L.group();
  for (const m of L.metrics) {
    const f = L.figures(m.id);
    assert.equal(f.rows.length, data.entities.length);
    assert.ok(f.rows.every((r) => L.node(r.node)));
  }
  assert.equal(L.figures('overdue').total, g.summaries.reduce((a, s) => a + s.payment.overdueGross, 0));
  assert.equal(L.figures('tickets').total, g.summaries.reduce((a, s) => a + s.openTickets, 0));
});

test('Lindenau: the timeline has an event for every dated record and each one leads to a node', () => {
  const ev = L.events();
  assert.equal(ev.length, data.contracts.length + data.invoices.length + data.tickets.length + data.orders.length + data.signals.length + data.opportunities.length);
  for (const e of ev) assert.ok(e.node && L.node(e.node), `${e.id} -> ${e.node}`);
  assert.equal(L.timeline({ range: 'all' }).total, ev.length);
});
