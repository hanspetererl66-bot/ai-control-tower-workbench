import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { embedMockupData } from '../scripts/sync-mockup-spaces.mjs';
import { MAX_ASK_LENGTH } from '../src/space-ask.ts';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/collections/index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/collections/data.json'), 'utf8'));

// The page logic sits between two markers, so the test runs the real code, not a copy.
const src = /\/\/ @logic-start([\s\S]*?)\/\/ @logic-end/.exec(page)[1];
const L = new Function(`${src}; return makeLogic;`)()(data);

test('collections is installable and its page embeds the current sample data', () => {
  assert.equal(EXAMPLE_SPACES.collections, 'collections');
  assert.equal(embedMockupData(page, data), page, 'run: npm run sync:mockups');
  assert.doesNotMatch(page, /\bfetch\(|XMLHttpRequest|localStorage/, 'Spaces have no network and no localStorage');
});

test('sample data is internally consistent', () => {
  const ids = data.customers.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const invoiceIds = data.customers.flatMap((c) => [...c.open.map((i) => i.id), ...c.history.map((h) => h.id)]);
  assert.equal(new Set(invoiceIds).size, invoiceIds.length, 'invoice ids are unique');
  for (const c of data.customers) {
    assert.ok(c.history.length >= 6, `${c.id} has a history`);
    for (const h of c.history) assert.ok(h.paid && h.due && h.gross > 0, `${h.id} is complete`);
    for (const i of c.open) {
      assert.ok(i.p >= 0 && i.p <= 1 && i.lo <= i.hi, `${i.id} forecast is a valid range`);
      assert.ok(i.gross > 0);
    }
    assert.equal(c.checks.length, 4, `${c.id} has the four checks`);
  }
  for (const p of Object.values(data.persons)) assert.deepEqual(Object.keys(p.can).sort(), ['call', 'clarify', 'escalate', 'reminder', 'watch']);
});

test('the payment history of the sample late payer is computed from the dates, not typed in', () => {
  const s = L.stats(L.customer('nordlicht'));
  assert.deepEqual(s.days, [14, 21, 9, 28, 35, 18, 26, 31]);
  assert.equal(s.afterDue, 8);
  assert.equal(s.serious, 6); // more than 14 days late
  assert.equal(s.avgAfter, 22.8);
  assert.match(L.reasons(L.customer('nordlicht'), L.invoices(L.customer('nordlicht'))[0])[0], /8 of 8 .* 22\.8 days late; 6 of them more than 14/);
  assert.match(L.reasons(L.customer('muster'), L.invoices(L.customer('muster'))[0])[0], /on the due date or earlier/);
});

test('the morning list ranks by expected amount at risk, not by percentage', () => {
  const rs = L.ranking();
  assert.deepEqual(rs.map((r) => r.customer.id), ['nordlicht', 'kuestenlogistik', 'lindenau', 'muster', 'hanse']);
  for (let i = 1; i < rs.length; i++) assert.ok(rs[i - 1].expected >= rs[i].expected);
  const k = L.risk(L.customer('kuestenlogistik'));
  assert.equal(k.expected, Math.round(148500 * 0.66));
  // A big invoice with a middle chance outranks a small one with a high chance.
  const small = { gross: 10000, p: 0.9 }, big = { gross: 100000, p: 0.4 };
  assert.ok(big.gross * big.p > small.gross * small.p);
  const t = L.totals();
  assert.equal(t.open, rs.reduce((a, r) => a + r.exposure, 0));
  assert.equal(t.expected, rs.reduce((a, r) => a + r.expected, 0));
});

test('our side comes first: a failed check turns the advice into "clarify", and no reminder is planned', () => {
  const k = L.customer('kuestenlogistik');
  assert.equal(L.failing(k).length, 2);
  const plan = L.plan(k);
  assert.deepEqual(plan.map((p) => p.type), ['clarify']);
  assert.equal(L.advice(k), 'Clarify first');
  assert.ok(!plan.some((p) => p.type === 'reminder'));
  // Same signal, other answer: with all checks clear the same invoice would get a reminder.
  const clean = { ...k, checks: k.checks.map((c) => ({ ...c, ok: true })) };
  assert.deepEqual(L.plan(clean).map((p) => p.type), ['reminder']);
});

test('measures are staged by status and amount', () => {
  assert.deepEqual(L.plan(L.customer('nordlicht')).map((p) => p.type), ['call', 'reminder', 'escalate']); // past due, open amount above the threshold
  assert.deepEqual(L.plan(L.customer('lindenau')).map((p) => p.type), ['watch']);
  assert.deepEqual(L.plan(L.customer('muster')), []);
  assert.deepEqual(L.plan(L.customer('hanse')), []);
  // Below the escalation threshold a likely-late customer gets the reminder only.
  const n = L.customer('nordlicht');
  const small = { ...n, open: [{ ...n.open[1], gross: 20000 }] };
  assert.deepEqual(L.plan(small).map((p) => p.type), ['reminder']);
  for (const p of L.plan(n)) assert.ok(p.tool && p.label && p.basis, 'each step names its tool, effect and basis');
});

test('AI actors never release, order and rights are enforced, an escalation needs the sales director', () => {
  const rel = {};
  for (const who of ['claude', 'agent']) for (const id of ['P1', 'P2', 'P3']) assert.equal(L.canRelease(who, 'nordlicht', id, rel).code, 'agent');
  assert.equal(L.release(rel, 'sven', 'nordlicht', 'P2').code, 'order'); // reminder before the call
  assert.equal(L.release(rel, 'sven', 'nordlicht', 'P1').ok, true);
  assert.equal(L.release(rel, 'sven', 'nordlicht', 'P1').code, 'done');
  assert.equal(L.release(rel, 'sven', 'nordlicht', 'P2').ok, true);
  assert.equal(L.release(rel, 'sven', 'nordlicht', 'P3').code, 'right');
  assert.equal(L.release(rel, 'marlene', 'nordlicht', 'P3').ok, true);
  assert.equal(L.canRelease('sven', 'muster', 'P1', {}).code, 'unknown');
  assert.deepEqual(L.attempts().map((a) => a.ok), [false, false, false, true, true, false, true]);
});

test('the reminder draft is neutral and never mentions the forecast', () => {
  for (const c of data.customers) {
    const d = L.draft(c);
    assert.doesNotMatch(d.body + d.subject, /forecast|predict|probab|likely|%|risk/i, `${c.id} draft leaks the model`);
    assert.match(d.body, /Dear /);
    assert.match(d.body, /ignore this note/);
    for (const i of c.open) assert.ok(d.body.includes(i.id), `${c.id} draft names ${i.id}`);
    assert.match(d.to, /@example\.invalid>$/);
  }
  const n = L.draft(L.customer('nordlicht')).body;
  assert.match(n, /past the due date:\n {2}INV-2026-N0009/);
  assert.match(n, /next invoice follows:\n {2}INV-2026-N0010/);
});

test('the track record is computed and labelled as a fictional sample', () => {
  assert.deepEqual(L.track(), { flagged: 12, late: 9, precision: 75, missed: 3 });
  assert.match(page, /fictional sample/);
  assert.match(data.backtest.note, /Fictional sample/);
});

test('the page says what it is: sample forecast, nothing sent, no credit assessment', () => {
  assert.match(page, /not model output/);
  assert.match(page, /Nothing is sent/);
  assert.match(page, /credit assessment/);
  assert.match(data.forecastNote, /Not model output/);
});

test('prompts handed to Claude fit the Space limit and say read only / draft only', () => {
  const live = `Collections: run predict_late_payments for my accounts (${data.customers.map((c) => c.id).join(', ')}) and compare the result with the morning list. Read only; say which engine answered.`;
  assert.ok(live.length <= MAX_ASK_LENGTH);
  const d = L.draft(L.customer('nordlicht'));
  const gmail = `Create a Gmail draft (do not send) to Katrin Brandt at Nordlicht Maschinenbau GmbH with subject "${d.subject}" and a short friendly reminder about the open invoices. Do not mention any forecast.`;
  assert.ok(gmail.length <= MAX_ASK_LENGTH);
});

test('colours in the page come from tokens', () => {
  assert.doesNotMatch(page.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style id="design-system">[\s\S]*?<\/style>/, ''), /#[0-9a-f]{3,6}\b/i, 'only tokens outside the design system');
});

test('the page renders every tab and customer without script errors, and the release flow works in the DOM', async () => {
  const { JSDOM, VirtualConsole } = await import('jsdom');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e.message)));
  const dom = new JSDOM(page, { runScripts: 'dangerously', virtualConsole: vc });
  const d = dom.window.document;
  const click = (sel) => { const el = d.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); };
  for (const t of ['list', 'why', 'ours', 'act', 'track', 'rights']) {
    click(`#tabs [data-id="${t}"]`);
    assert.ok(d.querySelector('#main').textContent.length > 300, `${t} renders`);
  }
  for (const c of data.customers) for (const t of ['why', 'ours', 'act']) {
    click(`#tabs [data-id="${t}"]`);
    click(`#main [data-act="cust"][data-id="${c.id}"]`);
    assert.match(d.querySelector('#main').textContent, new RegExp(c.name));
  }
  click('#tabs [data-id="act"]');
  click('#main [data-act="cust"][data-id="nordlicht"]');
  click('#main [data-act="release"][data-id="P2"]');
  assert.match(d.querySelector('#main .verdict.warn').textContent, /P2 needs P1 first/);
  click('#actor [data-id="claude"]');
  click('#main [data-act="release"][data-id="P1"]');
  assert.match(d.querySelector('#main').textContent, /cannot release anything/);
  click('#actor [data-id="sven"]');
  click('#main [data-act="release"][data-id="P1"]');
  click('#main [data-act="release"][data-id="P2"]');
  click('#main [data-act="release"][data-id="P3"]');
  assert.match(d.querySelector('#main').textContent, /Only the sales director releases an escalation/);
  click('#actor [data-id="marlene"]');
  click('#main [data-act="release"][data-id="P3"]');
  assert.match(d.querySelector('#main').textContent, /3 of 3 released/);
  click('#main [data-act="reset"]');
  assert.match(d.querySelector('#main').textContent, /0 of 3 released/);
  assert.deepEqual(errors, []);
});
