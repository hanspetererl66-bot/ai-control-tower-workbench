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

test('tours point at existing nodes and have titles and texts', () => {
  assert.deepEqual(graph.tours.map((t) => t.id), ['ariba', 'governance', 'communication']);
  for (const t of graph.tours) {
    assert.ok(t.title && t.summary && t.steps.length >= 5, t.id);
    for (const s of t.steps) { assert.ok(graph.nodes.some((n) => n.id === s.node), s.node); assert.ok(s.title && s.text); }
  }
});

test('governance tour facts match the graph', () => {
  const edge = (a, b) => graph.edges.some((e) => e.source === a && e.target === b);
  assert.ok(edge('risk:R2', 'agent:contract-drafter') && edge('risk:R6', 'agent:contract-drafter'));
  assert.ok(edge('skill:access-review-prep', 'risk:R2') && edge('skill:access-review-prep', 'skill:board-briefing') && edge('skill:board-briefing', 'risk:R6'));
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

test('communication: calls and e-mail conversations are linked to contract, offer, ticket and each other', () => {
  const edge = (a, b, type) => graph.edges.some((e) => e.source === a && e.target === b && (!type || e.type === type));
  assert.equal(graph.nodes.filter((n) => n.type === 'call').length, 5);
  assert.equal(graph.nodes.filter((n) => n.type === 'thread').length, 4);
  assert.ok(edge('call:CALL-0414', 'contract:C-2023-0390', 'DISCUSSES') && edge('call:CALL-0414', 'offer:OFF-2026-0318') && edge('call:CALL-0414', 'ticket:TKT-48213'));
  assert.ok(edge('thread:T-101', 'contract:C-2023-0390', 'DISCUSSES') && edge('thread:T-101', 'call:CALL-0414', 'FOLLOWS_UP'));
  assert.ok(edge('thread:T-103', 'call:CALL-0407', 'FOLLOWS_UP'), 'the mail that closes a call action');
  assert.ok(edge('thread:T-104', 'risk:R7', 'RELATES_TO_RISK'), 'the flagged mail is tied to the prompt-injection risk');
  assert.ok(edge('call:CALL-0412', 'customer:nordwind-handel-gmbh', 'WITH_CUSTOMER'));
  assert.equal(graph.nodes.find((n) => n.id === 'call:CALL-0409').meta['Open actions'], '1 (1 overdue)');
});

test('communication tools: search, neighbours and impact include calls and mails', () => {
  assert.ok(h.search_graph({ query: 'ariba', type: 'call' }).nodes.some((n) => n.id === 'call:CALL-0414'));
  const nb = h.get_graph_neighbors({ node: 'T-101' });
  assert.match(JSON.stringify(nb), /follows up on/);
  assert.match(JSON.stringify(nb), /CALL-0414/);
  const impact = h.analyze_graph_impact({ node: 'C-2023-0390', depth: 2, types: ['call', 'thread'] });
  assert.match(JSON.stringify(impact), /CALL-0414/);
  assert.match(JSON.stringify(impact), /T-101/);
  assert.match(JSON.stringify(h.find_graph_path({ from: 'T-104', to: 'R7' })), /prompt injection/i);
  assert.throws(() => h.search_graph({ query: 'x1', type: 'mail' }), ToolError);
});

test('Sales view: deals carry ACV, TCV, probability and dates; offers and contracts are enriched; ACV matches the pipeline', () => {
  const pipeline = JSON.parse(readFileSync(join(ROOT, 'examples/sales/pipeline.json'), 'utf8'));
  const valued = pipeline.deals.filter((d) => d.value);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const d of valued) {
    const id = d.stage === 'sell' ? `offer:${d.id}` : d.stage === 'contract' ? `contract:${d.id}` : `deal:${d.id}`;
    const n = byId.get(id);
    assert.ok(n?.sales, `${id} has sales data`);
    assert.equal(n.sales.acv, d.value);
    assert.equal(n.sales.tcv, Math.round((d.value * (d.termMonths ?? 12)) / 12), `${id}: TCV is ACV times term in months divided by 12`);
    assert.equal(n.sales.prob, d.score ?? undefined);
    if (d.stage !== 'contract') assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/, `${id} has a date for the time slider`);
  }
  assert.equal(graph.nodes.filter((n) => n.type === 'deal').length, valued.filter((d) => d.stage === 'lead' || d.stage === 'opportunity').length);
  assert.ok(graph.nodes.filter((n) => n.type === 'call' || n.type === 'thread').every((n) => n.date), 'calls and mails are dated');
  assert.ok(graph.asOf >= pipeline.asOf);
});

test('Stakeholders: customer contacts get a role and a contact strength derived from calls and mails', () => {
  const people = graph.nodes.filter((n) => n.stake);
  assert.ok(people.length >= 8);
  const felix = graph.nodes.find((n) => n.id === 'person:felix-brandt');
  assert.equal(felix.stake.touches, felix.stake.calls + felix.stake.mails);
  assert.equal(felix.stake.role, 'Blocker', 'security contacts are blockers');
  assert.equal(felix.stake.strength, 'strong');
  assert.ok(people.every((p) => ['Sponsor', 'Decider', 'Blocker', 'Influencer'].includes(p.stake.role)));
  assert.ok(people.every((p) => (p.stake.touches === 0) === (p.stake.strength === 'none')));
  assert.ok(graph.edges.some((e) => e.type === 'TOOK_PART_IN') && graph.edges.some((e) => e.type === 'WROTE_IN'));
});

test('Page: Sales view by default with enablers, value legend, week slider, questions and stakeholder map', () => {
  for (const id of ['b-enabler', 'b-value', 'b-stake', 't-range', 'ask', 'vleg']) assert.match(page, new RegExp(`id="${id}"`));
  assert.match(page, /const hidden = new Set\(ENABLER\)/, 'enablers are hidden until switched on');
  for (const q of ['Which opportunities can still close by quarter end?', 'Which opportunities do I have in MEE, APEC and NALA?', 'Which quarter-end deals are at risk?', 'Which contracts end or need notice before quarter end?', 'Which open deals have no decision maker yet?', 'What changed since last week?', 'Where is a skill missing?']) assert.ok(page.includes(q), q);
  // questions, legend and time slider sit in their own bars and no longer cover the graph
  for (const sel of ['.ask', '.legend', '.timebar', '.vleg']) assert.doesNotMatch(page, new RegExp(`\\${sel}\\{position:absolute`), `${sel} must not float over the canvas`);
});

test('Sales regions and quarter-end data: accounts carry a region, contracts carry end and notice', () => {
  const regions = ['MEE', 'APEC', 'NALA'];
  const open = graph.nodes.filter((n) => n.sales && n.sales.stage !== 'contract');
  assert.ok(open.length > 8);
  for (const n of open) assert.ok(regions.includes(n.sales.region), `${n.id} has a region`);
  for (const r of regions) assert.ok(open.some((n) => n.sales.region === r), `${r} has open deals`);
  for (const n of graph.nodes.filter((x) => x.type === 'customer' && x.sales === undefined && Object.values(x.meta).length)) if (n.region) assert.ok(regions.includes(n.region));
  const contracts = graph.nodes.filter((n) => n.sales && n.sales.stage === 'contract');
  assert.ok(contracts.length >= 5);
  for (const c of contracts) assert.ok(c.sales.end && c.sales.noticeDays > 0, `${c.id} has end and notice period`);
  assert.ok(graph.regionNote);
});
