import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'examples/sub4me/index.html'), 'utf8');

function open(opts = {}) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errs.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, ...opts });
  return { w: dom.window, errs };
}

test('the portal entry page: greeting, four quick actions, one simple ring and one bar per product', async () => {
  const { w, errs } = open();
  await new Promise((r) => setTimeout(r, 200));
  const $ = (q) => w.document.querySelector(q), $$ = (q) => [...w.document.querySelectorAll(q)];
  assert.match($('#hero .hero-title').textContent, /^Welcome, Mr\. Miller\./);
  assert.match($('#hero .hero-sub').textContent, /last login 2026-10-17/);
  assert.deepEqual($$('#hero .hero-acts button').map((b) => b.dataset.go), ['tickets', 'invoices', 'contracts', 'usage']);
  assert.equal($$('.ck-rings svg .arc').length, 2, 'the used share and its forecast, no ring per product');
  assert.equal($$('.ck-rings svg circle.trk').length, 1);
  assert.equal($$('#ck-leg .ck-prod').length, 5);
  assert.match($('#ck-pct').textContent, /^\d+%$/);
  const bars = $$('#ck-leg .ck-prod i').map((i) => i.style.width);
  assert.ok(bars.every((b) => /%$/.test(b)), 'every product bar is set');
  assert.deepEqual(errs, []);
});

test('the scenario buttons and the month slider move the one ring', () => {
  const { w } = open();
  const $ = (q) => w.document.querySelector(q);
  const before = $('#ck-arc').style.strokeDashoffset;
  $('[data-scn=growth]').click();
  const growth = $('#ck-arc-fc').style.strokeDashoffset;
  assert.notEqual(growth, '');
  const r = $('#ck-range');
  r.value = '2';
  r.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.notEqual($('#ck-arc').style.strokeDashoffset, before, 'an earlier month shows a smaller share');
  assert.match($('#ck-out').textContent, /Mar · actual/);
});

test('motion: staggered entrance and counting numbers end on the real values', async () => {
  const { w } = open();
  const $$ = (q) => [...w.document.querySelectorAll(q)];
  assert.ok($$('.rise').length >= 8, 'hero, cockpit, key figures and cards rise in');
  const finals = $$('#kpis .v').map((v) => v.textContent);
  await new Promise((r) => setTimeout(r, 1300));
  const after = $$('#kpis .v').map((v) => v.textContent);
  assert.ok(after.every((t) => /\d/.test(t)));
  assert.equal(after[0], '5', 'active contracts end on the real count');
  assert.ok(finals.length === 5);
});

test('with reduced motion nothing waits for an animation', () => {
  const { w } = open({ beforeParse(win) { win.matchMedia = (q) => ({ matches: /reduce/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }); } });
  assert.equal(w.document.querySelectorAll('.rise').length, 0);
  assert.match(w.document.querySelector('#ck-head').textContent, /AI units/, 'the briefing is shown at once');
  assert.equal(w.document.querySelector('#kpis .v').textContent, '5');
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{\.rise\{animation:none/);
});

test('headlines use their own bolder display font, the body keeps the portal font, colours stay tokens', () => {
  const css = html.slice(html.indexOf('/* Portal entry:'), html.indexOf('<style id="design-system">'));
  assert.match(css, /--font-display:ui-serif/);
  assert.match(css, /body\.s4m h2,body\.s4m \.k,[^{]*\{font-family:var\(--font-display\);font-weight:800/);
  assert.doesNotMatch(css.replace(/#fff/g, ''), /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'no colour outside the tokens');
  assert.doesNotMatch(html.slice(html.indexOf('<body')), /fetch\(|localStorage/);
});

test('the other tabs move too: staggered rows, growing bars and columns, counting key figures, all off for reduced motion', async () => {
  const css = html.slice(html.indexOf('/* Motion on the other tabs'), html.indexOf('<style id="design-system">'));
  for (const name of ['rise2', 'fadein', 'barin', 'colin']) assert.match(css, new RegExp(`@keyframes ${name}`), name);
  for (const sec of ['pg-contracts', 'pg-invoices', 'pg-usage', 'pg-tickets']) assert.match(css, new RegExp(`#${sec} tbody tr:nth-child\\(-n\\+12\\)`), `${sec}: rows rise one after another`);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{body\.s4m \.pg \*[^}]*animation:none!important/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'no colour outside the tokens');
  const { w, errs } = open();
  const kpi = () => [...w.document.querySelectorAll('#usage-kpis .v')].map((v) => v.textContent);
  const real = kpi();
  w.document.querySelector('[data-tab=usage]').click();
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepEqual(kpi(), real, 'the counting ends on the real numbers');
  w.document.querySelector('[data-tab=invoices]').click();
  w.document.querySelector('[data-tab=usage]').click();
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepEqual(kpi(), real, 'opening a tab again does not leave a half-counted number');
  assert.deepEqual(errs, []);
});
