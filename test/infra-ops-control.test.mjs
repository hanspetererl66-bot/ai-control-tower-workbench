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
const { assess, customerStatus, applyFixes, evidence, composeMail, say, buildAsk } = vm.runInNewContext(`${logic(page, 'ctl-logic')}; ({ assess, customerStatus, applyFixes, evidence, composeMail, say, buildAsk })`);
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
  assert.match(text, /with a restart in a maintenance window/);
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
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, 'wb:ask');
  assert.ok(posted[0].prompt.length <= 600);
  assert.match(posted[0].prompt, /title "Nordlicht Logistik: cc-prd-01 repaired"/);
  assert.match(posted[0].prompt, /Found: TLS certificate expired 2 days ago/);
  assert.match(posted[0].prompt, /Fixed: cert days left -2 -> 365/);
  assert.ok(doc.querySelector('[data-real]').disabled, 'no second ticket by accident');
  doc.querySelector('[data-real]').click();
  assert.equal(posted.length, 1);
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
