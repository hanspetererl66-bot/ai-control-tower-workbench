import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutAppCss, layoutSpaceRules } from '../src/layouts.ts';
import { DEFAULT_SKIN, SKINS, SKIN_DEFS, skinAppCss, skinSpaceRules } from '../src/skins.ts';
import { DEFAULT_PREFERENCES, resetLook, sanitizePreferences, isOriginalLook } from '../src/preferences.ts';
import { applySpacePrefs, buildPreferenceCss, luminance } from '../src/preferences-style.ts';

const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('four skins, the calm violet one is the default and needs no override', () => {
  assert.deepEqual([...SKINS], ['violet', 'mono', 'azure', 'signal']);
  assert.equal(DEFAULT_SKIN, 'violet');
  assert.deepEqual(skinSpaceRules('violet'), []);
  assert.deepEqual(skinAppCss('violet'), []);
  assert.equal(DEFAULT_PREFERENCES.skin, 'violet');
});

test('every skin keeps text, secondary text and the accent readable in light and dark', () => {
  for (const id of SKINS) {
    for (const mode of ['light', 'dark']) {
      const t = SKIN_DEFS[id].space[mode];
      assert.ok(contrast(t.ink, t.surface) >= 7, `${id} ${mode}: text on surface`);
      assert.ok(contrast(t.ink, t.canvas) >= 7, `${id} ${mode}: text on canvas`);
      assert.ok(contrast(t.muted, t.surface) >= 4.5, `${id} ${mode}: secondary text on surface`);
      assert.ok(contrast(t.accent, t.surface) >= 4.5, `${id} ${mode}: accent on surface`);
      const app = SKIN_DEFS[id].app?.[mode];
      if (app) {
        assert.ok(contrast(app.ink, app.panel) >= 7, `${id} ${mode}: app text`);
        assert.ok(contrast(app.muted, app.panel) >= 4.5, `${id} ${mode}: app secondary text`);
        assert.ok(contrast('#ffffff', app.send) >= 4.5, `${id} ${mode}: white text on the send button`);
      }
    }
  }
});

test('a skin is saved, validated and part of the look', () => {
  assert.equal(sanitizePreferences({ skin: 'azure' }).skin, 'azure');
  assert.equal(sanitizePreferences({ skin: 'neon' }).skin, 'violet', 'unknown skins fall back');
  assert.equal(sanitizePreferences({ skin: { x: 1 } }).skin, 'violet');
  const mono = { ...DEFAULT_PREFERENCES, skin: 'mono' };
  assert.equal(isOriginalLook(mono), false);
  assert.equal(resetLook(mono).skin, 'violet');
});

test('the app gets the skin tokens, then the accent colour overrides the skin accent', () => {
  assert.equal(buildPreferenceCss(DEFAULT_PREFERENCES), layoutAppCss('minimal').join('\n'), 'the default skin adds nothing, only the default layout');
  const css = buildPreferenceCss({ ...DEFAULT_PREFERENCES, skin: 'signal', accent: '#0070F2' });
  assert.match(css, /--bg:#eef3f5/);
  assert.match(css, /:root\[data-theme="dark"\]\{--bg:#06222f/);
  assert.ok(css.indexOf('--bg:#eef3f5') < css.indexOf('--accent:#0070F2'), 'accent comes after the skin');
});

test('Spaces get the whole palette from the skin and the accent on top', () => {
  const html = '<html><head></head><body></body></html>';
  const plain = applySpacePrefs(html, { ...DEFAULT_PREFERENCES });
  assert.ok(plain.includes(layoutSpaceRules('minimal').join('')) && !plain.includes('--canvas'), 'the default skin adds no palette, only the default layout');
  const azure = applySpacePrefs(html, { ...DEFAULT_PREFERENCES, skin: 'azure' });
  assert.match(azure, /--canvas:#f3f8fc/);
  assert.match(azure, /html:root\[data-theme="dark"\]\{--canvas:#0b1722/);
  const both = applySpacePrefs(html, { ...DEFAULT_PREFERENCES, skin: 'mono', accent: '#C2185B' });
  assert.ok(both.indexOf('--canvas:#f5f5f5') < both.indexOf('--purple:#C2185B'), 'accent comes after the skin');
});

test('status colours are not part of any skin', () => {
  for (const id of SKINS) assert.doesNotMatch(skinSpaceRules(id).join(''), /--(green|red|amber)/);
});
