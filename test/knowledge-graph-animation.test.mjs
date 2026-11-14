import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { extractGraph } from '../connectors/_lib/server/graph.mjs';

const html = readFileSync(join(import.meta.dirname, '../examples/knowledge-graph/index.html'), 'utf8');
const block = /\/\* @pulse-start \*\/([\s\S]*?)\/\* @pulse-end \*\//.exec(html)[1];
const { pulseIds, HEALTH_TOKEN } = vm.runInNewContext(`${block}; ({ pulseIds, HEALTH_TOKEN })`);
const graph = extractGraph(html);
const node = (id, extra = {}) => ({ id, type: 'contract', ...extra });

test('graph animation: escalations first, then red renewals by the closest decision, never more than the cap, never anything else', () => {
  const list = [
    node('a', { renewal: { health: 'red', days: 30 } }), node('b', { renewal: { health: 'red', days: -5 } }), node('c', { renewal: { health: 'yellow', days: 1 } }),
    node('d', { renewal: { health: 'green', days: 2 } }), node('e', { type: 'customer', escalation: { level: 'Management' } }), node('f'),
    node('g', { renewal: { health: 'red', days: 10 } }),
  ];
  assert.deepEqual(pulseIds(list, 15), ['e', 'b', 'g', 'a'], 'the escalation, then red ones, the one that is overdue first');
  assert.deepEqual(pulseIds(list, 2), ['e', 'b'], 'the cap cuts the end of the list');
  assert.deepEqual(pulseIds([], 15), []);
  assert.deepEqual(pulseIds(list.filter((n) => !n.escalation && n.renewal?.health !== 'red'), 15), [], 'yellow, green and plain nodes never breathe');
});

test('graph animation: with the sample data the calm picture holds (red renewals and the two escalations, well below the cap)', () => {
  const ids = pulseIds(graph.nodes, 15);
  const red = graph.nodes.filter((n) => n.renewal?.health === 'red').length, esc = graph.nodes.filter((n) => n.escalation).length;
  assert.equal(ids.length, red + esc);
  assert.ok(ids.length > 0 && ids.length <= 15, `${ids.length} breathing nodes`);
  assert.deepEqual(Object.keys(HEALTH_TOKEN).sort(), ['green', 'red', 'yellow']);
});

test('graph animation: the rings use theme tokens, the breath never runs with reduced motion, and the page says what the rings mean', () => {
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, 'no colour literals in the new code');
  assert.deepEqual(Object.values(vm.runInNewContext(`${block}; HEALTH_TOKEN`)).sort(), ['amber', 'green', 'red']);
  assert.match(html, /PULSE\.has\(n\.id\) && !reduced && IP >= 1/, 'the breath is off with reduced motion and waits for the intro');
  assert.match(html, /if \(foc \|\| r <= 5 \|\| !\(n\.renewal \|\| n\.escalation\)\) return;/, 'rings only in the calm state, not while something is selected');
  assert.match(html, /Ring colour = renewal health/);
  assert.match(html, /Colour = renewal health \(red, yellow, green\)/);
});

test('graph animation: the ring is one function, drawn in 2D and in 3D; an overdue invoice is red', () => {
  assert.equal((html.match(/(?<!function )healthRing\(n, /g) ?? []).length, 2, 'one call in the 2D view and one in the 3D view');
  assert.equal((html.match(/function healthRing\(/g) ?? []).length, 1);
  assert.match(html, /healthRing\(n, q\.x, q\.y, r, al \* depth\(q\), now\)/, 'the 3D view fades the ring with the depth of the node');
  assert.match(html, /n\.type === 'invoice' && n\.meta && n\.meta\.Status === 'Overdue'\) return C\.red/);
  const overdue = graph.nodes.filter((n) => n.type === 'invoice' && n.meta.Status === 'Overdue'), open = graph.nodes.filter((n) => n.type === 'invoice' && n.meta.Status === 'Open');
  assert.ok(overdue.length > 0 && open.length > 0, 'the sample data has both kinds');
  assert.match(html, /overdue invoices are red/);
});
