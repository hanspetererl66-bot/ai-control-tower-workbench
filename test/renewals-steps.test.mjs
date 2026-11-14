import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'examples/renewals/index.html'), 'utf8');
const data = JSON.parse(/<script type="application\/json" id="renewal-data">\s*([\s\S]*?)<\/script>/.exec(html)[1]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/scrollIntoView/.test(m)) errors.push(m); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(w) { w.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; w.HTMLElement.prototype.scrollIntoView = () => {}; } });
  await wait(120);
  const w = dom.window, d = w.document;
  return { w, d, q: (s) => d.querySelector(s), qa: (s) => [...d.querySelectorAll(s)], errors, visible: () => [...d.querySelectorAll('.pg')].filter((p) => !p.hidden).map((p) => p.id) };
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));


test('renewals: the box "What is this page?" is gone, the other cards stay', async () => {
  const p = await open();
  assert.equal(p.q('details.intro'), null);
  assert.doesNotMatch(p.d.body.textContent, /What is this page\?/);
  assert.ok(p.q('#guide') && p.q('#ctx') && p.q('#tabs'), 'the demo flow, the customer choice and the steps are still there');
  assert.equal(p.errors.length, 0);
});

test('renewals: the four main steps are a path: links between them, the step you are on is marked, the line to the next step flows', async () => {
  const p = await open();
  const links = () => p.qa('#tabs .rp-link').map((l) => l.className.replace('rp-link', '').trim());
  assert.equal(p.qa('#tabs .rp-link').length, 3);
  assert.deepEqual(links(), ['next', '', ''], 'on step 1 the line to step 2 flows');
  assert.equal(p.q('#tabs').className, 'tabs rp rp-in', 'the first drawing plays the entrance');
  click(p.w, p.qa('#tabs .rp-step')[2]);
  assert.deepEqual(links(), ['lit go', 'lit go', 'next'], 'on step 3 the lines up to it are lit and drawn, the one to step 4 flows');
  assert.equal(p.q('#tabs').className, 'tabs rp rp-move');
  assert.equal(p.q('#tabs').style.getPropertyValue('--rp-from'), '0');
  assert.equal(p.q('#tabs .rp-step.on').textContent, '3Renewal action');
  click(p.w, p.q('#tab-autopilot'));
  assert.equal(p.q('#tabs').className, 'tabs rp rp-still', 'a second view of the same step does not replay anything');
  click(p.w, p.qa('#tabs .rp-step')[1]);
  assert.deepEqual(links(), ['lit', 'next', ''], 'going back lights fewer links and draws none');
  assert.equal(p.q('#tabs').style.getPropertyValue('--rp-from'), '2');
  assert.equal(p.qa('#tabs [role=tab]').filter((b) => b.getAttribute('aria-selected') === 'true').length >= 1, true);
  assert.equal(p.errors.length, 0);
});

test('renewals: the seven phases come in one after the other the first time and then stay still; the filtered phase is marked', async () => {
  const p = await open();
  click(p.w, p.qa('#tabs .rp-step')[1]);
  await wait(60);
  assert.equal(p.qa('#process .ph').length, 7);
  assert.ok(p.q('#process .pl').classList.contains('pl-in'), 'the first drawing animates');
  assert.deepEqual(p.qa('#process .ph').map((b) => b.getAttribute('style')), [0, 1, 2, 3, 4, 5, 6].map((i) => `--k:${i}`));
  click(p.w, p.q('#process .ph'));
  await wait(30);
  assert.equal(p.q('#process .pl').classList.contains('pl-in'), false, 'a click that only filters does not replay the entrance');
  assert.equal(p.qa('#process .ph[aria-pressed=true]').length, 1);
  assert.equal(p.errors.length, 0);
});

test('renewals: the step and phase styles use tokens only, every animation stops with reduced motion, and the path folds up on a narrow screen', () => {
  const css = html.slice(html.indexOf('/* The renewal process, big:'), html.indexOf('.an-row{'));
  assert.ok(css.length > 800);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'no colour outside the tokens');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.tabs\.rp \*,\.tabs\.rp,#process \.ph,\.pl-in \.ph\{animation:none!important;transition:none!important\}\}/);
  assert.match(css, /@media \(max-width:760px\)\{\.rp-link\{display:none\}/);
  assert.match(css, /@keyframes rp-draw/);
  assert.match(css, /@keyframes ph-rise/);
});
