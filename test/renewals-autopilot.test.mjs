import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/renewals/index.html'), 'utf8');
const data = JSON.parse(/<script type="application\/json" id="renewal-data">\s*([\s\S]*?)<\/script>/.exec(page)[1]);
const L = vm.runInNewContext(`${/<script id="renewal-logic">([\s\S]*?)<\/script>/.exec(page)[1]}; ({ signals, options, apStart, apAct, apSummary, AP_STEPS, wbStart, wbAct, WB_REASONS })`);
const AS_OF = data.asOf;
const ctxOf = (c, mode = 'autopilot') => { const sig = L.signals(c, AS_OF); return { c, sig, opts: L.options(c, sig, data.rules), rules: data.rules, mode }; };
const small = data.cases.find((c) => { const x = ctxOf(c); return x.sig.signals.every((s) => s.level === 'plus' || s.key === 'timing' || s.key === 'no-offer') && c.annualEur < data.rules.autoThresholdEur && c.status !== 'Lapsed' && x.opts.some((o) => o.withinCap); });
const big = data.cases.find((c) => c.annualEur >= data.rules.autoThresholdEur && c.status !== 'Lapsed' && c.offer);

test('autopilot: a small renewal within policy runs alone up to the answer of the customer, a person does nothing', () => {
  assert.ok(small, 'the sample has a small renewal without warning signals');
  const st = L.apStart(ctxOf(small));
  assert.equal(st.status, 'waiting-customer');
  assert.ok(st.sent);
  assert.deepEqual([...new Set(st.log.map((e) => e.actor))], ['Autopilot']);
  assert.deepEqual(Array.from(st.log, (e) => e.step), ['watch', 'brief', 'offer', 'check', 'approve', 'send', 'negotiate']);
  const done = L.apAct(st, 'signed', 'Customer', ctxOf(small));
  assert.equal(done.status, 'done');
  assert.match(done.log.at(-1).text, /Order-to-Cash/);
  assert.equal(L.apSummary({ a: done }).touchless, 100);
});

test('autopilot: a big renewal stops at the deal desk with the reasons, and nothing is sent before a person acts', () => {
  const ctx = ctxOf(big), st = L.apStart(ctx);
  assert.equal(st.status, 'waiting-person');
  assert.equal(st.gate, 'approve');
  assert.ok(st.reasons.length > 0 && st.reasons.some((r) => /not below/.test(r)));
  assert.equal(st.sent, false);
  assert.equal(L.apAct(st, 'send', 'Anna', ctx), st, 'an action that does not fit changes nothing');
  const ok = L.apAct(st, 'approve', 'Anna', ctx);
  assert.equal(ok.gate, 'send', 'approving does not send');
  const sent = L.apAct(ok, 'send', 'Anna', ctx);
  assert.equal(sent.status, 'waiting-customer');
  assert.equal(sent.log.filter((e) => e.actor === 'Anna').length, 2);
  const done = L.apAct(sent, 'signed', 'Customer', ctx);
  assert.equal(done.status, 'done');
  assert.equal(L.apSummary({ a: done }).touchless, 0);
});

test('autopilot: reject and take-over stop the case, a decline ends the renewal and says a win-back case is opened, a change request needs a person again', () => {
  const ctx = ctxOf(big), st = L.apStart(ctx);
  assert.equal(L.apAct(st, 'reject', 'Anna', ctx).status, 'stopped');
  assert.equal(L.apAct(st, 'takeover', 'Anna', ctx).status, 'stopped');
  const sent = L.apAct(L.apAct(st, 'approve', 'Anna', ctx), 'send', 'Anna', ctx);
  const lost = L.apAct(sent, 'declined', 'Customer', ctx);
  assert.equal(lost.status, 'lost');
  assert.match(lost.log.at(-1).text, /declined\. A win-back case is opened/, 'the log says what really happens: a win-back case follows');
  const again = L.apAct(sent, 'changes', 'Customer', ctx);
  assert.equal(again.status, 'waiting-person', 'a counter offer is checked by a person');
  assert.equal(again.gate, 'approve');
  assert.match(again.log.find((e) => e.actor === 'Customer' && /asks for changes/.test(e.text)).text, /prepares the offer again.*a person checks it at the deal desk/, 'it does not claim a new offer');
  const sctx = ctxOf(small), sm = L.apAct(L.apStart(sctx), 'changes', 'Customer', sctx);
  assert.equal(sm.status, 'waiting-person', 'even a small case goes to a person after a change request');
});

test('autopilot: supervised mode asks a person for every offer, even a small one', () => {
  const ctx = ctxOf(small, 'supervised'), st = L.apStart(ctx);
  assert.equal(st.status, 'waiting-person');
  assert.equal(st.gate, 'approve');
  assert.match(st.log.at(-1).text, /supervised/);
});

test('autopilot: a person can pick another offer; the policy check is repeated for it', () => {
  const ctx = ctxOf(big), st = L.apStart(ctx), other = ctx.opts.find((o) => o.key !== st.pick);
  const ch = L.apAct(st, 'change', 'Anna', ctx, other.key);
  assert.equal(ch.pick, other.key);
  assert.equal(ch.gate, 'approve');
  assert.equal(L.apAct(st, 'change', 'Anna', ctx, 'nonsense'), st);
});

test('autopilot: every contract of the sample runs to a gate without error and the counts add up', () => {
  const states = Object.fromEntries(data.cases.map((c) => [c.id, L.apStart(ctxOf(c))]));
  const s = L.apSummary(states);
  assert.equal(s.cases, data.cases.length);
  assert.equal(s.person + s.customer + s.done + s.stopped + s.lost, s.cases);
  assert.ok(s.person > 0 && s.customer > 0, 'some wait for a person, some for the customer');
});

const lapsed = data.cases.filter((c) => c.status === 'Lapsed');

test('win-back: a decline records the reason; the win-back case analyses, plans and then waits for a person', () => {
  const ctx = ctxOf(big), st = L.apStart(ctx), sent = L.apAct(L.apAct(st, 'approve', 'Anna', ctx), 'send', 'Anna', ctx);
  const lost = L.apAct(sent, 'declined', 'Customer', ctx, 'competitor');
  assert.equal(lost.status, 'lost');
  assert.equal(lost.reason, 'competitor');
  assert.match(lost.log.at(-1).text, /a competitor/);
  assert.equal(L.apAct(sent, 'declined', 'Customer', ctx, 'nonsense').reason, 'unknown', 'an unknown reason is not kept');
  const wb = L.wbStart(ctx, lost.reason);
  assert.equal(wb.status, 'waiting-person');
  assert.equal(wb.gate, 'approve');
  assert.deepEqual(Array.from(wb.log, (e) => e.step), ['analyse', 'plan', 'approve']);
  assert.match(wb.log[1].text, /Executive call first/);
  assert.ok(wb.offer.annualEur > 0 && wb.offer.termMonths > 0);
});

test('win-back: approve (with an owner), send, answer; a win goes to the order, a no closes the case; nothing is skipped', () => {
  const c = lapsed[0], ctx = ctxOf(c);
  const wb = L.wbStart(ctx, 'unknown');
  assert.equal(L.wbAct(wb, 'send', 'Anna', ctx), wb, 'no sending before the plan is approved');
  assert.equal(L.wbAct(wb, 'won', 'Customer', ctx), wb, 'no answer before the message is out');
  const ok = L.wbAct(wb, 'approve', 'Anna', ctx, 'Max Beispiel');
  assert.equal(ok.gate, 'send');
  assert.equal(ok.owner, 'Max Beispiel');
  const out = L.wbAct(ok, 'send', 'Max Beispiel', ctx);
  assert.equal(out.status, 'waiting-customer');
  const won = L.wbAct(out, 'won', 'Customer', ctx);
  assert.equal(won.status, 'done');
  assert.match(won.log.at(-1).text, /Order-to-Cash/);
  assert.equal(L.wbAct(out, 'lost', 'Customer', ctx).status, 'closed');
  assert.equal(L.wbAct(wb, 'reject', 'Anna', ctx).status, 'stopped');
  assert.equal(L.wbAct(wb, 'takeover', 'Anna', ctx).status, 'stopped');
});

test('win-back: every lapsed contract of the sample can start one, with the entry price from the options or 15 % below today', () => {
  assert.equal(lapsed.length, 3);
  for (const c of lapsed) {
    const wb = L.wbStart(ctxOf(c), 'unknown');
    assert.equal(wb.status, 'waiting-person', c.id);
    assert.ok(wb.offer.annualEur > 0 && wb.offer.annualEur < c.annualEur * 1.01, c.id);
  }
});
