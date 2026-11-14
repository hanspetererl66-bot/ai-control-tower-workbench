import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';
import { applySpacePrefs, spaceTipsMessage } from '../src/preferences-style.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const page = '<html><head></head><body></body></html>';

test('a Space is told the tips when it loads: nothing for the defaults, off, size and colours', () => {
  assert.equal(applySpacePrefs(page, { ...DEFAULT_PREFERENCES, tips: { ...DEFAULT_PREFERENCES.tips } }), applySpacePrefs(page, { ...DEFAULT_PREFERENCES, tips: undefined }), 'the default tips add nothing to what the skin sets');
  const off = applySpacePrefs(page, { ...DEFAULT_PREFERENCES, tips: { ...DEFAULT_PREFERENCES.tips, enabled: false } });
  assert.match(off, /html:root\{--wb-tips:off\}/);
  const styled = applySpacePrefs(page, { ...DEFAULT_PREFERENCES, tips: { enabled: true, size: 'large', textColor: '#111111', bubbleColor: '#ffeeaa', highlightColor: '#ff0000' } });
  assert.match(styled, /html:root\{--tip-size:16px;--tip-text:#111111;--tip-bg:#ffeeaa;--tip-mark:#ff0000\}/);
  assert.doesNotMatch(styled, /--wb-tips/, 'on is the default and sets nothing');
});

test('a change in Settings reaches an open Space as a message', () => {
  assert.deepEqual(spaceTipsMessage({ enabled: false, size: 'xlarge', textColor: '', bubbleColor: '#fff', highlightColor: '' }), { type: 'ct:tips', enabled: false, size: 18.5, textColor: '', bubbleColor: '#fff', highlightColor: '' });
  assert.equal(spaceTipsMessage(DEFAULT_PREFERENCES.tips).size, null, 'normal size follows the skin');
});

test('the viewer sends the change without reloading the page, takes "Turn off tips" back and stores it as the setting', () => {
  const viewer = read('src/ui/SpaceViewer.tsx');
  assert.match(viewer, /applySpacePrefs\(themed, \{ \.\.\.prefs, tips: tipsAtLoad\.current \}\)/, 'the page source only knows the tips of its start, so a change does not reload it');
  assert.match(viewer, /postMessage\(spaceTipsMessage\(prefs\.tips\)/);
  assert.match(viewer, /event\.data\.type === 'wb:tips' && typeof event\.data\.enabled === 'boolean'/);
  assert.match(read('src/App.tsx'), /onTips=\{\(enabled\) => updatePrefs\(\(c\) => \(\{ \.\.\.c, tips: \{ \.\.\.c\.tips, enabled \} \}\)\)\}/);
  assert.match(read('src/ui/PreferencesPanels.tsx'), /in Spaces that have them \(Revenue Recognition\)/);
  assert.match(read('src/settings-help.ts'), /of Spaces that have tips \(Revenue Recognition\)/);
});
