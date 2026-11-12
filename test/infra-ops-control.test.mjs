import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { embedControl, repoControlData } from '../scripts/sync-infra-ops-control.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('examples/infra-ops-control/index.html');
const logic = (html, id) => new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`).exec(html)[1];
const { windowPlan, nextWindow, thresholdFor, assess, customerStatus, applyFixes, evidence, composeMail, say, buildAsk } = vm.runInNewContext(`${logic(page, 'ctl-logic')}; ({ windowPlan, nextWindow, thresholdFor, assess, customerStatus, applyFixes, evidence, composeMail, say, buildAsk })`);
const data = repoControlData();

test('page embeds the current data and design system, is installable, and has no network or storage access', () => {
  assert.equal(embedControl(page, data, read('examples/shared/design-system.css')), page, 'run npm run sync:infra-ops-control');
  assert.equal(EXAMPLE_SPACES['infra-ops-control'], 'infra-ops-control');
  assert.ok(SPACE_PAGES.includes('examples/infra-ops-control/index.html'));
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/);
  assert.equal(JSON.parse(read('examples/infra-ops-control/space.json')).title, 'Infra Ops Control');
});

test('the status rules are the same as in the Infra VM landscape Space', () => {
  const other = vm.runInNewContext(`${logic(read('examples/it-infrastructure/index.html'), 'vm-logic')}; assess`);
  const rules = JSON.parse(read('examples/it-infrastructure/vms.json')).rules;
  assert.deepEqual(data.rules, rules);
  for (const v of [...data.vms, ...JSON.parse(read('examples/it-infrastructure/vms.json')).vms]) assert.equal(JSON.stringify(assess(v, rules)), JSON.stringify(other(v, rules)));
});

test('data is consistent: unique names, every VM belongs to a customer, every reason has a task, the story customer is red', () => {
  assert.equal(new Set(data.vms.map((v) => v.name)).size, data.vms.length);
  const ids = new Set(data.customers.map((c) => c.id));
  assert.equal(ids.size, data.customers.length);
  for (const c of data.customers) assert.ok(data.vms.some((v) => v.customer === c.id), `${c.name} has VMs`);
  for (const v of data.vms) {
    assert.ok(ids.has(v.customer), v.name);
    for (const r of assess(v, data.rules).reasons) assert.ok(data.tasks[r.key]?.fix, `${v.name}: task for ${r.key}`);
  }
  const musterVms = data.vms.filter((v) => v.customer === 'musind').map((v) => assess(v, data.rules).status);
  assert.equal(customerStatus(musterVms), 'red');
  const proxy = data.vms.find((v) => v.name === 'proxy-edge-01');
  assert.equal(proxy.customer, 'musind');
  assert.equal(proxy.certExpiresInDays, 5);
  const states = new Set(data.customers.map((c) => customerStatus(data.vms.filter((v) => v.customer === c.id).map((v) => assess(v, data.rules).status))));
  assert.deepEqual([...states].sort(), ['green', 'red', 'yellow'], 'the demo shows all three colours');
});

function open() {
  const dom = new JSDOM(page, { runScripts: 'dangerously' });
  return dom.window.document;
}

test('three levels: customers, the VMs of the clicked customer, the state of the clicked VM, and the way back', () => {
  const doc = open();
  const tiles = [...doc.querySelectorAll('[data-cust]')];
  assert.equal(tiles.length, data.customers.length);
  assert.ok(tiles[0].classList.contains('red'), 'worst customers first');
  assert.match(tiles[0].textContent, /SAP 00100/);
  doc.querySelector('[data-cust="musind"]').click();
  assert.match(doc.querySelector('#crumbs').textContent, /All customers.*Muster Industrie AG/);
  const vmTiles = [...doc.querySelectorAll('[data-vm]')];
  assert.equal(vmTiles.length, data.vms.filter((v) => v.customer === 'musind').length);
  assert.ok(vmTiles[0].classList.contains('red'));
  doc.querySelector('[data-f="green"]').click();
  assert.ok([...doc.querySelectorAll('[data-vm]')].every((t) => t.classList.contains('green')));
  doc.querySelector('[data-f="all"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('proxy-edge-01')).click();
  const view = doc.querySelector('#view').textContent;
  assert.match(view, /Red because of the worst check: TLS certificate expires in 5 days/);
  assert.match(view, /Renew TLS certificate/);
  assert.ok(doc.querySelector('#fix-slot'), 'place for the automatic repair');
  doc.querySelector('[data-go="cust"]').click();
  assert.ok(doc.querySelector('[data-vm]'));
  doc.querySelector('[data-go="all"]').click();
  assert.equal(doc.querySelectorAll('[data-cust]').length, data.customers.length);
});

test('an unreachable VM shows no measurements, a test VM no backup check', () => {
  const doc = open();
  doc.querySelector('[data-cust="hansa"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('port-gw-01')).click();
  assert.match(doc.querySelector('#view').textContent, /Not reachable/);
  assert.ok(doc.querySelectorAll('.metric.na').length >= 6);
  doc.querySelector('[data-go="all"]').click();
  doc.querySelector('[data-cust="musind"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('sap-qas-app01')).click();
  assert.match([...doc.querySelectorAll('.metric.na')].map((m) => m.textContent).join('|'), /Last backup.*not checked/);
});

test('the automatic correction turns every non-green VM green and names what changed', () => {
  const broken = data.vms.map((v) => ({ v, a: assess(v, data.rules) })).filter((x) => x.a.status !== 'green');
  assert.ok(broken.length >= 8);
  for (const { v, a } of broken) {
    const after = applyFixes(v, a.reasons, data.tasks);
    assert.equal(assess(after, data.rules).status, 'green', `${v.name} is green after the fix`);
    assert.equal(assess(v, data.rules).status, a.status, 'the original VM is not changed');
    const ev = evidence(v, after, a.reasons);
    assert.equal(ev.length, a.reasons.length);
    assert.ok(ev.every((e) => String(e.before) !== String(e.after)), `${v.name}: every line shows a change`);
  }
});

test('the customer mail names the customer, the VM, the ticket and what was done, in plain words', () => {
  const c = data.customers.find((x) => x.id === 'nordlicht');
  const v = data.vms.find((x) => x.name === 'cc-prd-01');
  const m = composeMail(c, v, assess(v, data.rules).reasons, data.tasks, 'OP-2101');
  assert.equal(m.to, c.contact);
  assert.match(m.to, /\.example$/, 'fictional address');
  assert.match(m.subject, /^\[OP-2101\] cc-prd-01/);
  for (const part of ['Nordlicht Logistik', 'cc-prd-01', 'Renew TLS certificate', 'Ticket OP-2101 is closed', 'expired 2 days ago']) assert.ok(m.body.includes(part), part);
  assert.doesNotMatch(m.body, /-2 days/);
  assert.equal(say('TLS certificate expires in 5 days (red up to 7 days)'), 'TLS certificate expires in 5 days (red up to 7 days)');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(doc, selector) { for (let i = 0; i < 300 && !doc.querySelector(selector); i++) await sleep(10); }

test('Fix automatically: ticket, correction, check, mail preview, ticket closed; the VM and the customer turn green', async () => {
  const doc = open();
  doc.querySelector('#speed').value = 'fast';
  doc.querySelector('#speed').dispatchEvent(new doc.defaultView.Event('change'));
  doc.querySelector('[data-cust="hansa"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('port-gw-01')).click();
  const btn = doc.querySelector('[data-fix]');
  assert.ok(btn, 'a red VM has the button');
  btn.click();
  assert.match(doc.querySelector('#fix-slot').textContent, /Ticket OP-2101 opened for Hansa Maritime/);
  assert.equal(doc.querySelectorAll('.runbar li').length, 7);
  await until(doc, '.runbar li.done:last-child');
  const text = doc.querySelector('#fix-slot').textContent;
  assert.match(text, /Ticket OP-2101 closed/);
  assert.match(text, /not sent/);
  assert.match(text, /ops@hansa-maritime\.example/);
  assert.match(text, /Approved automatically by policy/);
  assert.match(doc.querySelector('.banner').className, /green/);
  assert.equal(doc.querySelector('[data-fix]'), null, 'no button once repaired');
  doc.querySelector('[data-go="all"]').click();
  assert.ok(doc.querySelector('[data-cust="hansa"]').classList.contains('green'), 'the customer is green now');
  assert.match(doc.querySelector('#view').textContent, /Tickets from automatic repairs[\s\S]*OP-2101[\s\S]*port-gw-01/);
  doc.querySelector('[data-reset]').click();
  assert.ok(doc.querySelector('[data-cust="hansa"]').classList.contains('red'), 'reset brings the red VM back');
  assert.doesNotMatch(doc.querySelector('#view').textContent, /Tickets from automatic repairs/);
});

test('only red VMs get the button, only one repair runs at a time, and the story VM is fixed with its two reasons', async () => {
  const doc = open();
  doc.querySelector('#speed').value = 'fast';
  doc.querySelector('#speed').dispatchEvent(new doc.defaultView.Event('change'));
  doc.querySelector('[data-cust="alpen"]').click();
  doc.querySelector('[data-vm]').click();
  assert.equal(doc.querySelector('[data-fix]'), null, 'yellow VMs have no button');
  doc.querySelector('[data-go="all"]').click();
  doc.querySelector('[data-cust="musind"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('proxy-edge-01')).click();
  doc.querySelector('[data-fix]').click();
  assert.match(doc.querySelector('#fix-slot').textContent, /Waiting for the customer[\s\S]*OP-2101/, 'Muster Industrie asks for every patch window above one hour');
  doc.querySelector('[data-go="cust"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('fs-archive-01')).click();
  assert.ok(doc.querySelector('[data-fix]').disabled, 'a second repair waits');
  assert.match(doc.querySelector('#fix-slot').textContent, /waits for the customer/);
  doc.querySelector('[data-go="cust"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('proxy-edge-01')).click();
  doc.querySelector('[data-agree="sim"]').click();
  doc.querySelector('[data-go="cust"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('fs-archive-01')).click();
  assert.ok(doc.querySelector('[data-fix]').disabled, 'a second repair waits');
  doc.querySelector('[data-fix]').click();
  assert.doesNotMatch(doc.querySelector('#fix-slot').textContent, /OP-2102/);
  await sleep(600);
  doc.querySelector('[data-go="cust"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('proxy-edge-01')).click();
  const text = doc.querySelector('#fix-slot').textContent;
  assert.match(text, /OP-2101 closed/);
  assert.match(text, /TLS certificate, days left\s*5\s*365/);
  assert.match(text, /Missing patch, days\s*16\s*0/);
  assert.match(text, /with a restart in the maintenance window 2026-10-2\d \d\d:\d\d–\d\d:\d\d/);
  assert.match(text, /Window 2026-10-2\d [\s\S]*agreed with the customer through the hotline/);
});

test('the request to Joule fits the host limit for every red VM, names the three tools in order, and contains no address', () => {
  const reds = data.vms.filter((v) => assess(v, data.rules).status === 'red');
  assert.ok(reds.length >= 4);
  for (const v of data.vms.filter((x) => assess(x, data.rules).status !== 'green')) {
    const reasons = assess(v, data.rules).reasons, c = data.customers.find((x) => x.id === v.customer);
    const ask = buildAsk(c, v, reasons, data.tasks, evidence(v, applyFixes(v, reasons, data.tasks), reasons));
    assert.ok(ask.length <= 600, `${v.name}: ${ask.length} characters`);
    const order = ['create_ticket', 'create_draft', 'close_ticket'].map((n) => ask.indexOf(n));
    assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], `${v.name}: tools in order`);
    for (const part of [v.name, c.name, 'customer muster', 'priority High', 'do not send', 'my own address']) assert.ok(ask.includes(part), `${v.name}: ${part}`);
    assert.ok(!ask.includes('…'), `${v.name}: the description is complete, not cut off`);
    assert.ok(ask.includes('Found: ') && ask.includes('Fixed: ') && ask.includes('->'), `${v.name}: what was found and what changed`);
    assert.doesNotMatch(ask, /@|\.example/, `${v.name}: no address in the request`);
  }
});

test('Do it for real: the button asks Joule once with the prepared request; outside the Werkbank there is no button', async () => {
  const doc = open();
  const posted = [];
  Object.defineProperty(doc.defaultView, 'parent', { value: { postMessage: (m) => posted.push(m) } });
  doc.querySelector('#speed').value = 'fast';
  doc.querySelector('#speed').dispatchEvent(new doc.defaultView.Event('change'));
  doc.querySelector('[data-cust="nordlicht"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('cc-prd-01')).click();
  assert.equal(doc.querySelector('[data-real]'), null, 'no button before the repair');
  doc.querySelector('[data-fix]').click();
  await until(doc, '[data-real]');
  const btn = doc.querySelector('[data-real]');
  assert.match(doc.querySelector('#fix-slot').textContent, /nothing is sent/);
  btn.click();
  const asks = () => posted.filter((m) => m.type === 'wb:ask');
  assert.equal(asks().length, 1);
  assert.equal(posted.find((m) => m.type === 'wb:ask').type, 'wb:ask');
  assert.ok(asks()[0].prompt.length <= 600);
  assert.match(asks()[0].prompt, /title "Nordlicht Logistik: cc-prd-01 repaired"/);
  assert.match(asks()[0].prompt, /Found: TLS certificate expired 2 days ago/);
  assert.match(asks()[0].prompt, /Fixed: cert days left -2 -> 365/);
  assert.ok(doc.querySelector('[data-real]').disabled, 'no second ticket by accident');
  doc.querySelector('[data-real]').click();
  assert.equal(asks().length, 1);
  assert.match(doc.querySelector('#fix-slot').textContent, /Asked Joule/);

  const alone = open();
  alone.querySelector('#speed').value = 'fast';
  alone.querySelector('#speed').dispatchEvent(new alone.defaultView.Event('change'));
  alone.querySelector('[data-cust="hansa"]').click();
  [...alone.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('port-gw-01')).click();
  alone.querySelector('[data-fix]').click();
  await until(alone, '.runbar li.done:last-child');
  assert.equal(alone.querySelector('[data-real]'), null);
  assert.match(alone.querySelector('#fix-slot').textContent, /Open this Space in the Werkbank/);
});

/* ---- the window rules (package E): Auto-fix follows the same rules as the Customer Hotline and the Orchestrator ---- */
const cust = (id) => data.customers.find((c) => c.id === id);
const plan = (customer, vmName) => { const v = data.vms.find((x) => x.name === vmName); return JSON.parse(JSON.stringify(windowPlan(data, cust(customer), assess(v, data.rules).reasons))); };

test('the window rules equal the Customer Hotline: nights, freezes and the thresholds of the customers that exist in both', () => {
  const hot = JSON.parse(read('examples/infra-hotline/data.json'));
  assert.equal(data.window.leadDays, hot.policy.leadDays);
  assert.deepEqual(data.window.freezes.map((f) => [f.from, f.to, f.reason]), hot.freezes.map((f) => [f.from, f.to, f.reason]));
  assert.equal(data.window.policy.defaults.patch, hot.policy.defaults['patch-vm']);
  for (const c of data.customers.filter((x) => x.hotlineId)) {
    const h = hot.customers.find((x) => x.id === c.hotlineId);
    assert.deepEqual(c.nights, { days: h.days, from: h.from, until: h.until }, c.name);
    const own = data.window.policy.overrides.find((o) => o.customer === c.id && o.task === 'patch'), theirs = hot.policy.overrides.find((o) => o.customer === c.hotlineId && o.template === 'patch-vm');
    assert.equal(own && own.hours, theirs && theirs.hours, `${c.name}: patch rule`);
  }
  for (const c of data.customers) assert.ok(c.nights && c.nights.days.length, `${c.name} has nights`);
});

test('windowPlan: only a repair with a restart needs a window; the policy decides who agrees it', () => {
  assert.equal(plan('nordlicht', 'cc-prd-01'), null, 'a certificate needs no restart');
  const musind = plan('musind', 'proxy-edge-01');
  assert.equal(musind.needed, true, 'Premium Plus asks above one hour');
  assert.equal(musind.threshold.source, 'customer');
  const nordlicht = plan('nordlicht', 'edi-gw-01');
  assert.equal(nordlicht.needed, false, '2 h is within the 2 h default');
  assert.match(nordlicht.text, /standard window, no call/);
  assert.equal(plan('hansa', 'port-gw-01').needed, false);
  const pharma = windowPlan(data, cust('pharma'), [{ key: 'patch' }]);
  assert.equal(pharma.needed, true, 'GxP: always');
});

test('windows come from the nights of the customer, after the lead time, and never inside a freeze', () => {
  const w = nextWindow(data, cust('nordlicht'), 2, Date.parse('2026-10-22T00:00:00Z'));
  assert.equal(JSON.parse(JSON.stringify(w)).start, '2026-10-25T22:00');
  const pharmaFrozen = JSON.parse(JSON.stringify(nextWindow({ ...data, window: { ...data.window, freezes: [{ from: '2026-10-24', to: '2026-10-25', customer: 'pharma', reason: 'audit' }] } }, cust('pharma'), 2, Date.parse('2026-10-23T00:00:00Z'))));
  assert.equal(pharmaFrozen.start, '2026-10-31T20:00');
  assert.equal(pharmaFrozen.moved, 'audit');
  assert.equal(thresholdFor(data.window.policy, 'hansa', 'patch').hours, 2);
});

test('Fix automatically for a customer that does not need to agree sets the window itself and runs', async () => {
  const doc = open();
  doc.querySelector('#speed').value = 'fast';
  doc.querySelector('#speed').dispatchEvent(new doc.defaultView.Event('change'));
  doc.querySelector('[data-cust="nordlicht"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('edi-gw-01')).click();
  doc.querySelector('[data-fix]').click();
  assert.equal(doc.querySelector('[data-agree]'), null, 'no gate');
  await until(doc, '.runbar li.done:last-child');
  const text = doc.querySelector('#fix-slot').textContent;
  assert.match(text, /Window 2026-10-\d\d \d\d:\d\d–\d\d:\d\d[\s\S]*set from the nights of the customer/);
  assert.match(text, /standard window, no call/);
  assert.match(text, /The restart waits for the window/);
});

/* ---- the page in a fake host: the gate hands the window to the hotline and continues with the answer ---- */
function host() {
  const posted = [];
  const parent = { postMessage: (m) => posted.push(m) };
  const dom = new JSDOM(page, { runScripts: 'dangerously', beforeParse(w) { Object.defineProperty(w, 'parent', { value: parent }); } });
  const w = dom.window, doc = w.document;
  const send = (state, handoffs) => { const ev = new w.Event('message'); ev.source = parent; ev.data = { type: 'wb:restore', state: state ?? null, handoffs }; w.dispatchEvent(ev); };
  const lastState = () => posted.filter((m) => m.type === 'wb:state').at(-1).state;
  return { doc, posted, send, lastState, w };
}

test('in the Werkbank the gate hands the window to the Customer Hotline and the repair continues with the agreed window', async () => {
  const h = host();
  h.doc.querySelector('#speed').value = 'fast';
  h.doc.querySelector('#speed').dispatchEvent(new h.w.Event('change'));
  h.doc.querySelector('[data-cust="musind"]').click();
  [...h.doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('proxy-edge-01')).click();
  h.doc.querySelector('[data-fix]').click();
  h.doc.querySelector('[data-agree="hotline"]').click();
  const m = h.posted.find((x) => x.type === 'wb:handoff');
  assert.equal(m.to, 'infra-hotline');
  assert.equal(m.payload.type, 'window-request');
  assert.equal(m.payload.task.id, 'OP-2101');
  assert.equal(m.payload.task.customer, 'mi', 'the hotline knows the customer by its own id');
  assert.equal(m.payload.task.requester, 'auto-fix');
  assert.equal(m.payload.hours, 2);
  const saved = h.lastState();
  assert.equal(saved.gate.ticket, 'OP-2101');
  // the trip: a fresh frame gets the state back plus the answer of the hotline
  const h2 = host();
  h2.doc.querySelector('#speed').value = 'fast';
  h2.send(saved, [{ from: 'infra-hotline', payload: { type: 'window-result', taskId: 'OP-2101', status: 'declined', window: null } }]);
  assert.match(h2.doc.querySelector('#fix-slot').textContent, /The customer has not agreed yet/);
  h2.send(null, [{ from: 'infra-hotline', payload: { type: 'window-result', taskId: 'OP-2101', status: 'confirmed', window: ['<b>', 'x'] } }]);
  assert.match(h2.doc.querySelector('#fix-slot').textContent, /Waiting for the customer/, 'a bad window is ignored');
  h2.send(null, [{ from: 'infra-hotline', payload: { type: 'window-result', taskId: 'OP-9999', status: 'confirmed', window: ['2026-10-31T21:00', '2026-10-31T23:00'] } }]);
  assert.match(h2.doc.querySelector('#fix-slot').textContent, /Waiting for the customer/, 'an answer for another ticket is ignored');
  h2.send(null, [{ from: 'infra-hotline', payload: { type: 'window-result', taskId: 'OP-2101', status: 'confirmed', window: ['2026-10-29T21:00', '2026-10-29T23:00'] } }]);
  await until(h2.doc, '.runbar li.done:last-child');
  const text = h2.doc.querySelector('#fix-slot').textContent;
  assert.match(text, /Window 2026-10-29 21:00–23:00 agreed with the customer through the hotline/);
  assert.match(text, /maintenance window 2026-10-29 21:00–23:00/);
});

test('a customer without a hotline profile can only simulate the agreement, and says so', async () => {
  const alt = embedControl(page, { ...data, window: { ...data.window, policy: { ...data.window.policy, overrides: [...data.window.policy.overrides, { customer: 'hansa', task: 'unreachable', hours: 0, note: 'test rule' }] } } }, read('examples/shared/design-system.css'));
  const posted = [];
  const parent = { postMessage: (m) => posted.push(m) };
  const dom = new JSDOM(alt, { runScripts: 'dangerously', beforeParse(w) { Object.defineProperty(w, 'parent', { value: parent }); } });
  const doc = dom.window.document;
  doc.querySelector('#speed').value = 'fast';
  doc.querySelector('#speed').dispatchEvent(new dom.window.Event('change'));
  doc.querySelector('[data-cust="hansa"]').click();
  [...doc.querySelectorAll('[data-vm]')].find((t) => t.textContent.includes('port-gw-01')).click();
  doc.querySelector('[data-fix]').click();
  assert.equal(doc.querySelector('[data-agree="hotline"]'), null);
  assert.match(doc.querySelector('#fix-slot').textContent, /no profile in the Customer Hotline Space, so the agreement is simulated/);
  doc.querySelector('[data-agree="sim"]').click();
  await until(doc, '.runbar li.done:last-child');
  assert.ok(!posted.some((m) => m.type === 'wb:handoff'), 'nothing was handed to the hotline');
  dom.window.close();
});
