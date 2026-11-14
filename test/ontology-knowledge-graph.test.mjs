import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildMap, createSimulation } from '../src/graph-map.ts';
import { exampleOntologies } from '../src/ontology-manager.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the Ontology Manager shows its map as a knowledge graph: the tab is called "Knowledge graph", the graph is the default view and the columns are the second one', () => {
  const view = read('src/ui/OntologyManagerView.tsx');
  assert.match(view, /\{ id: 'map', label: 'Knowledge graph' \}/);
  const map = read('src/ui/OntologyMap.tsx');
  assert.match(map, /useState<'sorted' \| 'free'>\('free'\)/, 'the self-arranging graph is what opens');
  const buttons = [...map.matchAll(/aria-pressed=\{mode === '(free|sorted)'\}[^\n]*?>(Graph|Columns)<\/button>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(buttons, [['free', 'Graph'], ['sorted', 'Columns']], 'Graph first, then Columns');
  assert.match(map, /aria-label="Interactive knowledge graph of the ontology catalog\./);
});

test('in the graph every node has a soft halo in its own colour (the hubs a wider one); the columns view has none', () => {
  const map = read('src/ui/OntologyMap.tsx');
  assert.match(map, /if \(!sorted && !\(n\.id === sl \|\| n\.id === hv\)\) \{[\s\S]*?n\.kind === 'ontology' \? 3\.4 : 2\.3[\s\S]*?n\.kind === 'ontology' \? 0\.28 : 0\.16/);
});

test('the layout gives the nodes more room: longer links, a stronger push and a wider ring, and it still settles to finite, separate places', () => {
  const map = buildMap(exampleOntologies(), { version: 1, ontologies: {}, bindings: [], views: [], plans: [], consumers: [], questions: [], proposals: [] }, []);
  const sim = createSimulation(map);
  for (let i = 0; i < 300; i += 1) sim.tick(Math.max(0.05, 1 - i / 300));
  const n = map.nodes.length;
  assert.ok(n > 10);
  for (let i = 0; i < n; i += 1) assert.ok(Number.isFinite(sim.x[i]) && Number.isFinite(sim.y[i]), `node ${i} has a place`);
  let closest = Infinity;
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) closest = Math.min(closest, Math.hypot(sim.x[i] - sim.x[j], sim.y[i] - sim.y[j]));
  assert.ok(closest > 2, `no two nodes sit on top of each other (closest: ${closest.toFixed(1)})`);
  const src = read('src/graph-map.ts');
  assert.match(src, /const len = l\.weak \? 150 : 92/);
  assert.match(src, /\(3600 \/ d2\) \* alpha/);
  assert.match(src, /slugs\.length > 3 \? 150 \+ slugs\.length \* 70 : 260/);
});
