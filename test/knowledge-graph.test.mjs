import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createGraphHandlers, extractGraph, NODE_TYPES, EDGE_TYPES } from '../connectors/control-tower/server/graph.mjs';
import { repoGraph } from '../scripts/sync-knowledge-graph.mjs';
import { ToolError } from '../connectors/control-tower/server/tools.mjs';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/knowledge-graph/index.html'), 'utf8');
const graph = repoGraph();
const h = createGraphHandlers(() => graph);

test('embedded graph equals the graph built from the sources', () => {
  assert.deepEqual(extractGraph(page), JSON.parse(JSON.stringify(graph)), 'run: npm run sync:knowledge-graph');
});

test('graph is consistent: known types, resolvable edges, no duplicates, no isolated nodes, curated links resolve', () => {
  assert.equal(graph.unresolvedLinks, undefined);
  const ids = new Set(graph.nodes.map((n) => n.id));
  assert.equal(ids.size, graph.nodes.length);
  const seen = new Set(), used = new Set();
  for (const n of graph.nodes) assert.ok(NODE_TYPES[n.type], `node type ${n.type}`);
  for (const e of graph.edges) {
    assert.ok(ids.has(e.source) && ids.has(e.target), `${e.source} -> ${e.target}`);
    assert.ok(EDGE_TYPES[e.type], `edge type ${e.type}`);
    const key = `${e.source}|${e.type}|${e.target}`;
    assert.ok(!seen.has(key), key); seen.add(key); used.add(e.source); used.add(e.target);
  }
  assert.deepEqual(graph.nodes.filter((n) => !used.has(n.id)).map((n) => n.id), []);
  assert.ok(graph.nodes.length > 120 && graph.edges.length > 200);
});

test('tour steps point at existing nodes', () => {
  assert.ok(graph.tour.length >= 5);
  for (const s of graph.tour) assert.ok(graph.nodes.some((n) => n.id === s.node), s.node);
});

test('the Space page reads no network and no storage', () => {
  assert.doesNotMatch(page, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket|<form/);
});

test('overview, search, neighbours', () => {
  const o = h.get_graph_overview();
  assert.equal(o.nodes, graph.nodes.length);
  assert.deepEqual(o.withoutConnections, []);
  assert.equal(o.view.space, 'knowledge-graph');
  const s = h.search_graph({ query: 'ariba' });
  assert.ok(s.nodes.some((n) => n.id === 'product:ariba-procurement'));
  assert.ok(h.search_graph({ query: 'ariba', type: 'contract' }).nodes.every((n) => n.type === 'contract'));
  const nb = h.get_graph_neighbors({ node: 'C-2023-0390' });
  assert.equal(nb.node.id, 'contract:C-2023-0390');
  assert.ok(nb.neighbours.Customer && nb.neighbours.Offer);
  assert.match(JSON.stringify(nb.neighbours.Offer), /renewed by/);
});

test('path and impact answer the Ariba story', () => {
  const p = h.find_graph_path({ from: 'R2', to: 'Muster Industrie AG' });
  assert.equal(p.connected, true);
  assert.ok(p.length >= 2 && p.length <= 6);
  const i = h.analyze_graph_impact({ node: 'contract:C-2023-0390', depth: 2 });
  assert.ok(i.affected > 5);
  const flat = JSON.stringify(i.byDistance);
  assert.match(flat, /Ariba Procurement/);
  assert.match(flat, /Contract renewal reminder/);
  assert.doesNotMatch(flat, /ai-control-tower"/, 'hubs are not followed');
  assert.ok(Object.keys(i.byDistance).every((d) => Number(d) <= 2));
});

test('input errors are ToolErrors', () => {
  assert.throws(() => h.search_graph({ query: 'a' }), ToolError);
  assert.throws(() => h.get_graph_neighbors({ node: 'does-not-exist-xyz' }), ToolError);
  assert.throws(() => h.get_graph_neighbors({ node: 'R' }), /ambiguous/);
  assert.throws(() => h.analyze_graph_impact({ node: 'R2', depth: 9 }), ToolError);
  assert.throws(() => h.find_graph_path({ from: 'R2' }), ToolError);
});
