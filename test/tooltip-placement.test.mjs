import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = join(import.meta.dirname, '..');
const PAGES = ['it-fleet', 'renewals', 'it-infrastructure', 'customer-360'];

/** The source of `function placeTip(...) { ... }` out of a page: from its start to the matching closing brace. */
function placeTipOf(slug) {
  const html = readFileSync(join(ROOT, `examples/${slug}/index.html`), 'utf8');
  const start = html.indexOf('function placeTip(');
  assert.ok(start >= 0, `${slug} has placeTip`);
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return vm.runInNewContext(`(${html.slice(start, i + 1)})`);
}
const place = (fn, w, h, x, y, vw, vh) => { const el = { offsetWidth: w, offsetHeight: h, style: {} }; fn(el, x, y, vw, vh); return { left: parseFloat(el.style.left), top: parseFloat(el.style.top), w, h }; };

for (const slug of PAGES) {
  test(`${slug}: the tooltip never covers the pointer and stays inside the window, wherever the pointer is`, () => {
    const fn = placeTipOf(slug);
    let checked = 0;
    for (const [vw, vh] of [[1280, 800], [900, 600], [420, 700]]) {
      for (const [w, h] of [[290, 110], [300, 260], [300, 520]]) {
        for (let x = 0; x <= vw; x += 37) for (let y = 0; y <= vh; y += 29) {
          const r = place(fn, w, h, x, y, vw, vh);
          const fitsBeside = w <= Math.max(vw - 8 - (x + 16), x - 16 - 8) || h <= Math.max(vh - 8 - (y + 16), y - 16 - 8);
          assert.ok(r.left >= 8 - 1e-6 && r.top >= 8 - 1e-6, `${slug}: inside at the top left (${x},${y})`);
          if (w + 16 <= vw && h + 16 <= vh) assert.ok(r.left + w <= vw - 8 + 1e-6 && r.top + h <= vh - 8 + 1e-6, `${slug}: inside at the bottom right (${x},${y}) ${vw}x${vh} ${w}x${h}`);
          if (fitsBeside) { assert.ok(!(x >= r.left && x <= r.left + w && y >= r.top && y <= r.top + h), `${slug}: covers the pointer at (${x},${y}) in ${vw}x${vh}, tooltip ${w}x${h}`); checked++; }
        }
      }
    }
    assert.ok(checked > 1000);
  });
}

test('the old rule covered the pointer near the bottom and right edge, the new one flips to the other side', () => {
  const fn = placeTipOf('it-fleet');
  const bottomRight = place(fn, 290, 200, 1250, 780, 1280, 800);
  assert.ok(bottomRight.left + 290 <= 1250 - 16 + 1e-6, 'left of the pointer');
  assert.ok(bottomRight.top + 200 <= 780 - 16 + 1e-6, 'above the pointer');
  const free = place(fn, 290, 200, 300, 200, 1280, 800);
  assert.equal(free.left, 316);
  assert.equal(free.top, 216);
});
