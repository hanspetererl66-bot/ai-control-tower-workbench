import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GRIR_SQL, IC_SQL, handleDatabricksPrecloseMessage, pickGrir, precloseExtensionFor, summarize } from '../src/databricks-preclose-bridge.ts';
import { handlePrecloseForecastMessage } from '../src/forecast-bridge.ts';

const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
// The Statement API returns every cell as a string.
const grirRows = [
  { po_number: '4500001001', item: '10', company_code: 'DE10', vendor_name: 'Nordwerk Metall GmbH', description: 'Metal housings', goods_receipt_date: '2026-10-29', age_days: '4', gr_value_eur: '50700.00', invoiced_value_eur: '0.00', open_value_eur: '50700.0', classification: 'ACCRUE' },
  { po_number: '4500000871', item: '10', company_code: 'DE10', vendor_name: 'Baltic Fasteners UAB', description: 'Fasteners', goods_receipt_date: '2026-07-07', age_days: '118', gr_value_eur: '6300', invoiced_value_eur: '0', open_value_eur: '6300', classification: 'STALE_REVIEW', extra: 'dropped' },
];
const icRows = [{ item_id: 'IC-0005', seller_company: 'DE10', buyer_company: 'UK10', description: 'Management fee', posting_date: '2026-10-26', seller_amount_eur: '84200', buyer_amount_eur: null, difference_eur: '84200', category: 'MISSING_ON_BUYER_SIDE' }];
const sapItems = [
  { po_number: '4500001001', item: '10', open_value_eur: 50700, accrued_eur: 0, accrual_document: null },
  { po_number: '4500000871', item: '10', open_value_eur: 6000, accrued_eur: 0, accrual_document: null },
];

function fakeCall({ sap = true, fail = null } = {}) {
  const calls = [];
  const call = async (tool, args) => {
    calls.push([tool, args]);
    if (fail) throw new Error(fail);
    if (tool === 'databricks_run_sql') return text({ columns: [], rows: args.statement.includes('v_ic_differences') ? icRows : grirRows, rowCount: 1 });
    if (tool === 'get_open_grir_items') {
      if (!sap) throw new Error('sap-mock is not connected');
      return text({ count: sapItems.length, items: sapItems });
    }
    throw new Error(`unexpected tool ${tool}`);
  };
  return { call, calls };
}

test('the request returns lakehouse rows with numbers parsed, checked against SAP, and nothing extra', async () => {
  const { call, calls } = fakeCall();
  const reply = await handleDatabricksPrecloseMessage({ type: 'ct:databricks-preclose-request', requestId: 'd1' }, call);
  assert.equal(reply.type, 'ct:databricks-preclose');
  assert.equal(reply.requestId, 'd1');
  const { grir, intercompany, summary, sapConnected } = reply.data;
  assert.equal(sapConnected, true);
  assert.equal(grir[0].openEur, 50700);
  assert.equal(grir[0].sapMatch, true);
  assert.equal(grir[1].sapMatch, false, 'SAP says 6000, the lakehouse says 6300');
  assert.equal(grir[1].sapOpenEur, 6000);
  assert.equal(JSON.stringify(reply).includes('dropped'), false);
  assert.equal(intercompany[0].buyerEur, null);
  assert.equal(intercompany[0].differenceEur, 84200);
  assert.deepEqual([summary.accrueCount, summary.accrueEur, summary.staleCount, summary.staleEur], [1, 50700, 1, 6300]);
  assert.deepEqual(calls.map(([tool]) => tool), ['databricks_run_sql', 'databricks_run_sql', 'get_open_grir_items']);
});

test('the Space cannot send its own SQL and the company filter is validated', async () => {
  const { call, calls } = fakeCall();
  await handleDatabricksPrecloseMessage({ type: 'ct:databricks-preclose-request', requestId: 'd2', company: 'DE10', statement: 'DROP TABLE x', sql: 'DELETE FROM y' }, call);
  const sent = calls.filter(([tool]) => tool === 'databricks_run_sql').map(([, args]) => args.statement);
  assert.equal(sent[0], GRIR_SQL('DE10'));
  assert.equal(sent[1], IC_SQL);
  assert.ok(sent.every((statement) => /^SELECT /.test(statement) && !/DROP|DELETE|INSERT|UPDATE/i.test(statement)));
  const bad = fakeCall();
  await handleDatabricksPrecloseMessage({ type: 'ct:databricks-preclose-request', requestId: 'd3', company: "DE10' OR '1'='1" }, bad.call);
  assert.equal(bad.calls[0][1].statement, GRIR_SQL(undefined), 'an invalid company code is ignored');
  assert.equal(bad.calls.some(([, args]) => String(args.statement ?? '').includes("OR '1'")), false);
});

test('without SAP the lakehouse view is still shown and says it is unchecked', async () => {
  const reply = await handleDatabricksPrecloseMessage({ type: 'ct:databricks-preclose-request', requestId: 'd4' }, fakeCall({ sap: false }).call);
  assert.equal(reply.data.sapConnected, false);
  assert.equal(reply.data.grir[0].sapMatch, null);
});

test('errors and foreign messages', async () => {
  const failed = await handleDatabricksPrecloseMessage({ type: 'ct:databricks-preclose-request', requestId: 'd5' }, fakeCall({ fail: 'DATABRICKS_TOKEN is missing' }).call);
  assert.deepEqual([failed.type, failed.requestId], ['ct:error', 'd5']);
  assert.match(failed.message, /TOKEN/);
  assert.equal((await handleDatabricksPrecloseMessage({ type: 'ct:databricks-preclose-request', requestId: 'd6' }, undefined)).type, 'ct:error');
  assert.equal(await handleDatabricksPrecloseMessage({ type: 'something-else', requestId: 'd7' }, fakeCall().call), null);
  assert.equal(await handleDatabricksPrecloseMessage({ type: 'ct:databricks-preclose-request', requestId: '../x' }, fakeCall().call), null);
  // The forecast handler of the same Space ignores this message type, so the two can be chained.
  assert.equal(await handlePrecloseForecastMessage({ type: 'ct:databricks-preclose-request', requestId: 'd8' }, fakeCall().call), null);
});

test('extension routing and summary', () => {
  assert.equal(precloseExtensionFor('databricks_run_sql', 'ai-control-tower'), 'databricks');
  assert.equal(precloseExtensionFor('get_open_grir_items', 'ai-control-tower'), 'sap-mock');
  assert.equal(precloseExtensionFor('estimate_accruals', 'ai-control-tower'), 'ai-control-tower');
  const items = pickGrir({ rows: grirRows }, null);
  assert.equal(summarize(items).accrueEur, 50700);
});

test('the Space has the card, sends only its two messages and posts nothing', () => {
  const html = readFileSync(new URL('../examples/finance-preclose/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="dbx-load"/);
  assert.match(html, /ct:databricks-preclose-request/);
  assert.match(html, /wb:ask/);
  assert.doesNotMatch(html, /submit_draft|draft_accrual_posting/, 'writes stay in the conversation');
  assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|localStorage/);
});
