import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const read = (f) => readFileSync(join(import.meta.dirname, '../src/ui', f), 'utf8');

test('Profiles panel confirms the active profile', () => {
  const s = read('PreferencesPanels.tsx');
  assert.match(s, /is active and saved/);
  assert.match(s, /Active ✓/);
  assert.match(s, /aria-live="polite"/);
});

test('Working profile panel shows "Saved" after a change and clears it again', () => {
  const s = read('HarnessPanel.tsx');
  assert.match(s, /Saved ✓/);
  assert.match(s, /setSavedAt\(Date\.now\(\)\)/);
  assert.match(s, /clearTimeout/);
});
