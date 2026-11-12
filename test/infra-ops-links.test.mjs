import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const doms = [];
after(() => doms.forEach((d) => d.window.close()));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Loads a whole Space in a fake host frame; `send` plays what the host posts into a freshly loaded frame. */
function load(slug) {
  const posted = [];
  const parent = { postMessage: (m) => posted.push(m) };
  const errors = [];
  const dom = new JSDOM(read(`examples/${slug}/index.html`), {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { Object.defineProperty(w, 'parent', { value: parent }); w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }); w.addEventListener('error', (e) => errors.push(e.message)); },
  });
  doms.push(dom);
  const w = dom.window;
  const send = (state, handoffs) => { const ev = new w.Event('message'); ev.source = parent; ev.data = { type: 'wb:restore', state: state ?? null, handoffs }; w.dispatchEvent(ev); };
  const last = (type) => [...posted].reverse().find((m) => m.type === type);
  return { w, doc: w.document, posted, send, last, errors };
}

const TASK = { id: 'CHG-1040', template: 'renew-certificate', target: 'ke-s4-prd', customer: 'ke', window: ['2026-10-22T22:00', '2026-10-23T00:00'], requester: 'sa', params: {} };

test('the service request asks the RCA agent and the Hotline, and keeps both results on the task', () => {
  const ops = load('infra-ops');
  ops.w.__io.openTask('CHG-1040');
  ops.doc.querySelector('[data-auto=rca]').click();
  const toRca = ops.posted.find((m) => m.type === 'wb:handoff' && m.to === 'infra-rca');
  assert.equal(toRca.payload.type, 'rca-request');
  assert.equal(toRca.payload.task.id, 'CHG-1040');
  ops.doc.querySelector('[data-auto=window]').click();
  const toHot = ops.posted.find((m) => m.type === 'wb:handoff' && m.to === 'infra-hotline');
  assert.equal(toHot.payload.type, 'window-request');
  assert.equal(toHot.payload.hours, 2);

  const st = ops.last('wb:state').state;
  ops.send(st, [
    { from: 'infra-rca', payload: { type: 'rca-result', taskId: 'CHG-1040', incident: 'INC-506', cause: 'ACME renewal job stopped', confidence: 'High confidence', action: 'Renew now', verdict: 'accepted' } },
    { from: 'infra-hotline', payload: { type: 'window-result', taskId: 'CHG-1040', status: 'confirmed', window: ['2026-10-28T22:00', '2026-10-29T00:00'] } },
  ]);
  const t = ops.w.__io.find('CHG-1040');
  assert.equal(t.rca.cause, 'ACME renewal job stopped');
  assert.equal(t.rca.verdict, 'accepted');
  assert.deepEqual(t.window, ['2026-10-28T22:00', '2026-10-29T00:00'], 'a task in review takes the agreed window');
  assert.match(ops.doc.body.textContent, /Next best action: Renew now/);
  assert.deepEqual(ops.errors, []);
});

test('a task that is already approved keeps its window, the result is only logged', () => {
  const ops = load('infra-ops');
  const before = ops.w.__io.find('CHG-1039').window.slice();
  ops.send(null, [{ from: 'infra-hotline', payload: { type: 'window-result', taskId: 'CHG-1039', status: 'confirmed', window: ['2026-11-01T22:00', '2026-11-02T02:00'] } }]);
  assert.deepEqual(ops.w.__io.find('CHG-1039').window, before);
});

test('a bad window from the hotline is ignored', () => {
  const ops = load('infra-ops');
  const before = ops.w.__io.find('CHG-1040').window.slice();
  ops.send(null, [{ from: 'infra-hotline', payload: { type: 'window-result', taskId: 'CHG-1040', status: 'confirmed', window: ['<b>x</b>', 'y'] } }]);
  assert.deepEqual(ops.w.__io.find('CHG-1040').window, before);
});

test('the RCA Space opens the alert on the system of the request and sends the result back', () => {
  const rca = load('infra-rca');
  rca.send(null, [{ from: 'infra-ops', payload: { type: 'rca-request', task: { ...TASK, target: 'proxy-edge-01', customer: 'mi', id: 'CHG-1050' } } }]);
  assert.match(rca.doc.body.textContent, /For service request CHG-1050/);
  assert.match(rca.doc.body.textContent, /The alert on this system is selected/);
  rca.doc.querySelector('[data-verdict=accepted]').click();
  rca.doc.querySelector('[data-send]').click();
  const m = rca.last('wb:handoff');
  assert.equal(m.to, 'infra-ops');
  assert.equal(m.payload.type, 'rca-result');
  assert.equal(m.payload.taskId, 'CHG-1050');
  assert.equal(m.payload.incident, 'INC-506');
  assert.equal(m.payload.verdict, 'accepted');
  assert.ok(m.payload.cause.length > 3 && m.payload.action.length > 3);
});

test('without an alert on that system the RCA Space says so and takes the closest incident of the customer', () => {
  const rca = load('infra-rca');
  rca.send(null, [{ from: 'infra-ops', payload: { type: 'rca-request', task: { ...TASK, customer: 'mi', target: 'musind-int04' } } }]);
  assert.match(rca.doc.body.textContent, /There is no alert on this system/);
});

test('the Hotline takes the request, asks for a window when the policy says so, and reports the confirmed window', () => {
  const hot = load('infra-hotline');
  hot.send(null, [{ from: 'infra-ops', payload: { type: 'window-request', hours: 6, task: { ...TASK, id: 'CHG-1060', template: 'patch-vm', customer: 'mi', target: 'musind-int04' } } }]);
  assert.match(hot.doc.body.textContent, /CHG-1060/);
  assert.match(hot.doc.body.textContent, /Waiting for the customer/);
  hot.doc.querySelector('[data-tab=hotline]').click();
  hot.doc.querySelector('[data-call]').click();
  for (let i = 0; i < 12 && hot.doc.querySelector('[data-accept="1"]'); i++) hot.doc.querySelector('[data-accept="1"]').click();
  hot.doc.querySelector('[data-tab=requests]').click();
  hot.doc.querySelector('[data-op=confirm][data-id=CHG-1060]').click();
  hot.doc.querySelector('[data-op=report][data-id=CHG-1060]').click();
  const m = hot.last('wb:handoff');
  assert.equal(m.to, 'infra-ops');
  assert.equal(m.payload.type, 'window-result');
  assert.equal(m.payload.status, 'confirmed');
  assert.match(m.payload.window[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
  assert.deepEqual(hot.errors, []);
});

test('the Hotline ignores a request for an unknown customer or task', () => {
  const hot = load('infra-hotline');
  const n = hot.w.document.querySelectorAll('.req').length;
  hot.send(null, [{ from: 'infra-ops', payload: { type: 'window-request', hours: 6, task: { ...TASK, id: 'CHG-1', customer: 'zz' } } }]);
  assert.equal(hot.w.document.querySelectorAll('.req').length, n);
});

test('the Hotline previews the confirmation mail, sends it only through the host and shows that it was sent', async () => {
  const hot = load('infra-hotline');
  hot.send(null, [{ from: 'infra-ops', payload: { type: 'window-request', hours: 6, task: { ...TASK, id: 'CHG-1060', template: 'patch-vm', customer: 'mi', target: 'musind-int04' } } }]);
  hot.doc.querySelector('[data-tab=hotline]').click();
  hot.doc.querySelector('[data-call]').click();
  for (let i = 0; i < 12 && hot.doc.querySelector('[data-accept="1"]'); i++) hot.doc.querySelector('[data-accept="1"]').click();
  hot.doc.querySelector('[data-tab=requests]').click();
  assert.equal(hot.doc.querySelector('[data-op=mail][data-id=CHG-1060]'), null, 'no mail before the window is confirmed');
  hot.doc.querySelector('[data-op=confirm][data-id=CHG-1060]').click();
  const answer = (m) => { const ev = new hot.w.Event('message'); ev.source = hot.w.parent; ev.data = m; hot.w.dispatchEvent(ev); };
  hot.doc.querySelector('[data-op=mail][data-id=CHG-1060]').click();
  const pre = hot.posted.find((m) => m.type === 'hm:preview-request');
  assert.equal(pre.fields.id, 'CHG-1060');
  assert.equal(pre.fields.customer, 'Muster Industrie AG');
  assert.ok(!('to' in pre.fields), 'the Space never names a recipient');
  answer({ type: 'hm:preview', requestId: pre.requestId, mail: { to: 'test@example.com', subject: 'Subject <b>x</b>', body: 'Body text' } });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(hot.doc.body.textContent, /Body text/);
  assert.equal(hot.doc.querySelector('.mailbox b b'), null, 'markup in the mail is shown as text');
  hot.doc.querySelector('[data-mail=send]').click();
  const sent = hot.posted.find((m) => m.type === 'hm:send-request');
  assert.equal(sent.fields.id, 'CHG-1060');
  answer({ type: 'hm:sent', requestId: sent.requestId, result: { sent: true, at: '2026-11-12T10:00:00.000Z', to: 'test@example.com' } });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(hot.doc.body.textContent, /Confirmation sent to test@example\.com/);
  assert.equal(hot.doc.querySelector('[data-op=mail][data-id=CHG-1060]'), null);
  assert.deepEqual(hot.errors, []);
});

test('a cancelled dialog or an error leaves the mail unsent and says so', async () => {
  const hot = load('infra-hotline');
  hot.send(null, [{ from: 'infra-ops', payload: { type: 'window-request', hours: 6, task: { ...TASK, id: 'CHG-1061', template: 'patch-vm', customer: 'mi', target: 'musind-int04' } } }]);
  hot.doc.querySelector('[data-tab=hotline]').click();
  hot.doc.querySelector('[data-call]').click();
  for (let i = 0; i < 12 && hot.doc.querySelector('[data-accept="1"]'); i++) hot.doc.querySelector('[data-accept="1"]').click();
  hot.doc.querySelector('[data-tab=requests]').click();
  hot.doc.querySelector('[data-op=confirm][data-id=CHG-1061]').click();
  const answer = (m) => { const ev = new hot.w.Event('message'); ev.source = hot.w.parent; ev.data = m; hot.w.dispatchEvent(ev); };
  hot.doc.querySelector('[data-op=mail][data-id=CHG-1061]').click();
  answer({ type: 'ct:error', requestId: hot.posted.find((m) => m.type === 'hm:preview-request').requestId, message: 'No test recipient is set.' });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(hot.doc.body.textContent, /No test recipient is set/);
  assert.equal(hot.doc.querySelector('[data-mail=send]'), null);
});

test('the Hotline reports back to whoever asked: the orchestrator gets its answer, the service request keeps its own', () => {
  const hot = load('infra-hotline');
  hot.send(null, [{ from: 'infra-orchestrator', payload: { type: 'window-request', hours: 4, task: { ...TASK, id: 'F-807', template: 'patch-vm', customer: 'mi', target: 'musind-int04' } } }]);
  hot.doc.querySelector('[data-tab=hotline]').click();
  hot.doc.querySelector('[data-call]').click();
  for (let i = 0; i < 12 && hot.doc.querySelector('[data-accept="1"]'); i++) hot.doc.querySelector('[data-accept="1"]').click();
  hot.doc.querySelector('[data-tab=requests]').click();
  hot.doc.querySelector('[data-op=confirm][data-id=F-807]').click();
  assert.match(hot.doc.body.textContent, /Report back to the orchestrator/);
  hot.doc.querySelector('[data-op=report][data-id=F-807]').click();
  const m = hot.last('wb:handoff');
  assert.equal(m.to, 'infra-orchestrator');
  assert.equal(m.payload.type, 'window-result');
  assert.equal(m.payload.status, 'confirmed');
});

test('the Hotline answers Auto-fix too: the window of a repair goes back to the Space that asked', () => {
  const hot = load('infra-hotline');
  hot.send(null, [{ from: 'infra-ops-control', payload: { type: 'window-request', hours: 2, task: { ...TASK, id: 'OP-2101', template: 'patch-vm', customer: 'mi', target: 'proxy-edge-01' } } }]);
  assert.match(hot.doc.body.textContent, /OP-2101/);
  hot.doc.querySelector('[data-tab=hotline]').click();
  hot.doc.querySelector('[data-call]').click();
  for (let i = 0; i < 12 && hot.doc.querySelector('[data-accept="1"]'); i++) hot.doc.querySelector('[data-accept="1"]').click();
  hot.doc.querySelector('[data-tab=requests]').click();
  hot.doc.querySelector('[data-op=confirm][data-id=OP-2101]').click();
  assert.match(hot.doc.body.textContent, /Report back to Auto-fix/);
  hot.doc.querySelector('[data-op=report][data-id=OP-2101]').click();
  const m = hot.last('wb:handoff');
  assert.equal(m.to, 'infra-ops-control');
  assert.equal(m.payload.status, 'confirmed');
});

test('a finished service request reports its outcome to the Orchestrator once, queued without opening it', async () => {
  const ops = load('infra-ops');
  ops.w.__io.S.speed = 'fast';
  const t = ops.w.__io.find('CHG-1039');
  assert.equal(t.state, 'approved');
  ops.w.__io.startRun(t);
  for (let i = 0; i < 400 && t.state !== 'done'; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(t.state, 'done');
  const outs = ops.posted.filter((m) => m.type === 'wb:handoff' && m.payload && m.payload.type === 'outcome');
  assert.equal(outs.length, 1);
  assert.equal(outs[0].to, 'infra-orchestrator');
  assert.equal(outs[0].open, false);
  const o = outs[0].payload.outcome;
  assert.deepEqual([o.source, o.id, o.template, o.by, o.result, o.waitedMin, o.durationMin], ['service-request', 'CHG-1039', 'patch-vm', 'person', 'done', t.approvals.length * 45, 55 + t.approvals.length * 45]);
  assert.equal(typeof o.customer, 'string');
});
