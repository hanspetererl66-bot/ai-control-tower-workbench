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
