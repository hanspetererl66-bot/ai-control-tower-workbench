import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, layoutMap, focusOf, impactIds, visibleMap, searchMap } from '../src/graph-map.ts';
import { exampleOntologies, emptyGovernance, addBinding } from '../src/ontology-manager.ts';

const onts = exampleOntologies();
const metric = onts.flatMap((o) => o.terms.filter((t) => t.kind === 'metric').map((t) => ({ o, t })))[0];
const gov = addBinding(addBinding(emptyGovernance(), { slug: metric.o.slug, term: metric.t.id, kind: 'agent', name: 'Margin Analyst' }), { slug: metric.o.slug, term: metric.t.id, kind: 'report', name: 'Board pack' });

test('buildMap: one hub per ontology, weak hub links, consumers from bindings', () => {
  const map = buildMap(onts, gov);
  assert.equal(map.nodes.filter((n) => n.kind === 'ontology').length, onts.length);
  assert.ok(map.edges.some((e) => e.weak && e.prop === 'contains'));
  const users = map.nodes.filter((n) => n.kind === 'agent' || n.kind === 'report');
  assert.equal(users.length, 2);
  assert.ok(map.edges.some((e) => e.prop === 'uses' && !e.weak));
  assert.equal(new Set(map.nodes.map((n) => n.id)).size, map.nodes.length);
});

test('focusOf reaches the same terms as impactOf for every term', () => {
  const map = buildMap(onts, emptyGovernance());
  for (const o of onts) for (const t of o.terms) {
    const f = focusOf(map, `${o.slug}:${t.id}`, 3);
    const got = [...f.level.keys()].filter((id) => id !== f.root).sort();
    assert.deepEqual(got, impactIds(o, t.id, 3).sort(), `${o.slug}:${t.id}`);
  }
});

test('consumers sit one step beyond their term', () => {
  const map = buildMap(onts, gov);
  const f = focusOf(map, `${metric.o.slug}:${metric.t.id}`, 3);
  const names = [...f.level.keys()].map((id) => map.nodes.find((n) => n.id === id).label);
  assert.ok(names.includes('Margin Analyst') && names.includes('Board pack'));
});

test('layoutMap is deterministic and finite', () => {
  const map = buildMap(onts, gov);
  const a = layoutMap(map, 80), b = layoutMap(map, 80);
  assert.deepEqual([...a.x], [...b.x]);
  assert.ok([...a.x, ...a.y].every(Number.isFinite));
});

test('visibleMap and searchMap filter', () => {
  const map = buildMap(onts, gov);
  const only = visibleMap(map, new Set(['metric']), 'all');
  assert.ok(only.nodes.every((n) => n.kind === 'metric'));
  assert.ok(only.edges.every((e) => !e.weak));
  assert.deepEqual(searchMap(map, '   '), []);
  assert.ok(searchMap(map, metric.t.label.slice(0, 4)).length > 0);
});
