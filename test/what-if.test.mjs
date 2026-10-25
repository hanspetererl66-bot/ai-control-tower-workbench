import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createWhatIfHandlers, prepareWhatIf, simulateCreditCut } from '../connectors/control-tower/server/what-if.mjs';
import { embedWhatIf, modelSource, repoModel } from '../scripts/sync-what-if.mjs';

const data = JSON.parse(readFileSync(new URL('../examples/control-tower/data.json', import.meta.url), 'utf8'));
const model = prepareWhatIf(data);

test('0 % cut throttles nobody and keeps the ceiling', () => {
  const r = simulateCreditCut(model, 0);
  assert.equal(r.ceiling.beforeM, r.ceiling.afterM);
  assert.equal(r.agents.runsLostPerDay, 0);
  assert.equal(r.processes.length, 0);
  assert.ok(r.groups.every((g) => g.mustReducePct === 0));
});

test('30 % cut falls under the actual spend and throttles', () => {
  const r = simulateCreditCut(model, 30);
  assert.equal(r.ceiling.afterM, 15.05);
  assert.ok(r.ceiling.overByM > 0 && r.ceiling.status === 'over');
  assert.ok(r.agents.runsLostPerDay > 0 && r.processes.length > 0);
  assert.ok(r.risks.some((k) => k.effect === 'steigt'));
  assert.ok(r.assumptions.length >= 3);
});

test('break-even is where the ceiling meets the spend, and more cut never throttles less', () => {
  const be = simulateCreditCut(model, 0).breakEvenCutPct;
  assert.ok(be > 20 && be < 30, String(be));
  assert.equal(simulateCreditCut(model, Math.floor(be) - 1).agents.runsLostPerDay, 0);
  let last = -1;
  for (let c = 0; c <= 90; c += 5) {
    const lost = simulateCreditCut(model, c).agents.runsLostPerDay;
    assert.ok(lost >= last, `cut ${c}`);
    last = lost;
  }
});

test('the page embeds exactly the module model and data, and is in sync', () => {
  const html = readFileSync(new URL('../examples/what-if/index.html', import.meta.url), 'utf8');
  assert.equal(embedWhatIf(html, repoModel(), undefined, readFileSync(new URL('../examples/shared/design-system.css', import.meta.url), 'utf8')), html);
  const embedded = /<script id="wi-model">([\s\S]*?)<\/script>/.exec(html)[1].trim();
  assert.equal(embedded, modelSource().trim());
  const ctx = vm.createContext({});
  vm.runInContext(`${embedded}\nthis.sim = simulateCreditCut; this.prep = prepareWhatIf;`, ctx);
  for (let c = 0; c <= 60; c += 6) assert.deepEqual(JSON.parse(JSON.stringify(ctx.sim(model, c))), JSON.parse(JSON.stringify(simulateCreditCut(model, c))));
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/);
});

test('the tool validates input and returns a view', async () => {
  const class_ = class ToolError extends Error {};
  const h = createWhatIfHandlers({ loadTower: async () => ({ data, source: 'test' }), ToolError: class_ });
  await assert.rejects(() => h.simulate_credit_cut({ cut_percent: 120 }), class_);
  await assert.rejects(() => h.simulate_credit_cut({}), class_);
  const r = await h.simulate_credit_cut({ cut_percent: 30 });
  assert.equal(r.view.space, 'what-if');
  assert.equal(r.cutPct, 30);
});
