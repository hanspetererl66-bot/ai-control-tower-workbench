import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeLogic } from '../connectors/_lib/server/customer-360.mjs';
import { mergeSandbox, removeSandbox, sandboxCustomers } from '../connectors/_lib/server/customer-360-sandbox.mjs';
import { parseArgs } from '../scripts/customer-360-sandbox.mjs';

const data = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'examples/customer-360/data.json'), 'utf8'));
const trace = (so, customer, over = {}) => ({
  sales_order: so, customer,
  order: { type: 'OR', created: '2026-09-15T00:00:00', net_amount: 1000, currency: 'EUR', delivery_status: 'C', billing_status: 'A' },
  status: { stage: 'delivered_not_invoiced', message: 'x', billed: 0, gap_amount: 1000, currency: 'EUR' },
  items: { count: 2, first: [{ item: '10', material: 'TG11', quantity: '5' }] },
  deliveries: [{ delivery: '80001', goods_issued: true }], billings: [], ...over,
});
const snapshot = {
  customers: [{ customer: '1010', name: 'Some SAP Customer' }],
  traces: [
    trace('5', '1010'),
    trace('6', '1010', { status: { stage: 'invoiced', gap_amount: 0, currency: 'EUR' }, billings: [{ billing_document: '9001', amount: 1000 }, { billing_document: '9002', cancelled: true }] }),
    trace('7', '1010', { order: { net_amount: 500, currency: 'USD', created: '2026-10-01' } }),
    trace('8', '2020'),
  ],
};

test('sandboxCustomers lists the customers with their stages', () => {
  const rows = sandboxCustomers(snapshot);
  assert.equal(rows[0].customer, '1010');
  assert.equal(rows[0].orders, 3);
  assert.equal(rows[0].name, 'Some SAP Customer');
  assert.deepEqual(rows[0].stages, { delivered_not_invoiced: 2, invoiced: 1 });
});

test('mergeSandbox adds only the chosen customer, marks the source and leaves the input alone', () => {
  const before = JSON.stringify(data);
  const { data: next, orders, skipped } = mergeSandbox(data, snapshot, { customer: '1010' });
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(orders.map((o) => o.id), ['SO-5', 'SO-6']);
  assert.deepEqual(skipped.map((s) => s.order), ['7'], 'a foreign currency needs a demo rate');
  for (const o of orders) { assert.equal(o.source, 'sap-sandbox'); assert.equal(o.entity, 'nl-ma'); assert.ok(data.contracts.some((c) => c.id === o.contract)); }
  assert.match(orders[1].note, /invoice 9001/);
  assert.doesNotMatch(orders[1].note, /9002/, 'a cancelled invoice is not listed');
  assert.equal(next.orders.length, data.orders.length + 2);
});

test('a demo rate converts, and running again replaces instead of adding twice', () => {
  const one = mergeSandbox(data, snapshot, { customer: '1010', rates: { USD: 0.9 } });
  assert.equal(one.orders.find((o) => o.id === 'SO-7').netEur, 450);
  const two = mergeSandbox(one.data, snapshot, { customer: '1010', rates: { USD: 0.9 } });
  assert.equal(two.data.orders.length, one.data.orders.length);
  assert.deepEqual(removeSandbox(two.data).orders, data.orders);
});

test('mergeSandbox refuses what it cannot place', () => {
  assert.throws(() => mergeSandbox(data, snapshot, {}), /Name the sandbox customer/);
  assert.throws(() => mergeSandbox(data, snapshot, { customer: '9999' }), /no traced order/);
  assert.throws(() => mergeSandbox(data, snapshot, { customer: '1010', entity: 'nl-x' }), /Unknown company/);
  const clash = { ...snapshot, traces: [trace('81021', '1010')] };
  assert.equal(mergeSandbox(data, clash, { customer: '1010' }).skipped[0].order, '81021');
});

test('the graph shows merged orders as Nordlicht nodes with their source, and the gap counts', () => {
  const { data: next } = mergeSandbox(data, snapshot, { customer: '1010' });
  const L = makeLogic(next);
  const o = L.node('order:SO-5');
  assert.ok(o, 'order node exists');
  assert.ok(o.facts.some((f) => f[0] === 'Source' && /SAP sandbox, order 5/.test(f[1])));
  assert.ok(L.node('order:SO-81021').facts.some((f) => f[0] === 'Source' && f[1] === 'sample data'));
  assert.ok(L.graph.edges.some((e) => e.type === 'ORDERED' && e.target === 'order:SO-5' && e.source === 'entity:nl-ma'));
  assert.ok(L.o2c().some((g) => g.order === 'SO-5' && g.kind === 'delivered-not-invoiced' && g.netEur === 1000));
  assert.ok(!L.o2c().some((g) => g.order === 'SO-6'), 'a fully invoiced order is no gap');
  const doc = L.doc('order:SO-5').text;
  assert.match(doc, /source is SAP sandbox/i);
  assert.match(doc, /\(order:SO-5\)/);
  assert.ok(L.retrieve('Which orders were delivered but not invoiced?').ids.includes('order:SO-5'));
});

test('command line options are checked', () => {
  assert.deepEqual(parseArgs(['--customer', '1', '--rate', 'USD=0.92']).rates, { USD: 0.92 });
  assert.throws(() => parseArgs(['--rate', 'dollar']), /USD=0.92/);
  assert.throws(() => parseArgs(['--limit', '99']), /1 to 12/);
  assert.throws(() => parseArgs(['--what']), /Unknown option/);
});
