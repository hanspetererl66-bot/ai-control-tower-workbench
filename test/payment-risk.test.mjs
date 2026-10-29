import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolError } from '../connectors/control-tower/server/tools.mjs';
import { checkForecast, createPaymentRiskHandlers, serviceUrl } from '../connectors/control-tower/server/payment-risk.mjs';

const invoices = [{ id: 'INV-1', status: 'Open', grossEur: 100, due: '2026-10-31', type: 'Invoice' }];
const sub4me = { list_invoices: async () => ({ customer: 'Muster', customerId: 'muster', asOf: '2026-10-18', invoices, source: 'sample data' }) };
const answer = {
  asOf: '2026-10-18', engine: 'baseline', engineNote: 'n', trainedOn: '600 synthetic invoices', lateMeansDaysAfterDue: 14,
  customerHabit: { avgDelayDays: 2, lateShare: 0.1, paidInvoicesSeen: 8 },
  items: [{ id: 'INV-1', contractId: 'C-1', grossEur: 100, due: '2026-10-31', daysToDue: 13, alreadyOverdue: false, lateProbability: 0.7, risk: 'high', drivers: [{ label: 'Invoice amount', value: 11.5, effectPct: 20, secret: 'x' }] }],
  internal: 'dropped',
};
const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('without a configured service the tool says so and invents nothing', async () => {
  const { predict_late_payments } = createPaymentRiskHandlers({ sub4me, ToolError, env: {}, fetchImpl: async () => assert.fail('must not call') });
  await assert.rejects(predict_late_payments({}), /not configured/);
});

test('sends the customer invoices to the service and returns the checked forecast', async () => {
  const seen = [];
  const handlers = createPaymentRiskHandlers({
    sub4me, ToolError, env: { TABPFN_SERVICE_URL: 'http://127.0.0.1:8808', TABPFN_SERVICE_TOKEN: 'tok' },
    fetchImpl: async (url, init) => (seen.push([String(url), init]), ok(answer)()),
  });
  const result = await handlers.predict_late_payments({});
  assert.equal(seen[0][0], 'http://127.0.0.1:8808/predict/late-payment');
  assert.equal(seen[0][1].headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(seen[0][1].body), { customer: 'muster', as_of: '2026-10-18', invoices });
  assert.equal(result.highRisk, 1);
  assert.equal(result.engine, 'baseline');
  assert.equal(result.internal, undefined);
  assert.equal(result.items[0].drivers[0].secret, undefined);
  assert.deepEqual(result.view, { space: 'sub4me', tab: 'invoices' });
  assert.match(result.disclaimer, /synthetic/);
});

test('service errors become tool errors the chat can show', async () => {
  const env = { TABPFN_SERVICE_URL: 'http://localhost:8808' };
  const down = createPaymentRiskHandlers({ sub4me, ToolError, env, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(down.predict_late_payments({}), /not reachable/);
  const bad = createPaymentRiskHandlers({ sub4me, ToolError, env, fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(bad.predict_late_payments({}), /HTTP 500/);
  const odd = createPaymentRiskHandlers({ sub4me, ToolError, env, fetchImpl: ok({ nope: 1 }) });
  await assert.rejects(odd.predict_late_payments({}), /unexpected answer/);
});

test('only https, or http on this computer, is accepted as the service address', () => {
  assert.equal(serviceUrl(''), null);
  assert.ok(serviceUrl('https://forecast.example.com'));
  assert.ok(serviceUrl('http://127.0.0.1:8808'));
  assert.throws(() => serviceUrl('http://forecast.example.com'), /https/);
  assert.throws(() => serviceUrl('not a url'), /valid URL/);
});

test('checkForecast clamps probabilities and unknown risk levels', () => {
  const out = checkForecast({ items: [{ id: 'A', lateProbability: 7, risk: 'weird' }] });
  assert.equal(out.items[0].lateProbability, 1);
  assert.equal(out.items[0].risk, 'low');
});
