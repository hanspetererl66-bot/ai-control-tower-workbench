import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SECTION_EFFECT, TAB_HELP, sectionEffect } from '../src/settings-help.ts';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const css = read('src/theme.css');
const dialog = read('src/ui/SettingsDialog.tsx');

test('every Settings tab explains what it is, where it applies and what changes', () => {
  const ids = [...dialog.matchAll(/\{ id: '(\w+)', title: '\w+' \}/g)].map((m) => m[1]);
  assert.ok(ids.length >= 8);
  for (const id of ids) {
    const h = TAB_HELP[id];
    assert.ok(h, `tab ${id} has help`);
    for (const key of ['what', 'where', 'effect']) assert.ok(h[key].length > 30, `${id}.${key}`);
  }
});

test('every static Settings section has a "what it does" line', () => {
  const files = ['src/ui/PreferencesPanels.tsx', 'src/ui/GroupsPanel.tsx', 'src/ui/MemoryPanel.tsx', 'src/ui/SettingsDialog.tsx'].map(read).join('\n');
  const titles = [...new Set([...files.matchAll(/<Section title="([^"]+)"/g)].map((m) => m[1]))];
  assert.ok(titles.length >= 25, `found ${titles.length} sections`);
  for (const t of titles) assert.ok(sectionEffect(t).length > 20, `missing effect for "${t}"`);
  for (const t of ['Appearance', 'Text size in Spaces', 'Sprache']) assert.ok(sectionEffect(t), t);
});

test('effect lines are plain sentences and do not promise things the app does not do', () => {
  for (const [title, text] of SECTION_EFFECT) {
    assert.match(text, /[.!?]$/, title);
    assert.doesNotMatch(text, /\bTODO\b|\bTBD\b/, title);
  }
  assert.match(sectionEffect('Export and import'), /export first/i);
  assert.match(sectionEffect('Team memory'), /confidential/);
});

test('the settings window can be resized with the mouse and enlarged with a button', () => {
  assert.match(css, /\.dialog\.settings-dialog\s*{[^}]*resize:\s*both/s);
  assert.match(css, /\.dialog\.settings-dialog\s*{[^}]*max-width:\s*calc\(100vw/s);
  assert.doesNotMatch(css, /\.dialog\.settings-dialog\s*{[^}]*max-width:\s*620px/s, 'no fixed 620px cap any more');
  assert.match(css, /\.prefs-body\s*{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
  assert.doesNotMatch(css, /\.prefs-body\s*{[^}]*max-height/s, 'the body grows with the window');
  assert.match(dialog, /settings-size/);
  assert.match(dialog, /aria-pressed=\{large\}/);
});
