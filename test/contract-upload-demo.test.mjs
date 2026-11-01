import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import vm from 'node:vm';
import { readTables } from '../electron/attachments.mjs';
import { AS_OF, COLUMNS, buildXlsx, csvOf, demoContracts } from '../scripts/make-demo-contracts.mjs';
import { buildBatches, parseTableText } from '../shared/table-ingest.mjs';

const ROOT = join(import.meta.dirname, '..');
const wf09 = JSON.parse(readFileSync(join(ROOT, 'examples/n8n-workflows/09-bulk-table-ingest.json'), 'utf8'));
const wf10 = JSON.parse(readFileSync(join(ROOT, 'examples/n8n-workflows/10-contract-notice-from-upload.json'), 'utf8'));
const code = (wf, name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;
const plain = (x) => JSON.parse(JSON.stringify(x));
const run = async (js, ctx) => plain([...(await vm.runInNewContext(`(async()=>{${js}})`, ctx)())]);

test('the committed demo files are what the generator writes, and the xlsx and csv hold the same table', () => {
  const rows = demoContracts();
  assert.equal(rows.length, 60);
  assert.equal(readFileSync(join(ROOT, 'examples/demo-data/contracts-demo.csv'), 'utf8'), csvOf(COLUMNS, rows));
  const fromXlsx = readTables(join(ROOT, 'examples/demo-data/contracts-demo.xlsx'))[0].table;
  const fromCsv = parseTableText(readFileSync(join(ROOT, 'examples/demo-data/contracts-demo.csv'), 'utf8'));
  assert.deepEqual(fromXlsx.columns, COLUMNS);
  assert.deepEqual(fromXlsx.rows, rows);
  assert.deepEqual(fromCsv.rows, rows);
  const tmp = join(mkdtempSync(join(tmpdir(), 'demo-')), 'x.xlsx');
  buildXlsx(tmp, COLUMNS, rows);
  assert.deepEqual(readTables(tmp)[0].table.rows, rows, 'the generator output can be read back');
});

test('workflow 10 is importable, closed by a token and reads only the rows of one upload', () => {
  const names = wf10.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(wf10.nodes.map((n) => n.id)).size, names.length);
  for (const n of wf10.nodes) assert.equal(n.credentials, undefined);
  for (const [from, o] of Object.entries(wf10.connections)) { assert.ok(names.includes(from)); for (const out of o.main) for (const t of out) assert.ok(names.includes(t.node)); }
  const hook = wf10.nodes.find((n) => n.name === 'Receive request');
  assert.equal(hook.parameters.authentication, 'headerAuth');
  const read = wf10.nodes.find((n) => n.name === 'Read uploaded rows');
  assert.match(read.parameters.url, /batch_id=eq\./);
  assert.equal(read.alwaysOutputData, true, 'an empty upload still gets an answer');
  assert.equal(wf10.active, false);
  assert.doesNotMatch(JSON.stringify(wf10), /eyJ|sb_secret/);
});

test('the whole path: demo table → batches → workflow 09 records → workflow 10 report', async () => {
  const table = readTables(join(ROOT, 'examples/demo-data/contracts-demo.xlsx'))[0].table;
  const batches = buildBatches({ fileName: 'contracts-demo.xlsx', table, batchSize: 25, batchId: 'demo-1' });
  assert.equal(batches.length, 3);
  const stored = [];
  for (const b of batches) {
    const [out] = await run(code(wf09, 'Validate batch'), { $input: { first: () => ({ json: { body: b } }) } });
    assert.equal(out.json.ok, true);
    stored.push(...out.json.rows);
  }
  assert.deepEqual(stored.map((r) => r.row_index), Array.from({ length: 60 }, (_, i) => i));
  const params = await run(code(wf10, 'Parameters'), { $input: { first: () => ({ json: { body: { batchId: 'demo-1' } } }) } });
  assert.deepEqual(params[0].json, { ok: true, errors: [], batchId: 'demo-1', asOf: AS_OF, withinDays: 30 });
  // What Supabase returns for the read: the stored rows without the key columns.
  const fromDb = stored.map((r) => ({ json: { row_index: r.row_index, data: r.data } }));
  const ctx = { $input: { all: () => fromDb }, $: (name) => ({ first: () => (name === 'Parameters' ? params[0] : null) }), Intl };
  const [report] = await run(code(wf10, 'Check deadlines'), ctx);
  // The same numbers, computed independently from the table.
  const days = rows60().map((r) => Math.round((Date.parse(r[4]) - Number(r[5]) * 864e5 - Date.parse(AS_OF)) / 864e5));
  const expectedAlerts = days.filter((d) => d <= 30).length;
  assert.equal(report.json.total, 60);
  assert.equal(report.json.alerts, expectedAlerts);
  assert.equal(report.json.passed, days.filter((d) => d < 0).length);
  assert.ok(report.json.alerts >= 5 && report.json.passed >= 1 && report.json.alerts < 30, 'the demo has some alerts, at least one passed deadline, and mostly fine contracts');
  assert.deepEqual(report.json.alertContracts.map((c) => c.daysLeft), [...report.json.alertContracts.map((c) => c.daysLeft)].sort((a, b) => a - b));
  assert.match(report.json.digest, /^Contract notice check for upload demo-1 as of 2026-10-19: 60 contracts/);
  assert.match(report.json.digest, /Draft only: nothing is sent/);
  assert.equal(Object.values(report.json.byOwner).flat().length, report.json.alerts);
});

const rows60 = () => demoContracts();

test('workflow 10 copes with an empty upload, Excel date numbers and broken rows', async () => {
  const ctx = (items) => ({ $input: { all: () => items }, $: () => ({ first: () => ({ json: { batchId: 'e', asOf: '2026-10-19', withinDays: 30 } }) }), Intl });
  const [empty] = await run(code(wf10, 'Check deadlines'), ctx([{ json: {} }]));
  assert.equal(empty.json.total, 0);
  assert.match(empty.json.digest, /Nothing to do now/);
  const serial = Math.round(Date.parse('2026-11-15') / 864e5) + 25569;
  const [r] = await run(code(wf10, 'Check deadlines'), ctx([
    { json: { row_index: 0, data: { 'Contract ID': 'A', 'Contract end': String(serial), 'Notice days': '30', 'Annual value EUR': '1000', Owner: 'X' } } },
    { json: { row_index: 1, data: { 'Contract ID': '', 'Contract end': 'soon', 'Notice days': '30' } } },
  ]));
  assert.equal(r.json.total, 1);
  assert.equal(r.json.skipped, 1);
  assert.equal(r.json.alertContracts[0].end, '2026-11-15');
  assert.equal(r.json.alertContracts[0].noticeDeadline, '2026-10-16');
  assert.equal(r.json.alertContracts[0].daysLeft, -3);
  const [bad] = await run(code(wf10, 'Parameters'), { $input: { first: () => ({ json: { body: { batchId: '../x' } } }) } });
  assert.equal(bad.json.ok, false);
});
