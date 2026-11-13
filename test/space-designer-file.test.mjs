import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDataFile } from '../src/space-designer-file.ts';
import { normalizeLayout, MAX_ROWS, MAX_COLUMNS } from '../src/space-layout.ts';

test('a JSON list of objects becomes columns (all keys, in order of first use) and string cells', () => {
  const a = parseDataFile('t.json', JSON.stringify([{ Team: 'A', Open: 12 }, { Team: 'B', Open: 8, Late: true }]));
  assert.deepEqual(a.columns, ['Team', 'Open', 'Late']);
  assert.deepEqual(a.rows, [['A', '12', ''], ['B', '8', 'true']]);
});

test('a JSON list of lists uses the first list as header; {columns, rows} works too', () => {
  assert.deepEqual(parseDataFile('t.json', '[["x","y"],[1,2]]').rows, [['1', '2']]);
  const b = parseDataFile('t.json', '{"columns":["x","y"],"rows":[[1],[3,4,5]]}');
  assert.deepEqual(b.rows, [['1', ''], ['3', '4']]);
});

test('CSV with commas or semicolons and a BOM is read; a TSV too', () => {
  assert.deepEqual(parseDataFile('t.csv', '﻿Name;Open\r\nA;3\r\nB;4\r\n').rows, [['A', '3'], ['B', '4']]);
  assert.deepEqual(parseDataFile('t.tsv', 'a\tb\n1\t2').columns, ['a', 'b']);
  assert.deepEqual(parseDataFile('t.csv', 'a,b\n"x, y",2').rows, [['x, y', '2']]);
});

test('bad files give a plain error and nothing else', () => {
  for (const [name, text] of [['t.json', '{nope'], ['t.csv', '   '], ['t.json', '[]'], ['t.json', '[1,2]'], ['t.json', '{"a":1}'], ['t.json', '"text"']]) {
    assert.ok('error' in parseDataFile(name, text), `${name} ${text}`);
  }
});

test('limits: too many rows or columns are cut with a note; long cells are clipped and newlines flattened', () => {
  const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ k: String(i) }));
  const a = parseDataFile('t.json', JSON.stringify(many));
  assert.equal(a.rows.length, MAX_ROWS);
  assert.match(a.notes.join(' '), /Only the first/);
  const wide = Object.fromEntries(Array.from({ length: MAX_COLUMNS + 3 }, (_, i) => [`c${i}`, 'v']));
  assert.equal(parseDataFile('t.json', JSON.stringify([wide])).columns.length, MAX_COLUMNS);
  const c = parseDataFile('t.json', JSON.stringify([{ a: 'x'.repeat(500) + '\nline' }]));
  assert.ok(c.rows[0][0].length <= 200 && !c.rows[0][0].includes('\n'));
});

test('a file source is stored with its name only: path separators are dropped, bad dates cleared, unknown kinds ignored', () => {
  const layout = normalizeLayout({ title: 't', blocks: ['d1', 'd2', 'd3'].map((d) => ({ id: `b${d}`, type: 'table', title: 'T', dataset: d, sortable: false, totals: false })), datasets: [
    { id: 'd1', name: 'A', columns: ['x'], rows: [['1']], source: { kind: 'file', name: '/Users/me/secret/data.csv', asOf: '2026-11-13T10:00', note: 'n' } },
    { id: 'd2', name: 'B', columns: ['x'], rows: [['1']], source: { kind: 'file', name: 'a.csv', asOf: 'yesterday', note: '' } },
    { id: 'd3', name: 'C', columns: ['x'], rows: [['1']], source: { kind: 'url', name: 'http://x' } },
  ] });
  const [d1, d2, d3] = layout.datasets;
  assert.equal(d1.source.kind, 'file');
  assert.ok(!/[\\/]/.test(d1.source.name));
  assert.equal(d1.source.asOf, '2026-11-13T10:00');
  assert.equal(d2.source.asOf, '');
  assert.equal(d3.source, undefined);
});
