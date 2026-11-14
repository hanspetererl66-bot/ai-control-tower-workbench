import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CAT_FACES, DEFAULT_CAT, EARS, FACES, FACE_COLS, FACE_ROWS, HEAD, VISIBLE_ROWS, VISIBLE_SHARE,
  boxSize, faceCells, nextFace, placement, sanitizeCat, snapToEdge, turnFor,
} from '../src/cat-peek.ts';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '../src/preferences.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('only 60 % of the face is shown', () => {
  assert.equal(VISIBLE_SHARE, 0.6);
  assert.equal(VISIBLE_ROWS / FACE_ROWS, 0.6);
});

test('the pixel art is well formed: every row has 16 columns, every face 7 rows, the head 12', () => {
  assert.equal(HEAD.length, VISIBLE_ROWS);
  assert.equal(EARS.length, VISIBLE_ROWS);
  for (const row of [...HEAD, ...EARS]) assert.equal(row.length, FACE_COLS);
  for (const face of CAT_FACES) {
    assert.equal(FACES[face].length, 7, face);
    for (const row of FACES[face]) assert.equal(row.length, FACE_COLS, `${face}: ${row}`);
    for (const cell of faceCells(face)) assert.ok(cell.y < VISIBLE_ROWS && cell.x < FACE_COLS, face);
  }
  assert.ok(CAT_FACES.length >= 6);
});

test('the faces really differ from each other', () => {
  const seen = new Set(CAT_FACES.map((f) => FACES[f].join('|')));
  assert.equal(seen.size, CAT_FACES.length);
});

test('the next face is never the same, and any random number gives a valid face', () => {
  for (const f of CAT_FACES) for (const r of [0, 0.3, 0.999, 1, -1]) {
    const n = nextFace(f, r);
    assert.notEqual(n, f);
    assert.ok(CAT_FACES.includes(n));
  }
});

test('the cat touches its edge and stays inside the window', () => {
  for (const edge of ['bottom', 'top', 'left', 'right']) for (const at of [0, 0.5, 1]) {
    const p = placement({ edge, at }, 1200, 800);
    assert.ok(p.left >= 0 && p.top >= 0 && p.left + p.width <= 1200 && p.top + p.height <= 800, `${edge} ${at}`);
    if (edge === 'bottom') assert.equal(p.top + p.height, 800);
    if (edge === 'top') assert.equal(p.top, 0);
    if (edge === 'left') assert.equal(p.left, 0);
    if (edge === 'right') assert.equal(p.left + p.width, 1200);
  }
  assert.deepEqual(boxSize('left'), { width: boxSize('bottom').height, height: boxSize('bottom').width });
});

test('dropping the cat snaps it to the nearest edge', () => {
  assert.equal(snapToEdge(600, 790, 1200, 800).edge, 'bottom');
  assert.equal(snapToEdge(600, 5, 1200, 800).edge, 'top');
  assert.equal(snapToEdge(4, 400, 1200, 800).edge, 'left');
  assert.equal(snapToEdge(1195, 400, 1200, 800).edge, 'right');
  const s = snapToEdge(-50, 99999, 1200, 800);
  assert.ok(s.at >= 0 && s.at <= 1);
  assert.equal(snapToEdge(10, 10, 0, 0).at, 0);
});

test('the head turns so that it points away from the edge', () => {
  assert.deepEqual(['bottom', 'top', 'left', 'right'].map(turnFor), [0, 180, 90, -90]);
});

test('settings: bad values fall back, good ones stay', () => {
  assert.deepEqual(sanitizeCat(undefined), DEFAULT_CAT);
  assert.deepEqual(sanitizeCat({ enabled: false, edge: 'left', at: 0.25 }), { enabled: false, edge: 'left', at: 0.25 });
  assert.deepEqual(sanitizeCat({ enabled: 'yes', edge: 'middle', at: 7 }), { enabled: true, edge: 'bottom', at: 1 });
  assert.equal(sanitizeCat({ at: NaN }).at, DEFAULT_CAT.at);
  assert.equal(DEFAULT_PREFERENCES.cat.enabled, true);
  assert.equal(sanitizePreferences({ cat: { enabled: false, edge: 'top', at: 0.1 } }).cat.edge, 'top');
  assert.deepEqual(sanitizePreferences({}).cat, DEFAULT_CAT);
});

test('wired in: App draws the cat, the settings have the switch, the colours are tokens', () => {
  assert.match(read('src/App.tsx'), /<CatPeek cat=\{prefs\.cat\}/);
  assert.match(read('src/ui/PreferencesPanels.tsx'), /Show Casimir/);
  const comp = read('src/ui/CatPeek.tsx');
  assert.doesNotMatch(comp, /#[0-9a-fA-F]{3,6}\b|rgb\(/);
  assert.doesNotMatch(comp, /localStorage/);
});
