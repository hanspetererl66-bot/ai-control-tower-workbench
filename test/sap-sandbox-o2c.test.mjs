import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, flagStage, summarizeCustomer } from '../connectors/sap-sandbox/server/o2c.mjs';
import { createSandboxHandlers } from '../connectors/sap-sandbox/server/sandbox.mjs';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const order = { SalesOrder: '5', SoldToParty: '10100001', CreationDate: '2026-10-01T00:00:00.000Z', TotalNetAmount: '1000.00', TransactionCurrency: 'EUR' };

test('classify walks the chain: blocked, not delivered, goods issue open, not invoiced, partly, invoiced', () => {
  assert.equal(classify({ order: { ...order, DeliveryBlockReason: '01' } }, NOW).stage, 'delivery_blocked');
  assert.equal(classify({ order }, NOW).stage, 'not_delivered');
  assert.equal(classify({ order: { ...order, OverallDeliveryStatus: 'C' } }, NOW).stage, 'delivered_no_document_found');
  assert.equal(classify({ order, deliveries: [{ delivery: '8', goods_issued: false }] }, NOW).stage, 'goods_issue_open');
  const stuck = classify({ order, deliveries: [{ delivery: '8', goods_issued: true, goods_issue_date: '2026-10-20T00:00:00.000Z' }] }, NOW);
  assert.deepEqual([stuck.stage, stuck.severity, stuck.gap_amount, stuck.days_open], ['delivered_not_invoiced', 'stuck', 1000, 15]);
  const del = [{ delivery: '8', goods_issued: true, goods_issue_date: '2026-10-20T00:00:00.000Z' }];
  const partly = classify({ order, deliveries: del, billings: [{ billing_document: '9', amount: '400', cancelled: false }] }, NOW);
  assert.deepEqual([partly.stage, partly.gap_amount], ['partly_invoiced', 600]);
  assert.equal(classify({ order, deliveries: del, billings: [{ billing_document: '9', amount: '1000', cancelled: false }] }, NOW).stage, 'invoiced');
});

test('a cancelled invoice does not count as billed', () => {
  const del = [{ delivery: '8', goods_issued: true, goods_issue_date: '2026-10-20T00:00:00.000Z' }];
  const r = classify({ order, deliveries: del, billings: [{ billing_document: '9', amount: '1000', cancelled: true }] }, NOW);
  assert.equal(r.stage, 'delivered_not_invoiced');
});

test('flagStage reads the header flags only', () => {
  assert.equal(flagStage({ ...order, OverallDeliveryStatus: 'C', OverallOrdReltdBillgStatus: 'A' }).attention, true);
  assert.equal(flagStage({ ...order, OverallDeliveryStatus: 'C', OverallOrdReltdBillgStatus: 'C' }).stage, 'invoiced');
  assert.equal(flagStage({ ...order, OverallDeliveryStatus: 'B' }).stage, 'partly_delivered');
  assert.equal(flagStage({ ...order }).stage, 'not_delivered');
  assert.equal(flagStage({ ...order, DeliveryBlockReason: '01' }).attention, true);
  assert.equal(flagStage({ ...order, OverallDeliveryStatus: 'C', OverallOrdReltdBillgStatus: 'A' }).billing_status, 'not started');
});

test('customer summary groups by currency, skips cancelled invoices and says payment behaviour is not read', () => {
  const s = summarizeCustomer({
    partner: { BusinessPartner: '10100001', BusinessPartnerFullName: 'Domestic US Customer 1' },
    orders: [{ ...order, OverallOrdReltdBillgStatus: 'C' }, { ...order, SalesOrder: '6', TotalNetAmount: '500', OverallDeliveryStatus: 'C', OverallOrdReltdBillgStatus: 'A' }],
    billings: [{ TotalNetAmount: '1000', TransactionCurrency: 'EUR' }, { TotalNetAmount: '999', TransactionCurrency: 'EUR', BillingDocumentIsCancelled: true }],
  });
  assert.equal(s.name, 'Domestic US Customer 1');
  assert.deepEqual(s.by_currency.EUR, { orders: 2, ordered: 1500, invoiced: 1000, open_to_invoice: 500 });
  assert.equal(s.needs_attention.length, 1);
  assert.match(s.payment_behaviour, /^not read/);
});

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const env = { SAP_API_KEY: 'k' };
const d = (results) => json({ d: { results } });

test('order to cash finds the delivery and the missing invoice', async () => {
  const urls = [];
  const h = createSandboxHandlers({ env, fetchImpl: async (url) => {
    urls.push(decodeURIComponent(url));
    const u = decodeURIComponent(url);
    if (u.includes("/A_SalesOrder('5')")) return json({ d: { SalesOrder: '5', SoldToParty: '10100001', TotalNetAmount: '1000', TransactionCurrency: 'EUR', OverallDeliveryStatus: 'C', OverallOrdReltdBillgStatus: 'A', CreationDate: '/Date(1790000000000)/' } });
    if (u.includes('/A_SalesOrderItem?')) return d([{ SalesOrderItem: '10', Material: 'TG11', RequestedQuantity: '2', NetAmount: '1000' }]);
    if (u.includes('/A_OutbDeliveryItem?')) return d([{ DeliveryDocument: '80000001', ReferenceSDDocument: '5' }]);
    if (u.includes('/A_OutbDeliveryHeader?')) return d([{ DeliveryDocument: '80000001', OverallGoodsMovementStatus: 'C', ActualGoodsMovementDate: '/Date(1790100000000)/' }]);
    if (u.includes('/A_BillingDocumentItem?')) return d([]);
    throw new Error(`unexpected ${u}`);
  } });
  const r = await h.sap_sandbox_order_to_cash({ sales_order: '5' });
  assert.equal(r.status.stage, 'delivered_not_invoiced');
  assert.equal(r.status.gap_amount, 1000);
  assert.deepEqual(r.deliveries.map((x) => [x.delivery, x.goods_issued]), [['80000001', true]]);
  assert.equal(r.billings.length, 0);
  assert.equal(r.items.first[0].material, 'TG11');
  assert.ok(urls.some((u) => u.includes("ReferenceSDDocument eq '5' or ReferenceSDDocument eq '80000001'")));
  assert.deepEqual(r.notes, []);
});

test('order to cash keeps going when a step is not offered and reports it in notes', async () => {
  const h = createSandboxHandlers({ env, fetchImpl: async (url) => {
    const u = decodeURIComponent(url);
    if (u.includes("/A_SalesOrder('5')")) return json({ d: { SalesOrder: '5', TotalNetAmount: '100', TransactionCurrency: 'EUR' } });
    if (u.includes('/A_SalesOrderItem?')) return d([]);
    return json({}, 404);
  } });
  const r = await h.sap_sandbox_order_to_cash({ sales_order: '5' });
  assert.equal(r.status.stage, 'not_delivered');
  assert.ok(r.notes.some((n) => n.startsWith('deliveries:')));
});

test('a key problem or a wrong order number stops order to cash instead of becoming a note', async () => {
  const bad = createSandboxHandlers({ env, fetchImpl: async () => json({}, 401) });
  await assert.rejects(bad.sap_sandbox_order_to_cash({ sales_order: '5' }), /API key/);
  const calls = [];
  const h = createSandboxHandlers({ env, fetchImpl: async (url) => { calls.push(url); return json({}, 404); } });
  await assert.rejects(h.sap_sandbox_order_to_cash({ sales_order: '5' }), /did not find that/);
  await assert.rejects(h.sap_sandbox_order_to_cash({ sales_order: "5' or '1'='1" }), /letters and digits/);
  assert.equal(calls.length, 1);
});

test('scan filters by customer and can return only the orders that need attention', async () => {
  const calls = [];
  const h = createSandboxHandlers({ env, fetchImpl: async (url) => { calls.push(decodeURIComponent(url)); return d([
    { SalesOrder: '1', OverallDeliveryStatus: 'C', OverallOrdReltdBillgStatus: 'A', TotalNetAmount: '10', TransactionCurrency: 'EUR' },
    { SalesOrder: '2', OverallDeliveryStatus: 'C', OverallOrdReltdBillgStatus: 'C', TotalNetAmount: '20', TransactionCurrency: 'EUR' },
  ]); } });
  const r = await h.sap_sandbox_o2c_scan({ customer: '10100001', only_attention: true, top: 10 });
  assert.equal(r.read, 2); assert.equal(r.attention, 1); assert.deepEqual(r.orders.map((o) => o.sales_order), ['1']);
  assert.ok(calls[0].includes("SoldToParty eq '10100001'") && calls[0].includes('$orderby=CreationDate desc') && calls[0].includes('$top=10'));
});

test('customer 360 combines partner, orders and invoices and survives a missing API', async () => {
  const h = createSandboxHandlers({ env, fetchImpl: async (url) => {
    const u = decodeURIComponent(url);
    if (u.includes("/A_BusinessPartner('10100001')")) return json({ d: { BusinessPartner: '10100001', BusinessPartnerFullName: 'Domestic US Customer 1' } });
    if (u.includes("/A_Customer('10100001')")) return json({}, 404);
    if (u.includes('/A_SalesOrder?')) return d([{ SalesOrder: '1', TotalNetAmount: '10', TransactionCurrency: 'USD', OverallDeliveryStatus: 'C', OverallOrdReltdBillgStatus: 'A', CreationDate: '2026-10-01T00:00:00.000Z' }]);
    if (u.includes('/A_BillingDocument?')) return d([{ BillingDocument: '9', TotalNetAmount: '10', TransactionCurrency: 'USD' }]);
    throw new Error(`unexpected ${u}`);
  } });
  const r = await h.sap_sandbox_customer_360({ customer: '10100001' });
  assert.equal(r.found, true); assert.equal(r.name, 'Domestic US Customer 1');
  assert.equal(r.by_currency.USD.invoiced, 10);
  assert.equal(r.needs_attention.length, 1);
  assert.ok(r.notes.some((n) => n.startsWith('customer:')));
  const none = createSandboxHandlers({ env, fetchImpl: async () => json({}, 404) });
  assert.equal((await none.sap_sandbox_customer_360({ customer: '77' })).found, false);
});
