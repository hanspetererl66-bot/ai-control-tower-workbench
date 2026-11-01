import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SPACE_SCROLL_CSS, applySpaceScroll } from '../src/space-scale.ts';

const read = (rel) => readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');

test('every Space gets the sideways scroll rule once, inside the head', () => {
  const page = '<!doctype html><html><head><title>x</title></head><body>hi</body></html>';
  const out = applySpaceScroll(page);
  assert.match(out, /<style id="werkbank-space-scroll">.*<\/style><\/head>/);
  assert.equal(applySpaceScroll(out), out, 'a second pass changes nothing');
  assert.equal(applySpaceScroll('<p>no head</p>').startsWith('<style id="werkbank-space-scroll">'), true);
  assert.equal(applySpaceScroll(''), '');
});

test('the rule keeps the page scrollable sideways and shows a horizontal bar that can be grabbed, without touching vertical bars', () => {
  assert.match(SPACE_SCROLL_CSS, /html\{overflow-x:auto!important\}/);
  assert.match(SPACE_SCROLL_CSS, /body\{overflow-x:visible!important\}/, 'the body must not become its own scroller, or the bar would sit at the end of a long page');
  assert.match(SPACE_SCROLL_CSS, /::-webkit-scrollbar:horizontal\{display:block!important;height:10px!important\}/);
  assert.match(SPACE_SCROLL_CSS, /::-webkit-scrollbar-thumb:horizontal\{[^}]*min-width:40px/);
  assert.doesNotMatch(SPACE_SCROLL_CSS.replace(/:horizontal/g, ''), /scrollbar\{[^}]*width:/, 'no rule sets the width of a vertical bar');
});

test('the viewer applies it to every Space, and the AI Control Tower no longer hides the bar of its tab row', () => {
  assert.match(read('src/ui/SpaceViewer.tsx'), /srcDoc=\{applySpaceScroll\(applySpaceTools\(applySpaceScale\(/);
  const ct = read('examples/control-tower/index.html');
  assert.doesNotMatch(ct, /\.tbar::-webkit-scrollbar\{display:none\}/);
  assert.match(ct, /\.tbar::-webkit-scrollbar\{height:8px\}/);
  assert.match(ct, /\.tbar\{[^}]*overflow-x:auto/);
});
