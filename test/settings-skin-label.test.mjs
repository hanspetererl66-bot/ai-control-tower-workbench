import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { TAB_HELP } from '../src/settings-help.ts';

const ROOT = join(import.meta.dirname, '..');

test('settings: the tab that was called Look is called Skin (the internal id stays look)', () => {
  const dialog = readFileSync(join(ROOT, 'src/ui/SettingsDialog.tsx'), 'utf8');
  assert.match(dialog, /\{ id: 'look', title: 'Skin' \}/);
  assert.doesNotMatch(dialog, /title: 'Look'/);
  assert.ok(TAB_HELP.look, 'the tab keeps its help text');
  assert.match(TAB_HELP.profiles.where, /^Skin, /, 'the profile help names the tab by its new name');
});
