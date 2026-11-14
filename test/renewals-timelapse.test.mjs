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
const L = vm.runInNewContext(`${logicSource}; ({ signals, lapseDates, usageAtDate, caseAt, lapseFrame, lapseEvents, usagePct })`);
const plain = (x) => JSON.parse(JSON.stringify(x));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const byContract = (id) => data.cases.find((c) => c.contractId === id);
const frames = (cid) => L.lapseDates(data.asOf).map((d) => L.lapseFrame(data.cases, data.customers, cid, d, data.asOf));
const CUSTOMERS = ['muster', 'hanse', 'lindenau', 'alpenwerke', 'rheinberg', 'seeland'];

test('time-lapse dates: 22 weekly frames, the first about five months back, the last is today', () => {
  const d = L.lapseDates(data.asOf);
  assert.equal(d.length, 22);
  assert.equal(d.at(-1), data.asOf);
  assert.equal(d[0], '2026-05-25');
  for (let i = 1; i < d.length; i++) assert.equal((Date.parse(d[i]) - Date.parse(d[i - 1])) / 864e5, 7);
});

test('the last frame is today, exactly: every renewal has the colour, the signals, the tickets and the invoices it has now', () => {
  for (const cid of CUSTOMERS) {
    const last = frames(cid).at(-1);
    const mine = data.cases.filter((c) => c.customerId === cid);
    assert.equal(last.cases.length, mine.length, cid);
    for (const c of mine) {
      const f = last.cases.find((x) => x.contractId === c.contractId), now = L.signals(c, data.asOf);
      assert.equal(f.health, now.health, `${c.contractId} colour`);
      assert.deepEqual(plain(f.sig.signals), plain(now.signals), `${c.contractId} signals`);
      assert.deepEqual(plain(f.tickets), plain(c.tickets), `${c.contractId} tickets`);
      assert.deepEqual(plain(f.invoices.map((i) => [i.id, i.status])), plain(c.invoices.map((i) => [i.id, i.status])), `${c.contractId} invoices`);
      assert.equal(L.usagePct(f), L.usagePct(c), `${c.contractId} usage`);
    }
    assert.deepEqual(plain(last.customer.escalation), plain((data.customers.find((x) => x.id === cid)).escalation));
  }
});

test('usage over time: the monthly values of the trend, a straight line in between, the last one is today', () => {
  const c = byContract('C-2024-0702'); // 119 113 107 100 95 90
  const at = (n) => L.usageAtDate(c, new Date(Date.parse(data.asOf) - n * 864e5).toISOString().slice(0, 10), data.asOf);
  assert.equal(at(0), 90);
  assert.equal(at(30), 95);
  assert.equal(at(150), 119);
  assert.equal(at(15), 93, 'half way between 95 and 90');
  assert.equal(at(400), 119, 'before the first value it stays at the first');
  assert.equal(L.usageAtDate(byContract('C-2025-0731'), '2026-06-01', data.asOf), L.usagePct(byContract('C-2025-0731')), 'without a trend usage is today\'s');
});

test('what existed then: tickets and invoices only from their dates, an invoice is open before its due date, a lapsed contract was running before its end', () => {
  const rb = byContract('C-2023-0610'), at = (d) => L.caseAt(rb, d, data.asOf);
  assert.equal(at('2026-10-08').tickets.length, 0);
  assert.equal(at('2026-10-09').tickets.length, 1, 'TKT-51022 was opened on 2026-10-09');
  const inv = byContract('C-2026-0811');
  assert.equal(L.caseAt(inv, '2026-08-30', data.asOf).invoices.length, 0, 'not issued yet');
  assert.equal(L.caseAt(inv, '2026-09-15', data.asOf).invoices[0].status, 'Open', 'issued, not yet due');
  assert.equal(L.caseAt(inv, '2026-10-05', data.asOf).invoices[0].status, 'Overdue');
  const lapsed = byContract('C-2022-0701'); // Seeland Commerce Cloud, ended 2026-06-30
  assert.equal(L.caseAt(lapsed, '2026-06-01', data.asOf).status, 'Running');
  assert.equal(L.caseAt(lapsed, '2026-06-01', data.asOf).offer, null, 'no reactivation offer while it ran');
  assert.equal(L.caseAt(lapsed, '2026-08-01', data.asOf).status, 'Lapsed');
  assert.equal(L.caseAt(rb, '2026-06-01', data.asOf).status, rb.status);
});

test('the stories: Rheinberg is green for months and turns red in the last weeks; the escalation exists only from its start; Muster lapses in June', () => {
  const fr = frames('rheinberg'), levels = fr.map((f) => f.level);
  assert.equal(levels[0], 'green');
  assert.equal(levels.at(-1), 'red');
  assert.equal(levels.indexOf('red') >= 19, true, 'red only in the last three weeks');
  assert.equal(fr.find((f) => f.date === '2026-10-05').customer.escalation, null);
  assert.equal(fr.find((f) => f.date === '2026-10-12').customer.escalation.level, 'Executive');
  const events = (cid, date) => { const f = frames(cid), i = f.findIndex((x) => x.date === date); return plain(L.lapseEvents(f[i - 1], f[i])); };
  const week = events('rheinberg', '2026-10-12');
  assert.ok(week.some((e) => e.level === 'red' && /Ticket TKT-51022 opened \(Very high\)/.test(e.text)));
  assert.ok(week.some((e) => /turned red/.test(e.text)));
  assert.ok(week.some((e) => /Executive escalation opened/.test(e.text)));
  assert.equal(week[0].level, 'red', 'the most serious come first');
  const june = frames('muster'), lapseWeek = june.findIndex((f, i) => i && f.cases.find((c) => c.contractId === 'C-2022-0502').status === 'Lapsed' && june[i - 1].cases.find((c) => c.contractId === 'C-2022-0502').status !== 'Lapsed');
  assert.ok(lapseWeek > 0);
  assert.ok(plain(L.lapseEvents(june[lapseWeek - 1], june[lapseWeek])).some((e) => /lapsed on 2026-06-30/.test(e.text)));
  // The hidden loss: usage falls week by week at Hanse Analytics Cloud.
  const hanse = frames('hanse'), u = hanse.map((f) => L.usagePct(f.cases.find((c) => c.contractId === 'C-2024-0702')));
  assert.ok(u[0] > u.at(-1) && u.every((v, i) => !i || v <= u[i - 1]), 'monotonically falling');
});

test('events: nothing is reported twice and every event has a level and text', () => {
  for (const cid of CUSTOMERS) {
    const f = frames(cid), seenTickets = new Set();
    for (let i = 1; i < f.length; i++) for (const e of L.lapseEvents(f[i - 1], f[i])) {
      assert.ok(['red', 'amber', 'green', 'grey'].includes(e.level) && e.text.length > 5);
      const m = /^Ticket (TKT-\d+) opened/.exec(e.text); if (m) { assert.ok(!seenTickets.has(m[1]), `${m[1]} twice`); seenTickets.add(m[1]); }
    }
  }
});

async function open() {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/scrollIntoView/.test(m)) errors.push(m); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(w) { w.ResizeObserver = class { observe() {} disconnect() {} }; } });
  await wait(150);
  const d = dom.window.document;
  return { w: dom.window, d, q: (s) => d.querySelector(s), qa: (s) => [...d.querySelectorAll(s)], errors };
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const slide = (w, el, v) => { el.value = String(v); el.dispatchEvent(new w.Event('input', { bubbles: true })); };

test('page: the map of a customer has the time-lapse bar; the slider shows the customer as it was, with a banner, and "Today" brings it back', async () => {
  const p = await open();
  assert.equal(p.q('#lapse').hidden, true, 'not with all customers');
  click(p.w, p.q('#tab-process')); click(p.w, p.q('.planet[data-cust=rheinberg]'));
  assert.equal(p.q('#lapse').hidden, false);
  assert.equal(p.qa('#lapse .lr').length, 22);
  assert.match(p.q('#lapse-play').textContent, /Play the last 5 months/);
  const todayClasses = p.qa('.cmapsvg .cnode').map((g) => [...g.classList].filter((c) => ['red', 'yellow', 'green', 'lapsed'].includes(c))[0]);
  assert.ok(todayClasses.includes('red'));
  slide(p.w, p.q('#lapse-i'), 3);
  assert.match(p.q('.lapse-banner').textContent, /as it was on 15 Jun/);
  assert.match(p.q('#lapse-date').textContent, /18 weeks ago/);
  const past = p.qa('.cmapsvg .cnode').map((g) => [...g.classList].filter((c) => ['red', 'yellow', 'green', 'lapsed'].includes(c))[0]);
  assert.ok(!past.includes('red'), 'no red contract in June');
  assert.equal(p.q('.cmapsvg .cctr').classList.contains('green'), true);
  // The model of the page is the past one while looking at it, and today's again afterwards.
  assert.equal(p.w.__renewals().filter((c) => c.customerId === 'rheinberg' && c.health === 'red').length, 0);
  slide(p.w, p.q('#lapse-i'), 21);
  assert.equal(p.q('.lapse-banner'), null);
  assert.ok(p.w.__renewals().filter((c) => c.customerId === 'rheinberg' && c.health === 'red').length >= 2);
  assert.match(p.q('#lapse-events').textContent, /This week/);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('page: the events of the week are listed, the ribbon marks the week and jumps on a click, leaving the map puts everything back', async () => {
  const p = await open();
  click(p.w, p.q('#tab-process')); click(p.w, p.q('.planet[data-cust=rheinberg]'));
  const i = L.lapseDates(data.asOf).indexOf('2026-10-12');
  click(p.w, p.qa('#lapse .lr')[i]);
  assert.equal(p.qa('#lapse .lr.on').length, 1);
  assert.equal(p.q('#lapse .lr.on').dataset.i, String(i));
  assert.match(p.q('#lapse-events').textContent, /Ticket TKT-51022 opened \(Very high\)/);
  assert.ok(p.qa('#lapse-events li i.red').length >= 1);
  // Leave the Renewal map for Today: the numbers are today's again (9 red).
  click(p.w, p.q('#tab-overview'));
  assert.equal(p.w.__renewals().filter((c) => c.health === 'red' && c.status !== 'Lapsed').length, 9);
  assert.match(p.q('#kpis').textContent, /3 renewals · act now/, 'Rheinberg has three red renewals today (the page is still filtered to it)');
  assert.equal(p.w.__renewals().find((c) => c.contractId === 'C-2023-0610').sig.days, 14, 'the days are counted from today again');
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('page: play steps through the weeks and pauses; the speed can be changed', async () => {
  const p = await open();
  click(p.w, p.q('#tab-process')); click(p.w, p.q('.planet[data-cust=seeland]'));
  const sel = p.q('#lapse-speed'); sel.value = 'fast'; sel.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  click(p.w, p.q('#lapse-play'));
  assert.equal(p.q('#lapse-i').value, '0', 'play starts at the first week');
  assert.match(p.q('#lapse-play').textContent, /Pause/);
  await wait(1000);
  const at = +p.q('#lapse-i').value;
  assert.ok(at >= 2 && at < 21, `moved on: ${at}`);
  click(p.w, p.q('#lapse-play'));
  assert.match(p.q('#lapse-play').textContent, /Play on/);
  const stopped = p.q('#lapse-i').value;
  await wait(700);
  assert.equal(p.q('#lapse-i').value, stopped, 'paused');
  click(p.w, p.q('#lapse-now'));
  assert.equal(p.q('#lapse-i').value, '21');
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('time-lapse: pure, no network, no storage, tokens only', () => {
  const logic = logicSource.slice(logicSource.indexOf('/* ---------- time-lapse'));
  assert.ok(logic.length > 2000);
  assert.doesNotMatch(logic, /fetch\(|localStorage|Date\.now|Math\.random|new Date\(\)/);
  const page = html.slice(html.indexOf('/* ---------- time-lapse of the renewal map'), html.indexOf('function renderAll() {'));
  assert.doesNotMatch(page, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|#[0-9a-fA-F]{3,8}\b|rgb\(/);
});
