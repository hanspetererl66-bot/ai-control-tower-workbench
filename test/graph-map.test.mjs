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

test('the live simulation gives the same layout as layoutMap when it is run the same way, and a pinned node stays where it is', async () => {
  const { createSimulation } = await import('../src/graph-map.ts');
  const map = buildMap(onts, emptyGovernance());
  const done = layoutMap(map, 40, 7);
  const sim = createSimulation(map, 7);
  for (let step = 0; step < 40; step++) sim.tick(Math.max(0.02, 1 - step / 40));
  assert.deepEqual(Array.from(sim.x), Array.from(done.x));
  assert.deepEqual(Array.from(sim.y), Array.from(done.y));
  const again = createSimulation(map, 7);
  again.pinned[0] = 1; again.x[0] = 500; again.y[0] = -300;
  for (let i = 0; i < 30; i++) again.tick(0.8);
  assert.equal(again.x[0], 500); assert.equal(again.y[0], -300);
  assert.ok(Array.from(again.x).every(Number.isFinite));
});

test('many ontologies get a wider ring than two, so their areas do not sit on top of each other', async () => {
  const { exampleOntologies } = await import('../src/ontology-manager.ts');
  const { extraExampleOntologies } = await import('../src/ontology-examples.ts');
  const wide = buildMap([...exampleOntologies(), ...extraExampleOntologies()], emptyGovernance());
  const p = layoutMap(wide);
  const hubs = wide.nodes.map((n, i) => ({ n, i })).filter((h) => h.n.kind === 'ontology');
  assert.equal(hubs.length, 7);
  let nearest = 1e9;
  for (let a = 0; a < hubs.length; a++) for (let b = a + 1; b < hubs.length; b++) nearest = Math.min(nearest, Math.hypot(p.x[hubs[a].i] - p.x[hubs[b].i], p.y[hubs[a].i] - p.y[hubs[b].i]));
  assert.ok(nearest > 200, `the closest two ontology hubs are ${Math.round(nearest)} apart`);
});

// ---------------------------------------------------------------- confirmed and suspected users (act A, step 3)

import { setUsageDecision } from '../src/ontology-usage.ts';
import { CONSUMER_MAP_KINDS, MAP_KIND_LABEL } from '../src/graph-map.ts';

test('map: confirmed users join as solid nodes with their name, dismissed ones do not, unknown terms and kinds are ignored', () => {
  const slug = metric.o.slug, term = metric.t.id;
  let g = emptyGovernance();
  g = setUsageDecision(g, `${slug}|${term}|space:rr`, 'confirmed', 'x', 0, 'Revenue Recognition');
  g = setUsageDecision(g, `${slug}|${term}|workflow:w1`, 'confirmed', 'x', 0); // no name kept: the id after the kind is shown
  g = setUsageDecision(g, `${slug}|${term}|agent:gone`, 'dismissed', 'x', 0, 'Dismissed agent');
  g = setUsageDecision(g, `${slug}|NoSuchTerm|space:x`, 'confirmed', 'x', 0, 'Orphan');
  g = setUsageDecision(g, `${slug}|${term}|alien:x`, 'confirmed', 'x', 0, 'Alien');
  const map = buildMap(onts, g);
  const labels = map.nodes.filter((n) => CONSUMER_MAP_KINDS.includes(n.kind)).map((n) => `${n.kind}:${n.label}`).sort();
  assert.deepEqual(labels, ['space:Revenue Recognition', 'workflow:w1']);
  assert.ok(map.nodes.filter((n) => CONSUMER_MAP_KINDS.includes(n.kind)).every((n) => !n.uncertain));
  assert.ok(map.edges.filter((e) => e.prop === 'uses').every((e) => !e.uncertain && !e.weak));
  assert.equal(MAP_KIND_LABEL.space, 'Space');
  assert.equal(new Set(map.nodes.map((n) => n.id)).size, map.nodes.length);
});

test('map: suspected users are dashed (node and link), never duplicate a declared user, and ignore unknown terms and kinds', () => {
  const slug = metric.o.slug, term = metric.t.id;
  const suspected = [
    { slug, term, kind: 'space', name: 'Finance Pre-Close' },
    { slug, term, kind: 'agent', name: 'Margin Analyst' }, // already declared by a person in `gov`
    { slug, term: 'NoSuchTerm', kind: 'space', name: 'Orphan' },
    { slug, term, kind: 'alien', name: 'Alien' },
  ];
  const map = buildMap(onts, gov, suspected);
  const dashed = map.nodes.filter((n) => n.uncertain);
  assert.deepEqual(dashed.map((n) => n.label), ['Finance Pre-Close']);
  const link = map.edges.find((e) => e.to === `${slug}:${term}` && e.from === dashed[0].id);
  assert.equal(link.uncertain, true);
  assert.equal(map.nodes.find((n) => n.label === 'Margin Analyst').uncertain, undefined, 'the declared user stays solid');
  assert.equal(buildMap(onts, gov).nodes.length + 1, map.nodes.length, 'only the one new node was added');
});

test('map: the focus on a term reaches its confirmed and its suspected users one hop beyond, suspected ones over a dashed link', () => {
  const slug = metric.o.slug, term = metric.t.id;
  const g = setUsageDecision(emptyGovernance(), `${slug}|${term}|space:rr`, 'confirmed', 'x', 0, 'Revenue Recognition');
  const map = buildMap(onts, g, [{ slug, term, kind: 'workflow', name: 'Accrual flow' }]);
  const focus = focusOf(map, `${slug}:${term}`, 3);
  const sure = map.nodes.find((n) => n.label === 'Revenue Recognition'), maybe = map.nodes.find((n) => n.label === 'Accrual flow');
  assert.equal(focus.level.get(sure.id), 1);
  assert.equal(focus.level.get(maybe.id), 1);
  assert.ok([...focus.edges].some((e) => e.from === maybe.id && e.uncertain));
  assert.ok([...focus.edges].every((e) => e.from !== sure.id || !e.uncertain));
});

// ---------------------------------------------------------------- guidance: starting points and the sentence
import { startingPoints, describeFocus, linkWord } from '../src/graph-map.ts';
import { resolveCatalog } from '../src/ontology-manager.ts';

test('startingPoints: terms with something hanging on them, biggest first, one per ontology before a second one', async () => {
  const cat = resolveCatalog({ ok: false, error: 'x' });
  const map = buildMap(cat.ontologies, cat.governance);
  const starts = startingPoints(map, 5);
  assert.equal(starts.length, 5);
  assert.ok(starts.every((s) => s.affected > 0 && ['class', 'metric', 'resource'].includes(s.node.kind)));
  assert.equal(new Set(starts.map((s) => s.node.slug)).size, 5, 'five different ontologies');
  assert.deepEqual(startingPoints(map, 5).map((s) => s.node.id), starts.map((s) => s.node.id), 'same answer every time');
  for (const s of starts) assert.equal(focusOf(map, s.node.id, 3).level.size - 1, s.affected);
  assert.deepEqual(startingPoints(buildMap([], emptyGovernance())), []);
});

test('describeFocus: says in words what would be affected, and says plainly when nothing is', () => {
  const map = buildMap(onts, gov);
  const root = `${metric.o.slug}:${metric.t.id}`;
  const text = describeFocus(map, focusOf(map, root, 3), 3);
  assert.match(text, new RegExp(`^If ${metric.t.label} changes, \\d+ other things? would be affected: `));
  assert.match(text, /agents?/);
  assert.match(text, /reports?/);
  assert.doesNotMatch(text, /classs/);
  const lonely = map.nodes.find((n) => n.kind === 'class' && focusOf(map, n.id, 3).level.size === 1);
  assert.match(describeFocus(map, focusOf(map, lonely.id, 3), 3), /^Nothing depends on /);
  assert.equal(linkWord('derivedFrom'), 'derived from');
  assert.equal(linkWord('somethingNew'), 'somethingNew');
});

test('the example catalog is a real graph: every term of the extra ontologies is linked to something, and users hang on all of them', async () => {
  const cat = resolveCatalog({ ok: false, error: 'x' });
  const map = buildMap(cat.ontologies, cat.governance);
  const solid = map.edges.filter((e) => !e.weak);
  assert.ok(map.nodes.length > 140 && solid.length > 140, `${map.nodes.length} nodes, ${solid.length} links`);
  const users = map.nodes.filter((n) => ['agent', 'skill', 'report'].includes(n.kind));
  assert.ok(users.length >= 40, `${users.length} users`);
  for (const o of cat.ontologies.filter((x) => x.slug !== 'werkbank_fin' && x.slug !== 'procurement_docs')) {
    const loose = o.terms.filter((t) => !map.edges.some((e) => !e.weak && (e.from === `${o.slug}:${t.id}` || e.to === `${o.slug}:${t.id}`)));
    assert.deepEqual(loose.map((t) => t.id), [], `${o.slug}: terms with no link`);
  }
});

// ---------------------------------------------------------------- sorted layout
import { layoutLanes, LANES, laneIndexOf } from '../src/graph-map.ts';

test('layoutLanes: one panel per ontology, every node inside its own panel and lane, nothing on top of anything', () => {
  const cat = resolveCatalog({ ok: false, error: 'x' });
  const map = buildMap(cat.ontologies, cat.governance);
  const lay = layoutLanes(map);
  assert.equal(lay.panels.length, cat.ontologies.length);
  assert.ok([...lay.x, ...lay.y].every(Number.isFinite));
  map.nodes.forEach((n, i) => {
    const p = lay.panels.find((q) => q.slug === n.slug);
    assert.ok(lay.x[i] >= p.x && lay.x[i] <= p.x + p.w && lay.y[i] >= p.y && lay.y[i] <= p.y + p.h, `${n.label} inside ${p.title}`);
    if (n.kind !== 'ontology') {
      const lane = p.lanes.find((l) => l.id === LANES[laneIndexOf(n.kind)].id);
      assert.ok(lane && lay.x[i] >= lane.x && lay.x[i] <= lane.x + lane.w, `${n.label} in its lane`);
    }
  });
  const seen = new Set();
  map.nodes.forEach((_, i) => { const k = `${Math.round(lay.x[i])},${Math.round(lay.y[i])}`; assert.ok(!seen.has(k), `two nodes at ${k}`); seen.add(k); });
  for (let a = 0; a < lay.panels.length; a++) for (let b = a + 1; b < lay.panels.length; b++) {
    const p = lay.panels[a], q = lay.panels[b];
    assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `${p.title} and ${q.title} overlap`);
  }
  assert.deepEqual(Array.from(layoutLanes(map).x), Array.from(lay.x), 'same answer every time');
});

test('layoutLanes: lanes read left to right as data, terms, metrics, users, and the best connected stand on top', () => {
  const cat = resolveCatalog({ ok: false, error: 'x' });
  const map = buildMap(cat.ontologies, cat.governance);
  const lay = layoutLanes(map);
  const hr = lay.panels.find((p) => p.slug === 'werkbank_hr');
  assert.deepEqual(hr.lanes.map((l) => l.id), ['source', 'term', 'metric', 'user']);
  assert.ok(hr.lanes.every((l, i) => i === 0 || l.x >= hr.lanes[i - 1].x + hr.lanes[i - 1].w));
  const terms = map.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.slug === 'werkbank_hr' && n.kind === 'class').sort((a, b) => lay.y[a.i] - lay.y[b.i]);
  assert.ok(terms[0].n.degree >= terms[terms.length - 1].n.degree);
  assert.ok(layoutLanes(buildMap([], emptyGovernance())).panels.length === 0);
});
