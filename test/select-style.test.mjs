import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';
import { applySpacePrefs, contrastRatio } from '../src/preferences-style.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('src/theme.css');
const block = css.slice(css.indexOf('/* Dropdown boxes (select), lighter and medium grey'));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, p) => `#${hex(a).map((v, i) => Math.round(v * p + hex(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('')}`;
const lum = (h) => { const [r, g, b] = hex(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const token = (src, name) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(src)[1];

test('dropdown boxes: one rule for the app, colour and weight only, tokens only, focus left to the page', () => {
  assert.match(block, /select:not\(\[multiple\]\):not\(\[size\]\):not\(#wb-sel\):not\(:focus\) \{\s*color: color-mix\(in srgb, var\(--ink\) 62%, var\(--panel\)\);\s*border-color: color-mix\(in srgb, var\(--ink\) 24%, var\(--panel\)\);\s*font-weight: 400;/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'no colour values');
  assert.doesNotMatch(block.split('select option')[0], /\b(padding|border-width|border-radius|background|width|height)\s*:/, 'size, shape and background stay as they are');
});

test('dropdown boxes in Spaces get the same look from the Space tokens, also with the default settings', () => {
  const html = applySpacePrefs('<html><head></head><body></body></html>', { ...DEFAULT_PREFERENCES });
  assert.match(html, /html select:not\(\[multiple\]\):not\(\[size\]\):not\(#wb-sel\):not\(:focus\)\{color:color-mix\(in srgb,var\(--ink\) 62%,var\(--surface\)\);border-color:color-mix\(in srgb,var\(--ink\) 24%,var\(--surface\)\);font-weight:400\}/);
  assert.match(html, /html select option\{color:var\(--ink\);background:var\(--surface\)\}/);
});

test('the text of a dropdown box is a medium grey and still readable, in light and dark, in the app and in Spaces', () => {
  const dark = css.slice(css.indexOf(':root[data-theme="dark"] {'));
  const ds = read('examples/shared/design-system.css');
  const cases = [
    ['app light', token(css, '--ink'), token(css, '--panel')],
    ['app dark', token(dark, '--ink'), token(dark, '--panel')],
    ['space light', token(ds, '--ink'), token(ds, '--surface')],
    ['space dark', token(ds.slice(ds.indexOf('prefers-color-scheme:dark')), '--ink'), token(ds.slice(ds.indexOf('prefers-color-scheme:dark')), '--surface')],
  ];
  for (const [name, ink, ground] of cases) {
    const text = mix(ink, ground, 0.62), border = mix(ink, ground, 0.24);
    assert.ok(contrastRatio(text, ground) >= 4.5, `${name}: readable (${contrastRatio(text, ground).toFixed(2)}:1)`);
    assert.ok(lum(text) > 0.15 && lum(text) < 0.6, `${name}: a medium grey (luminance ${lum(text).toFixed(2)})`);
    assert.ok(contrastRatio(border, ground) < contrastRatio(text, ground), `${name}: the border is lighter than the text`);
  }
});
