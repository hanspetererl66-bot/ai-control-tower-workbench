import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AGGREGATES, datasetValue, makeToken, normalizeLayout, pruneDatasets, resolveLayout, tokenDatasets } from '../src/space-layout.ts';
import { layoutFromHtml, renderSpacePage } from '../src/space-layout-render.ts';

const CSS = readFileSync(join(import.meta.dirname, '..', 'examples/shared/design-system.css'), 'utf8');
const DS = { id: 'd1', name: 'Tickets', columns: ['Priority', 'Open', 'Cost'], rows: [['High', '12', '€ 1,200.50'], ['Medium', '30', '1.000,25'], ['Low', '8', '{warn} 80']],
  source: { kind: 'joule', prompt: 'Open Jira tickets by priority', asOf: '2026-11-13T08:30', note: 'Jira via Joule' } };
const layout = (blocks, datasets = [DS]) => ({ version: 1, datasets, blocks });

test('a data set can carry a Joule query as its source; the source is checked and kept, anything else is dropped', () => {
  const l = normalizeLayout(layout([{ id: 'b1', type: 'table', title: 'T', dataset: 'd1', sortable: false, totals: false }]));
  assert.deepEqual(l.datasets[0].source, DS.source);
  const bad = normalizeLayout(layout([{ id: 'b1', type: 'table', title: 'T', dataset: 'd1', sortable: false, totals: false }], [{ ...DS, source: { kind: 'sql', prompt: 'select 1', asOf: 'yesterday', note: 'x' } }]));
  assert.equal(bad.datasets[0].source, undefined, 'only the kind "joule" exists');
  const odd = normalizeLayout(layout([{ id: 'b1', type: 'table', title: 'T', dataset: 'd1', sortable: false, totals: false }], [{ ...DS, source: { kind: 'joule', prompt: 'p'.repeat(900), asOf: 'yesterday', note: 'n'.repeat(400) } }]));
  assert.equal(odd.datasets[0].source.prompt.length, 600);
  assert.equal(odd.datasets[0].source.asOf, '', 'a time that is not a time is dropped');
  assert.ok(odd.datasets[0].source.note.length <= 160);
  assert.equal(normalizeLayout(layout([{ id: 'b1', type: 'table', title: 'T', dataset: 'd1', sortable: false, totals: false }], [{ id: 'd1', name: 'x', columns: ['A'], rows: [] }])).datasets[0].source, undefined, 'a data set without a source stays as it was');
});

test('datasetValue: the first and last value, a count, and sum, max, min, average of the numbers in a column, in the number formats the layout already reads', () => {
  assert.equal(datasetValue(DS, 'Priority', 'first'), 'High');
  assert.equal(datasetValue(DS, 'Priority', 'last'), 'Low');
  assert.equal(datasetValue(DS, 'Priority', 'count'), '3');
  assert.equal(datasetValue(DS, 'Open', 'sum'), '50');
  assert.equal(datasetValue(DS, 'Open', 'max'), '30');
  assert.equal(datasetValue(DS, 'Open', 'min'), '8');
  assert.equal(datasetValue(DS, 'Open', 'avg'), '16.67');
  assert.equal(datasetValue(DS, 'Cost', 'sum'), '2,280.75', '€ 1,200.50 + 1.000,25 + 80 (a status mark does not count)');
  assert.equal(datasetValue(DS, 'open', 'sum'), '50', 'the column name ignores case and spaces at the ends');
  assert.equal(datasetValue(DS, 'Priority', 'sum'), null, 'a column without numbers has no sum');
  assert.equal(datasetValue(DS, 'Nope', 'first'), null);
  assert.equal(datasetValue({ ...DS, rows: [] }, 'Open', 'first'), null);
  assert.deepEqual([...AGGREGATES], ['first', 'last', 'sum', 'count', 'max', 'min', 'avg']);
  assert.equal(makeToken('d1', 'Open', 'sum'), '{{d1.Open:sum}}');
  assert.equal(makeToken('d1', 'Priority'), '{{d1.Priority}}');
});

test('resolveLayout puts the figures into every text of every block; unknown data sets, columns and functions become n/a and are reported', () => {
  const l = layout([
    { id: 'b1', type: 'text', title: 'Open {{d1.Open:sum}}', text: 'We have {{d1.Open:sum}} tickets, the biggest group is {{ d1.Priority }} with {{d1.Open:max}}.' },
    { id: 'b2', type: 'kpis', items: [{ label: 'Open', value: '{{d1.Open:sum}}', delta: '{{d1.Open:count}} groups', tone: 'info', trend: '' }] },
    { id: 'b3', type: 'callout', tone: 'warn', title: 'Check', text: '{{d9.Open:sum}} {{d1.Nope}} {{d1.Priority:sum}} {{d1.Open:median}}' },
  ]);
  const r = resolveLayout(l);
  assert.equal(r.layout.blocks[0].title, 'Open 50');
  assert.equal(r.layout.blocks[0].text, 'We have 50 tickets, the biggest group is High with 30.');
  assert.deepEqual([r.layout.blocks[1].items[0].value, r.layout.blocks[1].items[0].delta], ['50', '3 groups']);
  assert.equal(r.layout.blocks[2].text, 'n/a n/a n/a n/a');
  assert.equal(r.issues.length, 4);
  assert.match(r.issues.join(' '), /there is no data set "d9"[\s\S]*has no column "Nope"[\s\S]*has no numbers or no values for sum[\s\S]*"median" is not a function/);
  assert.equal(l.blocks[0].text.includes('{{d1.Open:sum}}'), true, 'the stored layout keeps its tokens');
  assert.deepEqual(resolveLayout(layout([{ id: 'b1', type: 'text', title: 'Plain', text: 'No tokens here {not a token}' }])).issues, []);
});

test('tokenDatasets finds the data sets that texts use, and pruneDatasets keeps them although no table or chart shows them', () => {
  const l = layout([{ id: 'b1', type: 'text', title: '', text: '{{d1.Open:sum}} and {{d2.A}}' }], [DS, { id: 'd2', name: 'Other', columns: ['A'], rows: [['x']] }, { id: 'd3', name: 'Unused', columns: ['A'], rows: [] }]);
  assert.deepEqual(tokenDatasets(l.blocks).sort(), ['d1', 'd2']);
  assert.deepEqual(pruneDatasets(l).datasets.map((d) => d.id), ['d1', 'd2']);
  assert.deepEqual(normalizeLayout(l).datasets.map((d) => d.id), ['d1', 'd2']);
});

test('the page shows the figures, says when and from where a data set was filled, escapes everything, and keeps the tokens in the stored layout', () => {
  const l = layout([
    { id: 'b1', type: 'text', title: 'Tickets', text: 'Open: {{d1.Open:sum}}' },
    { id: 'b2', type: 'table', title: 'By priority', dataset: 'd1', sortable: false, totals: false },
    { id: 'b3', type: 'callout', tone: 'info', title: 'Plain', text: 'Nothing from data' },
  ]);
  const html = renderSpacePage({ title: 't', layout: l, css: CSS });
  assert.match(html, /Open: 50/);
  const stored = layoutFromHtml(html);
  assert.equal(stored.blocks[0].text, 'Open: {{d1.Open:sum}}', 'editing later still finds the token');
  assert.deepEqual(stored.datasets[0].source, DS.source);
  assert.equal((html.match(/class="wb-asof"/g) ?? []).length, 2, 'under the text with a value and under the table, not under the plain note');
  assert.match(html, /Data as of 2026-11-13 08:30 UTC · Jira via Joule/);
  const evil = renderSpacePage({ title: 't', layout: layout([{ id: 'b1', type: 'text', title: 'x', text: '{{d1.Priority}}' }], [{ ...DS, rows: [['<img src=x onerror=alert(1)>', '1', '1']], source: { ...DS.source, note: '<script>alert(1)</script>' } }]), css: CSS });
  assert.ok(!/<img src=x/.test(evil) && !/<script>alert\(1\)<\/script>/.test(evil.replace(/<script type="application\/json" id="wb-layout">[\s\S]*?<\/script>/, '')), 'a cell or a note from Joule cannot add markup');
  const unfilled = renderSpacePage({ title: 't', layout: layout([{ id: 'b1', type: 'table', title: 'T', dataset: 'd1', sortable: false, totals: false }], [{ ...DS, source: { ...DS.source, asOf: '', note: '' } }]), css: CSS });
  assert.match(unfilled, /Data not filled yet/);
  const typed = renderSpacePage({ title: 't', layout: layout([{ id: 'b1', type: 'table', title: 'T', dataset: 'd1', sortable: false, totals: false }], [{ id: 'd1', name: 'x', columns: ['A'], rows: [['1']] }]), css: CSS });
  assert.ok(!/wb-asof"/.test(typed), 'typed numbers have no "as of" line');
});

test('the page has no network and no storage, also with tokens', () => {
  const html = renderSpacePage({ title: 't', layout: layout([{ id: 'b1', type: 'text', title: '', text: '{{d1.Open:sum}}' }]), css: CSS });
  assert.doesNotMatch(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/);
});
