import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CAT_FACES, DEFAULT_CAT, FACE_COLS, FACE_ROWS, GRID_ROWS, LEDGE_ROWS, TONE, TONE_COUNT, VISIBLE_ROWS, VISIBLE_SHARE,
  PHASES, afterFace, boxSize, drawCat, faceDuration, heartCount, lookToward, nextFace, pawsUp, placement, runsOf, sanitizeCat, shareAt,
} from '../src/cat-peek.ts';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '../src/preferences.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const CAT_MID = 15; // a column between the tabby stripes
const flat = (g) => g.map((r) => r.join('')).join('/');

test('only 60 % of the face is shown, and a ledge runs below it', () => {
  assert.equal(VISIBLE_SHARE, 0.6);
  assert.equal(VISIBLE_ROWS / FACE_ROWS, 0.6);
  assert.equal(GRID_ROWS, VISIBLE_ROWS + LEDGE_ROWS);
});

test('every face is a full grid of valid tones with a thin black ledge along the whole bottom', () => {
  for (const face of CAT_FACES) {
    const g = drawCat({ face });
    assert.equal(g.length, GRID_ROWS, face);
    for (const row of g) { assert.equal(row.length, FACE_COLS, face); for (const t of row) assert.ok(Number.isInteger(t) && t >= 0 && t < TONE_COUNT, face); }
    for (let y = VISIBLE_ROWS; y < GRID_ROWS; y++) assert.ok(g[y].every((t) => t === TONE.ledge), `${face} ledge row ${y}`);
    // Nothing of the face is black ledge above the ledge.
    for (let y = 0; y < VISIBLE_ROWS; y++) assert.ok(g[y].every((t) => t !== TONE.ledge), `${face} row ${y}`);
    // The head is really drawn (fur, eyes, nose).
    const tones = new Set(g.flat());
    for (const t of [TONE.line, TONE.dark, TONE.light, TONE.mid, TONE.pale, TONE.pink]) assert.ok(tones.has(t), `${face} tone ${t}`);
  }
});

test('there are at least ten faces and they all look different', () => {
  assert.ok(CAT_FACES.length >= 13);
  assert.ok(CAT_FACES.includes('sleep') && CAT_FACES.includes('yawn') && CAT_FACES.includes('love'));
  assert.equal(new Set(CAT_FACES.map((f) => flat(drawCat({ face: f })))).size, CAT_FACES.length);
});

test('animation: a blink, a look and an ear flick each change the picture; same pose gives the same picture', () => {
  const base = flat(drawCat({ face: 'neutral' }));
  assert.equal(base, flat(drawCat({ face: 'neutral' })));
  assert.notEqual(base, flat(drawCat({ face: 'neutral', blink: true })));
  assert.notEqual(base, flat(drawCat({ face: 'neutral', look: { x: 1, y: 0 } })));
  assert.notEqual(base, flat(drawCat({ face: 'neutral', flick: 'left' })));
  assert.notEqual(flat(drawCat({ face: 'neutral', flick: 'left' })), flat(drawCat({ face: 'neutral', flick: 'right' })));
  // A face with closed eyes (yawn) does not change when he blinks.
  assert.equal(flat(drawCat({ face: 'yawn' })), flat(drawCat({ face: 'yawn', blink: true })));
});

test('paws: resting them on the ledge changes the picture and never touches the ledge itself', () => {
  for (const face of CAT_FACES) {
    const up = drawCat({ face, paws: true });
    assert.notEqual(flat(up), flat(drawCat({ face })), face);
    for (let y = VISIBLE_ROWS; y < GRID_ROWS; y++) assert.ok(up[y].every((t) => t === TONE.ledge), face);
  }
  assert.equal(pawsUp('sleep', 0.99), true);
});

test('yawning and sleeping play a script: every step looks different, and the script loops', () => {
  for (const face of ['yawn', 'sleep']) {
    const { steps } = PHASES[face];
    assert.equal(steps, 4);
    const frames = Array.from({ length: steps }, (_, i) => flat(drawCat({ face, phase: i })));
    assert.ok(new Set(frames).size >= 3, face);
    assert.equal(flat(drawCat({ face, phase: steps })), frames[0]);
  }
  // Sleeping eyes are closed: blinking changes nothing; a snore bubble grows and shrinks.
  assert.equal(flat(drawCat({ face: 'sleep' })), flat(drawCat({ face: 'sleep', blink: true })));
  const count = (phase) => drawCat({ face: 'sleep', phase }).flat().filter((t) => t === TONE.white).length;
  assert.ok(count(2) > count(1) && count(1) > count(0));
});

test('after a yawn he often falls asleep, a sleeper often wakes up yawning, and a face is never followed by itself', () => {
  assert.equal(afterFace('yawn', 0.1), 'sleep');
  assert.equal(afterFace('sleep', 0.1), 'yawn');
  for (const f of CAT_FACES) for (const r of [0, 0.25, 0.5, 0.75, 0.999, 1, -1]) {
    const n = afterFace(f, r);
    assert.notEqual(n, f);
    assert.ok(CAT_FACES.includes(n));
    if (r >= 0.5 || (f !== 'yawn' && f !== 'sleep')) assert.notEqual(n, 'sleep');
  }
  assert.ok(faceDuration('sleep', 0) >= 9000 && faceDuration('neutral', 0) >= 4000 && faceDuration('neutral', 1) <= 9000);
  assert.ok(faceDuration('yawn', 0.5) >= PHASES.yawn.steps * PHASES.yawn.ms);
});

test('in love he sends one or two hearts', () => {
  const seen = new Set([0, 0.2, 0.49, 0.5, 0.9, 1].map(heartCount));
  assert.deepEqual([...seen].sort(), [1, 2]);
});

test('runs cover exactly the non-empty cells', () => {
  const g = drawCat({ face: 'blep' });
  const cells = g.flat().filter((t) => t !== TONE.none).length;
  assert.equal(runsOf(g).reduce((n, [, , len]) => n + len, 0), cells);
});

test('the next face is never the same, and any random number gives a valid face', () => {
  for (const f of CAT_FACES) for (const r of [0, 0.3, 0.999, 1, -1, 7]) {
    const n = nextFace(f, r);
    assert.notEqual(n, f);
    assert.ok(CAT_FACES.includes(n));
  }
});

test('he can sit anywhere on the screen and always stays fully inside the window', () => {
  for (const x of [0, 0.3, 1]) for (const y of [0, 0.5, 1]) {
    const p = placement({ x, y }, 1200, 800);
    assert.ok(p.left >= 0 && p.top >= 0 && p.left + p.width <= 1200 && p.top + p.height <= 800, `${x} ${y}`);
  }
  const { width, height } = boxSize();
  assert.equal(placement({ x: 0.5, y: 1 }, 1200, 800).top + height, 800);
  assert.equal(placement({ x: 1, y: 0 }, 1200, 800).left + width, 1200);
  assert.ok(width <= 80 && height <= 56);
  assert.deepEqual(placement({ x: 0.5, y: 0.5 }, 10, 10).left, 0);
});

test('dropping him gives the share of the free room, clamped to the window', () => {
  const p = placement({ x: 0.25, y: 0.75 }, 1200, 800);
  const s = shareAt(p.left, p.top, 1200, 800);
  assert.ok(Math.abs(s.x - 0.25) < 0.01 && Math.abs(s.y - 0.75) < 0.01);
  assert.deepEqual(shareAt(-500, 99999, 1200, 800), { x: 0, y: 1 });
  assert.deepEqual(shareAt(10, 10, 0, 0), { x: 0, y: 0 });
});

test('the eyes follow the pointer, with a dead zone close to him', () => {
  const c = { x: 500, y: 500 };
  assert.deepEqual(lookToward({ x: 510, y: 495 }, c), { x: 0, y: 0 });
  assert.deepEqual(lookToward({ x: 900, y: 500 }, c), { x: 1, y: 0 });
  assert.deepEqual(lookToward({ x: 100, y: 100 }, c), { x: -1, y: -1 });
  assert.deepEqual(lookToward({ x: 500, y: 900 }, c), { x: 0, y: 1 });
});

test('settings: bad values fall back, good ones stay, old edge/at values are ignored', () => {
  assert.deepEqual(sanitizeCat(undefined), DEFAULT_CAT);
  assert.deepEqual(sanitizeCat({ enabled: false, x: 0.25, y: 0.5 }), { enabled: false, x: 0.25, y: 0.5 });
  assert.deepEqual(sanitizeCat({ enabled: 'yes', x: 7, y: -3 }), { enabled: true, x: 1, y: 0 });
  assert.deepEqual(sanitizeCat({ edge: 'left', at: 0.4 }), DEFAULT_CAT);
  assert.equal(sanitizeCat({ x: NaN }).x, DEFAULT_CAT.x);
  assert.equal(DEFAULT_PREFERENCES.cat.enabled, true);
  assert.equal(DEFAULT_CAT.y, 1);
  assert.equal(sanitizePreferences({ cat: { enabled: false, x: 0.9, y: 0.1 } }).cat.x, 0.9);
  assert.deepEqual(sanitizePreferences({}).cat, DEFAULT_CAT);
});

test('wired in: App draws the cat, Settings has the switch, the colours are tokens (no hex in the component)', () => {
  assert.match(read('src/App.tsx'), /<CatPeek cat=\{prefs\.cat\}/);
  assert.match(read('src/ui/PreferencesPanels.tsx'), /Show Casimir/);
  assert.match(read('src/ui/CatPeek.tsx'), /heartCount/);
  const comp = read('src/ui/CatPeek.tsx');
  assert.doesNotMatch(comp, /#[0-9a-fA-F]{3,6}\b|rgb\(/);
  assert.doesNotMatch(comp, /localStorage/);
  const css = read('src/theme.css');
  for (let t = 1; t < TONE_COUNT; t++) assert.match(css, new RegExp(`--cat-${t}:`), `token --cat-${t}`);
});

test('dark purple cat with light purple ears: the ears are the light tone, the head is the dark one', () => {
  const g = drawCat({ face: 'neutral' });
  // Top rows (the ears) hold light cells, never the dark head tone; the middle of the head is dark.
  const top = g.slice(0, 4).flat();
  assert.ok(top.includes(TONE.light) && !top.includes(TONE.dark));
  assert.equal(g[8][CAT_MID], TONE.dark);
  const light = g.slice(0, 10).flat().filter((t) => t === TONE.light).length;
  assert.ok(light >= 20, 'the ears are clearly light');
  assert.match(read('src/ui/PreferencesPanels.tsx'), /A small dark purple cat with light purple ears and a lovely face that looks over a thin black ledge/);
});
