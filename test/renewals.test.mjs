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
const logic = vm.runInNewContext(`${/<script id="renewal-logic">([\s\S]*?)<\/script>/.exec(page)[1]}; ({ signals, actions, upliftPct, usagePct, daysBetween })`);
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

test('page: radar, table, detail, six demo steps, English chat prompts, no network', () => {
  for (const id of ['kpis', 'guide', 'tl', 'rows', 'detail', 'customer', 'q', 'reset']) assert.match(page, new RegExp(`id="${id}"`));
  assert.equal((page.match(/\{ t: '/g) || []).length, 6);
  assert.match(page, /customer-call-prep/);
  assert.match(page, /pricing-guard/);
  assert.equal((page.match(/Please answer in English/g) || []).length, 3);
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage/);
});
