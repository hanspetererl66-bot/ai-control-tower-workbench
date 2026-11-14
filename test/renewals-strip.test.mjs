import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'examples/renewals/index.html'), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/scrollIntoView/.test(m)) errors.push(m); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(w) { w.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; w.Element.prototype.scrollIntoView = () => {}; } });
  await wait(150);
  const d = dom.window.document;
  return { w: dom.window, d, q: (s) => d.querySelector(s), qa: (s) => [...d.querySelectorAll(s)], errors, visible: () => [...d.querySelectorAll('.pg')].filter((p) => !p.hidden).map((p) => p.id) };
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const num = (pill) => pill.querySelector('b').textContent;

test('the scope strip: renewals at stake, decision within six weeks and red renewals are buttons', async () => {
  const p = await open();
  const pills = p.qa('#jr .jr-val button.jr-pill');
  assert.deepEqual(pills.map((b) => b.dataset.jr), ['stake', 'six', 'red']);
  assert.match(pills[0].textContent, /renewals at stake \(a year\)/);
  assert.match(pills[1].textContent, /Decision within six weeks/); assert.match(num(pills[1]), /^\d+ of \d+$/);
  assert.match(pills[2].textContent, /Red renewals/);
  for (const b of pills) { assert.equal(b.getAttribute('aria-pressed'), 'false'); assert.match(b.title, /Show the renewals behind this figure/); }
  assert.equal(p.errors.length, 0);
});

test('a click on a figure opens the renewals behind it on the overview, with exactly that many rows, and a second click closes it', async () => {
  const p = await open();
  const strip = () => Object.fromEntries(p.qa('#jr .jr-pill').map((b) => [b.dataset.jr, num(b)]));
  const rows = () => p.qa('#kpi-detail tbody tr');

  click(p.w, p.q('#jr [data-jr=red]'));
  assert.deepEqual(p.visible(), ['pg-overview']);
  assert.equal(p.q('#kpi-detail').hidden, false);
  assert.match(p.q('#kpi-detail h2').textContent, /^Red renewals: \d+/);
  assert.equal(rows().length, +strip().red, 'the list has as many rows as the figure says');
  assert.equal(p.q('#jr [data-jr=red]').getAttribute('aria-pressed'), 'true');

  click(p.w, p.q('#jr [data-jr=six]'));
  assert.match(p.q('#kpi-detail h2').textContent, /^Decision within six weeks: \d+/);
  assert.equal(rows().length, +strip().six.split(' of ')[0]);
  assert.equal(p.q('#jr [data-jr=red]').getAttribute('aria-pressed'), 'false'); assert.equal(p.q('#jr [data-jr=six]').getAttribute('aria-pressed'), 'true');

  click(p.w, p.q('#jr [data-jr=stake]'));
  assert.match(p.q('#kpi-detail h2').textContent, /^Renewals at stake \(a year\): \d+/);
  assert.equal(rows().length, +strip().six.split(' of ')[1], 'all live renewals of the scope');
  const values = rows().map((r) => +r.children[2].textContent.replace(/[^\d]/g, ''));
  assert.deepEqual(values, [...values].sort((a, b) => b - a), 'the biggest value first');
  assert.equal(values.reduce((a, b) => a + b, 0), +strip().stake.replace(/[^\d]/g, ''), 'the rows add up to the figure of the strip');

  click(p.w, p.q('#jr [data-jr=stake]'));
  assert.equal(p.q('#kpi-detail').hidden, true, 'a second click closes it');
  assert.equal(p.errors.length, 0);
});

test('from another tab a click on a figure brings the overview with the list, and a click on a row opens the renewal', async () => {
  const p = await open();
  p.q('#tabs [data-id=process]')?.click();
  assert.ok(!p.visible().includes('pg-overview') || p.visible().length === 1);
  click(p.w, p.q('#jr [data-jr=red]'));
  assert.deepEqual(p.visible(), ['pg-overview']);
  const first = p.q('#kpi-detail tbody tr');
  assert.ok(first);
  click(p.w, first);
  assert.deepEqual(p.visible(), ['pg-list'], 'the row opens the renewal in the list');
  assert.equal(p.errors.length, 0);
});

test('the figures follow the customer and owner choice, because the lists use the same scope', async () => {
  const p = await open();
  p.q('#customer').value = 'lindenau'; p.q('#customer').dispatchEvent(new p.w.Event('change', { bubbles: true }));
  const strip = Object.fromEntries(p.qa('#jr .jr-pill').map((b) => [b.dataset.jr, num(b)]));
  assert.match(p.q('#jr .jr-pill').textContent, /^Lindenau: renewals at stake/);
  click(p.w, p.q('#jr [data-jr=red]'));
  assert.equal(p.qa('#kpi-detail tbody tr').length, +strip.red);
  click(p.w, p.q('#jr [data-jr=six]'));
  assert.equal(p.qa('#kpi-detail tbody tr').length, +strip.six.split(' of ')[0]);
  assert.equal(p.errors.length, 0);
});
