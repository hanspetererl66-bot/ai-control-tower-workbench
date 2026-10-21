import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { SPACE_TOOLS_SCRIPT, applySpaceTools } from '../src/space-tools.ts';

function helpers() {
  const window = { __WB_TEST__: true };
  vm.runInNewContext(SPACE_TOOLS_SCRIPT, { window, String, Object, Array, JSON, RegExp });
  return window.__wbTools;
}
const raw = helpers();
// Results come from another realm; compare them as plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));
const t = { matches: raw.matches, columns: (...args) => plain(raw.columns(...args)) };

test('search ignores case, umlauts and sharp s, and needs every word', () => {
  assert.equal(t.matches('Verträge der Muster Industrie AG', 'vertraege'), false, 'ae is not a transliteration of ä here');
  assert.equal(t.matches('Verträge der Muster Industrie AG', 'VERTRAGE'), true);
  assert.equal(t.matches('Straße Mannheim', 'strasse'), true);
  assert.equal(t.matches('Joule skill returns empty result', 'joule empty'), true);
  assert.equal(t.matches('Joule skill returns empty result', 'joule ariba'), false);
  assert.equal(t.matches('anything', '   '), true);
});

test('filters come from short, repeating, non-numeric columns only', () => {
  const headers = ['Ticket', 'Title', 'Priority', 'Status', 'Updated', 'Amount'];
  const rows = [
    ['TKT-1', 'A long title one', 'High', 'New', '2026-10-01', '1,200 €'],
    ['TKT-2', 'A long title two', 'Low', 'New', '2026-10-02', '800 €'],
    ['TKT-3', 'A long title three', 'High', 'Closed', '2026-10-03', '90 €'],
    ['TKT-4', 'A long title four', 'Medium', 'Closed', '2026-10-04', '10 €'],
  ];
  const found = t.columns(headers, rows);
  assert.deepEqual(found.map((c) => c.label), ['Priority', 'Status']);
  assert.deepEqual(found[0].values, ['High', 'Low', 'Medium']);
});

test('no filters for tiny tables, unique columns or numeric columns', () => {
  assert.deepEqual(t.columns(['Status'], [['New'], ['Closed']]), []);
  assert.deepEqual(t.columns(['Id'], [['1'], ['2'], ['3'], ['4']]), []);
  assert.deepEqual(t.columns(['Pct'], [['10%'], ['20%'], ['10%'], ['20%']]), []);
});

test('the script is injected once, before </body>, and the page keeps working without a body', () => {
  const page = '<html><body><p>x</p></body></html>';
  const once = applySpaceTools(page);
  assert.ok(once.indexOf('werkbank-space-tools') < once.indexOf('</body>'));
  assert.equal(applySpaceTools(once), once);
  assert.ok(applySpaceTools('<p>fragment</p>').startsWith('<p>fragment</p><style'));
});

test('the page only accepts messages from its parent window', () => {
  assert.match(SPACE_TOOLS_SCRIPT, /e\.source !== window\.parent/);
});

test('every bundled Space still parses with the script injected', () => {
  for (const name of readdirSync(new URL('../examples', import.meta.url))) {
    const file = join(new URL('../examples', import.meta.url).pathname, name, 'index.html');
    if (!existsSync(file)) continue;
    const html = applySpaceTools(readFileSync(file, 'utf8'));
    assert.equal((html.match(/id="werkbank-space-tools"/g) ?? []).length, 1, name);
  }
});
