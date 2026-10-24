import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { AS_OF, buildRenewals, embedRenewals, DATA as DATA_FILE } from '../scripts/sync-renewals.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('examples/renewals/index.html');
const data = JSON.parse(read(DATA_FILE));
const logic = vm.runInNewContext(`${/<script id="renewal-logic">([\s\S]*?)<\/script>/.exec(page)[1]}; ({ signals, actions, upliftPct, usagePct, daysBetween, retention, lifetimeYears, clv, options, autoCheck, autoEmail, levers })`);
const byContract = (id) => data.cases.find((c) => c.contractId === id);
const health = (id) => logic.signals(byContract(id), AS_OF);

test('data and page are in sync with the Sub4Me sample data and the design system, and the Space is registered', () => {
  assert.deepEqual(data, buildRenewals());
  assert.equal(embedRenewals(page, data, read('examples/shared/design-system.css')), page);
  assert.equal(EXAMPLE_SPACES.renewals, 'renewals');
  assert.ok(SPACE_PAGES.includes('examples/renewals/index.html'));
  const space = JSON.parse(read('examples/renewals/space.json'));
  assert.ok(space.title && space.insights.length >= 3);
});

test('cases: both customers with SAP customer IDs, unique ids, decision date = end minus notice period', () => {
  assert.deepEqual([...new Set(data.cases.map((c) => c.customerId))].sort(), ['hanse', 'muster']);
  assert.equal(new Set(data.cases.map((c) => c.id)).size, data.cases.length);
  assert.equal(new Set(data.cases.map((c) => c.sapCustomerId)).size, 2);
  for (const c of data.cases) {
    assert.match(c.sapCustomerId, /^00\d{8}$/);
    assert.equal(logic.daysBetween(c.decisionDate, c.end), c.noticeDays, c.id);
  }
  assert.equal(byContract('C-2023-0390').decisionDate, '2026-11-02', 'matches the notice deadline in the contract notes');
});

test('health rules: the known cases get the expected colours and reasons', () => {
  const ariba = health('C-2023-0390');
  assert.equal(ariba.health, 'red');
  for (const key of ['timing', 'invoice', 'uplift', 'competitor']) assert.ok(ariba.signals.some((s) => s.key === key), `Ariba: ${key}`);
  assert.equal(ariba.days, 14);
  const sf = health('C-2025-0041');
  assert.equal(sf.health, 'red'); assert.ok(sf.days < 0);
  assert.match(logic.actions(byContract('C-2025-0041'), sf)[0], /written extension/);
  assert.equal(health('C-2024-0702').health, 'green', 'Analytics Cloud ends in 2027: nothing to do yet');
  assert.equal(health('C-2022-0502').health, 'yellow', 'lapsed contract is a win-back candidate, not red');
  assert.equal(logic.upliftPct(byContract('C-2023-0390')), 5.2);
  assert.ok(logic.upliftPct(byContract('C-2023-0390')) > byContract('C-2023-0390').upliftCapPct);
});

test('every case has at least one action and the actions follow the priority order', () => {
  for (const c of data.cases) {
    const s = logic.signals(c, AS_OF), a = logic.actions(c, s);
    assert.ok(a.length >= 1 && a.length <= 3, c.id);
  }
  const s = health('C-2023-0390');
  assert.match(logic.actions(byContract('C-2023-0390'), s)[0], /overdue invoice/, 'an overdue invoice comes first');
});

test('page: radar, table, detail, seven demo steps, English chat prompts, no network', () => {
  for (const id of ['kpis', 'guide', 'tl', 'rows', 'detail', 'customer', 'q', 'reset', 'cust-cards', 'cust-panel']) assert.match(page, new RegExp(`id="${id}"`));
  assert.equal((page.match(/\{ t: '/g) || []).length, 7);
  assert.match(page, /customer-call-prep/);
  assert.match(page, /pricing-guard/);
  assert.equal((page.match(/Please answer in English/g) || []).length, 5);
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage/);
});

test('retention and lifetime value: transparent formula, alternatives follow the rules, the recommendation respects the cap', () => {
  const R = data.rules;
  assert.equal(R.marginPct, 70);
  assert.equal(logic.lifetimeYears(0.5, R), 2);
  assert.equal(logic.lifetimeYears(0.97, R), R.lifetimeCapYears, 'capped');
  assert.equal(logic.clv(100000, 0.5, R), 140000, 'annual value x margin x lifetime');
  for (const c of data.cases) {
    const s = logic.signals(c, AS_OF), opts = logic.options(c, s, R);
    assert.ok(opts.length >= 2, c.id);
    assert.equal(opts.filter((o) => o.recommended).length, 1, `${c.id}: exactly one recommended option`);
    const rec = opts.find((o) => o.recommended);
    assert.ok(rec.withinCap, `${c.id}: the recommended option stays within the contract cap`);
    for (const o of opts.filter((x) => x.withinCap)) assert.ok(rec.clvEur >= o.clvEur, `${c.id}: ${o.key} is not better than the recommendation`);
    assert.ok(c.customerAnnualEur >= c.annualEur || c.status === 'Lapsed', c.id);
  }
  const ariba = byContract('C-2023-0390'), opts = logic.options(ariba, logic.signals(ariba, AS_OF), R);
  assert.ok(!opts.find((o) => o.key === 'standard').withinCap, 'the offer is above the cap');
  assert.equal(opts.find((o) => o.recommended).key, 'cap');
  assert.ok(logic.levers(logic.signals(ariba, AS_OF), R).length >= 2);
  assert.match(page, /id="alt"/);
  assert.match(page, /Illustrative assumptions/);
});

test('automatic renewal: only below the threshold, without warning signals, within the cap', () => {
  const R = data.rules;
  assert.equal(R.autoThresholdEur, 30000);
  const check = (id) => { const c = byContract(id), s = logic.signals(c, AS_OF); return logic.autoCheck(c, s, logic.options(c, s, R), R); };
  const small = data.cases.filter((c) => c.annualEur < R.autoThresholdEur);
  assert.ok(small.length >= 5 && data.cases.some((c) => c.annualEur >= R.autoThresholdEur));
  for (const id of ['C-2026-0901', 'C-2026-0902', 'C-2026-0911', 'C-2026-0913']) { const r = check(id); assert.ok(r.eligible, id); assert.ok(r.pick.withinCap, id); }
  assert.ok(!check('C-2026-0912').eligible, 'overdue invoice stops the automation');
  assert.match(check('C-2026-0912').blockers.join(' '), /overdue/);
  assert.ok(!check('C-2026-0903').eligible, 'above the threshold');
  for (const c of data.cases.filter((x) => x.annualEur >= R.autoThresholdEur)) assert.ok(!check(c.contractId).eligible, c.contractId);
  const c = byContract('C-2026-0902'), m = logic.autoEmail(c, check('C-2026-0902').pick);
  assert.match(m.to, /@muster\.example$/); assert.match(m.body, /within the contract cap/);
});

test('page: the switch exists, is off by default and nothing is really sent', () => {
  assert.match(page, /id="auto"[^>]*role="switch"/);
  assert.match(page, /auto: false/);
  assert.match(page, /\(simulated\)/);
  assert.ok(!/fetch\(|XMLHttpRequest/.test(page));
});

test('customer situation: escalation, payment, usage and growth are derived from the contracts', () => {
  const sit = vm.runInNewContext(`${/<script id="renewal-logic">([\s\S]*?)<\/script>/.exec(page)[1]}; customerSituation`);
  assert.deepEqual(data.customers.map((c) => c.id).sort(), ['hanse', 'muster']);
  const muster = sit(data.customers.find((c) => c.id === 'muster'), data.cases), hanse = sit(data.customers.find((c) => c.id === 'hanse'), data.cases);
  assert.equal(muster.primary.key, 'escalation');
  assert.ok(muster.list.some((s) => s.key === 'payment') && muster.list.some((s) => s.key === 'usage'));
  assert.equal(muster.byPrio['Very high'], 1);
  assert.equal(hanse.primary.key, 'payment', 'no escalation: the overdue invoice comes first');
  assert.ok(hanse.list.some((s) => s.key === 'growth'));
  assert.equal(muster.overdue.length, 1);
  assert.match(muster.talk, /escalation/);
  const calm = sit({ id: 'x', escalation: null }, []);
  assert.equal(calm.primary.key, 'stable');
});
