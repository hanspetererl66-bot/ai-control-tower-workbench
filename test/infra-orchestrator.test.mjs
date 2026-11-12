import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { embedOrchestrator, repoOrchestratorData } from '../scripts/sync-infra-orchestrator.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('examples/infra-orchestrator/index.html');
const logicSource = /<script id="orch-logic">([\s\S]*?)<\/script>/.exec(page)[1];
const L = vm.runInNewContext(`${logicSource}; ({ threshold, autonomyOf, nextWindow, assess, statusOf, autoStarts, stepItem, orderOf, RUN_STEPS })`);
const data = repoOrchestratorData();
const plain = (x) => JSON.parse(JSON.stringify(x));
const auto = (hitl, extra = {}) => ({ ...plain(data.autonomy), hitl, ...extra });
const f = (id) => data.findings.find((x) => x.id === id);
const A = (id, hitl = false, a = auto(hitl)) => plain(L.assess(data, a, f(id)));

test('page embeds the current data and design system, is installable, has no network or storage access, colours only as tokens', () => {
  assert.equal(embedOrchestrator(page, data, read('examples/shared/design-system.css')), page, 'run npm run sync:infra-orchestrator');
  assert.equal(EXAMPLE_SPACES['infra-orchestrator'], 'infra-orchestrator');
  assert.ok(SPACE_PAGES.includes('examples/infra-orchestrator/index.html'));
  const code = page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '');
  assert.doesNotMatch(code, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket/);
  assert.doesNotMatch(code.replace(/<style[\s\S]*?<\/style>/g, ''), /#[0-9a-fA-F]{3,8}\b/);
  const meta = JSON.parse(read('examples/infra-orchestrator/space.json'));
  assert.equal(meta.domain, 'Autonomous Operations');
});

test('human in the loop on: every plan waits for a person, whatever the matrix says', () => {
  for (const x of data.findings) assert.equal(A(x.id, true).mode, 'approval', x.id);
});

test('human in the loop off: low-risk plans run by themselves, the floors keep the rest with a person', () => {
  const modes = Object.fromEntries(data.findings.map((x) => [x.id, A(x.id).mode]));
  assert.deepEqual(modes, { 'F-801': 'auto', 'F-802': 'auto', 'F-803': 'approval', 'F-804': 'auto', 'F-805': 'approval', 'F-806': 'auto', 'F-807': 'approval', 'F-808': 'auto' });
  assert.deepEqual(A('F-803').floors.map((x) => x.id), ['prod']);
  assert.deepEqual(A('F-805').floors.map((x) => x.id), ['risk', 'prod', 'deadline']);
});

test('the floors cannot be switched off: even a matrix that says "agent" for a high-risk move stays with a person', () => {
  const all = auto(false, { defaults: { ...data.autonomy.defaults, 'move-vm': 'auto', 'patch-vm': 'auto' }, overrides: [] });
  assert.equal(A('F-805', false, all).mode, 'approval');
  assert.equal(A('F-803', false, all).mode, 'approval', 'production patch');
  assert.equal(A('F-804', false, all).mode, 'auto', 'QAS patch is no floor');
});

test('the matrix: a customer rule beats the default', () => {
  assert.deepEqual(plain(L.autonomyOf(data.autonomy, 'hr', 'patch-vm')), { mode: 'auto', source: 'customer', note: 'Retail QAS landscape: patching may run on its own' });
  assert.equal(L.autonomyOf(data.autonomy, 'ke', 'patch-vm').mode, 'human');
  const off = auto(false, { overrides: [] });
  assert.equal(A('F-804', false, off).mode, 'approval', 'without the customer rule the default (person) applies');
});

test('the window policy of the hotline decides who agrees the window; the agent never sets it', () => {
  assert.equal(A('F-801').customer.needed, false);
  assert.equal(A('F-803').customer.needed, true, 'Beispiel Pharma always asks');
  assert.equal(A('F-807').customer.needed, true, '4 h is longer than the 2 h default');
  assert.equal(A('F-805').customer.needed, true);
});

test('windows come from the customer nights, after the lead time and outside freezes', () => {
  const w = L.nextWindow(data, 'bp', 4, Date.parse('2026-10-23T00:00:00Z'));
  assert.equal(w.start, '2026-10-24T20:00');
  const frozen = L.nextWindow(data, 'bp', 4, Date.parse('2026-10-25T00:00:00Z'));
  assert.equal(frozen.start, '2026-10-25T20:00', 'Sunday 25 Oct is free');
  const moved = plain(L.nextWindow({ ...data, customers: [{ ...data.customers[0], days: [1, 2, 3] }, ...data.customers.slice(1)] }, 'mi', 1, Date.parse('2026-10-26T00:00:00Z')));
  assert.equal(moved.start, '2026-10-26T21:00');
  const ke = plain(L.nextWindow({ ...data, freezes: [{ from: '2026-10-26', to: '2026-10-29', customer: 'ke', reason: 'audit' }] }, 'ke', 1, Date.parse('2026-10-26T00:00:00Z')));
  assert.equal(ke.start, '2026-11-02T21:00');
  assert.equal(ke.moved, 'audit');
});

test('a deadline the next window cannot meet is a floor (F-805: full in 3 days, next night after the lead time is later)', () => {
  const a = A('F-805');
  assert.equal(a.late, true);
  assert.ok(a.floors.some((x) => x.id === 'deadline'));
  assert.equal(A('F-801').late, false);
});

test('status and run: ready plans run to the end; the failing plan rolls back and stops, the agent does not retry', () => {
  const a = L.assess(data, auto(false), f('F-802')), s = {};
  assert.equal(L.statusOf(a, s).key, 'ready');
  assert.equal(L.autoStarts(a, s, false), true);
  assert.equal(L.autoStarts(a, s, true), false, 'paused: no start');
  let ev, n = 0;
  do { ev = plain(L.stepItem(a, s)); n++; } while (!ev.failed && !ev.done && n < 20);
  assert.equal(ev.failed, true);
  assert.equal(L.statusOf(a, s).key, 'rolled-back');
  assert.equal(L.autoStarts(a, s, false), false, 'no retry by itself');
  s.rolledBack = false; s.approved = true;
  do { ev = plain(L.stepItem(a, s)); n++; } while (!ev.failed && !ev.done && n < 40);
  assert.equal(ev.done, true);
  assert.equal(L.statusOf(a, s).label, 'Done after approval');
});

test('plans wait for the customer first, then for approval', () => {
  const a = L.assess(data, auto(true), f('F-803')), s = {};
  assert.equal(L.statusOf(a, s).key, 'waiting-customer');
  s.agreed = true;
  assert.equal(L.statusOf(a, s).key, 'waiting-approval');
  s.approved = true;
  assert.equal(L.statusOf(a, s).key, 'ready');
});

test('the most urgent plan comes first', () => {
  const list = plain(L.orderOf(data.findings.map((x) => L.assess(data, auto(false), x))));
  assert.deepEqual(list.slice(0, 2).map((x) => x.id), ['F-805', 'F-808']);
});

/* ---- the page itself, in a fake host ---- */
function load() {
  const posted = [];
  const parent = { postMessage: (m) => posted.push(m) };
  const errors = [];
  const dom = new JSDOM(page, { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { Object.defineProperty(w, 'parent', { value: parent }); w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); w.addEventListener('error', (e) => errors.push(e.message)); } });
  const w = dom.window;
  const send = (state, handoffs) => { const ev = new w.Event('message'); ev.source = parent; ev.data = { type: 'wb:restore', state: state ?? null, handoffs }; w.dispatchEvent(ev); };
  return { w, doc: w.document, posted, send, errors, close: () => w.close() };
}

test('page, human in the loop on: the sweep plans everything, nothing runs, a person approves one plan and it runs', () => {
  const p = load();
  try {
    assert.match(p.doc.body.textContent, /No sweep yet/);
    p.doc.querySelector('[data-act=sweep]').click();
    assert.equal(p.doc.querySelectorAll('.plan').length, 8);
    assert.equal(p.w.__io.state.auto.hitl, true);
    assert.ok([...p.doc.querySelectorAll('.plan')].every((el) => !el.classList.contains('run')), 'nothing runs');
    p.doc.querySelector('[data-act=approve][data-id=F-808]').click();
    p.w.__io.finish();
    assert.equal(p.w.__io.state.items['F-808'].done, true);
    assert.equal(p.w.__io.state.items['F-808'].by, 'person');
    assert.match(p.doc.body.textContent, /Done after approval/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('page, switch off: the agent runs the low-risk plans by itself, the floors wait, the failing one rolls back', () => {
  const p = load();
  try {
    p.doc.querySelector('[data-act=sweep]').click();
    p.doc.querySelector('#hitl').click();
    assert.equal(p.w.__io.state.auto.hitl, false);
    p.w.__io.finish();
    const it = p.w.__io.state.items;
    for (const id of ['F-801', 'F-804', 'F-806', 'F-808']) assert.equal(it[id].done && it[id].by, 'agent', id);
    assert.equal(it['F-802'].rolledBack, true);
    for (const id of ['F-803', 'F-805', 'F-807']) assert.ok(!it[id] || (!it[id].done && !it[id].running), id);
    assert.match(p.doc.querySelector('[data-act=retry][data-id=F-802]').textContent, /new try/);
    p.doc.querySelector('[data-tab=audit]').click();
    assert.match(p.doc.body.textContent, /Verification failed: rolled back/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('page, pause: no autonomous run starts and a started run stands still; resume continues', () => {
  const p = load();
  try {
    p.doc.querySelector('[data-act=pause]').click();
    p.doc.querySelector('[data-act=sweep]').click();
    p.doc.querySelector('#hitl').click();
    p.w.__io.finish();
    assert.ok(!Object.values(p.w.__io.state.items).some((s) => s.running || s.done), 'paused: nothing starts');
    assert.match(p.doc.body.textContent, /Paused\./);
    p.doc.querySelector('[data-act=pause]').click();
    p.w.__io.finish();
    assert.equal(p.w.__io.state.items['F-801'].done, true);
  } finally { p.close(); }
});

test('page: the customer window goes to the hotline and comes back; the agreed window is kept', () => {
  const p = load();
  try {
    p.doc.querySelector('[data-act=sweep]').click();
    p.doc.querySelector('[data-act=hotline][data-id=F-803]').click();
    const m = p.posted.find((x) => x.type === 'wb:handoff' && x.to === 'infra-hotline');
    assert.equal(m.payload.type, 'window-request');
    assert.equal(m.payload.task.id, 'F-803');
    assert.equal(m.payload.task.requester, 'orchestrator');
    assert.equal(m.payload.hours, 4);
    p.send(p.posted.filter((x) => x.type === 'wb:state').at(-1).state, [{ from: 'infra-hotline', payload: { type: 'window-result', taskId: 'F-803', status: 'confirmed', window: ['2026-10-31T20:00', '2026-11-01T00:00'] } }]);
    assert.equal(p.w.__io.state.items['F-803'].agreed, true);
    assert.match(p.doc.body.textContent, /2026-10-31 20:00–00:00 \(next day\)/);
    assert.ok(p.doc.querySelector('[data-act=approve][data-id=F-803]'), 'now it waits for approval');
    p.send(null, [{ from: 'infra-hotline', payload: { type: 'window-result', taskId: 'F-807', status: 'declined', window: null } }]);
    assert.ok(!p.w.__io.state.items['F-807'] || !p.w.__io.state.items['F-807'].agreed, 'declined: not agreed');
    p.send(null, [{ from: 'infra-hotline', payload: { type: 'window-result', taskId: 'F-807', status: 'confirmed', window: ['<b>x</b>', 'y'] } }]);
    assert.ok(!p.w.__io.state.items['F-807'] || !p.w.__io.state.items['F-807'].agreed, 'a bad window is ignored');
  } finally { p.close(); }
});

test('page: the autonomy matrix is editable and changes the decision; the state survives a trip to another Space', () => {
  const p = load();
  try {
    p.doc.querySelector('[data-act=sweep]').click();
    p.doc.querySelector('#hitl').click();
    p.doc.querySelector('[data-tab=autonomy]').click();
    const sel = p.doc.querySelector('select[data-a=over][data-t="patch-vm"][data-c=ke]');
    sel.value = 'auto'; sel.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    assert.equal(p.w.__io.find('F-807').mode, 'approval', 'production patch stays with a person');
    const saved = p.posted.filter((x) => x.type === 'wb:state').at(-1).state;
    assert.equal(saved.auto.overrides.some((o) => o.customer === 'ke' && o.template === 'patch-vm' && o.mode === 'auto'), true);
    const q = load();
    try { q.send(saved, []); assert.equal(q.w.__io.state.swept, true); assert.equal(q.w.__io.state.auto.hitl, false); } finally { q.close(); }
  } finally { p.close(); }
});
