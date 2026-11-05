import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LAYOUT, LAYOUTS, LAYOUT_DEFS, LAYOUT_LIST, isLayout, layoutAppCss, layoutSpaceRules } from '../src/layouts.ts';
import { DEFAULT_PREFERENCES, isOriginalLook, resetLook, sanitizePreferences, profileSettingsOf } from '../src/preferences.ts';
import { applySpacePrefs, buildPreferenceCss } from '../src/preferences-style.ts';

test('three layouts, the quiet one is the default', () => {
  assert.deepEqual([...LAYOUTS], ['minimal', 'expressive', 'contemporary']);
  assert.equal(DEFAULT_LAYOUT, 'minimal');
  assert.equal(DEFAULT_PREFERENCES.layout, 'minimal');
  assert.equal(LAYOUT_LIST.length, 3);
  for (const l of LAYOUT_LIST) assert.ok(l.name && l.description && l.space.length && l.app.length);
});

test('layouts never set colours: only tokens, no hex values', () => {
  for (const id of LAYOUTS) {
    const css = [...layoutSpaceRules(id), ...layoutAppCss(id)].join('\n');
    assert.equal(/#[0-9a-f]{3,8}\b/i.test(css), false, `${id} contains a hex colour`);
    assert.equal(/\burl\(|@import|https?:/.test(css), false, `${id} loads something from outside`);
  }
});

test('layouts differ in shape: corner radius grows from minimal to expressive', () => {
  const radius = (id) => Number(/--radius:(\d+)px/.exec(layoutSpaceRules(id)[0])[1]);
  assert.ok(radius('minimal') < radius('contemporary') && radius('contemporary') < radius('expressive'));
  assert.match(layoutSpaceRules('minimal').join(''), /--shadow:none/);
  assert.match(layoutSpaceRules('contemporary').join(''), /backdrop-filter/);
  assert.match(layoutSpaceRules('expressive').join(''), /prefers-reduced-motion:no-preference/, 'lift on hover only without reduced motion');
  assert.doesNotMatch(layoutSpaceRules('minimal').join(''), /transform/);
});

test('a layout is saved, validated, part of the profile and of the look', () => {
  assert.equal(sanitizePreferences({ layout: 'expressive' }).layout, 'expressive');
  assert.equal(sanitizePreferences({ layout: 'baroque' }).layout, 'minimal', 'unknown layouts fall back');
  assert.equal(sanitizePreferences({ layout: 7 }).layout, 'minimal');
  assert.equal(isLayout('contemporary'), true);
  const p = { ...DEFAULT_PREFERENCES, layout: 'contemporary' };
  assert.equal(profileSettingsOf(p).layout, 'contemporary');
  assert.equal(isOriginalLook(p), false);
  assert.equal(resetLook(p).layout, 'minimal');
});

test('the app and the Spaces get the chosen layout, after the skin and before the accent', () => {
  for (const id of LAYOUTS) {
    assert.ok(buildPreferenceCss({ ...DEFAULT_PREFERENCES, layout: id }).includes(LAYOUT_DEFS[id].app[0]));
    assert.ok(applySpacePrefs('<html><head></head></html>', { ...DEFAULT_PREFERENCES, layout: id }).includes(LAYOUT_DEFS[id].space[0]));
  }
  const html = applySpacePrefs('<html><head></head></html>', { ...DEFAULT_PREFERENCES, skin: 'mono', layout: 'expressive', accent: '#C2185B' });
  assert.ok(html.indexOf('--canvas:#f5f5f5') < html.indexOf('--radius:28px'), 'skin first, then layout');
  assert.ok(html.indexOf('--radius:28px') < html.indexOf('--purple:#C2185B'), 'accent last');
});
