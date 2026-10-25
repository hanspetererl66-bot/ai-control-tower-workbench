import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { nodeValueEur, parseNumber, simulateFailure } from '../shared/graph-failure.mjs';
import { embedGraph, modelSource, repoGraph } from '../scripts/sync-knowledge-graph.mjs';
import { parseAskMessage } from '../src/space-ask.ts';

const page = readFileSync(new URL('../examples/knowledge-graph/index.html', import.meta.url), 'utf8');
const graph = repoGraph();
const CONTRACT = 'contract:C-2023-0390';

test('numbers and money are read from node details', () => {
  assert.equal(parseNumber('€2,840,000'), 2840000);
  assert.equal(parseNumber('70%'), 70);
  assert.equal(parseNumber('n/a'), null);
  assert.equal(nodeValueEur({ type: 'contract', meta: { 'Annual value': '€290,000' } }), 290000);
  assert.equal(nodeValueEur({ type: 'offer', meta: { 'Annual value': '€438,000', 'Win probability': '70%' } }), 306600);
  assert.equal(nodeValueEur({ type: 'skill', meta: { 'Value last full month': '€425' } }), 5100);
  assert.equal(nodeValueEur({ type: 'agent', meta: {} }), 0);
});

test('a failing contract reaches its customer, offers and calls, with falling exposure', () => {
  const r = simulateFailure(graph, CONTRACT);
  const by = new Map(r.reached.map((x) => [x.id, x]));
  assert.equal(by.get(CONTRACT).exposure, 1);
  assert.ok(by.has('customer:muster-industrie-ag') && [...by.values()].some((x) => x.type === 'offer'));
  for (const x of r.reached.filter((y) => y.via)) assert.ok(x.exposure < by.get(x.via).exposure, x.id);
  assert.ok(r.atRiskEur > 0 && r.atRiskEur < r.exposedEur);
  assert.equal(r.affected, r.reached.length - 1);
});

test('hubs are not passed through and leaf types do not pass the failure on', () => {
  const r = simulateFailure(graph, CONTRACT);
  const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
  for (const x of r.reached) {
    assert.ok(!['system', 'connector'].includes(x.type), x.id);
    if (x.via) assert.ok(!['person', 'tool', 'app', 'customer', 'family'].includes(types.get(x.via)) || x.via === CONTRACT, `${x.id} via ${x.via}`);
  }
});

test('a wider spread reaches more, a narrower one less, and the origin is always included', () => {
  const n = (spread) => simulateFailure(graph, CONTRACT, { spread }).affected;
  assert.ok(n(0.5) < n(0.3) && n(0.3) < n(0.15));
  assert.equal(simulateFailure(graph, 'risk:R2', { spread: 0.99 }).affected, 0);
  assert.throws(() => simulateFailure(graph, 'nope'), /unknown node/);
});

test('the result is deterministic and lists German assumptions', () => {
  assert.deepEqual(simulateFailure(graph, 'risk:R2'), simulateFailure(graph, 'risk:R2'));
  assert.ok(simulateFailure(graph, 'risk:R2').assumptions.length >= 4);
});

test('the page embeds exactly the shared model, is in sync, and runs the same rules', () => {
  assert.equal(embedGraph(page, graph), page, 'run: npm run sync:knowledge-graph');
  const embedded = /<script id="kg-model">([\s\S]*?)<\/script>/.exec(page)[1].trim();
  assert.equal(embedded, modelSource().trim());
  const ctx = vm.createContext({});
  vm.runInContext(`${embedded}\nthis.sim = simulateFailure;`, ctx);
  for (const id of [CONTRACT, 'risk:R2', 'agent:abap-code-assistant', 'ticket:TKT-48213']) {
    for (const spread of [0.5, 0.3, 0.15]) {
      assert.deepEqual(JSON.parse(JSON.stringify(ctx.sim(graph, id, { spread }))), JSON.parse(JSON.stringify(simulateFailure(graph, id, { spread }))), `${id} ${spread}`);
    }
  }
});

test('the page offers the failure mode and asks Joule through wb:ask, within the host length limit', () => {
  assert.match(page, /id="m-failure"/);
  assert.match(page, /type: 'wb:ask'/);
  for (const kind of ['node', 'fail']) assert.ok(page.includes(`data-ask`) && page.includes(`'${kind}'`));
  assert.equal(parseAskMessage({ type: 'wb:ask', prompt: 'x'.repeat(600) }), 'x'.repeat(600));
  assert.equal(parseAskMessage({ type: 'wb:ask', prompt: 'x'.repeat(601) }), null);
});
