import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotToDocuments } from '../connectors/_lib/server/cognee-sap-corpus.mjs';
import { buildSapCorpus } from '../scripts/cognee-corpus.mjs';

const snapshot = {
  customers: [{ customer: '10100001', name: 'Domestic US Customer 1', country: 'US', latest_order: '2026-10-01T00:00:00.000Z', by_currency: { USD: { orders: 2, ordered: 1500, invoiced: 1000, open_to_invoice: 500 } }, needs_attention: [{ sales_order: '5', stage: 'delivered_not_fully_invoiced' }] }],
  traces: [{
    sales_order: '5', customer: '10100001',
    order: { type: 'OR', created: '2026-10-01T00:00:00.000Z', net_amount: '1000', currency: 'USD', delivery_status: 'complete', billing_status: 'not started' },
    items: { count: 1, first: [{ item: '10', material: 'TG11', quantity: '2' }] },
    deliveries: [{ delivery: '80000001', goods_issued: true, goods_issue_date: '2026-10-05T00:00:00.000Z' }],
    billings: [{ billing_document: '90000001', amount: '400', currency: 'USD', date: '2026-10-07T00:00:00.000Z', cancelled: false }],
    status: { stage: 'partly_invoiced', message: 'Invoiced 400 of 1000 USD.', gap_amount: 600, currency: 'USD' },
  }],
};

test('one document per customer, order, delivery, invoice and material, every line a sentence', () => {
  const docs = snapshotToDocuments(snapshot);
  assert.deepEqual(docs.map((d) => d.id).sort(), ['sap-customer:10100001', 'sap-delivery:80000001', 'sap-invoice:90000001', 'sap-material:TG11', 'sap-order:5']);
  for (const d of docs) assert.ok(d.text.split('\n').every((l) => /\.$/.test(l)), `${d.id}: every line is a sentence`);
});

test('the connections appear on both sides, with identifiers in brackets', () => {
  const by = Object.fromEntries(snapshotToDocuments(snapshot).map((d) => [d.id, d.text]));
  assert.match(by['sap-order:5'], /placed by Domestic US Customer 1 \(sap-customer:10100001\)/);
  assert.match(by['sap-customer:10100001'], /has order 5 \(sap-order:5\)/);
  assert.match(by['sap-customer:10100001'], /needs attention: delivered not fully invoiced/);
  assert.match(by['sap-order:5'], /has delivery 80000001 \(sap-delivery:80000001\)/);
  assert.match(by['sap-delivery:80000001'], /for sales order 5 \(sap-order:5\)/);
  assert.match(by['sap-invoice:90000001'], /amount is 400 USD/);
  assert.match(by['sap-order:5'], /600 USD is not yet invoiced/);
  assert.match(by['sap-material:TG11'], /part of sales order 5 \(sap-order:5\)/);
});

test('missing fields are left out, not written as "undefined" or "null"', () => {
  const text = snapshotToDocuments({ customers: [], traces: [{ sales_order: '7', order: {}, deliveries: [{ delivery: '8', goods_issued: false }], billings: [], items: { first: [] } }] }).map((d) => d.text).join('\n');
  assert.ok(!/undefined|null|NaN/.test(text));
  assert.match(text, /goods issue is not posted yet/);
});

test('without a snapshot there is no SAP corpus', () => {
  assert.equal(buildSapCorpus('/nonexistent/snapshot.json'), null);
});
