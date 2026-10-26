import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_PREFERENCES, archiveSpace, forgetSpace, resetAll, restoreSpace, sanitizePreferences, splitArchived } from '../src/preferences.ts';

const spaces = [
  { slug: 'it', title: 'IT' },
  { slug: 'it-fleet', title: 'IT Fleet', parent: 'it' },
  { slug: 'sales', title: 'Sales' },
];

test('archiving hides a Space, unpins it and moves its subspaces to the top level', () => {
  const base = { ...DEFAULT_PREFERENCES, pinnedSpaces: ['it', 'sales'] };
  const p = archiveSpace(base, 'it', spaces);
  assert.deepEqual(p.archivedSpaces, ['it']);
  assert.deepEqual(p.pinnedSpaces, ['sales']);
  assert.equal(p.spaceParents['it-fleet'], '');
  assert.equal(archiveSpace(p, 'it', spaces), p, 'archiving twice changes nothing');
});

test('split lists active Spaces and archived ones, newest archived first', () => {
  let p = archiveSpace(DEFAULT_PREFERENCES, 'sales', spaces);
  p = archiveSpace(p, 'it', spaces);
  const { active, archived } = splitArchived(spaces, p);
  assert.deepEqual(active.map((s) => s.slug), ['it-fleet']);
  assert.deepEqual(archived.map((s) => s.slug), ['it', 'sales']);
});

test('restore brings a Space back', () => {
  const p = restoreSpace(archiveSpace(DEFAULT_PREFERENCES, 'sales', spaces), 'sales');
  assert.deepEqual(p.archivedSpaces, []);
  assert.equal(splitArchived(spaces, p).active.length, 3);
});

test('deleting an archived Space and resetting settings behave', () => {
  const p = archiveSpace(DEFAULT_PREFERENCES, 'sales', spaces);
  assert.deepEqual(forgetSpace(p, 'sales', spaces).archivedSpaces, []);
  assert.deepEqual(resetAll({ ...p, accent: '#ff0000' }).archivedSpaces, ['sales'], 'a settings reset does not un-archive');
});

test('sanitising drops bad entries', () => {
  assert.deepEqual(sanitizePreferences({ archivedSpaces: ['ok', 'Bad Slug', 5] }).archivedSpaces, ['ok']);
  assert.deepEqual(sanitizePreferences({ archivedSpaces: 'x' }).archivedSpaces, []);
});

test('each Space card has archive and delete icons that are always visible', () => {
  const src = readFileSync(new URL('../src/ui/SpacesList.tsx', import.meta.url), 'utf8');
  assert.match(src, /Archive \$\{s\.title\}/);
  assert.match(src, /mini-icon-danger mini-icon-always/);
  assert.match(src, /Archived Spaces/);
});
