import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'examples/renewals/index.html'), 'utf8');
const data = JSON.parse(/<script type="application\/json" id="renewal-data">\s*([\s\S]*?)<\/script>/.exec(html)[1]);
const logicSource = readFileSync(join(ROOT, 'examples/renewals/logic.js'), 'utf8');
const L = vm.runInNewContext(`${logicSource}; ({ signals, findings, rescuePlan, priceImpact, bestPrice, weeklyBriefing, upliftPct, retention, options })`);
const byContract = (id) => data.cases.find((c) => c.contractId === id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (x) => JSON.parse(JSON.stringify(x));

async function open() {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/scrollIntoView/.test(m)) errors.push(m); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(w) { w.ResizeObserver = class { observe() {} disconnect() {} }; w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }); } });
  await wait(150);
  const d = dom.window.document;
  return { w: dom.window, d, q: (s) => d.querySelector(s), qa: (s) => [...d.querySelectorAll(s)], errors };
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

test('what the app found: one finding per kind, the hidden loss, the price trap and the clock are in, with a chance as the last one', () => {
  const found = plain(L.findings(data.cases, data.customers, data.asOf));
  assert.deepEqual(found.map((f) => f.key), ['trap', 'hidden', 'clock', 'expand']);
  const by = Object.fromEntries(found.map((f) => [f.key, f]));
  assert.equal(by.trap.contractId, 'C-2023-0610');
  assert.equal(by.hidden.contractId, 'C-2024-0702', 'Analytics Cloud looks green and is not');
  assert.equal(by.clock.contractId, 'C-2025-0712');
  assert.match(by.hidden.text, /shows 90 % usage and no warning today/);
  assert.ok(by.hidden.evidence.some((e) => /Head of Controlling/.test(e)), 'the lost champion is part of the evidence');
  assert.ok(by.trap.evidence.some((e) => /Oracle/.test(e)) && by.trap.evidence.some((e) => /Very high ticket/.test(e)));
  assert.equal(by.expand.tone, 'green');
  for (const f of found) { assert.ok(f.evidence.length >= 2, f.key); assert.ok(data.cases.some((c) => c.id === f.id), f.key); }
  // The findings come from the same signals as the colours: nothing is found where the signals are silent.
  assert.deepEqual(plain(L.findings(data.cases.filter((c) => c.contractId === 'C-2025-0731'), data.customers, data.asOf)), []);
});

test('rescue plan: the steps follow the signals, the colour and the numbers improve, the mail names the facts and nothing else', () => {
  const c = byContract('C-2023-0610'), rp = plain(L.rescuePlan(c, data.customers, data.rules, data.asOf));
  assert.deepEqual(rp.steps.map((s) => s.key), ['ticket', 'uplift', 'timing', 'competitor']);
  assert.equal(rp.before.health, 'red');
  assert.equal(rp.after.health, 'yellow', 'ticket and price are cleared, the competitor stays');
  assert.ok(rp.after.retentionPct > rp.before.retentionPct && rp.after.expectedEur > rp.before.expectedEur && rp.after.clvEur > rp.before.clvEur);
  assert.equal(rp.gainEur, rp.after.expectedEur - rp.before.expectedEur);
  assert.ok(rp.remaining.some((t) => /Competitor/.test(t)), 'what the plan does not solve is said');
  assert.match(rp.mail.body, /TKT-51022/);
  assert.match(rp.mail.body, new RegExp(`€\\s?${Math.round(c.offer.currentAnnualEur * 1.03 / 1000) * 1000 / 1000}`.replace('€', '€')) );
  assert.match(rp.mail.subject, /C-2023-0610/);
  assert.match(rp.mail.to, /@rheinberg\.example$/);
  // A renewal with nothing to fix gets a calm plan, not an invented problem.
  const calm = plain(L.rescuePlan(byContract('C-2025-0731'), data.customers, data.rules, data.asOf));
  assert.deepEqual(calm.steps.map((s) => s.key), ['keep']);
  assert.equal(calm.gainEur, 0);
  // Overdue invoice: the plan clears it and the colour changes.
  const inv = plain(L.rescuePlan(byContract('C-2026-0811'), data.customers, data.rules, data.asOf));
  assert.ok(inv.steps.some((s) => s.key === 'invoice') && inv.after.health !== 'red');
  // Every case yields a plan whose numbers are consistent.
  for (const k of data.cases) { const p = plain(L.rescuePlan(k, data.customers, data.rules, data.asOf)); assert.ok(p.steps.length >= 1 && p.after.expectedEur >= 0, k.contractId); assert.ok(p.gainEur >= 0, `${k.contractId} is never worse after the plan`); }
});

test('price impact: a higher rise lowers retention, it falls faster above the cap and with a competitor, and the best rise sits at the cap', () => {
  const c = byContract('C-2023-0610'), at = (u) => plain(L.priceImpact(c, data.rules, data.asOf, u));
  const series = [0, 2, 3, 5, 9, 12].map(at);
  for (let i = 1; i < series.length; i++) assert.ok(series[i].retentionPct <= series[i - 1].retentionPct, `retention at ${series[i].upliftPct} %`);
  assert.equal(at(3).withinCap, true);
  assert.equal(at(9).withinCap, false);
  assert.equal(at(9).overCap, 6);
  assert.ok(at(9).deltaEur < 0 && at(3).deltaEur > 0, 'the rise at the cap pays, the one above it costs');
  const slopeAbove = (at(3).retentionPct - at(9).retentionPct) / 6, slopeBelow = (at(0).retentionPct - at(3).retentionPct) / 3;
  assert.ok(slopeAbove > slopeBelow, 'above the cap it falls faster');
  const best = plain(L.bestPrice(c, data.rules, data.asOf));
  assert.equal(best.upliftPct, c.upliftCapPct);
  // Without a competitor the same rise costs less retention.
  const nocomp = { ...c, offer: { ...c.offer, competitor: 'None' } };
  assert.ok(L.priceImpact(nocomp, data.rules, data.asOf, 9).retentionPct > at(9).retentionPct);
  assert.equal(at(-5).upliftPct, 0, 'a negative rise is read as 0');
});

test('weekly briefing: the numbers are those of the cases, and the mail names the biggest red renewals and the findings', () => {
  const w = plain(L.weeklyBriefing(data.cases, data.customers, data.asOf, data.rules));
  const live = data.cases.filter((c) => c.status !== 'Lapsed'), sig = (c) => L.signals(c, data.asOf);
  assert.equal(w.stakeEur, live.reduce((a, c) => a + c.annualEur, 0));
  assert.equal(w.redCount, live.filter((c) => sig(c).health === 'red').length);
  assert.equal(w.sixWeeks, live.filter((c) => sig(c).days <= 42).length);
  assert.equal(w.needNow, live.filter((c) => sig(c).health === 'red' || sig(c).days <= 14).length);
  assert.match(w.headline, new RegExp(`${w.redCount} are red`));
  assert.match(w.mail.body, /Rheinberg Energie GmbH, SAP S\/4HANA for utilities/);
  assert.match(w.mail.body, /Looks fine, but usage has been falling/);
  assert.match(w.mail.subject, /Renewals this week/);
  assert.ok(w.atRiskEur > 0 && w.atRiskEur < w.stakeEur);
});

test('page: Today shows the weekly line and the four findings; a button opens the rescue plan with before and after, steps and a mail draft', async () => {
  const p = await open();
  assert.match(p.q('#wow .wow-sentence').textContent, /a year are at stake/);
  assert.deepEqual(p.qa('#wow .wow-card').map((c) => c.dataset.key), ['trap', 'hidden', 'clock', 'expand']);
  assert.equal(p.q('#plan').hidden, true);
  click(p.w, p.q('#wow .wow-card[data-key=hidden] [data-plan]'));
  assert.equal(p.q('#plan').hidden, false);
  assert.match(p.q('#plan h2').textContent, /Rescue plan: SAP Analytics Cloud · Hanse/);
  assert.equal(p.qa('#plan .plan-col').length, 2);
  assert.ok(p.qa('#plan .plan-steps li').length >= 1);
  assert.match(p.q('#plan .plan-mail').value, /^Dear /);
  assert.match(p.q('#plan').textContent, /Nothing is sent/);
  // The trap: the numbers on the page are those of the logic.
  click(p.w, p.q('#wow .wow-card[data-key=trap] [data-plan]'));
  const rp = L.rescuePlan(byContract('C-2023-0610'), data.customers, data.rules, data.asOf);
  assert.equal(p.q('#plan .plan-col.after [data-fmt=pct]').dataset.count, String(rp.after.retentionPct));
  assert.match(p.q('#plan .plan-gain').textContent, /\+€/);
  // The chance shows an expansion, not a rescue.
  click(p.w, p.q('#wow .wow-card[data-key=expand] [data-plan]'));
  assert.match(p.q('#plan h2').textContent, /^Expansion:/);
  click(p.w, p.q('#plan-close'));
  assert.equal(p.q('#plan').hidden, true);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('page: the weekly mail opens as a draft that is only text, nothing is sent; Joule is asked only on request', async () => {
  const p = await open();
  const sent = []; p.w.parent.postMessage = (m) => sent.push(m);
  click(p.w, p.q('#wk-mail'));
  assert.match(p.q('#plan h2').textContent, /Weekly mail for the sales manager/);
  assert.match(p.q('#plan .plan-mail').value, /^Hello,/);
  assert.equal(sent.length, 0);
  click(p.w, p.q('#plan-ask'));
  await wait(20);
  assert.ok(sent.length <= 1);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('page: the detail of a renewal has a price slider whose numbers follow the logic, a warning above the cap and a button for the best rise', async () => {
  const p = await open();
  click(p.w, p.q('#wow .wow-card[data-key=trap] [data-open]'));
  const box = p.q('#detail .pwhat');
  assert.ok(box, 'the slider is in the detail');
  const rg = box.querySelector('input'), c = byContract('C-2023-0610');
  assert.equal(rg.value, '9', 'it starts at the rise of the offer');
  assert.match(box.querySelector('.pw-warn').textContent, /6 points above the contract cap of 3 %/);
  const expected = L.priceImpact(c, data.rules, data.asOf, 9);
  assert.match(box.querySelector('.pw-out').textContent, new RegExp(String(expected.retentionPct) + ' %'));
  rg.value = '3'; rg.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  assert.match(box.querySelector('.pw-warn').textContent, /Within the contract cap/);
  assert.equal(box.querySelector('.pw-u').textContent, '+3.0 %');
  rg.value = '12'; rg.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  click(p.w, box.querySelector('[data-pw-best]'));
  assert.equal(rg.value, '3', 'the best rise is the cap');
  // The rescue plan button of the detail opens the plan on Today.
  click(p.w, p.qa('#detail [data-act=plan]')[0]);
  assert.equal(p.q('#pg-overview').hidden, false);
  assert.match(p.q('#plan h2').textContent, /Rescue plan: SAP S\/4HANA for utilities/);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('wow features: no network, no storage, colours only as tokens', () => {
  const wow = html.slice(html.indexOf('/* ---------- wow:'), html.indexOf('function renderAll() {'));
  assert.ok(wow.length > 2000);
  assert.doesNotMatch(wow, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(wow, /#[0-9a-fA-F]{3,8}\b|rgb\(/);
  const logic = logicSource.slice(logicSource.indexOf('/* ---------- wow:'));
  assert.doesNotMatch(logic, /fetch\(|localStorage|Date\.now|Math\.random/, 'the logic is pure and repeatable');
});
