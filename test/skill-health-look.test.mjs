import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const src = (f) => readFileSync(join(import.meta.dirname, '..', f), 'utf8');
const css = src('src/theme.css');
const view = src('src/ui/SkillHealthView.tsx');
// the monitor's rules: the first block (up to the registry styles) plus the detail panel and animations block
const start = css.indexOf('/* ---- Skill health ---- */');
const calm = css.indexOf('/* Skill Health Monitor: small, calm animations');
const block = css.slice(start, css.indexOf('/* ----', start + 10) > 0 ? css.indexOf('/* ----', start + 10) : undefined) + css.slice(calm, calm + 2500);

test('Skill Health Monitor: calm palette for bars, dots and pills in both themes', () => {
  for (const t of ['--sh-good', '--sh-warn', '--sh-bad', '--sh-mute', '--sh-good-ink', '--sh-warn-ink', '--sh-bad-ink', '--sh-mute-ink']) {
    assert.ok((block.match(new RegExp(`${t}:`, 'g')) ?? []).length >= 2, `${t} is defined for light and dark`);
  }
  // no saturated fill with white text any more; the tone is a dot, not a thick border
  assert.doesNotMatch(block, /\.sh-pill \{[^}]*color: #fff/);
  assert.doesNotMatch(block, /border-left-color: var\(--lv-/);
});

test('Skill Health Monitor: ring, health band and counted numbers are in the view', () => {
  assert.match(view, /function Ring\(/);
  assert.match(view, /className="sh-band"/);
  assert.match(view, /function useCountUp\(/);
  assert.match(view, /<Tile i=\{0\}/);
});

test('Skill Health Monitor: every animation is switched off for reduced motion', () => {
  const m = block.match(/@media \(prefers-reduced-motion: reduce\) \{([^]*?)\n\}/);
  assert.ok(m, 'a reduced-motion block exists for the monitor');
  for (const cls of ['.sh-head', '.sh .sh-tile', '.sh-fill', '.sh-band', '.sh-ring-prog', '.sh-drawer', '.sh-scrim']) assert.ok(m[1].includes(cls), cls);
  assert.match(view, /prefers-reduced-motion: reduce/);
});

test('Skill Health Monitor: the eight tiles sit in four columns (two on a narrow window)', () => {
  assert.match(css, /\.sh-tiles \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 1000px\) \{ \.sh-tiles \{ grid-template-columns: repeat\(2/);
});
