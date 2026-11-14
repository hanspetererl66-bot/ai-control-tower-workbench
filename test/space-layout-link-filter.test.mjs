import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { BLOCK_INFO, addBlock, emptyLayout, normalizeLayout, removeBlock } from '../src/space-layout.ts';
import { renderSpacePage } from '../src/space-layout-render.ts';
import { SCHEMA_HELP } from '../src/space-designer-ai.ts';
import { parseOpenSpaceMessage } from '../src/space-open.ts';

const DS = { id: 'd1', name: 'Tickets', columns: ['Name', 'Status', 'Amount'], rows: [['Alpha', '{ok} Done', '10'], ['Beta', '{bad} Blocked', '20'], ['Gamma', '{ok} Done', '30']] };
const table = { id: 't1', type: 'table', title: 'Tickets', dataset: 'd1', sortable: true, totals: false };
const layout = (blocks) => normalizeLayout({ datasets: [DS], blocks });

test('the two new blocks are in the palette and the schema help that the agent gets', () => {
  for (const type of ['filter', 'spacelink']) {
    assert.ok(BLOCK_INFO.some((i) => i.type === type));
    assert.match(SCHEMA_HELP, new RegExp(`- ${type}:`));
  }
});

test('a filter belongs to a table: a wrong or missing table becomes the next table, a column the table lacks is dropped, no table gives an empty link', () => {
  const l = layout([{ type: 'filter', label: 'Find', table: 'nope', column: 'Nope' }, table]);
  assert.equal(l.blocks[0].table, 't1');
  assert.equal(l.blocks[0].column, '');
  assert.equal(layout([{ type: 'filter', label: 'Find', table: 't1', column: 'Status' }, table]).blocks[0].column, 'Status');
  assert.equal(normalizeLayout({ blocks: [{ type: 'filter', label: 'x', table: 't1' }] }).blocks[0].table, '');
});

test('removing the table a filter points at repairs the filter instead of leaving it dangling; a new filter picks the first table', () => {
  let l = layout([table, { id: 't2', type: 'table', title: 'More', dataset: 'd1', sortable: false, totals: false }]);
  l = addBlock(l, 'filter').layout;
  const f = l.blocks.find((b) => b.type === 'filter');
  assert.equal(f.table, 't1');
  const after = removeBlock(l, 't1');
  assert.equal(after.blocks.find((b) => b.type === 'filter').table, 't2');
  assert.equal(removeBlock(after, 't2').blocks.find((b) => b.type === 'filter').table, '');
  assert.equal(addBlock(emptyLayout(), 'filter').layout.blocks[0].table, '');
});

test('a link keeps only a folder name: paths, URLs and odd text are dropped', () => {
  const space = (v) => normalizeLayout({ blocks: [{ type: 'spacelink', label: 'Go', text: 't', space: v }] }).blocks[0].space;
  assert.equal(space('infra-ops'), 'infra-ops');
  for (const bad of ['../etc', 'a/b', 'https://x.test', 'javascript:alert(1)', '', ' x', 'a'.repeat(80)]) assert.equal(space(bad), '', bad);
});

test('the page for a link carries the folder name and the open script; without a Space the button is off; texts are escaped', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const html = renderSpacePage({ title: 't', css: '', layout: normalizeLayout({ blocks: [{ type: 'spacelink', label: evil, text: evil, space: 'infra-ops' }, { type: 'spacelink', label: 'Off', text: '', space: '' }] }) });
  assert.match(html, /data-wb-open-space="infra-ops"/);
  assert.match(html, /data-wb-open-space="" disabled/);
  assert.match(html, /window\.parent\.postMessage\(\{type:'wb:open-space',to:s\}/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal(html.includes('fetch(') || html.includes('XMLHttpRequest') || html.includes('localStorage'), false);
});

test('the host accepts only a plain folder name in an open-space message', () => {
  assert.equal(parseOpenSpaceMessage({ type: 'wb:open-space', to: 'infra-ops' }), 'infra-ops');
  for (const bad of [null, 'x', {}, { type: 'wb:open-space' }, { type: 'wb:open-space', to: '../x' }, { type: 'wb:open-space', to: 5 }, { type: 'wb:handoff', to: 'infra-ops' }]) assert.equal(parseOpenSpaceMessage(bad), null);
});

test('in the page the search box and the pick list hide rows that do not match, and say how many are left', () => {
  const html = renderSpacePage({ title: 't', css: '', layout: layout([{ type: 'filter', label: 'Find a ticket', table: 't1', column: 'Status' }, table]) });
  assert.match(html, /placeholder="Find a ticket"/);
  assert.match(html, /<option>Done<\/option><option>Blocked<\/option>|<option>Blocked<\/option><option>Done<\/option>/, 'the pick list holds each value once, without the status marker');
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const { document } = dom.window;
  const rows = () => [...document.querySelectorAll('[data-wb-block="t1"] tbody tr')];
  const input = document.querySelector('.wb-filter input');
  input.value = 'beta';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual(rows().map((r) => r.hidden), [true, false, true]);
  assert.equal(document.querySelector('.wb-count').textContent, '1 of 3 rows');
  input.value = '';
  const select = document.querySelector('.wb-filter select');
  select.value = 'Done';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(rows().map((r) => r.hidden), [false, true, false]);
  select.value = '';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(rows().map((r) => r.hidden), [false, false, false]);
  assert.equal(document.querySelector('.wb-count').textContent, '');
});

test('a filter without a table says so instead of breaking the page', () => {
  const html = renderSpacePage({ title: 't', css: '', layout: normalizeLayout({ blocks: [{ type: 'filter', label: 'x' }] }) });
  assert.match(html, /needs a table/);
});
