import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { barModel, chipOf } from '../src/spaces-bar.ts';

const domains = ['Sales', 'Ops', 'Empty'];
const home = { a: 'Sales', a1: 'Sales', a2: 'Sales', b: 'Sales', c: 'Ops', c1: 'Ops', d: 'Ops' };
const parents = { a1: 'a', a2: 'a', c1: 'c' };
const spaces = ['a', 'a1', 'a2', 'b', 'c', 'c1', 'd'].map((slug) => ({ slug }));
const base = { spaces, domains, domainOf: (s) => home[s], parentOf: (s) => parents[s] ?? '', selected: null, chosen: null, searching: false };

test('tabs: every domain with the number of its Spaces, in display order', () => {
  const m = barModel(base);
  assert.deepEqual(m.tabs, [{ name: 'Sales', count: 4 }, { name: 'Ops', count: 3 }, { name: 'Empty', count: 0 }]);
  assert.equal(m.flat, false);
});

test('the open tab: the one clicked, else the domain of the open Space, else the first domain that has Spaces', () => {
  assert.equal(barModel({ ...base, selected: 'c1' }).active, 'Ops', 'the open Space decides');
  assert.equal(barModel({ ...base, selected: 'c1', chosen: 'Sales' }).active, 'Sales', 'a clicked tab wins');
  assert.equal(barModel({ ...base, chosen: 'Gone' }).active, 'Sales', 'a tab that no longer exists is ignored');
  assert.equal(barModel({ ...base, spaces: spaces.filter((s) => home[s.slug] === 'Ops') }).active, 'Ops', 'the first domain with Spaces, not an empty one');
  assert.equal(barModel({ ...base, spaces: [], domains: ['Only'] }).active, 'Only');
  assert.equal(barModel({ ...base, spaces: [], domains: [] }).active, '', 'no domains, no tab');
});

test('chips: the top-level Spaces of the open domain, each with its subspaces', () => {
  const m = barModel(base);
  assert.deepEqual(m.chips, [{ slug: 'a', subs: ['a1', 'a2'] }, { slug: 'b', subs: [] }]);
  assert.deepEqual(barModel({ ...base, chosen: 'Ops' }).chips, [{ slug: 'c', subs: ['c1'] }, { slug: 'd', subs: [] }]);
  assert.deepEqual(barModel({ ...base, chosen: 'Empty' }).chips, [], 'an empty domain has no chips');
});

test('chips: a subspace whose parent is not in the list is not shown, like in the cards', () => {
  const m = barModel({ ...base, spaces: spaces.filter((s) => s.slug !== 'a') });
  assert.deepEqual(m.chips.map((c) => c.slug), ['b']);
});

test('searching: no tabs, the hits are one flat row, subspaces included', () => {
  const m = barModel({ ...base, spaces: [{ slug: 'a1' }, { slug: 'd' }], searching: true });
  assert.equal(m.flat, true);
  assert.deepEqual(m.tabs, []);
  assert.deepEqual(m.chips, [{ slug: 'a1', subs: [] }, { slug: 'd', subs: [] }]);
});

test('the chip of the open Space: the Space itself, or the Space whose subspace is open', () => {
  const { chips } = barModel(base);
  assert.equal(chipOf(chips, 'a'), 'a');
  assert.equal(chipOf(chips, 'a2'), 'a');
  assert.equal(chipOf(chips, 'b'), 'b');
  assert.equal(chipOf(chips, 'c'), '', 'a Space of another domain has no chip here');
  assert.equal(chipOf(chips, null), '');
});

test('the subspace menu of the bar floats, so the sideways-scrolling chip row cannot cut it off, and it uses a token the app defines', () => {
  const list = readFileSync(new URL('../src/ui/SpacesList.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  assert.match(list, /className="bar-pop bar-pop-float" role="menu" ref=\{placeSubMenu\}/);
  assert.match(list, /dock === 'bottom'[^\n]*bottom = /, 'a bar at the bottom opens the menu upward');
  assert.match(css, /\.bar-pop-float \{ position: fixed;/);
  assert.match(css, /\.bar-chips \{[^}]*overflow-x: auto/, 'the reason for floating');
  const bar = css.slice(css.indexOf('.list-bar {'), css.indexOf('/* Ontology Manager: lifecycle'));
  assert.doesNotMatch(bar, /var\(--surface\)/, 'the app has --panel, not --surface: the menu would have no background');
});
