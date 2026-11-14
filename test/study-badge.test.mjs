import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clampBadge, nudgeBadge, parseBadge, BADGE_SIZE } from '../src/study-badge.ts';

const win = { w: 1440, h: 900 };

test('clamp: the badge stays fully inside the window', () => {
  assert.deepEqual(clampBadge({ x: -50, y: -50 }, win), { x: 6, y: 6 });
  const far = clampBadge({ x: 9999, y: 9999 }, win);
  assert.equal(far.x, win.w - BADGE_SIZE.w - 6);
  assert.equal(far.y, win.h - BADGE_SIZE.h - 6);
  assert.deepEqual(clampBadge({ x: 300, y: 200 }, win), { x: 300, y: 200 });
});

test('clamp: a tiny window never gives negative room', () => {
  assert.deepEqual(clampBadge({ x: 100, y: 100 }, { w: 50, h: 20 }), { x: 6, y: 6 });
});

test('parse: only a finite x and y count, everything else means never moved', () => {
  assert.deepEqual(parseBadge('{"x":10,"y":20}'), { x: 10, y: 20 });
  for (const bad of [null, '', 'nope', '{"x":"a","y":1}', '{"x":1}', '[]']) assert.equal(parseBadge(bad), null);
});

test('keys: arrows move by 10, with Shift by 40, other keys do nothing', () => {
  assert.deepEqual(nudgeBadge({ x: 100, y: 100 }, 'ArrowRight', false), { x: 110, y: 100 });
  assert.deepEqual(nudgeBadge({ x: 100, y: 100 }, 'ArrowUp', true), { x: 100, y: 60 });
  assert.equal(nudgeBadge({ x: 1, y: 1 }, 'a', false), null);
});

test('wiring: the app uses the movable badge and the bar glows in rainbow tokens', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  assert.match(app, /<StudyBadge \/>/);
  assert.match(css, /@keyframes study-rainbow/);
  for (let i = 1; i <= 6; i++) assert.match(css, new RegExp(`--rainbow-${i}:`));
  const kf = css.slice(css.indexOf('@keyframes study-rainbow'), css.indexOf('@keyframes study-slide'));
  assert.doesNotMatch(kf, /#[0-9a-f]{3,6}/i, 'the animation uses tokens only');
});
