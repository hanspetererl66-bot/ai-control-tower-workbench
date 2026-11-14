import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'examples/skill-marketplace/index.html'), 'utf8');
const design = readFileSync(join(ROOT, 'examples/shared/design-system.css'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const block = (id) => { const a = html.indexOf(`<style id="${id}">`); return a < 0 ? '' : html.slice(a, html.indexOf('</style>', a)); };

test('the text of the Space is 20 % larger: the page rules were scaled, the shared design system stays embedded unchanged and its sizes are scaled in one extra block', () => {
  const page = html.replace(block('design-system'), '');
  const sizes = [...page.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 80, 'many sizes');
  assert.ok(Math.min(...sizes) >= 13.2, `the smallest text is 13.2 px (11 px x 1.2), found ${Math.min(...sizes)}`);
  assert.match(html, /body\{margin:0;background:var\(--bg\);color:var\(--ink\);font:16\.8px\/1\.5 var\(--font\)\}/, 'the base size 14 px became 16.8 px');
  assert.match(html, /\.hero h1\{margin:0;font-size:31\.2px;/, 'a sample rule: 26 px became 31.2 px (then raised again by the look)');
  assert.ok(html.includes(design.trim().slice(0, 200)), 'the design system is embedded as it is');
  const scaled = block('sm-scale');
  for (const [sel, px] of [['.tag', 11], ['.sh', 13], ['.chd', 15], ['button.small', 12]]) assert.ok(scaled.includes(`${sel}{font-size:${(px * 1.2).toFixed(1).replace(/\.0$/, '')}px}`), `${sel} scaled`);
});

test('the look: pill navigation, a hero with a drifting glow, cards that rise in one after the other and lift on hover, bars that grow; tokens only; reduced motion stops it all', () => {
  const look = block('sm-look');
  assert.ok(look.length > 3000);
  assert.doesNotMatch(look, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'no colour outside the tokens');
  for (const frame of ['sm-drift', 'sm-rise', 'sm-grow', 'sm-fade']) assert.match(look, new RegExp(`@keyframes ${frame}`));
  assert.match(look, /\.s4m \.caps>\.cap,\.s4m \.skills>\.sk,\.s4m \.bundles>\.bundle,\.s4m \.sum>div,\.s4m \.steps>\.step\{animation:sm-rise/);
  assert.match(look, /body nav button\[aria-selected=true\]\{background:var\(--purple\)/);
  assert.match(look, /@media \(prefers-reduced-motion:reduce\)\{[^]*animation:none!important/);
  assert.match(look, /@media \(max-width:760px\)/, 'it still folds up on a narrow screen');
  assert.doesNotMatch(html.slice(html.indexOf('<body')), /fetch\(|localStorage|XMLHttpRequest/, 'still no network and no storage');
});

test('numbers count up on the header and the analytics pages and end on the real value; with reduced motion they are shown at once', async () => {
  const open = (reduce) => {
    const errs = []; const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/scrollTo/.test(m)) errs.push(m); });
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, beforeParse(w) { if (reduce) w.matchMedia = (q) => ({ matches: /reduce/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }); } });
    return { w: dom.window, d: dom.window.document, errs };
  };
  const p = open(false);
  try {
    await sleep(200);
    const real = p.d.querySelector('#hdr-count').textContent;
    p.d.querySelector('#tabs [data-tab=overview]').click();
    await sleep(120);
    const during = [...p.d.querySelectorAll('.pg.on .sum .n')].map((e) => e.textContent);
    await sleep(1300);
    const after = [...p.d.querySelectorAll('.pg.on .sum .n')].map((e) => e.textContent);
    assert.ok(after.every((t) => /^\d/.test(t)) && after.length >= 3);
    assert.notDeepEqual(during, after, 'it was still counting a moment before');
    assert.ok(Number(after[0]) > 10, 'it ended on the real number of skills');
    assert.match(real, /27 registered skills|\d+ registered skills/);
    assert.deepEqual(p.errs, []);
  } finally { p.w.close(); }
  const q = open(true);
  try {
    await sleep(200);
    q.d.querySelector('#tabs [data-tab=overview]').click();
    const now = [...q.d.querySelectorAll('.pg.on .sum .n')].map((e) => e.textContent);
    await sleep(100);
    assert.deepEqual([...q.d.querySelectorAll('.pg.on .sum .n')].map((e) => e.textContent), now, 'no counting');
    assert.ok(Number(now[0]) > 10);
  } finally { q.w.close(); }
});
