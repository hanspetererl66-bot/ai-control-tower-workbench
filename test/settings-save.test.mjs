import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '../src/preferences.ts';
import { applyDraft, changeSummary, changedKeys, isDirty } from '../src/settings-draft.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const base = sanitizePreferences({});

test('a draft that was not touched is not dirty and changes nothing', () => {
  assert.deepEqual(changedKeys(base, { ...base }), []);
  assert.equal(isDirty(base, { ...base }), false);
  assert.deepEqual(applyDraft(base, { ...base }, base), base);
  assert.equal(changeSummary(base, { ...base }), '');
});

test('the changed keys are found, also inside nested settings, and nothing else', () => {
  const draft = { ...base, skin: 'azure', tips: { ...base.tips, size: 'tiny' }, appScale: 1.25 };
  assert.deepEqual(changedKeys(base, draft).sort(), ['appScale', 'skin', 'tips']);
  assert.equal(isDirty(base, draft), true);
  assert.equal(isDirty(base, { ...base, skin: base.skin }), false, 'the same value is not a change');
  assert.equal(isDirty(base, { ...base, pinnedSpaces: ['a'] }), true);
  assert.equal(isDirty(base, { ...base, pinnedSpaces: [...base.pinnedSpaces] }), false, 'a copy is not a change');
});

test('the order of the keys inside a setting is not a change (the settings come out of different places)', () => {
  const reordered = { ...base, chat: Object.fromEntries(Object.entries(base.chat).reverse()) };
  assert.notEqual(JSON.stringify(reordered.chat), JSON.stringify(base.chat), 'the test really has another order');
  assert.equal(isDirty(base, reordered), false);
  assert.deepEqual(changedKeys(base, sanitizePreferences({ ...base, appearance: 'light' })), ['appearance'], 'a normal edit through sanitize changes only that setting');
});

test('Save writes only what the person changed: a setting that moved meanwhile elsewhere is not overwritten by the old copy', () => {
  const draft = { ...base, skin: 'azure', appScale: 1.25 };
  const meanwhile = { ...base, cat: { ...base.cat, x: 0.3, y: 0.4 }, skin: base.skin };
  const saved = applyDraft(meanwhile, draft, base);
  assert.equal(saved.skin, 'azure');
  assert.equal(saved.appScale, 1.25);
  assert.deepEqual(saved.cat, { ...base.cat, x: 0.3, y: 0.4 }, 'Casimir keeps the place he was dragged to');
  // Saving twice is the same as saving once.
  assert.deepEqual(applyDraft(saved, draft, base), saved);
});

test('the summary names what changed in words, once each, and shortens a long list', () => {
  assert.equal(changeSummary(base, { ...base, skin: 'azure' }), 'Skin');
  assert.equal(changeSummary(base, { ...base, spacesView: 'tree', spacesDock: 'right' }), 'Spaces list', 'two keys of one topic read once');
  assert.equal(changeSummary(base, { ...base, skin: 'azure', appScale: 1.25, font: 'mono', density: 'compact', contrast: 'high' }), 'Skin, Text size, Font, Density and 1 more');
  assert.equal(DEFAULT_PREFERENCES.cat.enabled, true);
});

test('the dialog works on a draft: Save and Discard, a guard on closing, the panels get the draft, the old live buttons are gone', () => {
  const d = read('src/ui/SettingsDialog.tsx');
  assert.match(d, /applyDraft\(current, mine, was\)/, 'Save writes the changed keys');
  assert.match(d, /onClick=\{save\} disabled=\{!dirty\}>Save</);
  assert.match(d, /onClick=\{discard\} disabled=\{!dirty\}>Discard</);
  assert.match(d, /Save and close/); assert.match(d, /Discard and close/); assert.match(d, /Keep editing/);
  assert.match(d, /const requestClose = \(\) => \{ if \(dirty\) setAsking\(true\); else onClose\(\); \}/, 'closing with unsaved changes asks first');
  assert.match(d, /className="icon-btn settings-close" onClick=\{requestClose\}/);
  assert.match(d, /event\.target === event\.currentTarget\) requestClose\(\)/, 'a click on the background asks too');
  assert.match(d, /if \(askingRef\.current\) setAsking\(false\); else closeRef\.current\(\)/, 'Escape closes the question first');
  for (const p of ['ProfilesPanel', 'LookPanel', 'AssistantPanel', 'WorkPanel', 'StoragePanel']) assert.match(d, new RegExp(`<${p} prefs=\\{panelPrefs\\} update=\\{panelUpdate\\}`), `${p} edits the draft`);
  assert.doesNotMatch(d, /update=\{personalize\.update\}/, 'no panel writes straight to the settings');
  assert.match(d, /onClick=\{\(\) => pickAppearance\(option\.id\)\}/);
  assert.match(d, /onClick=\{\(\) => pickScale\(scale\)\}/);
  assert.doesNotMatch(d, /onClick=\{\(\) => onChange\(option\.id\)\}/, 'the appearance is no longer applied at once');
  assert.match(read('src/theme.css'), /\.settings-foot-dirty \.settings-foot-msg/);
});
