import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import vm from 'node:vm';
import { prepareAttachments, readTables, MAX_ATTACHMENTS } from '../electron/attachments.mjs';
import { buildBatches, parseTableText } from '../shared/table-ingest.mjs';

const wf = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'examples/n8n-workflows/09-bulk-table-ingest.json'), 'utf8'));
const node = (name) => wf.nodes.find((n) => n.name === name);
const validate = async (body) => [...(await vm.runInNewContext(`(async()=>{${node('Validate batch').parameters.jsCode}})`, { $input: { first: () => ({ json: { body } }) } })())];

test('workflow 09 is importable, needs no credentials in the file and is wired webhook → validate → store', () => {
  const names = wf.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(wf.nodes.map((n) => n.id)).size, names.length);
  for (const n of wf.nodes) assert.equal(n.credentials, undefined);
  for (const [from, o] of Object.entries(wf.connections)) { assert.ok(names.includes(from)); for (const out of o.main) for (const t of out) assert.ok(names.includes(t.node)); }
  const hook = node('Receive batch');
  assert.equal(hook.parameters.path, 'bulk-table-ingest');
  assert.equal(hook.parameters.authentication, 'headerAuth');
  assert.equal(wf.active, false);
  const store = node('Store rows in Supabase').parameters;
  assert.match(store.url, /on_conflict=batch_id,row_index/);
  assert.match(JSON.stringify(store.headerParameters), /ignore-duplicates/);
  assert.doesNotMatch(JSON.stringify(wf), /eyJ|sb_secret|service_role"?:\s*"[A-Za-z0-9]/, 'no key in the file');
});

test('workflow 09 accepts what the Werkbank sends and turns every row into one keyed record', async () => {
  const batches = buildBatches({ fileName: 'orders.csv', table: parseTableText('id,qty\n1,5\n2,6\n3,7\n'), batchSize: 2, batchId: 'up-1' });
  const [first] = await validate(batches[0]);
  assert.equal(first.json.ok, true);
  assert.deepEqual(first.json.rows.map((r) => r.row_index), [0, 1]);
  assert.deepEqual(JSON.parse(JSON.stringify(first.json.rows[0])), { batch_id: 'up-1', row_index: 0, source: 'orders.csv', data: { id: '1', qty: '5' } });
  const [second] = await validate(batches[1]);
  assert.deepEqual(second.json.rows.map((r) => r.row_index), [2], 'the second batch continues the numbering');
});

test('workflow 09 rejects bad batches with reasons', async () => {
  const ok = buildBatches({ fileName: 'a', table: parseTableText('a\n1'), batchId: 'x' })[0];
  for (const [bad, reason] of [
    [{ ...ok, batchId: '../x' }, /batchId/], [{ ...ok, index: 5 }, /index/], [{ ...ok, rows: [] }, /rows/],
    [{ ...ok, rows: new Array(1001).fill({}) }, /1000/], [{ ...ok, offset: -1 }, /offset/], [{ ...ok, columns: [] }, /columns/], [null ?? {}, /batchId/],
  ]) {
    const [r] = await validate(bad);
    assert.equal(r.json.ok, false);
    assert.match(r.json.errors.join(), reason);
  }
});

test('the migration closes the table to everybody but the server key', () => {
  const sql = readFileSync(join(import.meta.dirname, '..', 'supabase/migrations/20261028_018_bulk_upload_rows.sql'), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.bulk_upload_rows from anon, authenticated/);
  assert.match(sql, /primary key \(batch_id, row_index\)/);
});

function zipped(root, name, entries) {
  const src = join(root, `${name}-src`);
  for (const [p, c] of Object.entries(entries)) { mkdirSync(join(src, p, '..'), { recursive: true }); writeFileSync(join(src, p), c); }
  const out = join(root, name);
  execFileSync('/usr/bin/zip', ['-qr', out, '.'], { cwd: src });
  return out;
}

test('attachments: tsv and xlsx are described as tables, a big csv gets a summary first, and 25 files are allowed', () => {
  const root = mkdtempSync(join(tmpdir(), 'werkbank-table-test-'));
  const tsv = join(root, 'people.tsv');
  writeFileSync(tsv, 'name\tcity\nAnn\tBerlin\nBob\tWien\n');
  const xlsx = zipped(root, 'sales.xlsx', {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Q3 &amp; Q4" sheetId="1"/></sheets></workbook>',
    'xl/sharedStrings.xml': '<sst><si><t>Region</t></si><si><t>Revenue</t></si><si><t>DACH</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1200</v></c></row></sheetData></worksheet>',
  });
  const big = join(root, 'big.csv');
  writeFileSync(big, 'id,note\n' + Array.from({ length: 6000 }, (_, i) => `${i},${'x'.repeat(30)}`).join('\n'));
  const { files, errors } = prepareAttachments([tsv, xlsx, big], join(root, 'ws'));
  assert.deepEqual(errors, []);
  const by = Object.fromEntries(files.map((f) => [f.name, f]));
  assert.equal(by['people.tsv'].kind, 'table');
  assert.match(by['people.tsv'].extractedText, /2 rows, 2 columns/);
  assert.equal(by['sales.xlsx'].kind, 'table');
  assert.match(by['sales.xlsx'].extractedText, /sales\.xlsx \/ Q3 & Q4/);
  assert.match(by['sales.xlsx'].extractedText, /Revenue \(number, range 1200–1200\)/);
  assert.match(by['big.csv'].extractedText, /^Table "big\.csv": 6,000 rows/);
  assert.equal(readTables(by['sales.xlsx'].path)[0].table.rows[0][0], 'DACH');
  assert.equal(MAX_ATTACHMENTS, 25);
  const many = Array.from({ length: 25 }, (_, i) => { const p = join(root, `m${i}.csv`); writeFileSync(p, 'a\n1'); return p; });
  assert.equal(prepareAttachments(many, join(root, 'ws2')).files.length, 25);
  assert.throws(() => prepareAttachments([...many, tsv], join(root, 'ws3')), /at most 25/);
});
