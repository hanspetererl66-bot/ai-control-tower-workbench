import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { makeJourney } from '../shared/journey.mjs';

const read = (rel) => readFileSync(join(import.meta.dirname, '..', rel), 'utf8');
const J = makeJourney();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A Space page inside the app: window.parent is a stub, the host posts wb:restore with the hand-overs. */
async function open(file) {
  const errors = [], sent = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/scrollIntoView/.test(m)) errors.push(m); });
  const dom = new JSDOM(read(file), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(w) { Object.defineProperty(w, 'parent', { value: { postMessage: (m) => sent.push(structuredClone(m)) } }); w.ResizeObserver = class { observe() {} disconnect() {} }; } });
  await wait(100);
  const w = dom.window;
  const restore = (handoffs, state = null) => w.dispatchEvent(Object.assign(new w.Event('message'), { source: w.parent, data: { type: 'wb:restore', state, handoffs } }));
  return { w, errors, sent, restore, q: (s) => w.document.querySelector(s), qa: (s) => [...w.document.querySelectorAll(s)] };
}
const stopPayload = (id, customer) => J.handoff(J.stop(id), { customer }).payload;

test('journey receivers: Collections opens the tab and the customer of the stop', async () => {
  const p = await open('examples/collections/index.html');
  assert.equal(p.q('[role=tab][aria-selected=true]').dataset.id, 'list');
  p.restore([{ from: 'sales', payload: stopPayload('collections', 'lindenau') }]);
  assert.equal(p.q('[role=tab][aria-selected=true]').dataset.id, 'list', 'the stop opens the morning list');
  p.qa('[role=tab]').find((b) => b.dataset.id === 'why').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  const picked = () => p.qa('.pick button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim());
  assert.deepEqual(picked(), ['Lindenau Pharma AG'], 'the customer of the stop is the selected one');
  p.restore([{ from: 'sales', payload: { journey: { customer: 'muster', step: 'follow', tab: 'why' } } }]);
  assert.equal(p.q('[role=tab][aria-selected=true]').dataset.id, 'why', 'a tab of the page is taken over');
  assert.deepEqual(picked(), ['Muster Industrie AG']);
  p.restore([{ from: 'sales', payload: { journey: { customer: 'muster', step: 'follow', tab: 'nope' } } }]);
  assert.equal(p.q('[role=tab][aria-selected=true]').dataset.id, 'list', 'an unknown tab falls back to the morning list');
  p.restore([{ from: 'x', payload: { journey: { customer: 'unknown-customer' } } }, { from: 'x', payload: 'junk' }, null]);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('journey receivers: Order-to-Cash opens the renewal orders and puts the customer of the stop first', async () => {
  const p = await open('examples/order-to-cash-software/index.html');
  p.restore([{ from: 'sales', payload: stopPayload('renewal-orders', 'hanse') }]);
  assert.equal(p.q('[role=tab][aria-selected=true]').dataset.id, 'ren');
  assert.match(p.q('#main').textContent, /Hanse Handelsgruppe AG first/);
  assert.match(p.q('#main').textContent, /No renewal order for this customer has arrived yet/);
  const order = (customer, contractId, n) => ({ type: 'renewal-order', contractId, customer, product: 'Product ' + n, end: '2027-01-31', offer: 'Renewal', annualEur: 10000 * n, termMonths: 12, changePct: 3 });
  p.restore([{ from: 'renewals', payload: order('Muster Industrie AG', 'C-2026-0901', 1) }, { from: 'renewals', payload: order('Hanse Handelsgruppe AG', 'C-2026-0911', 2) }]);
  const heads = p.qa('#main .card h2').map((h) => h.textContent);
  assert.match(heads[0], /Hanse Handelsgruppe AG/, 'the journey customer comes first');
  assert.match(heads[0], /journey customer/);
  assert.doesNotMatch(heads[1], /journey customer/);
  assert.match(p.q('#main').textContent, /Their renewal orders are marked below/);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('journey receivers: a plain hand-over of an order (no journey) still opens the renewal orders, as before', async () => {
  const p = await open('examples/order-to-cash-software/index.html');
  p.restore([{ from: 'renewals', payload: { type: 'renewal-order', contractId: 'C-2026-0902', customer: 'Muster Industrie AG', product: 'Work Zone', end: '2026-12-31', offer: 'Renewal', annualEur: 12600, termMonths: 12, changePct: 0 } }]);
  assert.equal(p.q('[role=tab][aria-selected=true]').dataset.id, 'ren');
  assert.doesNotMatch(p.q('#main').textContent, /Sales journey:/);
  p.w.close();
});
