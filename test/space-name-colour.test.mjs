import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SKINS, SKIN_DEFS } from '../src/skins.ts';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';
import { accentVariants, buildPreferenceCss, contrastRatio } from '../src/preferences-style.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('src/theme.css');

test('the names of Spaces take the accent colour: sidebar rows, bar chips, overview cards, the title of an open Space', () => {
  const block = css.slice(css.indexOf('/* The names of Spaces take the colour of the chosen skin'));
  assert.match(block, /:root \{ --accent-ink: var\(--accent\); \}/);
  assert.match(block, /\.trow:not\(\.trow-on\) \.trow-title,\s*\.bar-chips \.chip:not\(\.chip-on\) \.chip-title,\s*\.sov-card-title,\s*\.topbar-title-space \{ color: var\(--accent-ink\); \}/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'no colour values, only tokens');
  assert.match(css, /\.card:not\(\.card-sub\) \.card-title \{ color: var\(--accent-ink\); font-weight: 700; \}/, 'the cards of the sidebar had fixed violet values');
  assert.match(css, /\.card-sub \.card-title \{ color: var\(--accent-ink\); font-weight: 600; \}/);
  assert.doesNotMatch(css, /\.card[^{]*\.card-title \{ color: #/, 'no fixed colour on a space title');
  assert.match(read('src/ui/SpaceViewer.tsx'), /className="topbar-title topbar-title-space"/);
  assert.match(read('src/ui/SpacesList.tsx'), /className="trow-title"/);
  assert.match(read('src/ui/SpacesList.tsx'), /className="chip-title"/);
  assert.match(read('src/ui/SpacesOverview.tsx'), /className="sov-card-title"/);
});

test('a custom accent also moves the name colour, the default follows the skin', () => {
  assert.doesNotMatch(buildPreferenceCss(DEFAULT_PREFERENCES), /--accent-ink/, 'no accent chosen: --accent-ink follows the accent of the skin');
  const a = accentVariants('#C2185B');
  const out = buildPreferenceCss({ ...DEFAULT_PREFERENCES, accent: '#C2185B' });
  assert.match(out, new RegExp(`:root\\{--accent:${a.light};--send:${a.light};--accent-ink:${a.lightInk}\\}`));
  assert.match(out, new RegExp(`:root\\[data-theme="dark"\\]\\{--accent:${a.dark};--send:${a.dark};--accent-ink:${a.darkInk}\\}`));
});

test('the name colour stays readable on every ground: every skin, light and dark, and custom accents', () => {
  const dark = css.slice(css.indexOf(':root[data-theme="dark"] {'));
  const tok = (src, n) => new RegExp(`${n}:\\s*(#[0-9a-fA-F]{6})`).exec(src)[1];
  const grounds = { light: [tok(css, '--bg'), tok(css, '--panel')], dark: [tok(dark, '--bg'), tok(dark, '--panel')] };
  // the default (violet) skin lives in theme.css
  for (const mode of ['light', 'dark']) for (const g of grounds[mode]) {
    const accent = tok(mode === 'light' ? css : dark, '--accent');
    assert.ok(contrastRatio(accent, g) >= 4.5, `violet ${mode}: ${accent} on ${g}: ${contrastRatio(accent, g).toFixed(2)}`);
  }
  for (const skin of SKINS) for (const mode of ['light', 'dark']) {
    const t = SKIN_DEFS[skin].app?.[mode]; if (!t) continue;
    for (const g of ['bg', 'panel', 'wash']) assert.ok(contrastRatio(t.accent, t[g]) >= 4.5, `${skin} ${mode} on ${g}: ${contrastRatio(t.accent, t[g]).toFixed(2)}`);
  }
  for (const accent of ['#0070F2', '#C2185B', '#F5A623', '#00A19A', '#222222', '#FFD400']) {
    const v = accentVariants(accent);
    for (const g of grounds.light) assert.ok(contrastRatio(v.lightInk, g) >= 4.5, `${accent} light ink on ${g}: ${contrastRatio(v.lightInk, g).toFixed(2)}`);
    for (const g of grounds.dark) assert.ok(contrastRatio(v.darkInk, g) >= 4.5, `${accent} dark ink on ${g}: ${contrastRatio(v.darkInk, g).toFixed(2)}`);
  }
});
