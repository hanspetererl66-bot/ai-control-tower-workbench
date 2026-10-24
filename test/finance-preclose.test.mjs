import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { buildPreclose } from '../scripts/generate-preclose-data.mjs';
import { embedPreclose, DATA as DATA_FILE } from '../scripts/sync-finance-preclose.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('examples/finance-preclose/index.html');
const data = JSON.parse(read(DATA_FILE));
const L = vm.runInNewContext(`${/<script id="preclose-logic">([\s\S]*?)<\/script>/.exec(page)[1]}; ({ pnl, lineAt, variance, bridge, evolution, taskState, readiness, openItems, accrualsAt, icMatrix, scenarioEffect, expectedScenario, fmtK })`);

test('data and page are in sync, and the Space is registered', () => {
  assert.deepEqual(data, buildPreclose());
  assert.equal(embedPreclose(page, data, read('examples/shared/design-system.css')), page);
  assert.equal(EXAMPLE_SPACES['finance-preclose'], 'finance-preclose');
  assert.ok(SPACE_PAGES.includes('examples/finance-preclose/index.html'));
  assert.ok(JSON.parse(read('examples/finance-preclose/space.json')).insights.length >= 3);
});

test('data: 22 working days, 4 company codes, 12 lines, series of full length, month end equals the booked value', () => {
  assert.equal(data.workingDays.length, 22);
  assert.equal(data.entities.length, 4);
  assert.equal(data.lines.length, 12);
  for (const e of Object.values(data.pl)) for (const l of data.lines) {
    const r = e[l.key];
    for (const k of ['actual', 'forecast', 'low', 'high']) assert.equal(r[k].length, 22);
    assert.equal(r.forecast[21], r.actual[21], 'the forecast of the last day is the booked month end');
    for (let i = 1; i < 22; i++) assert.ok(r.actual[i] >= r.actual[i - 1], 'booked amounts do not shrink');
    for (let i = 0; i < 22; i++) assert.ok(r.low[i] <= r.forecast[i] + 1 && r.high[i] >= r.forecast[i] - 1);
  }
});

test('P&L: sub-totals add up and EBIT = revenue - cost of revenue - operating expenses', () => {
  for (const ent of ['all', 'DE10', 'US10']) for (const d of [1, 12, 17, 22]) {
    const p = L.pnl(data, ent, d, {});
    const s = (rows, f) => rows.reduce((a, r) => a + r[f], 0);
    for (const f of ['forecast', 'budget', 'actual']) {
      assert.equal(p.tRev[f], s(p.rev, f));
      assert.equal(p.gross[f], p.tRev[f] - p.tCogs[f]);
      assert.equal(p.ebit[f], p.gross[f] - p.tOpex[f]);
    }
  }
  const g = L.pnl(data, 'all', 17, {}), sum = ['DE10', 'FR10', 'UK10', 'US10'].reduce((a, e) => a + L.pnl(data, e, 17, {}).ebit.forecast, 0);
  assert.equal(g.ebit.forecast, sum);
});

test('story: the DE10 licence deal and the UK10 hosting cost explain the EBIT gap; the range narrows during the month', () => {
  const p = L.pnl(data, 'all', 17, {}), v = L.variance(p.ebit, data.rules);
  assert.ok(v.abs < 0 && v.status !== 'green');
  const lic = L.variance(L.lineAt(data, 'DE10', 'license', 17), data.rules);
  assert.equal(lic.status, 'red');
  assert.equal(L.variance(L.lineAt(data, 'UK10', 'hosting', 17), data.rules).fav, false);
  const ev = L.evolution(data, 'all', 'ebit', {});
  assert.ok(ev[0].high - ev[0].low > ev[16].high - ev[16].low && ev[16].high - ev[16].low > ev[21].high - ev[21].low);
  assert.equal(ev[21].high, ev[21].low);
  assert.ok(Math.abs(ev[10].forecast - ev[10].budget) < Math.abs(ev[21].forecast - ev[21].budget), 'the gap becomes visible later in the month');
});

test('bridge: start plus the steps equals the forecast', () => {
  for (const m of ['revenue', 'ebit']) {
    const b = L.bridge(data, 'all', 17, m, {});
    assert.equal(Math.round(b.start + b.steps.reduce((a, s) => a + s.delta, 0)), Math.round(b.end));
  }
});

test('close calendar: states follow the day, blocked tasks are shown and readiness grows', () => {
  const t = (id) => data.tasks.find((x) => x.id === id);
  assert.equal(L.taskState(t('T07'), 17), 'blocked');
  assert.equal(L.taskState(t('T07'), 19), 'progress');
  assert.equal(L.taskState(t('T05'), 1), 'open');
  assert.equal(L.taskState(t('T01'), 5), 'done');
  const r = [1, 10, 17, 22].map((d) => L.readiness(data, 'all', d).pct);
  assert.deepEqual([...r].sort((a, b) => a - b), r);
  assert.ok(L.readiness(data, 'all', 17).blocked >= 2);
});

test('open items, accruals, alerts and intercompany matrix depend on the day', () => {
  assert.ok(L.openItems(data, 'all', 17).length > 0);
  assert.ok(L.openItems(data, 'all', 17).every((i) => i.openedWd <= 17 && (i.closedWd === null || i.closedWd > 17)));
  assert.ok(L.accrualsAt(data, 'all', 15).length < L.accrualsAt(data, 'all', 19).length);
  assert.ok(L.icMatrix(data, 17)['DE10>US10'] >= 400);
  assert.equal(L.icMatrix(data, 16)['UK10>DE10'], 86);
  assert.equal(L.icMatrix(data, 20)['UK10>DE10'], undefined, 'the cleared difference disappears');
});

test('approved accruals raise the booked amount of cost lines only', () => {
  const a = data.accruals.find((x) => x.id === 'AC-01');
  const before = L.lineAt(data, 'UK10', a.line, 17, {}), after = L.lineAt(data, 'UK10', a.line, 17, { 'AC-01': true });
  assert.equal(after.actual - before.actual, a.amountK);
  assert.equal(after.forecast, before.forecast);
});

test('scenarios: sums and probability-weighted value', () => {
  const none = L.scenarioEffect(data, {}, 'all');
  assert.equal(none.rev, 0); assert.equal(none.ebit, 0);
  const e = L.scenarioEffect(data, { deal: true, credit: true }, 'all');
  assert.equal(e.rev, 900); assert.equal(e.ebit, 810 + 40);
  const x = L.expectedScenario(data, 'all');
  assert.ok(x.up > 0 && x.down < 0);
});

test('page: chat prompts in English, nothing is sent, no network, no live system', () => {
  assert.ok((page.match(/Please answer in English\./g) || []).length >= 4);
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(page));
  assert.match(page, /mockup data/i);
  assert.equal((page.match(/\{ t: '/g) || []).length, 6);
  for (const m of page.matchAll(/send\(`([^`]{0,700})/g)) assert.ok(m[1].length > 40);
});
