import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { embedHotline, repoHotlineData } from '../scripts/sync-infra-hotline.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('examples/infra-hotline/index.html');
const logicSource = /<script id="hot-logic">([\s\S]*?)<\/script>/.exec(page)[1];
const L = vm.runInNewContext(`${logicSource}; ({ threshold, needsAgreement, checkSlot, proposals, callOpen, reply, statusOf, slotText, addDays, weekday })`);
const data = repoHotlineData();
const ctx = (over = {}) => ({ templates: data.templates, customers: data.customers, freezes: data.freezes, hotline: data.hotline, policy: structuredClone(data.policy), requests: structuredClone(data.requests), today: data.asOf, lead: data.policy.leadDays, ...over });
const plain = (x) => JSON.parse(JSON.stringify(x)); // results of the sandbox have another Object prototype
const req = (id) => data.requests.find((r) => r.id === id);
const cust = (id) => data.customers.find((c) => c.id === id);

test('page embeds the current data and design system, is installable, has no network or storage access, and sits under Autonomous Operations', () => {
  assert.equal(embedHotline(page, data, read('examples/shared/design-system.css')), page, 'run npm run sync:infra-hotline');
  assert.equal(EXAMPLE_SPACES['infra-hotline'], 'infra-hotline');
  assert.ok(SPACE_PAGES.includes('examples/infra-hotline/index.html'));
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket/);
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '').replace(/<style[\s\S]*?<\/style>/g, ''), /#[0-9a-fA-F]{3,8}\b/, 'colours only as tokens');
  const meta = JSON.parse(read('examples/infra-hotline/space.json'));
  assert.equal(meta.title, 'Customer Hotline');
  for (const slug of ['infra-rca', 'infra-hotline', 'infra-ops', 'infra-ops-control', 'infra-wiki', 'it-fleet', 'it-infrastructure', 'it-operations', 'change-checks']) {
    assert.equal(JSON.parse(read(`examples/${slug}/space.json`)).domain, 'Autonomous Operations', slug);
  }
});

test('the threshold comes from the customer rule first, then the default; the agreement is needed only above it', () => {
  const p = data.policy;
  assert.deepEqual(plain(L.threshold(p, 'mi', 'patch-vm')), { hours: 1, source: 'customer', note: p.overrides[0].note });
  assert.equal(L.threshold(p, 'aw', 'patch-vm').hours, 2);
  assert.equal(L.threshold(p, 'aw', 'patch-vm').source, 'default');
  // exactly at the threshold: no call
  assert.equal(L.needsAgreement(p, req('SR-2090')).needed, false, 'renew-certificate 2 h, threshold 2 h');
  // customer rule asks earlier
  assert.equal(L.needsAgreement(p, req('SR-2091')).needed, true, 'patch 4 h for Muster Industrie, threshold 1 h');
  // always ask (0) and never ask (null)
  assert.equal(L.needsAgreement(p, { ...req('SR-2095'), customer: 'bp', hours: 1 }).needed, true, 'GxP customer: every window');
  assert.equal(L.needsAgreement(p, req('SR-2097')).needed, false, 'the contract lets the provider choose the window, even at 5 h');
  assert.match(L.needsAgreement(p, req('SR-2097')).text, /provider choose/);
  // the policy is the only input: a changed threshold changes the verdict
  const strict = structuredClone(p); strict.defaults['renew-certificate'] = 1;
  assert.equal(L.needsAgreement(strict, req('SR-2090')).needed, true);
});

test('the agent accepts a window only when every rule holds, and says which rule failed', () => {
  const r = req('SR-2091'), c = cust('mi'), f = data.freezes, t = data.asOf, lead = 2;
  assert.equal(L.weekday('2026-10-27'), 2);
  const ok = L.checkSlot('2026-10-27', '21:00', r, c, f, t, lead);
  assert.equal(ok.ok, true);
  assert.equal(ok.start, '2026-10-27T21:00'); assert.equal(ok.end, '2026-10-28T01:00');
  assert.equal(L.checkSlot('2026-10-22', '21:00', r, c, f, t, lead).code, 'too-soon');
  assert.equal(L.checkSlot('2026-10-31', '21:00', r, c, f, t, lead).code, 'weekday');
  assert.equal(L.checkSlot('2026-10-27', '19:00', r, c, f, t, lead).code, 'early');
  assert.equal(L.checkSlot('2026-10-27', '23:30', req('SR-2092'), c, f, t, lead).code, 'late', '6 h from 23:30 ends after 05:00');
  assert.equal(L.checkSlot('2026-10-27', '23:30', r, c, f, t, lead).ok, true, '4 h from 23:30 still ends before 05:00');
  assert.equal(L.checkSlot('', '', r, c, f, t, lead).code, 'format');
  const bp = cust('bp');
  assert.equal(L.checkSlot('2026-10-24', '20:00', req('SR-2093'), bp, f, t, lead).ok, true);
  const frozen = [{ from: '2026-10-24', to: '2026-10-25', customer: 'bp', reason: 'GxP audit' }];
  assert.equal(L.checkSlot('2026-10-24', '20:00', req('SR-2093'), bp, frozen, t, lead).code, 'freeze');
  const global = [{ from: '2026-10-27', to: '2026-10-27', customer: null, reason: 'Year-end freeze' }];
  assert.equal(L.checkSlot('2026-10-27', '21:00', r, c, global, t, lead).code, 'freeze', 'a freeze without customer covers everyone');
  assert.equal(L.checkSlot('2026-10-26', '21:00', { ...r, hours: 1 }, { ...c, days: [0, 1, 2, 3, 4, 5, 6] }, [{ from: '2026-10-27', to: '2026-10-27', customer: null, reason: 'x' }], t, lead).ok, true, 'a window that ends before the freeze starts is fine');
});

test('every window the agent offers passes the same check, comes in order and stays out of freezes', () => {
  for (const r of data.requests) {
    const c = cust(r.customer), offers = L.proposals(r, c, data.freezes, data.asOf, 2);
    assert.ok(offers.length >= 1, `${r.id}: at least one offer`);
    assert.ok(offers.length <= 3);
    offers.forEach((o, i) => {
      assert.equal(L.checkSlot(o.date, o.start.slice(11), r, c, data.freezes, data.asOf, 2).ok, true, `${r.id} offer ${i + 1}`);
      if (i) assert.ok(o.start > offers[i - 1].start);
    });
  }
  const bp = cust('bp'), offers = L.proposals(req('SR-2093'), bp, [{ from: '2026-10-24', to: '2026-11-01', customer: 'bp', reason: 'audit' }], data.asOf, 2);
  assert.ok(offers.every((o) => o.date > '2026-11-01'), 'skips the freeze');
});

test('a call: the agent introduces itself as an AI, goes through the requests that need agreement, and agrees nothing by itself', () => {
  let call = L.callOpen(ctx(), 'mi');
  assert.match(call.lines[0].text, /AI voice assistant, not with a person/);
  assert.match(call.lines[0].text, /colleague at any time/);
  assert.deepEqual(plain(call.queue), ['SR-2091', 'SR-2092'], 'the certificate renewal (2 h) is not discussed');
  assert.equal(call.offers.length, 3);
  call = L.reply(call, ctx(), { type: 'accept', n: 1 });
  assert.equal(call.results[0].status, 'agreed');
  assert.equal(call.results[0].start, call.offers.length ? call.results[0].start : '');
  assert.match(call.lines.at(-1).text, /SR-2092/, 'goes on to the next request');
  call = L.reply(call, ctx(), { type: 'decline' });
  assert.equal(call.done, true);
  assert.deepEqual(plain(call.results.map((r) => r.status)), ['agreed', 'declined']);
  assert.match(call.lines.at(-1).text, /Operations confirms|colleague from operations confirms/);
  // the call itself never sets a request to confirmed
  assert.ok(!call.results.some((r) => r.status === 'confirmed'));
});

test('a counter-proposal inside the rules is noted; outside, the agent explains and after two misses a person takes over', () => {
  let call = L.callOpen(ctx(), 'mi');
  call = L.reply(call, ctx(), { type: 'counter', date: '2026-11-03', time: '21:00' });
  assert.equal(call.results[0].status, 'agreed'); assert.equal(call.results[0].how, 'counter');
  assert.equal(call.results[0].start, '2026-11-03T21:00');

  call = L.callOpen(ctx(), 'mi');
  call = L.reply(call, ctx(), { type: 'counter', date: '2026-10-31', time: '21:00' }); // a Saturday
  assert.equal(call.results.length, 0);
  assert.match(call.lines.at(-2).text, /nights of Tuesday, Wednesday, Thursday/);
  assert.equal(call.tries, 1);
  call = L.reply(call, ctx(), { type: 'counter', date: '2026-10-30', time: '21:00' });
  assert.equal(call.results[0].status, 'person');
  assert.match(call.results[0].reason, /two tries/);
  assert.match(call.lines.map((l) => l.text).join(' '), /colleague calls you back/);
  assert.match(call.lines.at(-1).text, /SR-2092|To sum up/, 'the second request is still handled');
});

test('"a person, please" ends the call at once; what was not discussed stays open', () => {
  let call = L.callOpen(ctx(), 'mi');
  call = L.reply(call, ctx(), { type: 'person' });
  assert.equal(call.done, true);
  assert.deepEqual(plain(call.results.map((r) => r.status)), ['person']);
  assert.match(call.lines.at(-1).text, /1 not discussed/);
  assert.match(call.lines.map((l) => l.text).join(' '), /Nothing has been agreed/);
});

test('a customer with nothing to agree gets told so; a policy change changes who is called about what', () => {
  const call = L.callOpen(ctx(), 'ke');
  assert.equal(call.done, true); assert.deepEqual(plain(call.queue), []);
  assert.match(call.lines.at(-1).text, /No service request is waiting/);
  const strict = ctx(); strict.policy.defaults['update-dns-record'] = 0;
  assert.deepEqual(plain(L.callOpen(strict, 'ke').queue), ['SR-2095']);
  const bp = L.callOpen(ctx(), 'bp');
  assert.deepEqual(plain(bp.queue), ['SR-2093']);
  assert.ok(bp.offers.every((o) => [0, 6].includes(L.weekday(o.date))), 'Beispiel Pharma only at weekends');
});

test('the status follows the person who has to act', () => {
  const p = data.policy;
  assert.equal(L.statusOf(req('SR-2090'), p).key, 'standard');
  assert.equal(L.statusOf(req('SR-2091'), p).key, 'waiting');
  assert.equal(L.statusOf({ ...req('SR-2091'), state: 'agreed' }, p).who, 'Operator confirms');
  assert.equal(L.statusOf({ ...req('SR-2091'), state: 'confirmed' }, p).who, 'Ready for approval');
});

test('data is consistent: customers and tasks exist, the story ticket is a service request that needs no call, every request that needs a call can be offered a window', () => {
  const ids = new Set(data.customers.map((c) => c.id)), tpl = new Set(data.templates.map((t) => t.id));
  assert.equal(new Set(data.requests.map((r) => r.id)).size, data.requests.length);
  for (const r of data.requests) { assert.ok(ids.has(r.customer), r.id); assert.ok(tpl.has(r.template), r.id); assert.ok(r.hours > 0); }
  for (const o of data.policy.overrides) { assert.ok(ids.has(o.customer)); assert.ok(tpl.has(o.template)); }
  assert.equal(req('SR-2090').customer, 'mi'); assert.match(req('SR-2090').note, /OP-2090/);
  assert.ok(data.requests.some((r) => L.needsAgreement(data.policy, r).needed) && data.requests.some((r) => !L.needsAgreement(data.policy, r).needed), 'both cases are in the sample');
  const ops = JSON.parse(read('examples/infra-ops/data.json'));
  for (const c of data.customers) assert.ok(ops.customers.some((o) => o.name === c.name), `${c.name} is a customer of Infrastructure Operations`);
  for (const f of ops.freezes) assert.ok(data.freezes.some((g) => g.from === f.from && g.to === f.to && g.customer === f.customer), 'same freezes as the change Space');
});

test('in the page: call, answer, hand the agreed window to an operator, who confirms it; the policy tab changes the verdict', async () => {
  const dom = new JSDOM(page, { runScripts: 'dangerously', pretendToBeVisual: true });
  const { document } = dom.window;
  const click = (sel) => { const b = document.querySelector(sel); assert.ok(b, sel); b.click(); };
  const text = () => document.querySelector('#view').textContent;
  assert.match(text(), /Waiting for the customer/);
  click('[data-tab="hotline"]');
  assert.match(text(), /No call is made and no voice service is connected/);
  click('[data-call]');
  assert.match(text(), /AI voice assistant, not with a person/);
  click('[data-accept="1"]');
  click('[data-decline]');
  assert.match(text(), /Call ended/);
  click('[data-go="requests"]');
  assert.match(text(), /Agreed on the phone/);
  assert.match(text(), /Operator confirms/);
  click('[data-op="confirm"]');
  assert.match(text(), /Window confirmed/);
  assert.match(text(), /Ready for approval/);
  assert.match(text(), /No agreement/, 'the declined request waits for an operator decision');
  // policy: Muster Industrie never asked for patches -> its patch request becomes a standard window
  click('[data-tab="policy"]');
  const sel = document.querySelector('[data-cell="mi|patch-vm"]');
  sel.value = 'never'; sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  click('[data-tab="requests"]');
  assert.match(text(), /provider choose the window/);
  dom.window.close();
});
