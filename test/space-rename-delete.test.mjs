import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PREFERENCES, applySpaceTitles, cleanSpaceTitle, forgetSpace, parentOf, renameSpace, sanitizePreferences } from '../src/preferences.ts';

const spaces = [
  { slug: 'it', title: 'IT' },
  { slug: 'it-fleet', title: 'IT Fleet', parent: 'it' },
  { slug: 'sales', title: 'Sales' },
];

test('a title is one clean line of at most 80 characters', () => {
  assert.equal(cleanSpaceTitle('  Cloud\n\tOps  '), 'Cloud Ops');
  assert.equal(cleanSpaceTitle('x'.repeat(200)).length, 80);
  assert.equal(cleanSpaceTitle('   '), '');
  assert.equal(cleanSpaceTitle(5), '');
});

test('rename keeps an own name, and the original name or an empty one takes it back', () => {
  let p = renameSpace(DEFAULT_PREFERENCES, 'it', 'Cloud Infrastructure Operations', 'IT');
  assert.deepEqual(applySpaceTitles(spaces, p).map((s) => s.title), ['Cloud Infrastructure Operations', 'IT Fleet', 'Sales']);
  assert.equal(spaces[0].title, 'IT', 'the list itself is not changed');
  p = renameSpace(p, 'it', '', 'IT');
  assert.deepEqual(p.spaceTitles, {});
  p = renameSpace(p, 'it-fleet', 'Fleet', 'IT Fleet');
  p = renameSpace(p, 'it-fleet', 'IT Fleet', 'IT Fleet');
  assert.deepEqual(p.spaceTitles, {});
});

test('own names survive sanitising and bad entries are dropped', () => {
  const p = sanitizePreferences({ spaceTitles: { it: ' Neu ', 'Bad Slug': 'x', sales: '   ' } });
  assert.deepEqual(p.spaceTitles, { it: 'Neu' });
});

test('forgetting a Space removes every trace and moves its subspaces to the top level', () => {
  const base = { ...DEFAULT_PREFERENCES, pinnedSpaces: ['it', 'sales'], spaceDomains: { it: 'Ops', sales: 'Sales' }, spaceTitles: { it: 'Cloud', sales: 'Vertrieb' }, startView: 'space:it' };
  const p = forgetSpace(base, 'it', spaces);
  assert.deepEqual(p.pinnedSpaces, ['sales']);
  assert.deepEqual(p.spaceDomains, { sales: 'Sales' });
  assert.deepEqual(p.spaceTitles, { sales: 'Vertrieb' });
  assert.equal(p.startView, 'chat');
  const remaining = spaces.filter((s) => s.slug !== 'it');
  assert.equal(parentOf(remaining[0], remaining, p), '', 'the former subspace is now on the top level');
  assert.equal(forgetSpace(base, 'sales', spaces).startView, 'space:it');
});
