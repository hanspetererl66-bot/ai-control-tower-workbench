import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBatches, buildTableSpaceHtml, checkWebhookUrl, describeColumns, inferType, parseDelimited, parseSharedStrings, parseSheetXml,
  parseTableText, slugify, sniffDelimiter, summarizeTable, toTable,
} from '../shared/table-ingest.mjs';
import { parseSpacePackage, buildSpacePackage } from '../shared/space-package.mjs';

test('sniffs the delimiter and parses quotes, doubled quotes and line breaks in cells', () => {
  assert.equal(sniffDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(sniffDelimiter('a\tb\n1\t2'), '\t');
  const rows = parseDelimited('name,note\n"Meier, Anna","said ""hi""\nthere"\nBob,ok\n');
  assert.deepEqual(rows, [['name', 'note'], ['Meier, Anna', 'said "hi"\nthere'], ['Bob', 'ok']]);
});

test('toTable cleans the header, pads short rows and keeps columns unique', () => {
  const t = toTable([['Name', ' ', 'name'], ['a'], ['b', 'x', 'y', 'extra']]);
  assert.deepEqual(t.columns, ['Name', 'column_2', 'name_2']);
  assert.deepEqual(t.rows, [['a', '', ''], ['b', 'x', 'y']]);
  assert.deepEqual(toTable([]), { columns: [], rows: [], truncated: false });
});

test('column types are inferred from the filled cells', () => {
  assert.equal(inferType(['1', '2,5', '']), 'number');
  assert.equal(inferType(['2026-01-02', '03.02.2026']), 'date');
  assert.equal(inferType(['yes', 'no']), 'boolean');
  assert.equal(inferType(['a', '1']), 'text');
  assert.equal(inferType(['', '']), 'empty');
});

test('the summary gives size, columns and sample rows instead of the whole table', () => {
  const t = parseTableText('id,status,amount\n1,open,10\n2,closed,20\n3,open,30\n');
  const s = summarizeTable('orders.csv', t, { sampleRows: 2 });
  assert.match(s, /3 rows, 3 columns/);
  assert.match(s, /status \(text.*values: open \| closed/);
  assert.match(s, /amount \(number.*range 10–30/);
  assert.match(s, /First 2 rows/);
  assert.doesNotMatch(s, /3 \| open \| 30/);
  assert.equal(describeColumns(t)[0].type, 'number');
});

test('batches share one id, carry index and total, and respect the size', () => {
  const t = parseTableText('a\n' + Array.from({ length: 5 }, (_, i) => i + 1).join('\n'));
  const b = buildBatches({ fileName: 'x.csv', table: t, batchSize: 2, batchId: 'u1' });
  assert.equal(b.length, 3);
  assert.deepEqual(b.map((x) => x.rows.length), [2, 2, 1]);
  assert.ok(b.every((x) => x.batchId === 'u1' && x.total === 3 && x.totalRows === 5));
  assert.deepEqual(b[0].rows[0], { a: '1' });
  assert.equal(buildBatches({ fileName: 'e', table: { columns: ['a'], rows: [] }, batchId: 'u' }).length, 1);
});

test('the webhook address must be https, or http on this computer, without credentials', () => {
  assert.equal(checkWebhookUrl('https://x.app.n8n.cloud/webhook/abc'), 'https://x.app.n8n.cloud/webhook/abc');
  assert.ok(checkWebhookUrl('http://localhost:5678/webhook/a'));
  assert.throws(() => checkWebhookUrl('http://example.com/hook'), /https/);
  assert.throws(() => checkWebhookUrl('https://u:p@example.com/hook'), /user name/);
  assert.throws(() => checkWebhookUrl('nonsense'), /web address/);
});

test('reads an xlsx sheet with shared strings, inline strings, gaps and numbers', () => {
  const shared = parseSharedStrings('<sst><si><t>Name</t></si><si><r><t>Ann</t></r><r><t>a</t></r></si><si><t>Qty</t></si></sst>');
  assert.deepEqual(shared, ['Name', 'Anna', 'Qty']);
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="inlineStr"><is><t>x &amp; y</t></is></c><c r="C2"><v>42</v></c></row></sheetData></worksheet>';
  const rows = parseSheetXml(sheet, shared);
  assert.deepEqual(rows, [['Name', '', 'Qty'], ['Anna', 'x & y', '42']]);
});

test('slugify gives a safe Space name', () => {
  assert.equal(slugify('Bestellungen Q3 – Übersicht'), 'bestellungen-q3-ubersicht');
  assert.equal(slugify('###'), 'tables');
});

test('the table Space is a valid, offline package and escapes dangerous cell text', () => {
  const t = parseTableText('name,qty\n"</script><b>x</b>",3\nBob,4\n');
  const html = buildTableSpaceHtml({ title: 'Orders <1>', tables: [{ name: 'orders.csv', table: t }] });
  assert.doesNotMatch(html, /<\/script><b>/);
  assert.match(html, /<title>Orders &lt;1&gt;<\/title>/);
  assert.match(html, /wb:ask/);
  assert.doesNotMatch(html, /https?:\/\//);
  const pkg = buildSpacePackage({ slug: 'orders', title: 'Orders', files: { 'index.html': html, 'space.json': JSON.stringify({ title: 'Orders' }) } });
  assert.equal(parseSpacePackage(JSON.stringify(pkg)).slug, 'orders');
});

test('the generated page script runs and renders rows', async () => {
  const { JSDOM } = await import('jsdom').catch(() => ({ JSDOM: null }));
  if (!JSDOM) return;
  const t = parseTableText('name,qty\nAnn,3\nBob,4\n');
  const dom = new JSDOM(buildTableSpaceHtml({ title: 'T', tables: [{ name: 'a', table: t }] }), { runScripts: 'dangerously' });
  assert.equal(dom.window.document.querySelectorAll('#body tr').length, 2);
});
