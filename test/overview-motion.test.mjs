import assert from 'node:assert/strict';
import test from 'node:test';
import { freshSlugs, countAt, easeOut, FRESH_DAYS } from '../src/overview-motion.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 9, 12);

test('fresh: only a minority of recently changed Spaces is marked', () => {
  const spaces = [
    { slug: 'a', updatedAt: NOW - 2 * 3_600_000 },
    { slug: 'b', updatedAt: NOW - (FRESH_DAYS + 1) * DAY },
    { slug: 'c', updatedAt: NOW - 20 * DAY },
    { slug: 'd', updatedAt: NOW - 30 * DAY },
    { slug: 'e', updatedAt: NOW - 40 * DAY },
  ];
  assert.deepEqual([...freshSlugs(spaces, NOW)], ['a']);
});

test('fresh: after an install every Space is new, so none is marked', () => {
  const all = ['a', 'b', 'c', 'd'].map((slug) => ({ slug, updatedAt: NOW - 3_600_000 }));
  assert.equal(freshSlugs(all, NOW).size, 0);
  const half = [{ slug: 'a', updatedAt: NOW - 1000 }, { slug: 'b', updatedAt: NOW - 1000 }, { slug: 'c', updatedAt: NOW - 90 * DAY }, { slug: 'd', updatedAt: NOW - 90 * DAY }];
  assert.equal(freshSlugs(half, NOW).size, 0, 'half or more is not a signal');
  assert.equal(freshSlugs([], NOW).size, 0);
});

test('fresh: a date in the future or an unknown date is not recent', () => {
  const spaces = [{ slug: 'a', updatedAt: NOW + 10 * DAY }, { slug: 'b', updatedAt: 0 }, { slug: 'c', updatedAt: NOW - 50 * DAY }, { slug: 'd', updatedAt: NOW - 60 * DAY }, { slug: 'e', updatedAt: NOW - 1000 }];
  assert.deepEqual([...freshSlugs(spaces, NOW)], ['e']);
});

test('count-up: starts at zero, only grows, ends exactly on the real number', () => {
  assert.equal(countAt(47, 0), 0);
  assert.equal(countAt(47, 1), 47);
  assert.equal(countAt(47, 7), 47);
  let last = -1;
  for (let p = 0; p <= 1.0001; p += 0.05) { const v = countAt(47, p); assert.ok(v >= last && v <= 47); last = v; }
  assert.equal(easeOut(-1), 0);
  assert.equal(easeOut(2), 1);
});
