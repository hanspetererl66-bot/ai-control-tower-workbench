import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SKINS, SKIN_DEFS, skinSpaceRules } from '../src/skins.ts';
import { accentVariants, applySpacePrefs } from '../src/preferences-style.ts';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';

/** What a Space really gets: the design-system tokens, then the skin rules (and the accent) on top. */
const system = readFileSync(new URL('../examples/shared/design-system.css', import.meta.url), 'utf8');

const rgb = (value) => {
  const v = value.trim();
  const rgba = /^rgba\(([^)]+)\)$/.exec(v);
  if (rgba) { const p = rgba[1].split(',').map(Number); return { c: p.slice(0, 3), a: p[3] }; }
  const h = v.replace('#', '');
  return { c: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), a: 1 };
};
const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const over = (fg, bg) => { const f = rgb(fg); const b = rgb(bg).c; return f.c.map((x, i) => x * f.a + b[i] * (1 - f.a)); };
const ratio = (fg, bg) => { const x = lum(rgb(fg).a < 1 ? over(fg, bg) : rgb(fg).c); const y = lum(rgb(bg).c); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const tokensOf = (css) => Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6}|rgba\([^)]*\)|var\(--[\w-]+\))/g)].map((m) => [m[1], m[2]]));
const lastBlock = (text, selector) => { const i = text.lastIndexOf(selector); return text.slice(i, text.indexOf('}', i)); };

/** Token values per skin and mode as the page sees them: design-system values, then the skin rule of that mode; var(--x) aliases resolve last. */
function seen(skin, mode) {
  const light = tokensOf(lastBlock(system, ':root{'));
  const dark = tokensOf(lastBlock(system, ':root[data-theme="dark"]{'));
  const rules = skinSpaceRules(skin);
  const rule = rules.find((r) => (mode === 'dark' ? r.startsWith('html:root[data-theme="dark"]') : r.startsWith('html:root,')));
  const t = { ...light, ...(mode === 'dark' ? dark : {}), ...(rule ? tokensOf(rule) : {}) };
  const resolve = (name, depth = 0) => { const v = t[name]; const m = /^var\(--([\w-]+)\)$/.exec(v ?? ''); return m && depth < 5 ? resolve(m[1], depth + 1) : v; };
  return new Proxy({}, { get: (_o, name) => (typeof name === 'string' ? resolve(name) : undefined) });
}

const TEXT = ['ink-2', 'muted', 'hint', 'purple-ink', 'green-ink', 'amber-ink', 'red-ink', 'blue-ink'];

test('in every skin and both themes, text tokens reach 4.5:1 on canvas, surface, wash and line-2', () => {
  for (const skin of SKINS) {
    for (const mode of ['light', 'dark']) {
      const t = seen(skin, mode);
      for (const ground of ['canvas', 'surface', 'wash', 'line-2']) {
        for (const name of TEXT) {
          assert.ok(t[name], `${skin} ${mode}: --${name} is defined`);
          assert.ok(ratio(t[name], t[ground]) >= 4.5, `${skin} ${mode}: --${name} ${t[name]} on ${ground} ${t[ground]}: ${ratio(t[name], t[ground]).toFixed(2)}`);
        }
      }
    }
  }
});

test('the accent as text (and on its own tint) stays readable in every skin', () => {
  for (const skin of SKINS) {
    for (const mode of ['light', 'dark']) {
      const t = seen(skin, mode);
      const tint = over(t['purple-dim'], t.canvas);
      const tintHex = `#${tint.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
      assert.ok(ratio(t['purple-ink'], tintHex) >= 4.5, `${skin} ${mode}: accent text on its tint: ${ratio(t['purple-ink'], tintHex).toFixed(2)}`);
      assert.ok(ratio(t['purple-ink'], t['purple-light']) >= 4.5, `${skin} ${mode}: accent text on accentLight: ${ratio(t['purple-ink'], t['purple-light']).toFixed(2)}`);
    }
  }
});

test('the app window: secondary text and the accent are readable on every ground, white stays readable on the send button', () => {
  for (const skin of SKINS) {
    for (const mode of ['light', 'dark']) {
      const a = SKIN_DEFS[skin].app?.[mode];
      if (!a) continue;
      for (const ground of ['bg', 'panel', 'wash', 'bubble']) {
        assert.ok(ratio(a.ink, a[ground]) >= 7, `${skin} ${mode}: app text on ${ground}`);
        assert.ok(ratio(a.muted, a[ground]) >= 4.5, `${skin} ${mode}: app muted on ${ground}: ${ratio(a.muted, a[ground]).toFixed(2)}`);
        assert.ok(ratio(a.accent, a[ground]) >= 4.5, `${skin} ${mode}: app accent on ${ground}: ${ratio(a.accent, a[ground]).toFixed(2)}`);
      }
      assert.ok(ratio('#ffffff', a.send) >= 4.5, `${skin} ${mode}: white on the send button`);
    }
  }
});

test('a custom accent colour also moves --purple-ink and stays readable as text', () => {
  const html = '<html><head></head><body></body></html>';
  for (const accent of ['#0070F2', '#C2185B', '#F5A623', '#00A19A', '#222222', '#FFD400']) {
    const a = accentVariants(accent);
    const out = applySpacePrefs(html, { ...DEFAULT_PREFERENCES, accent });
    assert.ok(out.includes(`--purple-ink:${a.lightInk}`) && out.includes(`--purple-ink:${a.darkInk}`), `${accent}: both modes set --purple-ink`);
    for (const ground of ['#ffffff', '#f6f5f8', '#f1f0f5', '#faf9fc']) assert.ok(ratio(a.lightInk, ground) >= 4.5, `${accent} light ink ${a.lightInk} on ${ground}: ${ratio(a.lightInk, ground).toFixed(2)}`);
    for (const ground of ['#0f0e13', '#18171d', '#1d1c24', '#222129']) assert.ok(ratio(a.darkInk, ground) >= 4.5, `${accent} dark ink ${a.darkInk} on ${ground}: ${ratio(a.darkInk, ground).toFixed(2)}`);
  }
});

test('the accent as text uses --purple-ink everywhere, never the bright --purple-mid fill', () => {
  assert.doesNotMatch(system, /(?<![-\w])color:var\(--purple-mid\)/);
  const tower = readFileSync(new URL('../examples/control-tower/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(tower, /(?<![-\w])color:var\(--purple-mid\)/);
});
