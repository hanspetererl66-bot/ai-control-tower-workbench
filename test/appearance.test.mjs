import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPEARANCE_STORAGE_KEY,
  parseAppearance,
  readAppearance,
  resolveAppearance,
  writeAppearance,
} from '../src/appearance.ts';

test('appearance preference accepts only system, light, and dark', () => {
  assert.equal(parseAppearance('system'), 'system');
  assert.equal(parseAppearance('light'), 'light');
  assert.equal(parseAppearance('dark'), 'dark');
  assert.equal(parseAppearance('sepia'), 'system');
  assert.equal(parseAppearance(null), 'system');
});

test('system appearance follows the current operating-system theme', () => {
  assert.equal(resolveAppearance('system', true), 'dark');
  assert.equal(resolveAppearance('system', false), 'light');
  assert.equal(resolveAppearance('dark', false), 'dark');
  assert.equal(resolveAppearance('light', true), 'light');
});

test('appearance preference round-trips through storage and fails safe', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  writeAppearance('dark', storage);
  assert.equal(values.get(APPEARANCE_STORAGE_KEY), 'dark');
  assert.equal(readAppearance(storage), 'dark');
  assert.equal(readAppearance({ getItem: () => 'unknown' }), 'system');
  assert.equal(readAppearance({ getItem: () => { throw new Error('blocked'); } }), 'system');
});
