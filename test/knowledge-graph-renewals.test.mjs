import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { buildGraph, EDGE_TYPES, NODE_TYPES } from '../connectors/_lib/server/graph.mjs';
import { extractGraph } from '../connectors/_lib/server/graph.mjs';
import { renewalsFromRepo, repoGraph, sourcesFromRepo } from '../scripts/sync-knowledge-graph.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const graph = repoGraph();
const data = JSON.parse(read('examples/renewals/renewals.json'));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const edgeKeys = new Set(graph.edges.map((e) => `${e.source}|${e.type}|${e.target}`));

test('renewals in the graph: every renewal case is a contract node of its customer, with decision date and health', () => {
  assert.equal(data.cases.length, 21);
  for (const c of data.cases) {
    const node = byId.get(`contract:${c.contractId}`);
    assert.ok(node, `contract node for ${c.contractId}`);
    assert.equal(node.type, 'contract');
    assert.ok(edgeKeys.has(`customer:${c.customer.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}|HAS_CONTRACT|${node.id}`), `${c.contractId} belongs to ${c.customer}`);
    assert.equal(node.renewal.decision, c.decisionDate);
    assert.ok(['red', 'yellow', 'green'].includes(node.renewal.health));
    assert.match(node.meta['Renewal decision'], new RegExp(c.decisionDate));
  }
});

test('renewals in the graph: the health is the one the Renewals page calculates, not a second rule', () => {
  const page = read('examples/renewals/index.html');
  const { signals } = vm.runInNewContext(`${/<script id="renewal-logic">([\s\S]*?)<\/script>/.exec(page)[1]}; ({ signals })`);
  for (const c of data.cases) assert.equal(byId.get(`contract:${c.contractId}`).renewal.health, signals(c, data.asOf).health, c.contractId);
  assert.ok(graph.nodes.some((n) => n.renewal?.health === 'red') && graph.nodes.some((n) => n.renewal?.health === 'yellow'), 'the sample data has both');
});

test('renewals in the graph: open invoices are nodes that hang on their contract, tickets hang on the contract too', () => {
  const invoices = data.cases.flatMap((c) => c.invoices.map((i) => ({ ...i, contractId: c.contractId })));
  assert.ok(invoices.length >= 14, 'the sample data has open and overdue invoices');
  for (const i of invoices) {
    const node = byId.get(`invoice:${i.id}`);
    assert.ok(node && node.type === 'invoice', i.id);
    assert.ok(edgeKeys.has(`invoice:${i.id}|INVOICE_FOR|contract:${i.contractId}`), `${i.id} is for ${i.contractId}`);
    assert.equal(node.meta.Status, i.status);
    assert.equal(node.meta.Due, i.due);
  }
  for (const c of data.cases) for (const t of c.tickets) assert.ok(edgeKeys.has(`ticket:${t.id}|ABOUT|contract:${c.contractId}`), `${t.id} is about ${c.contractId}`);
  assert.equal(graph.nodes.filter((n) => n.type === 'invoice').length, invoices.length, 'only open and overdue invoices, one node each');
});

test('renewals in the graph: an escalation is a mark on the customer, only where there is one', () => {
  const marked = graph.nodes.filter((n) => n.escalation).map((n) => n.label).sort();
  assert.deepEqual(marked, data.customers.filter((c) => c.escalation).map((c) => c.name).sort());
  assert.ok(!marked.includes('Hanse Handelsgruppe AG'));
  assert.match(byId.get('customer:lindenau-pharma-ag').meta.Escalation, /2608 upgrade/);
});

test('renewals in the graph: nothing else changed (calls, mails and deals stay; ids are unique; every edge resolves; no node is alone)', () => {
  assert.equal(graph.nodes.filter((n) => n.type === 'call').length, 5);
  assert.equal(graph.nodes.filter((n) => n.type === 'thread').length, 8);
  assert.equal(new Set(graph.nodes.map((n) => n.id)).size, graph.nodes.length);
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) assert.ok(ids.has(e.source) && ids.has(e.target) && EDGE_TYPES[e.type], `${e.source} ${e.type} ${e.target}`);
  const touched = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
  for (const n of graph.nodes.filter((x) => ['invoice', 'contract', 'ticket'].includes(x.type))) assert.ok(touched.has(n.id), `${n.id} has an edge`);
  assert.ok(NODE_TYPES.invoice && EDGE_TYPES.INVOICE_FOR);
  const old = byId.get('contract:C-2023-0390');
  assert.equal(old.view.space, 'sub4me', 'a contract that was in the graph keeps its Space');
});

test('renewals in the graph: without the source the graph is the one it was (nothing is added by accident)', () => {
  const src = sourcesFromRepo();
  const plain = buildGraph({ ...src, renewals: undefined });
  assert.equal(plain.nodes.filter((n) => n.type === 'invoice').length, 0);
  const known = new Set(plain.nodes.map((n) => n.id));
  const wanted = new Set();
  for (const c of data.cases) {
    if (!known.has(`contract:${c.contractId}`)) wanted.add(`contract:${c.contractId}`);
    for (const t of c.tickets) if (!known.has(`ticket:${t.id}`)) wanted.add(`ticket:${t.id}`);
    for (const i of c.invoices) wanted.add(`invoice:${i.id}`);
  }
  assert.equal(plain.nodes.length + wanted.size, graph.nodes.length, 'the renewals add exactly the contracts, tickets and invoices the plain graph does not know');
});

test('renewals in the graph: the page carries the graph and styles the new type', () => {
  const html = read('examples/knowledge-graph/index.html');
  const inPage = extractGraph(html);
  assert.equal(inPage.nodes.length, graph.nodes.length);
  assert.match(html, /invoice:\{c:'amber',s:'square'/);
  assert.match(html, /const SALES = \[[^\]]*'invoice'/);
  assert.equal(renewalsFromRepo().cases.length, 21);
});
