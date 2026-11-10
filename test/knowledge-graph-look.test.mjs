import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const page = readFileSync(join(import.meta.dirname, '..', 'examples/knowledge-graph/index.html'), 'utf8');
const code = page.slice(page.lastIndexOf('<script>'));
const look = code.slice(code.indexOf('/* look layer'), code.indexOf('function drawMini()'));

test('look layer exists and is the 2D draw routine', () => {
  assert.ok(look.length > 3000);
  assert.match(look, /function draw\(now\)/);
});

test('look layer takes every colour from the tokens (no literals)', () => {
  // the only regex with hex digits is the luminance parser; remove that line before looking for literals
  const stripped = look.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.includes('const m = /^#')).join('\n');
  assert.doesNotMatch(stripped, /#[0-9a-fA-F]{3,8}\b/, 'hex colour in the look layer');
  assert.doesNotMatch(stripped, /\b(rgba?|hsla?)\(/, 'rgb/hsl colour in the look layer');
  assert.match(page, /C = \{ bg:g\('--canvas'\)/, 'colours are read from computed style');
});

test('all new motion respects prefers-reduced-motion', () => {
  assert.match(page, /const reduced = matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(look, /const ease = \(cur, target\) => \(reduced \? target/, 'focus easing is skipped when reduced');
  assert.match(look, /const ip0 = reduced \? 1/, 'intro is skipped when reduced');
  assert.match(look, /inF && !reduced && IP >= 1/, 'particles are skipped when reduced');
  assert.match(look, /const pu = reduced \? 0/, 'selection pulse is skipped when reduced');
  assert.match(page, /const ce = reduced \? 1/, 'camera easing is skipped when reduced');
  assert.match(page, /@media \(prefers-reduced-motion:reduce\)\{#mini,\.legend button/, 'CSS transitions are switched off');
});

test('no network and no storage in the page', () => {
  assert.doesNotMatch(code, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/);
  assert.doesNotMatch(page, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(page, /<script[^>]+src=/);
});

test('existing features are still there', () => {
  for (const s of ['function draw3d', 'function set3d', 'function startTour', 'simulateFailure(', 'function impact(', 'function pathBetween', 'id="m-failure"', 'id="m-path"', 'id="m-impact"', 'function renderLegend', 'id="mini"', 'function computeFocus', 'window.__kg']) assert.ok(page.includes(s), s);
});

test('new interaction: legend spotlight, fit to selection, hulls, comets', () => {
  assert.match(code, /S\.hot = b\.dataset\.t/);
  assert.match(code, /ev\.key === 'f'/);
  assert.match(look, /soft type hulls/);
  assert.match(look, /small comets/);
});
