import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const plain = (x) => JSON.parse(JSON.stringify(x));
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
const REPLY = (findings = FINDINGS, o = {}) => ({ type: 'mon:findings', source: 'live', adapter: 'zabbix', fetchedAt: '2026-11-13T08:30', sinceHours: 24, alerts: 7, skipped: 3, withheld: 1, rulesDropped: 0, unmatched: [], findings, ...o });
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
    p.w.__io.setHitl(false);
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

/* ---- the protocol: decisions written down, a person's verdict, the numbers ---- */
const req = (p, type) => p.posted.filter((m) => m.type === type).at(-1);
const reply = async (p, type, body) => { p.answer({ ...body, requestId: req(p, type).requestId }); await p.tick(); };
const IDS = { 'L-1': 101, 'L-2': 102, 'L-3': 103, 'L-4': 104 };
const SUMMARY = (o = {}) => ({ type: 'sh:summary', summary: { runs: 1, decisions: 4, auto: 2, judged: 3, agree: 2, disagree: 1, floorMissed: 0, byReason: { 'wrong-window': 1 }, ...o } });
async function recorded(p) { await enter(p); await reply(p, 'sh:start-request', { type: 'sh:started', runId: 7, decisions: IDS }); }

test('shadow mode writes every decision of the agent to the protocol, judged as if human in the loop were off, whatever the switch says', async () => {
  const p = load();
  try {
    assert.equal(p.w.__io.state.auto.hitl, true, 'the switch is on');
    await enter(p);
    const r = req(p, 'sh:start-request');
    assert.deepEqual(plain(r.run), { adapter: 'zabbix', fetchedAt: '2026-11-13T08:30', alerts: 7, skipped: 3, withheld: 1 });
    const by = Object.fromEntries(r.decisions.map((d) => [d.findingId, d]));
    assert.equal(Object.keys(by).length, 4);
    assert.equal(by['L-1'].mode, 'auto');
    assert.equal(by['L-2'].mode, 'approval');
    assert.deepEqual(plain(by['L-2'].floors), ['prod']);
    assert.equal(by['L-2'].customerNeeded, true);
    assert.equal(by['L-2'].customer, '', 'an unknown customer is not given an id');
    assert.deepEqual([by['L-1'].host, by['L-1'].kind, by['L-1'].template, by['L-1'].env, by['L-1'].deadlineDays], ['gw-01', 'cert-expiry', 'renew-certificate', 'PRD', 14]);
    assert.match(by['L-1'].windowStart, /^2026-11-\d\dT\d\d:\d\d$/);
    assert.ok(by['L-1'].why.length > 5);
    assert.equal(p.doc.querySelector('#hitl').disabled, true, 'the switch cannot be used in shadow mode');
    await reply(p, 'sh:start-request', { type: 'sh:started', runId: 7, decisions: IDS });
    assert.deepEqual(p.w.__io.state.decisionIds, IDS);
    assert.match(p.doc.querySelector('#view').textContent, /Does the decision above hold\?/);
    p.doc.querySelector('[data-tab=audit]').click();
    assert.match(p.doc.body.textContent, /Protocol: run #7 with 4 decisions recorded/);
    assert.ok(req(p, 'sh:summary-request'), 'the numbers are asked for');
  } finally { p.close(); }
});

test('a verdict: agree is one click, disagree offers only the reasons that fit the decision, both go to the protocol and the numbers are refreshed', async () => {
  const p = load();
  try {
    await recorded(p);
    const plan = (id) => [...p.doc.querySelectorAll('.plan')].find((el) => el.textContent.includes(id));
    plan('L-1').querySelector('[data-act=v-agree]').click();
    assert.deepEqual(plain([req(p, 'sh:verdict-request').decisionId, req(p, 'sh:verdict-request').verdict]), [101, 'agree']);
    await reply(p, 'sh:verdict-request', { type: 'sh:verdict', decisionId: 101, verdict: 'agree', reason: '' });
    assert.match(plan('L-1').textContent, /You agree/);
    assert.ok(req(p, 'sh:summary-request'));
    // a decision to run by itself: "a floor did not hold" fits, "it could have run by itself" does not
    plan('L-1').querySelector('[data-act=v-open]').click();
    let opts = [...plan('L-1').querySelectorAll('[data-reason] option')].map((o) => o.value);
    assert.ok(opts.includes('floor-missed') && !opts.includes('over-cautious'));
    plan('L-1').querySelector('[data-reason]').value = 'floor-missed';
    plan('L-1').querySelector('[data-note]').value = 'renewal needs the security team';
    plan('L-1').querySelector('[data-act=v-save]').click();
    assert.deepEqual(plain(['decisionId', 'verdict', 'reason', 'note'].map((k) => req(p, 'sh:verdict-request')[k])), [101, 'disagree', 'floor-missed', 'renewal needs the security team']);
    await reply(p, 'sh:verdict-request', { type: 'sh:verdict', decisionId: 101, verdict: 'disagree', reason: 'floor-missed' });
    assert.match(plan('L-1').textContent, /You disagree: A person should have decided/, 'a changed mind is a new verdict');
    // a decision to wait for a person: the other way round
    plan('L-4').querySelector('[data-act=v-open]').click();
    opts = [...plan('L-4').querySelectorAll('[data-reason] option')].map((o) => o.value);
    assert.ok(opts.includes('over-cautious') && !opts.includes('floor-missed'));
    plan('L-4').querySelector('[data-act=v-cancel]').click();
    assert.equal(plan('L-4').querySelector('[data-reason]'), null);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('without the protocol (no database) the decisions are still shown, marked as not recorded, with no way to judge', async () => {
  const p = load();
  try {
    await enter(p);
    await reply(p, 'sh:start-request', { type: 'ct:error', message: 'The shadow protocol needs the desktop app and the shared database.' });
    assert.equal(p.doc.querySelectorAll('.plan').length, 4);
    assert.match(p.doc.querySelector('#view').textContent, /Not recorded: the protocol is not available \(The shadow protocol needs the desktop app/);
    assert.equal(p.doc.querySelector('[data-act=v-agree]'), null);
    assert.deepEqual(plain(p.w.__io.state.decisionIds), {});
  } finally { p.close(); }
});

test('a verdict that cannot be saved is not shown as given', async () => {
  const p = load();
  try {
    await recorded(p);
    p.doc.querySelector('[data-act=v-agree]').click();
    await reply(p, 'sh:verdict-request', { type: 'ct:error', message: 'unknown decision' });
    assert.equal(Object.keys(p.w.__io.state.verdicts).length, 0);
    assert.match(p.doc.body.textContent, /Does the decision above hold\?/);
  } finally { p.close(); }
});

test('the numbers: judged, agreed, floors that did not hold; any floor that did not hold is a stop sign', async () => {
  const p = load();
  try {
    await recorded(p);
    await reply(p, 'sh:summary-request', SUMMARY());
    p.doc.querySelector('[data-tab=outcomes]').click();
    await reply(p, 'sh:summary-request', SUMMARY());
    const t = p.doc.querySelector('#view').textContent;
    assert.match(t, /Shadow results \(all runs\)/);
    assert.match(t, /4decisions in 1 run[\s\S]*3judged by you[\s\S]*67 %you agreed[\s\S]*0floors that did not hold \(target 0\)/);
    assert.match(t, /The window is wrong: 1/);
    assert.equal(p.doc.querySelector('.redbar'), null, 'no stop sign at 0');
    await reply(p, 'sh:summary-request', SUMMARY({ floorMissed: 2, byReason: { 'floor-missed': 2 } }));
    p.doc.querySelector('[data-tab=audit]').click(); p.doc.querySelector('[data-tab=outcomes]').click();
    await reply(p, 'sh:summary-request', SUMMARY({ floorMissed: 2, byReason: { 'floor-missed': 2 } }));
    assert.match(p.doc.querySelector('.redbar').textContent, /Stop: a floor did not hold 2 times\./);
    assert.match(p.doc.querySelector('.redbar').textContent, /abort criterion of the roadmap/);
  } finally { p.close(); }
});

test('decisions and verdicts survive a trip to another Space; leaving shadow mode clears them', async () => {
  const p = load();
  try {
    await recorded(p);
    p.doc.querySelector('[data-act=v-agree]').click();
    await reply(p, 'sh:verdict-request', { type: 'sh:verdict', decisionId: req(p, 'sh:verdict-request').decisionId, verdict: 'agree', reason: '' });
    const saved = p.posted.filter((m) => m.type === 'wb:state').at(-1).state;
    assert.deepEqual(plain(saved.decisionIds), IDS);
    assert.equal(Object.keys(saved.verdicts).length, 1);
    const q = load();
    try { q.send(saved); assert.deepEqual(plain(q.w.__io.state.decisionIds), IDS); assert.match(q.doc.querySelector('#view').textContent, /You agree/); } finally { q.close(); }
    p.doc.querySelector('#shadow').click();
    assert.deepEqual(plain([p.w.__io.state.decisionIds, p.w.__io.state.verdicts, p.w.__io.state.proto]), [{}, {}, null]);
  } finally { p.close(); }
});

test('ignored rules are shown: no banner at 0, a banner with the number and the reasons otherwise, and it survives a trip', async () => {
  const p = load();
  try {
    await enter(p);
    assert.ok(![...p.doc.querySelectorAll('.banner')].some((b) => /rules? ignored/.test(b.textContent)), 'nothing to say at 0');
    p.doc.querySelector('#shadow').click();
    await enter(p, REPLY(FINDINGS, { rulesDropped: 2 }));
    const text = [...p.doc.querySelectorAll('.banner')].map((b) => b.textContent).join(' ');
    assert.match(text, /2 rules ignored\./);
    assert.match(text, /longer than 100 characters or not a valid pattern[\s\S]*kind is unknown[\s\S]*more than 30 rules[\s\S]*Findings may be missing/);
    const saved = p.posted.filter((m) => m.type === 'wb:state').at(-1).state;
    assert.equal(saved.shadow.rulesDropped, 2);
    const q = load();
    try { q.send(saved); assert.match(q.doc.body.textContent, /2 rules ignored\./); } finally { q.close(); }
    p.doc.querySelector('#shadow').click();
    await enter(p, REPLY(FINDINGS, { rulesDropped: 1 }));
    assert.match([...p.doc.querySelectorAll('.banner')].map((b) => b.textContent).join(' '), /1 rule ignored\./, 'singular');
  } finally { p.close(); }
});

test('the alerts that match no rule are shown with their wording, escaped; nothing is shown when there are none; the list survives a trip', async () => {
  const p = load();
  try {
    await enter(p);
    assert.equal(p.doc.querySelector('.unmatched'), null, 'no list, no box');
    p.doc.querySelector('#shadow').click();
    const unmatched = [{ id: 'U1', host: 'gw-02', severity: 'high', text: 'Zertifikat l\u00e4uft in 5 Tagen ab' }, { id: 'U2', host: 'srv-<b>x</b>', severity: 'low', text: '<img src=x onerror=alert(1)> Backup failed' }];
    await enter(p, REPLY(FINDINGS, { skipped: 5, unmatched }));
    const box = p.doc.querySelector('.unmatched');
    assert.match(box.querySelector('summary').textContent, /5 alerts match no rule: show them/);
    assert.match(box.textContent, /gw-02 · high · Zertifikat l\u00e4uft in 5 Tagen ab/);
    assert.match(box.textContent, /… and 3 more\./, 'the list is cut, the count is not');
    assert.equal(box.querySelector('img'), null, 'markup is shown as text, never run');
    assert.match(box.textContent, /<img src=x onerror=alert\(1\)> Backup failed/);
    assert.match(box.textContent, /text pattern on this wording/);
    const saved = p.posted.filter((m) => m.type === 'wb:state').at(-1).state;
    assert.equal(saved.shadow.unmatched.length, 2);
    const q = load();
    try { q.send(saved); assert.match(q.doc.querySelector('.unmatched summary').textContent, /5 alerts match no rule/); } finally { q.close(); }
    p.doc.querySelector('#shadow').click();
    await enter(p, REPLY(FINDINGS, { skipped: 1, unmatched: [unmatched[0]] }));
    assert.match(p.doc.querySelector('.unmatched summary').textContent, /1 alert matches no rule: show it/, 'singular');
  } finally { p.close(); }
});
