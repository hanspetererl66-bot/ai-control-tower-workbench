import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { createSandboxHandlers } from '../connectors/sap-sandbox/server/sandbox.mjs';
import { buildSnapshot } from '../scripts/sap-sandbox-snapshot.mjs';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const d = (results) => json({ d: { results } });
const fake = async (url) => {
  const u = decodeURIComponent(url);
  if (u.includes('/API_BUSINESS_PARTNER/A_BusinessPartner?')) return d([{ BusinessPartner: '1' }]);
  if (/\/API_[A-Z_]+\/\?/.test(u)) return u.includes('API_PRODUCT_SRV') ? json({}, 404) : json({ d: { EntitySets: ['A_SalesOrder', 'A_BusinessPartner'] } });
  if (u.includes('/A_SalesOrder?')) return d([{ SalesOrder: '5', SoldToParty: '10100001', OverallDeliveryStatus: 'A', TotalNetAmount: '10', TransactionCurrency: 'EUR' }, { SalesOrder: '6', SoldToParty: '10100001', OverallDeliveryStatus: 'C', OverallOrdReltdBillgStatus: 'C', TotalNetAmount: '20', TransactionCurrency: 'EUR' }]);
  if (u.includes("/A_SalesOrder('5')")) return json({ d: { SalesOrder: '5', SoldToParty: '10100001', TotalNetAmount: '10', TransactionCurrency: 'EUR' } });
  if (u.includes("/A_SalesOrder('6')")) return json({}, 404);
  if (u.includes("/A_BusinessPartner('10100001')")) return json({ d: { BusinessPartner: '10100001' } });
  if (u.includes('/A_SalesOrderItem?')) return d([]);
  return json({}, 404);
};

test('the snapshot probes the catalog, traces orders, reads customers and keeps going after single failures', async () => {
  const s = await buildSnapshot(createSandboxHandlers({ env: { SAP_API_KEY: 'secret-key' }, fetchImpl: fake }), { orders: 5, now: () => new Date('2026-11-04T12:00:00Z') });
  assert.equal(s.fetched_at, '2026-11-04T12:00:00.000Z');
  assert.ok(s.probe.find((p) => p.service === 'API_PRODUCT_SRV').ok === false);
  assert.ok(s.probe.find((p) => p.service === 'API_SALES_ORDER_SRV').ok);
  assert.equal(s.summary.orders_read, 2);
  assert.equal(s.summary.traced, 1);
  assert.deepEqual(s.errors.map((e) => e.sales_order), ['6']);
  assert.equal(s.customers.length, 1);
  assert.deepEqual(s.summary.stages, { not_delivered: 1 });
});

test('the key never ends up in the snapshot, and a wrong key stops before anything is read', async () => {
  const s = await buildSnapshot(createSandboxHandlers({ env: { SAP_API_KEY: 'secret-key' }, fetchImpl: fake }), { orders: 2 });
  assert.ok(!JSON.stringify(s).includes('secret-key'));
  await assert.rejects(buildSnapshot(createSandboxHandlers({ env: { SAP_API_KEY: 'bad' }, fetchImpl: async () => json({}, 401) })), /API key/);
});

test('the command line refuses to start without a key and does not print one', () => {
  let out = '';
  try { execFileSync('node', ['scripts/sap-sandbox-snapshot.mjs', '--out', '/tmp/never-written.json'], { cwd: new URL('..', import.meta.url).pathname, env: { PATH: process.env.PATH }, stdio: 'pipe' }); } catch (e) { out = String(e.stderr); }
  assert.match(out, /SAP_API_KEY is missing/);
});
