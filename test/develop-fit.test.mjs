import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FIT_MAX, FIT_MIN, FIT_WIDTH, fitScale } from '../src/develop-fit.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const natural = { w: FIT_WIDTH, h: 800 };

test('scale: a window that is big enough shows the page as it is, a bigger one enlarges it a little at most', () => {
  assert.equal(fitScale({ w: 1240, h: 800 }, natural), 1);
  assert.equal(fitScale({ w: 1600, h: 1000 }, natural), FIT_MAX, 'never more than the maximum');
  assert.equal(fitScale({ w: 1300, h: 840 }, natural), 1.048, "the width is the tighter side: 1300 / 1240");
});

test('scale: the smaller of width and height decides, so every tile fits in both', () => {
  assert.equal(fitScale({ w: 1240, h: 600 }, natural), 0.75, 'too low: the height decides');
  assert.equal(fitScale({ w: 930, h: 800 }, natural), 0.75, 'too narrow: the width decides');
  assert.equal(fitScale({ w: 930, h: 560 }, natural), 0.7, 'both small: the smaller one');
});

test('scale: the default window (1280 x 720) and the smallest one (900 x 600) both fit', () => {
  /* the main area is the window minus the icon rail (60 px) */
  const def = fitScale({ w: 1280 - 60, h: 720 }, natural);
  const min = fitScale({ w: 900 - 60, h: 600 }, natural);
  assert.ok(def !== null && def >= 0.85 && def <= 1, `default window: ${def}`);
  assert.ok(min !== null && min >= FIT_MIN, `smallest window: ${min}`);
});

test('scale: below the readable size there is no scale (null): the responsive grid and scrolling take over', () => {
  assert.equal(fitScale({ w: 700, h: 400 }, natural), null);
  assert.equal(fitScale({ w: 1240, h: 470 }, natural), null);
  assert.equal(fitScale({ w: 744, h: 800 }, natural, FIT_MIN), FIT_MIN, 'exactly the minimum still fits');
});

test('scale: nothing measured yet keeps the natural size instead of dividing by zero', () => {
  assert.equal(fitScale({ w: 0, h: 0 }, natural), 1);
  assert.equal(fitScale({ w: 1000, h: 700 }, { w: FIT_WIDTH, h: 0 }), 1);
  assert.equal(fitScale({ w: 1000, h: 700 }, { w: 0, h: 800 }), 1);
  assert.equal(fitScale({ w: Number.NaN, h: 700 }, natural), 1);
});

test('wiring: the hub is laid out at the design width with four tiles in a row and scaled as a whole; the fallback keeps the old grid', () => {
  const hub = read('src/ui/DevelopHub.tsx'), css = read('src/theme.css');
  assert.match(hub, /useFit\(!open && mode === 'hub'\)/, 'only the start page is fitted, not the wizard or Sources');
  assert.match(hub, /new ResizeObserver\(measure\)/);
  assert.match(hub, /transform: `scale\(\$\{fit\.scale\}\)`/);
  assert.match(hub, /width: FIT_WIDTH \* fit\.scale, height: fit\.h \* fit\.scale/, 'the wrapper takes the scaled size, so the page stays centred without scrollbars');
  assert.match(css, /\.develop-fit-on \.develop \{ width: 1240px;/);
  assert.match(css, /\.develop-fit-on \.develop-cards \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/, 'beats the 2-column rule of narrow windows');
  assert.match(css, /\.develop-fit:not\(\.develop-fit-on\) \{ display: contents; \}/, 'too small: the page behaves exactly as before');
  assert.match(css, /@media \(max-width: 1280px\) \{ \.develop-cards \{ grid-template-columns: repeat\(2/, 'the old responsive rules are still there');
  assert.equal(FIT_WIDTH, 1240);
});
