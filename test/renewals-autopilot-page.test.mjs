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

test('renewals autopilot page: run, gates, approval, sending and signing move a renewal through the steps', async () => {
  const p = await open();
  click(p.w, p.q('#tab-autopilot'));
  assert.deepEqual(p.visible(), ['pg-autopilot']);
  assert.ok(p.q('#ap-run') && !p.q('#ap-run').disabled);
  assert.equal(p.qa('.apcase').length, 0, 'nothing runs before the button is pressed');
  click(p.w, p.q('#ap-run'));
  const waiting = p.qa('.apcase.st-waiting-person'), cust = p.qa('.apcase.st-waiting-customer');
  assert.ok(waiting.length > 0 && cust.length > 0);
  assert.equal(p.qa('.apcase').length, p.w.__renewals().filter((c) => c.stage < 4 || c.stage === 4).length, 'every open renewal has a case');
  assert.ok(waiting[0].querySelector('[data-apa=approve]'), 'a gate offers Approve');
  assert.ok(!waiting[0].querySelector('[data-apa=send]'), 'nothing can be sent before the approval');
  const id = waiting[0].querySelector('[data-apa=approve]').dataset.id;
  click(p.w, waiting[0].querySelector('[data-apa=approve]'));
  const card = () => p.q(`.apcase[data-case="${id}"]`);
  assert.ok(card().querySelector('[data-apa=send]'), 'after the approval the e-mail waits for a person');
  assert.equal(p.w.__state.stage[id], 2);
  click(p.w, card().querySelector('[data-apa=send]'));
  assert.ok(card().classList.contains('st-waiting-customer'));
  assert.equal(p.w.__state.stage[id], 3);
  click(p.w, card().querySelector('[data-apa=signed]'));
  assert.ok(card().classList.contains('st-done'));
  assert.equal(p.w.__state.stage[id], 4, 'the other pages see the renewal as signed');
  assert.match(card().textContent, /Order-to-Cash/);
  click(p.w, p.q('#ap-reset'));
  assert.equal(p.qa('.apcase').length, 0);
  assert.equal(p.w.__state.stage[id], undefined);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals autopilot page: supervised mode sends every renewal to a person; a saved state is checked when it comes back', async () => {
  const p = await open();
  click(p.w, p.q('#tab-autopilot'));
  const mode = p.q('#ap-mode'); mode.value = 'supervised'; mode.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  click(p.w, p.q('#ap-run'));
  assert.equal(p.qa('.apcase.st-waiting-customer').length, 0, 'in supervised mode nothing goes out alone');
  const bad = { ap: { [p.w.__renewals()[0].id]: { status: 'done', step: 99, mode: 'autopilot', pick: null, gate: null, reasons: [], log: [] }, nope: {} }, apMode: 'weird' };
  p.w.dispatchEvent(Object.assign(new p.w.Event('message'), { source: p.w.parent, data: { type: 'wb:restore', state: bad } }));
  assert.deepEqual(p.errors, []);
  p.w.close();
});

async function openInHost() {
  const posted = [], errors = [];
  const parent = { postMessage: (m) => posted.push(structuredClone(m)) };
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/scrollIntoView/.test(m)) errors.push(m); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(w) { Object.defineProperty(w, 'parent', { value: parent }); w.ResizeObserver = class { observe() {} disconnect() {} }; } });
  await wait(120);
  const w = dom.window;
  return { w, posted, errors, q: (s) => w.document.querySelector(s), qa: (s) => [...w.document.querySelectorAll(s)] };
}
const toHost = (w, data) => w.dispatchEvent(Object.assign(new w.Event('message'), { source: w.parent, data }));

test('renewals autopilot: a signed renewal is handed over to Order-to-Cash (Software) once, and the booking comes back into the log', async () => {
  const p = await openInHost();
  click(p.w, p.q('#tab-autopilot')); click(p.w, p.q('#ap-run'));
  const first = p.q('.apcase.st-waiting-person [data-apa=approve]'), id = first.dataset.id;
  click(p.w, first); click(p.w, p.q(`[data-apa=send][data-id="${id}"]`)); click(p.w, p.q(`[data-apa=signed][data-id="${id}"]`));
  const hand = p.posted.filter((m) => m.type === 'wb:handoff');
  assert.equal(hand.length, 1);
  assert.equal(hand[0].to, 'order-to-cash-software');
  assert.equal(hand[0].open, false, 'it is queued, the person is not thrown out of the page');
  const c = data.cases.find((x) => x.id === id);
  assert.equal(hand[0].payload.type, 'renewal-order');
  assert.equal(hand[0].payload.contractId, c.contractId);
  assert.ok(Number.isInteger(hand[0].payload.termMonths) && hand[0].payload.annualEur > 0);
  assert.ok(JSON.stringify(hand[0]).length < 4000);
  // the button opens the other Space and does not hand over a second time in the log
  click(p.w, p.q(`[data-apopen="${id}"]`));
  assert.equal(p.posted.filter((m) => m.type === 'wb:handoff').length, 2);
  assert.equal(p.w.__state.ap[id].log.filter((e) => /handed over to the Space/.test(e.text)).length, 1);
  // Order management answers
  toHost(p.w, { type: 'wb:restore', state: null, handoffs: [{ from: 'order-to-cash-software', payload: { type: 'order-confirmed', contractId: c.contractId, orderNo: 'SO-92001', invoiceFrom: '2027-01-01' } }] });
  assert.match(p.q(`.apcase[data-case="${id}"]`).textContent, /Booked in Order-to-Cash: SO-92001/);
  assert.equal(p.w.__state.ap[id].log.at(-1).actor, 'Order management');
  toHost(p.w, { type: 'wb:restore', state: null, handoffs: [{ from: 'x', payload: { type: 'order-confirmed', contractId: c.contractId, orderNo: 'not-an-order' } }] });
  assert.equal(p.w.__state.ap[id].booked, 'SO-92001', 'a bad answer changes nothing');
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals autopilot: "Draft with Joule" asks for a Gmail draft to the own address, not sent, within 600 characters, once', async () => {
  const p = await openInHost();
  click(p.w, p.q('#tab-autopilot')); click(p.w, p.q('#ap-run'));
  const id = p.q('.apcase.st-waiting-person [data-apa=approve]').dataset.id;
  click(p.w, p.q(`[data-apa=approve][data-id="${id}"]`));
  const b = p.q(`[data-apdraft="${id}"]`);
  assert.ok(b && !b.disabled);
  click(p.w, b);
  const asks = p.posted.filter((m) => m.type === 'wb:ask');
  assert.equal(asks.length, 1);
  assert.match(asks[0].prompt, /create_draft to my own address/);
  assert.match(asks[0].prompt, /do NOT send/);
  assert.doesNotMatch(asks[0].prompt, /@/, 'no address goes into the request');
  assert.ok(asks[0].prompt.length <= 600);
  assert.ok(p.q(`[data-apdraft="${id}"]`).disabled, 'asked once');
  assert.ok(p.w.__state.ap[id].log.some((e) => /Asked Joule for a mail draft/.test(e.text)));
  p.w.close();
});

test('renewals autopilot: it never lowers a stage a person set, and "Reset autopilot" gives that stage back', async () => {
  const p = await open();
  const [byHand, untouched] = p.w.__renewals().filter((x) => x.status !== 'Lapsed' && x.annualEur >= 30000 && x.stage === 0);
  p.w.__state.stage[byHand.id] = 3; // a person took this renewal to "Sent" by hand
  click(p.w, p.q('#tab-autopilot')); click(p.w, p.q('#ap-run'));
  assert.ok(p.w.__state.ap[byHand.id], 'the autopilot ran on it');
  assert.equal(p.w.__state.ap[byHand.id].prevStage, 3, 'it remembers the stage from before');
  assert.equal(p.w.__state.stage[byHand.id], 3, 'the stage is not lowered');
  assert.equal(p.w.__state.stage[untouched.id], 1, 'a renewal nobody touched starts at 1');
  click(p.w, p.q('#ap-reset'));
  assert.equal(p.w.__state.stage[byHand.id], 3, 'reset gives back the stage a person had set');
  assert.equal(p.w.__state.stage[untouched.id], undefined, 'and removes what the autopilot set');
  assert.equal(p.w.__state.ap[byHand.id], undefined);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals autopilot: the stage "Prepared" says who prepared it', async () => {
  const p = await open();
  const [auto, person] = p.w.__renewals().filter((x) => x.status !== 'Lapsed' && x.annualEur >= 30000 && x.stage === 0);
  p.w.__state.stage[person.id] = 1; // a person marked this one as prepared
  click(p.w, p.q('#tab-autopilot')); click(p.w, p.q('#ap-run'));
  click(p.w, p.q('#tab-list'));
  click(p.w, p.q(`#rows tr[data-id="${auto.id}"]`));
  assert.match(p.q('#detail .flow').textContent, /Prepared \(autopilot\)/);
  assert.doesNotMatch(p.q('#detail .flow').textContent, /by you/, 'the autopilot is not "you"');
  click(p.w, p.q(`#rows tr[data-id="${person.id}"]`));
  assert.match(p.q('#detail .flow').textContent, /Prepared \(by you\)/, 'a person who prepared it is still named');
  assert.doesNotMatch(p.q('#detail .flow').textContent, /Prepared \(autopilot\)/);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals autopilot: the remembered stage is part of the saved state and a damaged value is dropped', async () => {
  const hosted = async () => { const p = await open(); const sent = []; Object.defineProperty(p.w, 'parent', { value: { postMessage: (m) => sent.push(m) } }); return { p, sent }; };
  const restore = (p, state) => p.w.dispatchEvent(new p.w.MessageEvent('message', { data: { type: 'wb:restore', state, handoffs: [] }, source: p.w.parent }));
  const a = await hosted();
  const c = a.p.w.__renewals().find((x) => x.status !== 'Lapsed' && x.annualEur >= 30000 && x.stage === 0);
  a.p.w.__state.stage[c.id] = 2;
  click(a.p.w, a.p.q('#tab-autopilot')); click(a.p.w, a.p.q('#ap-run'));
  const saved = JSON.parse(JSON.stringify(a.sent.filter((m) => m.type === 'wb:state').at(-1).state));
  assert.equal(saved.ap[c.id].prevStage, 2);
  a.p.w.close();
  const ok = await hosted(); restore(ok.p, saved);
  assert.equal(ok.p.w.__state.ap[c.id].prevStage, 2, 'it comes back');
  ok.p.w.close();
  for (const bad of [9, -1, 'x', 1.5]) {
    const b = await hosted(); const broken = JSON.parse(JSON.stringify(saved)); broken.ap[c.id].prevStage = bad;
    restore(b.p, broken);
    assert.equal(b.p.w.__state.ap[c.id], undefined, `prevStage ${JSON.stringify(bad)} is not trusted`);
    b.p.w.close();
  }
});
