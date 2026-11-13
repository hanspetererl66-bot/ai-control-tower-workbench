import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/infra-orchestrator/index.html'), 'utf8');

function load(hosted = true) {
  const posted = [];
  const parent = { postMessage: (m) => posted.push(m) };
  const errors = [];
  const dom = new JSDOM(page, { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { if (hosted) Object.defineProperty(w, 'parent', { value: parent }); w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); w.addEventListener('error', (e) => errors.push(e.message)); } });
  const w = dom.window;
  const answer = (m) => { const ev = new w.Event('message'); ev.source = parent; ev.data = m; w.dispatchEvent(ev); };
  const send = (state) => answer({ type: 'wb:restore', state, handoffs: [] });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { w, doc: w.document, posted, answer, send, tick, errors, close: () => w.close() };
}
const F = (o = {}) => ({ id: 'L-1', customer: 'mi', customerName: 'Muster Industrie AG', host: 'gw-01', env: 'PRD', kind: 'cert-expiry', template: 'renew-certificate', deadlineDays: 14, signal: 'Certificate for edge expires in 5 days', evidence: 'Monitoring alert 1 at 2026-11-13 08:00 UTC on gw-01: Certificate for edge expires in 5 days', live: true, ...o });
const FINDINGS = [F(), F({ id: 'L-2', customer: '', customerName: 'Kunde X GmbH', host: 'x-app01', kind: 'patch-age', template: 'patch-vm', deadlineDays: 30 }), F({ id: 'L-3', customer: 'hr', customerName: 'Hanseatic Retail GmbH', host: 'hr-qas01', env: 'QAS', kind: 'patch-age', template: 'patch-vm', deadlineDays: 25 }),
  F({ id: 'L-4', host: 'gw-02', deadlineDays: 1, signal: 'Certificate expires tomorrow' })];
const REPLY = (findings = FINDINGS, o = {}) => ({ type: 'mon:findings', source: 'live', adapter: 'zabbix', fetchedAt: '2026-11-13T08:30', sinceHours: 24, alerts: 7, skipped: 3, withheld: 1, findings, ...o });
const lastReq = (p) => p.posted.filter((m) => m.type === 'mon:findings-request').at(-1);
const enter = async (p, reply = REPLY()) => { p.doc.querySelector('#shadow').click(); p.answer({ ...reply, requestId: lastReq(p).requestId }); await p.tick(); };

test('outside the Werkbank there is no shadow button', () => {
  const p = load(false);
  try { assert.equal(p.doc.querySelector('#shadow'), null); } finally { p.close(); }
});

test('shadow mode: the live findings are asked for, planned with today as the date, and shown with what was not used', async () => {
  const p = load();
  try {
    assert.match(p.doc.querySelector('#shadow').textContent, /Load live findings \(shadow mode\)/);
    await enter(p);
    const r = lastReq(p);
    assert.deepEqual([r.type, r.sinceHours], ['mon:findings-request', 24]);
    assert.equal(p.doc.querySelectorAll('.plan').length, 4, 'the demo findings are replaced');
    const banner = p.doc.querySelector('.shadowbar').textContent;
    assert.match(banner, /Shadow mode\.[\s\S]*zabbix[\s\S]*2026-11-13 08:30 UTC[\s\S]*7 alerts, 4 findings, 3 not matched by a rule, 1 withheld[\s\S]*nothing is executed or approved/);
    assert.equal(p.w.__io.state.shadow.adapter, 'zabbix');
    assert.match(p.doc.querySelector('#demo').textContent, /^Shadow mode: the findings come from the live monitoring/);
    assert.match(p.doc.querySelector('.clock b').textContent, /^2026-11-13 00:00/, 'today, not the demo date');
    const windows = [...p.doc.querySelectorAll('.slot b')].map((b) => b.textContent);
    assert.ok(windows.every((t) => /^2026-11-(1[5-9]|2\d|30)|^2026-12/.test(t) || t === 'none found'), `windows are after today: ${windows}`);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('shadow mode executes and approves nothing: no action buttons, no run starts even with human in the loop off', async () => {
  const p = load();
  try {
    await enter(p);
    p.doc.querySelector('#hitl').click();
    p.w.__io.finish();
    assert.equal(p.doc.querySelector('[data-act=approve]'), null);
    assert.equal(p.doc.querySelector('[data-act=hotline]'), null);
    assert.equal(p.doc.querySelector('[data-act=retry]'), null);
    assert.ok(!Object.values(p.w.__io.state.items).some((s) => s.running || s.done || s.approved), 'nothing ran or was approved');
    p.w.__io.approve('L-1');
    assert.ok(!p.w.__io.state.items['L-1'] || !p.w.__io.state.items['L-1'].approved, 'not even by a direct call');
    assert.match(p.doc.body.textContent, /Shadow: would run by itself/, 'the QAS retail patch with its customer rule');
    assert.match(p.doc.body.textContent, /Shadow: would wait for the customer/, 'the patch windows above the policy threshold');
    assert.match(p.doc.body.textContent, /Shadow: would wait for a person/, 'a deadline the next window cannot meet');
    assert.match(p.doc.body.textContent, /Nothing is executed or approved/);
  } finally { p.close(); }
});

test('shadow mode: the decisions follow the same rules, and a customer the demo does not know gets assumed nights', async () => {
  const p = load();
  try {
    await enter(p);
    p.doc.querySelector('#hitl').click();
    const a = Object.fromEntries(p.w.__io.assessments().map((x) => [x.id, x]));
    assert.equal(a['L-1'].mode, 'auto', 'low-risk certificate, no floor');
    assert.equal(a['L-2'].mode, 'approval', 'production patch: a floor');
    assert.ok(a['L-2'].floors.some((f) => f.id === 'prod'));
    assert.equal(a['L-3'].mode, 'auto', 'QAS patch with the customer rule of the demo data');
    assert.match([...p.doc.querySelectorAll('.plan')].find((el) => el.textContent.includes('L-2')).textContent, /Kunde X GmbH[\s\S]*assumed nights/);
    assert.doesNotMatch([...p.doc.querySelectorAll('.plan')].find((el) => el.textContent.includes('L-1')).textContent, /assumed nights/, 'a customer the demo knows has its own nights');
    assert.equal(a['L-4'].mode, 'approval', 'the window is after the deadline: a floor');
    assert.equal(p.w.__io.state.live.length, 4);
  } finally { p.close(); }
});

test('an error keeps the demo findings and says why; Back to demo findings leaves shadow mode', async () => {
  const p = load();
  try {
    p.doc.querySelector('#shadow').click();
    p.answer({ type: 'ct:error', requestId: lastReq(p).requestId, message: 'No monitoring is connected.' });
    await p.tick();
    assert.match(p.doc.body.textContent, /No monitoring is connected\. The demo findings stay\./);
    assert.equal(p.w.__io.state.shadow, null);
    await enter(p);
    assert.equal(p.doc.querySelectorAll('.plan').length, 4);
    p.doc.querySelector('#shadow').click();
    assert.equal(p.w.__io.state.shadow, null);
    assert.equal(p.doc.querySelector('.shadowbar'), null);
    p.doc.querySelector('[data-act=sweep]').click();
    assert.equal(p.doc.querySelectorAll('.plan').length, 8, 'the demo findings are back');
    assert.match(p.doc.querySelector('#demo').textContent, /^Fictional findings and fixed rules/);
  } finally { p.close(); }
});

test('shadow mode survives a trip to another Space; an answer nobody asked for is ignored', async () => {
  const p = load();
  try {
    p.answer({ ...REPLY(), requestId: 'unknown' });
    assert.equal(p.w.__io.state.shadow, null);
    await enter(p);
    const saved = p.posted.filter((m) => m.type === 'wb:state').at(-1).state;
    assert.equal(saved.shadow.adapter, 'zabbix');
    assert.equal(saved.live.length, 4);
    const q = load();
    try { q.send(saved); assert.equal(q.w.__io.state.shadow.adapter, 'zabbix'); assert.equal(q.doc.querySelectorAll('.plan').length, 4); } finally { q.close(); }
  } finally { p.close(); }
});
