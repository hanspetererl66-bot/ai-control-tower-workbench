import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PREFERENCES, SPACES_VIEWS, importPreferences, exportPreferences, profileSettingsOf, sanitizePreferences, sanitizeProfileSettings } from '../src/preferences.ts';
import { spaceKey, treeNavigate, treeRows } from '../src/spaces-tree.ts';

const spaces = [{ slug: 'it' }, { slug: 'it-fleet' }, { slug: 'it-ops' }, { slug: 'sales' }];
const parents = { 'it-fleet': 'it', 'it-ops': 'it' };
const parentOf = (slug) => parents[slug] ?? '';

test('rows: a Space is followed by its subspaces, one level deep, in list order', () => {
  const rows = treeRows(spaces, parentOf, [], false);
  assert.deepEqual(rows.map((r) => `${r.depth}:${r.slug}`), ['0:it', '1:it-fleet', '1:it-ops', '0:sales']);
  assert.equal(rows[0].subCount, 2);
  assert.equal(rows[0].expanded, true);
  assert.equal(rows[1].parent, 'it');
  assert.equal(rows[3].subCount, 0);
  assert.equal(rows[3].expanded, false, 'a Space without subspaces has nothing to open');
});

test('rows: a collapsed Space hides its subspaces but still counts them', () => {
  const rows = treeRows(spaces, parentOf, [spaceKey('it')], false);
  assert.deepEqual(rows.map((r) => r.slug), ['it', 'sales']);
  assert.equal(rows[0].subCount, 2);
  assert.equal(rows[0].expanded, false);
});

test('rows: while searching, hits are flat so a subspace is found even without its parent', () => {
  const hits = [{ slug: 'it-fleet' }, { slug: 'sales' }];
  const rows = treeRows(hits, parentOf, [], true);
  assert.deepEqual(rows.map((r) => `${r.depth}:${r.slug}:${r.parent}`), ['0:it-fleet:', '0:sales:']);
  assert.ok(rows.every((r) => r.subCount === 0));
});

test('rows: a subspace whose parent is not in the list is not shown (same as the cards)', () => {
  const rows = treeRows([{ slug: 'it-fleet' }, { slug: 'sales' }], parentOf, [], false);
  assert.deepEqual(rows.map((r) => r.slug), ['sales']);
});

test('keys: Up and Down move, Home and End jump, and nothing moves past the ends', () => {
  const rows = treeRows(spaces, parentOf, [], false);
  assert.deepEqual(treeNavigate(rows, 0, 'ArrowDown'), { focus: 1 });
  assert.deepEqual(treeNavigate(rows, 2, 'ArrowUp'), { focus: 1 });
  assert.equal(treeNavigate(rows, 0, 'ArrowUp'), null);
  assert.equal(treeNavigate(rows, rows.length - 1, 'ArrowDown'), null);
  assert.deepEqual(treeNavigate(rows, 2, 'Home'), { focus: 0 });
  assert.deepEqual(treeNavigate(rows, 0, 'End'), { focus: rows.length - 1 });
  assert.equal(treeNavigate(rows, 1, 'a'), null, 'other keys are left alone');
  assert.equal(treeNavigate(rows, 99, 'ArrowDown'), null, 'an unknown row is ignored');
});

test('keys: Right opens a collapsed Space, then steps into its first subspace; Left closes it, then steps up to the parent', () => {
  const closed = treeRows(spaces, parentOf, [spaceKey('it')], false);
  assert.deepEqual(treeNavigate(closed, 0, 'ArrowRight'), { toggle: 'it' });
  assert.equal(treeNavigate(closed, 1, 'ArrowRight'), null, 'a Space without subspaces does not open');
  const open = treeRows(spaces, parentOf, [], false);
  assert.deepEqual(treeNavigate(open, 0, 'ArrowRight'), { focus: 1 });
  assert.deepEqual(treeNavigate(open, 0, 'ArrowLeft'), { toggle: 'it' }, 'an open Space closes first');
  assert.deepEqual(treeNavigate(open, 2, 'ArrowLeft'), { focus: 0 }, 'a subspace steps up to its parent');
  assert.equal(treeNavigate(open, 3, 'ArrowLeft'), null, 'a top-level Space without subspaces has nowhere to go');
});

test('setting: the Spaces list is cards by default, the choice is part of the profile and survives export and import', () => {
  assert.deepEqual([...SPACES_VIEWS], ['cards', 'tree']);
  assert.equal(DEFAULT_PREFERENCES.spacesView, 'cards');
  assert.equal(sanitizePreferences({}).spacesView, 'cards');
  assert.equal(sanitizePreferences({ spacesView: 'tree' }).spacesView, 'tree');
  assert.equal(sanitizePreferences({ spacesView: 'grid' }).spacesView, 'cards', 'an unknown value falls back');
  assert.deepEqual(sanitizeProfileSettings({ spacesView: 'tree' }), { spacesView: 'tree' });
  assert.deepEqual(sanitizeProfileSettings({ spacesView: 'x' }), {}, 'an invalid profile value is dropped, not defaulted');
  const p = { ...DEFAULT_PREFERENCES, spacesView: 'tree' };
  assert.equal(profileSettingsOf(p).spacesView, 'tree');
  assert.equal(importPreferences(exportPreferences(p)).spacesView, 'tree');
});
