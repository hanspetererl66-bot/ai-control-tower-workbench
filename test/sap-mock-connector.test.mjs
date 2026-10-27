import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ALTERNATIVES, GRIR_ITEMS, PURCHASE_ORDERS, VENDORS, scorePo } from '../connectors/sap-mock/server/data.mjs';
import { startStdioServer } from './helpers/stdio-mcp.mjs';

const ROOT = join(import.meta.dirname, '..');
const SERVER = join(ROOT, 'connectors/sap-mock/server/index.mjs');
const manifest = JSON.parse(readFileSync(join(ROOT, 'connectors/sap-mock/manifest.json'), 'utf8'));
const PIN = { SAP_MOCK_TODAY: '2026-10-27' };

test('manifest lists exactly the tools the server offers', async () => {
  const server = startStdioServer(SERVER, PIN);
  try {
    const { result } = await server.request('tools/list');
    assert.deepEqual(manifest.tools.map((tool) => tool.name).sort(), result.tools.map((tool) => tool.name).sort());
    assert.equal(manifest.name, 'sap-mock');
  } finally {
    server.close();
  }
});

test('only submit_draft is marked as a write, and it says so', async () => {
  const server = startStdioServer(SERVER, PIN);
  try {
    const { result } = await server.request('tools/list');
    const writes = result.tools.filter((tool) => tool.annotations.readOnlyHint === false).map((tool) => tool.name);
    assert.deepEqual(writes, ['submit_draft']);
    const submit = result.tools.find((tool) => tool.name === 'submit_draft');
    assert.match(submit.description, /WRITE/);
    for (const draft of ['draft_expedite_request', 'draft_supplier_inquiry', 'draft_accrual_posting']) {
      assert.match(result.tools.find((tool) => tool.name === draft).description, /DOES NOT/);
    }
  } finally {
    server.close();
  }
});

test('dates are relative to the pinned day and the demo buyer has twelve open orders', async () => {
  const server = startStdioServer(SERVER, PIN);
  try {
    const list = await server.tool('list_purchase_orders', { buyer_id: 'B-100' });
    assert.equal(list.json.as_of, '2026-10-27');
    assert.equal(list.json.total, 12);
    const first = list.json.purchase_orders.find((po) => po.po_number === '4500001001');
    assert.equal(first.requested_delivery_date, '2026-11-02'); // today + 6
    assert.equal(first.confirmed_delivery_date, '2026-11-08'); // today + 12
    assert.equal(first.ZZ_EXPEDITE_FLAG, '');
  } finally {
    server.close();
  }
});

test('nothing is posted without a draft, the right token and confirmed=true', async () => {
  const server = startStdioServer(SERVER, PIN);
  try {
    const draft = await server.tool('draft_expedite_request', { po_number: '4500001007', reason: 'Line 3 stock-out risk', requested_date: '2026-11-05' });
    assert.equal(draft.isError, false);
    assert.match(draft.json.status, /nothing has been posted/);
    const { draft_id: id, confirmation_token: token } = draft.json;

    // Drafting alone changes nothing.
    let po = await server.tool('get_purchase_order', { po_number: '4500001007' });
    assert.equal(po.json.purchase_order.ZZ_EXPEDITE_FLAG, '');

    const notConfirmed = await server.tool('submit_draft', { draft_id: id, confirmation_token: token, confirmed: false });
    assert.equal(notConfirmed.isError, true);
    const stringConfirmed = await server.tool('submit_draft', { draft_id: id, confirmation_token: token, confirmed: 'true' });
    assert.equal(stringConfirmed.isError, true);
    const wrongToken = await server.tool('submit_draft', { draft_id: id, confirmation_token: '000000000000', confirmed: true });
    assert.equal(wrongToken.isError, true);
    const unknown = await server.tool('submit_draft', { draft_id: 'DRAFT-9999', confirmation_token: token, confirmed: true });
    assert.equal(unknown.isError, true);

    po = await server.tool('get_purchase_order', { po_number: '4500001007' });
    assert.equal(po.json.purchase_order.ZZ_EXPEDITE_FLAG, '', 'rejected submissions must not post');

    const posted = await server.tool('submit_draft', { draft_id: id, confirmation_token: token, confirmed: true });
    assert.equal(posted.json.status, 'POSTED');
    assert.match(posted.json.change_document, /^CHG-\d+$/);

    po = await server.tool('get_purchase_order', { po_number: '4500001007' });
    assert.equal(po.json.purchase_order.ZZ_EXPEDITE_FLAG, 'X');
    assert.equal(po.json.purchase_order.expedite_requested_date, '2026-11-05');

    const again = await server.tool('submit_draft', { draft_id: id, confirmation_token: token, confirmed: true });
    assert.equal(again.json.status, 'ALREADY_POSTED');
    assert.equal(again.json.change_document, posted.json.change_document);

    const log = await server.tool('get_audit_log', {});
    const actions = log.json.entries.map((entry) => entry.action);
    assert.equal(actions.filter((action) => action === 'SUBMITTED').length, 1, 'posted exactly once');
    assert.equal(actions.filter((action) => action === 'SUBMIT_REJECTED').length, 4);
  } finally {
    server.close();
  }
});

test('a token only works for the draft it was issued for', async () => {
  const server = startStdioServer(SERVER, PIN);
  try {
    const one = await server.tool('draft_expedite_request', { po_number: '4500001001', reason: 'Needed for the line' });
    const two = await server.tool('draft_expedite_request', { po_number: '4500001002', reason: 'Needed for the line' });
    const crossed = await server.tool('submit_draft', { draft_id: one.json.draft_id, confirmation_token: two.json.confirmation_token, confirmed: true });
    assert.equal(crossed.isError, true);
  } finally {
    server.close();
  }
});

test('supplier inquiries only go to qualified alternatives', async () => {
  const server = startStdioServer(SERVER, PIN);
  try {
    const alternatives = await server.tool('list_alternative_suppliers', { material: 'M-2001' });
    assert.equal(alternatives.json.alternatives[0].vendor_id, 'V-1004');
    const bad = await server.tool('draft_supplier_inquiry', { po_number: '4500001007', alternative_vendor_id: 'V-1003', message: 'Can you quote?' });
    assert.equal(bad.isError, true);
    const good = await server.tool('draft_supplier_inquiry', { po_number: '4500001007', alternative_vendor_id: 'V-1004', message: 'Can you quote 1100 units by mid-November?' });
    assert.equal(good.isError, false);
    const posted = await server.tool('submit_draft', { draft_id: good.json.draft_id, confirmation_token: good.json.confirmation_token, confirmed: true });
    assert.equal(posted.json.status, 'POSTED');
    // An inquiry does not touch the existing order.
    const po = await server.tool('get_purchase_order', { po_number: '4500001007' });
    assert.equal(po.json.purchase_order.ZZ_EXPEDITE_FLAG, '');
  } finally {
    server.close();
  }
});

test('inputs are validated', async () => {
  const server = startStdioServer(SERVER, PIN);
  try {
    assert.equal((await server.tool('get_purchase_order', { po_number: 'abc' })).isError, true);
    assert.equal((await server.tool('get_purchase_order', { po_number: '4599999999' })).isError, true);
    assert.equal((await server.tool('draft_expedite_request', { po_number: '4500001001' })).isError, true, 'reason is required');
    assert.equal((await server.tool('draft_expedite_request', { po_number: '4500001001', reason: 'x', requested_date: '2020-01-01' })).isError, true);
    assert.equal((await server.tool('draft_expedite_request', { po_number: '4500001001', reason: 'x', requested_date: '2027-12-31' })).isError, true);
    assert.equal((await server.tool('draft_expedite_request', { po_number: '4500001001', reason: 'x'.repeat(501) })).isError, true);
    assert.equal((await server.tool('list_purchase_orders', { limit: 0 })).isError, true);
    assert.equal((await server.tool('list_purchase_orders', { status: 'DONE' })).isError, true);
    assert.equal((await server.request('tools/call', { name: 'does_not_exist', arguments: {} })).error.code, -32602);
  } finally {
    server.close();
  }
});

test('the audit log can be written to a file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sap-mock-'));
  const file = join(dir, 'audit.jsonl');
  const server = startStdioServer(SERVER, { ...PIN, SAP_MOCK_AUDIT_LOG: file });
  try {
    await server.tool('draft_expedite_request', { po_number: '4500001001', reason: 'Needed for the line' });
    await server.tool('get_audit_log', {}); // round trip, so the write above has happened
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].action, 'DRAFT_CREATED');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the demo data tells the story: six of the buyer\'s twelve orders are high risk, and the contrast buyer is calm', () => {
  const scored = (buyer) => PURCHASE_ORDERS.filter((row) => row.buyer === buyer).map((row) => ({ row, ...scorePo(row) }));
  assert.equal(scored('B-100').filter((entry) => entry.delayProbability >= 0.6).length, 6);
  assert.equal(scored('B-300').filter((entry) => entry.delayProbability >= 0.6).length, 0);
  // Every high-risk order has a stated reason, and the weakest vendor is among them.
  for (const entry of scored('B-100').filter((candidate) => candidate.delayProbability >= 0.6)) {
    assert.ok(entry.drivers.length >= 1);
  }
  assert.ok(scored('B-100').some((entry) => entry.row.vendor === 'V-1001' && entry.delayProbability > 0.8));
});

test('every reference in the data resolves', () => {
  const vendors = new Set(VENDORS.map((vendor) => vendor.id));
  for (const row of PURCHASE_ORDERS) assert.ok(vendors.has(row.vendor), `${row.po} has an unknown vendor`);
  for (const alternatives of Object.values(ALTERNATIVES)) {
    for (const alternative of alternatives) assert.ok(vendors.has(alternative.vendorId));
  }
  assert.equal(new Set(PURCHASE_ORDERS.map((row) => `${row.po}-${row.item}`)).size, PURCHASE_ORDERS.length, 'po/item keys are unique');
});

test('GR/IR: SAP and the lakehouse agree on the classification and the open values', async () => {
  const server = startStdioServer(SERVER, PIN);
  try {
    const all = await server.tool('get_open_grir_items', {});
    assert.equal(all.json.count, GRIR_ITEMS.length);
    const byClass = (name) => all.json.items.filter((item) => item.classification === name);
    assert.equal(byClass('ACCRUE').length, 8);
    assert.equal(byClass('STALE_REVIEW').length, 3);
    assert.equal(byClass('INVOICE_BEFORE_GOODS').length, 1);
    const pl = await server.tool('get_open_grir_items', { company_code: 'PL01' });
    assert.ok(pl.json.items.every((item) => item.company_code === 'PL01'));
    assert.equal((await server.tool('get_open_grir_items', { company_code: 'XX99' })).isError, true);
    const first = all.json.items.find((item) => item.po_number === '4500001001');
    assert.equal(first.goods_receipt_date, '2026-10-23'); // today - 4
    assert.equal(first.open_value_eur, 50700);
  } finally {
    server.close();
  }
});

test('an accrual follows the same gate and is limited to the open value', async () => {
  const server = startStdioServer(SERVER, PIN);
  try {
    const base = { po_number: '4500001001', item: '10', reason: 'GR/IR accrual, invoice pending' };
    // Refused before any draft exists.
    assert.equal((await server.tool('draft_accrual_posting', { ...base, amount_eur: 50700.01 })).isError, true, 'above open value');
    assert.equal((await server.tool('draft_accrual_posting', { ...base, amount_eur: 0 })).isError, true);
    assert.equal((await server.tool('draft_accrual_posting', { ...base, amount_eur: '100' })).isError, true);
    assert.equal((await server.tool('draft_accrual_posting', { po_number: '4500000871', item: '10', amount_eur: 100, reason: 'x' })).isError, true, 'stale item');
    assert.equal((await server.tool('draft_accrual_posting', { po_number: '4500003004', item: '10', amount_eur: 100, reason: 'x' })).isError, true, 'invoice before goods');
    assert.equal((await server.tool('draft_accrual_posting', { po_number: '4500009999', item: '10', amount_eur: 100, reason: 'x' })).isError, true, 'unknown item');

    const draft = await server.tool('draft_accrual_posting', { ...base, amount_eur: 50700 });
    assert.equal(draft.isError, false);
    assert.match(draft.json.status, /nothing has been posted/);
    assert.equal(draft.json.preview.company_code, 'DE01');
    let item = (await server.tool('get_open_grir_items', { company_code: 'DE01' })).json.items.find((entry) => entry.po_number === '4500001001');
    assert.equal(item.accrued_eur, 0, 'drafting changes nothing');

    const rejected = await server.tool('submit_draft', { draft_id: draft.json.draft_id, confirmation_token: draft.json.confirmation_token, confirmed: false });
    assert.equal(rejected.isError, true);
    const posted = await server.tool('submit_draft', { draft_id: draft.json.draft_id, confirmation_token: draft.json.confirmation_token, confirmed: true });
    assert.equal(posted.json.status, 'POSTED');
    assert.match(posted.json.accrual_document, /^ACC-\d+$/);

    item = (await server.tool('get_open_grir_items', { company_code: 'DE01' })).json.items.find((entry) => entry.po_number === '4500001001');
    assert.equal(item.accrued_eur, 50700);
    assert.equal(item.accrual_document, posted.json.accrual_document);
    // One accrual per item: a second one is refused.
    assert.equal((await server.tool('draft_accrual_posting', { ...base, amount_eur: 100 })).isError, true);
    const again = await server.tool('submit_draft', { draft_id: draft.json.draft_id, confirmation_token: draft.json.confirmation_token, confirmed: true });
    assert.equal(again.json.status, 'ALREADY_POSTED');
  } finally {
    server.close();
  }
});
