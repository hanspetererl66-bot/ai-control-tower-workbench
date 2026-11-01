import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ToolError } from '../connectors/_lib/server/tools.mjs';
import { FINANCE_FORECAST_TOOL_DEFINITIONS, checkAccrualEstimate, checkBudgetForecast, createFinanceForecastHandlers, loadPreclose } from '../connectors/_lib/server/finance-forecast.mjs';
import { handleControlTowerForecastMessage, handlePrecloseForecastMessage, pickAccrualEstimate, pickBudgetForecast } from '../src/forecast-bridge.ts';
import { checkToolCall, BUILTIN_HARNESSES } from '../src/harness.ts';

const tower = JSON.parse(readFileSync(new URL('../examples/control-tower/data.json', import.meta.url), 'utf8'));
const loadTower = async () => ({ data: tower, source: 'data.json' });
const env = { TABPFN_SERVICE_URL: 'http://127.0.0.1:8808' };
const reply = (body, ok = true, status = 200) => async (url, init) => ({ ok, status, json: async () => body, url: String(url), init });

const budgetAnswer = {
  engine: 'baseline', engineNote: 'n', trainedOn: '500 synthetic group-months', band: '80 % band', day: 28, daysInMonth: 31,
  items: [{ name: 'Engineering', budgetK: 6566, spentK: 7026, runRateK: 7778, p10K: 7100, p50K: 7700, p90K: 8100, p10Pct: 108, p50Pct: 117, p90Pct: 123, overrunProbability: 0.99, status: 'likely over', secret: 'x' }],
  internal: 'dropped',
};
const accrualAnswer = {
  engine: 'tabpfn', engineNote: '', trainedOn: '600 synthetic accruals', band: '80 % interval', tolerancePct: 10, asOfWd: 17,
  items: [{ id: 'AC-01', entity: 'UK10', line: 'hosting', amountK: 75, p10K: 70, p50K: 76, p90K: 84, correctionProbability: 0.31, risk: 'medium' }],
};

test('the sample data carries the month context and six months of history for every group', () => {
  const { forecastContext: c, groups } = tower.budget;
  assert.deepEqual([c.month, c.day, c.daysInMonth], ['2026-10', 28, 31]);
  for (const g of groups) {
    assert.equal(g.historyK.length, 6, g.name);
    assert.ok(g.historyK.every((v) => v > 0));
  }
});

test('forecast_budget sends the groups with spend so far and history, and returns the checked forecast', async () => {
  const seen = [];
  const handlers = createFinanceForecastHandlers({ loadTower, ToolError, env, fetchImpl: async (url, init) => { seen.push([String(url), JSON.parse(init.body), init.headers]); return reply(budgetAnswer)(); } });
  const out = await handlers.forecast_budget({});
  assert.equal(seen[0][0], 'http://127.0.0.1:8808/forecast/budget');
  const eng = seen[0][1].groups.find((g) => g.name === 'Engineering');
  assert.equal(eng.mtdK, Math.round((6566 * 107) / 100));
  assert.equal(eng.historyK.length, 6);
  assert.equal(seen[0][1].day, 28);
  assert.equal(out.engine, 'baseline');
  assert.deepEqual(out.overBudget, ['Engineering']);
  assert.equal(JSON.stringify(out).includes('secret'), false);
  assert.equal(JSON.stringify(out).includes('dropped'), false);
  assert.match(out.disclaimer, /synthetic/);
});

test('forecast_budget can be limited to one group and refuses unknown groups', async () => {
  const bodies = [];
  const handlers = createFinanceForecastHandlers({ loadTower, ToolError, env, fetchImpl: async (_u, init) => { bodies.push(JSON.parse(init.body)); return reply(budgetAnswer)(); } });
  await handlers.forecast_budget({ group: 'finance' });
  assert.deepEqual(bodies[0].groups.map((g) => g.name), ['Finance']);
  await assert.rejects(handlers.forecast_budget({ group: 'Nope' }), /No cost group/);
});

test('without a configured service the tools say so and invent nothing', async () => {
  const handlers = createFinanceForecastHandlers({ loadTower, ToolError, env: {}, fetchImpl: async () => assert.fail('must not be called') });
  await assert.rejects(handlers.forecast_budget({}), /not configured/);
  await assert.rejects(handlers.estimate_accruals({}), /not configured/);
});

test('service errors and timeouts become tool errors', async () => {
  const down = createFinanceForecastHandlers({ loadTower, ToolError, env, fetchImpl: async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); } });
  await assert.rejects(down.forecast_budget({}), /timeout/);
  const bad = createFinanceForecastHandlers({ loadTower, ToolError, env, fetchImpl: reply({}, false, 500) });
  await assert.rejects(bad.estimate_accruals({}), /HTTP 500/);
  const odd = createFinanceForecastHandlers({ loadTower, ToolError, env, fetchImpl: reply({ nope: 1 }) });
  await assert.rejects(odd.forecast_budget({}), /unexpected answer/);
});

test('estimate_accruals sends only the proposals known on that working day, optionally for one company code', async () => {
  const bodies = [];
  const handlers = createFinanceForecastHandlers({ loadTower, ToolError, env, fetchImpl: async (_u, init) => { bodies.push(JSON.parse(init.body)); return reply(accrualAnswer)(); } });
  const all = await handlers.estimate_accruals({});
  const data = loadPreclose();
  assert.equal(bodies[0].asOfWd, data.asOfWd);
  assert.deepEqual(bodies[0].accruals.map((a) => a.id), data.accruals.filter((a) => a.fromWd <= data.asOfWd).map((a) => a.id));
  assert.ok(bodies[0].accruals.every((a) => !('basis' in a)), 'free text stays here');
  assert.equal(all.engine, 'tabpfn');
  await handlers.estimate_accruals({ entity: 'de10', working_day: 19 });
  assert.ok(bodies[1].accruals.length && bodies[1].accruals.every((a) => a.entity === 'DE10' && a.fromWd <= 19));
  await assert.rejects(handlers.estimate_accruals({ entity: 'XX99' }), /Unknown company code/);
});

test('the checks clamp probabilities and drop unknown levels', () => {
  assert.equal(checkBudgetForecast({ items: [{ name: 'A', overrunProbability: 4, status: 'weird' }] }).items[0].overrunProbability, 1);
  assert.equal(checkBudgetForecast({ items: [{ name: 'A', status: 'weird' }] }).items[0].status, 'on track');
  assert.equal(checkAccrualEstimate({ items: [{ id: 'X', correctionProbability: -2, risk: 'weird' }] }).items[0].correctionProbability, 0);
  assert.equal(checkAccrualEstimate({ items: [{ id: 'X', risk: 'weird' }] }).items[0].risk, 'low');
  assert.throws(() => checkBudgetForecast(null));
  assert.throws(() => checkAccrualEstimate({}));
});

test('both tools only read, so a read-only working profile lets them through', () => {
  const review = BUILTIN_HARNESSES.find((p) => p.id === 'review');
  for (const { name } of FINANCE_FORECAST_TOOL_DEFINITIONS) assert.equal(checkToolCall(review, { toolName: `ai-control-tower__${name}` }).ok, true, name);
});

test('the Space bridges call exactly one tool each and pass on only the rendered fields', async () => {
  const calls = [];
  const call = (body) => async (tool, args) => { calls.push([tool, args]); return { content: [{ type: 'text', text: JSON.stringify(body) }] }; };
  const budget = await handleControlTowerForecastMessage({ type: 'ct:budget-forecast-request', requestId: 'b1' }, call(budgetAnswer));
  assert.deepEqual(calls[0], ['forecast_budget', {}]);
  assert.equal(budget.type, 'ct:budget-forecast');
  assert.equal(JSON.stringify(budget).includes('secret'), false);
  const accrual = await handlePrecloseForecastMessage({ type: 'ct:accrual-estimate-request', requestId: 'a1', entity: 'DE10', workingDay: 17 }, call(accrualAnswer));
  assert.deepEqual(calls[1], ['estimate_accruals', { entity: 'DE10', working_day: 17 }]);
  assert.equal(accrual.type, 'ct:accrual-estimate');
  await handlePrecloseForecastMessage({ type: 'ct:accrual-estimate-request', requestId: 'a2', entity: '../x', workingDay: 99 }, call(accrualAnswer));
  assert.deepEqual(calls[2], ['estimate_accruals', {}], 'bad values are dropped');
  assert.equal(pickBudgetForecast(null), null);
  assert.equal(pickAccrualEstimate({}), null);
});

test('the bridges ignore other messages, bad request ids, and answer errors', async () => {
  const never = async () => assert.fail('must not be called');
  assert.equal(await handleControlTowerForecastMessage({ type: 's4m:payment-risk-request', requestId: 'x' }, never), null);
  assert.equal(await handlePrecloseForecastMessage({ type: 'ct:budget-forecast-request', requestId: 'x' }, never), null, 'each Space has only its own request');
  assert.equal(await handleControlTowerForecastMessage({ type: 'ct:budget-forecast-request', requestId: 'bad id!' }, never), null);
  assert.equal((await handleControlTowerForecastMessage({ type: 'ct:budget-forecast-request', requestId: 'b1' }, undefined)).type, 'ct:error');
  const failing = async () => { throw new Error('boom'); };
  assert.deepEqual(await handlePrecloseForecastMessage({ type: 'ct:accrual-estimate-request', requestId: 'a1' }, failing), { type: 'ct:error', requestId: 'a1', message: 'boom' });
});

test('the Spaces ask the host, have no network and only listen to their parent', () => {
  for (const [slug, type] of [['control-tower', 'ct:budget-forecast-request'], ['finance-preclose', 'ct:accrual-estimate-request']]) {
    const html = readFileSync(new URL(`../examples/${slug}/index.html`, import.meta.url), 'utf8');
    assert.ok(html.includes(type), slug);
    assert.match(html, /e\.source\s*!==\s*window\.parent/, slug);
  }
});
