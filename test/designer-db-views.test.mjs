import assert from 'node:assert/strict';
import test from 'node:test';
import { DB_VIEWS, dayChoice, dbView, viewParams, viewTable } from '../shared/designer-db-views.mjs';
import { normalizeLayout } from '../src/space-layout.ts';
import { VIEWS } from '../connectors/_lib/server/observability.mjs';

test('every listed view points at a reading function that exists, and asks only for parameters that function takes', () => {
  for (const v of DB_VIEWS) {
    assert.ok(VIEWS[v.view], v.id);
    const ask = viewParams(v.id, 14);
    for (const k of Object.keys(ask.params)) assert.ok(VIEWS[v.view].args.includes(k), `${v.id}: ${k}`);
    assert.ok(v.columns.length > 0 && v.columns.length <= 12);
  }
  assert.equal(new Set(DB_VIEWS.map((v) => v.id)).size, DB_VIEWS.length);
});

test('an unknown id or a wild number of days gives nothing or the default; the window cannot name a function', () => {
  assert.equal(viewParams('obs_runs; drop table x', 7), null);
  assert.equal(viewParams('observability.trace', 7), null);
  assert.equal(dayChoice(5000), 30);
  assert.equal(dayChoice('7'), 30);
  assert.deepEqual(viewParams('observability.fleet', 90), { view: 'fleet', params: { days: 90 } });
  assert.deepEqual(viewParams('observability.runs', 7), { view: 'runs', params: { days: 7, limit: 200 } });
  assert.deepEqual(viewParams('observability.alerts', 7), { view: 'alerts', params: {} });
});

test('the answer becomes a table in the listed column order; text cells, rounded numbers, readable outcome and time', () => {
  const t = viewTable('observability.runs', { runs: [{ id: 5, name: 'Collections agent', version: 'v3', at: '2026-11-13T09:15:42Z', status: 'ok', steps: 4, ms: 1200, tokens: 900, costEur: 0.123456, goalMet: true, extra: 'ignored' }, { id: 6, goalMet: null }] }, 7);
  assert.deepEqual(t.columns.slice(0, 3), ['Run', 'Agent', 'Version']);
  assert.deepEqual(t.rows[0], ['5', 'Collections agent', 'v3', '2026-11-13 09:15', 'ok', '4', '1200', '900', '0.123', 'met']);
  assert.equal(t.rows[1][9], 'not sampled');
  assert.equal(t.rows[1][1], '');
  assert.match(t.sources, /Latest runs, last 7 days/);
});

test('rows are capped at 200 with a note, long or multi-line texts are cut, a wrong answer throws', () => {
  const alerts = Array.from({ length: 230 }, (_, i) => ({ severity: 'page', message: `line\nbreak ${'x'.repeat(400)}` + i }));
  const t = viewTable('observability.alerts', { alerts });
  assert.equal(t.rows.length, 200);
  assert.match(t.notes[0], /Only the first 200 of 230/);
  assert.ok(t.rows[0][5].length <= 200 && !t.rows[0][5].includes('\n'));
  assert.throws(() => viewTable('observability.alerts', { nothing: 1 }), /form I do not know/);
  assert.throws(() => viewTable('nope', {}), /Unknown view/);
});

test('a database source in a stored layout keeps only a listed view and a listed period', () => {
  const mk = (source) => normalizeLayout({ title: 't', blocks: [{ id: 'b1', type: 'table', title: 'T', dataset: 'd1', sortable: false, totals: false }], datasets: [{ id: 'd1', name: 'A', columns: ['x'], rows: [['1']], source }] }).datasets[0].source;
  assert.deepEqual(mk({ kind: 'database', view: 'observability.fleet', days: 7, asOf: '2026-11-13T10:00', note: 'n' }), { kind: 'database', view: 'observability.fleet', days: 7, asOf: '2026-11-13T10:00', note: 'n' });
  assert.equal(mk({ kind: 'database', view: 'public.users', days: 7 }), undefined);
  assert.equal(mk({ kind: 'database', view: 'observability.fleet', days: 365 }).days, 30);
  assert.ok(dbView('observability.cost-days'));
});
