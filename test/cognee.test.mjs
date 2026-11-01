import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractGraph } from '../connectors/_lib/server/graph.mjs';
import { graphToDocuments } from '../connectors/_lib/server/cognee-corpus.mjs';
import { BUNDLED_CONNECTORS, LIBRARY_CONNECTORS, MANIFEST_ONLY_CONNECTORS } from '../connectors/_lib/bundle.mjs';

const ROOT = join(import.meta.dirname, '..');
const graph = extractGraph(readFileSync(join(ROOT, 'examples/knowledge-graph/index.html'), 'utf8'));

test('one document per node, with its facts and connections as sentences', () => {
  const docs = graphToDocuments(graph);
  assert.equal(docs.length, graph.nodes.length);
  const muster = docs.find((d) => d.id === 'customer:muster-industrie-ag');
  assert.match(muster.text, /^Muster Industrie AG is a Customer \(customer:muster-industrie-ag\)\./);
  assert.match(muster.text, /Muster Industrie AG has contract C-2024-0187 \(Contract\)\./);
  assert.match(muster.text, /managed in Sub4Me/);
  for (const d of docs) assert.ok(d.text.split('\n').every((line) => /\.$/.test(line)), `${d.id}: every line is a sentence`);
});

test('every edge shows up in the text of both of its nodes', () => {
  const docs = new Map(graphToDocuments(graph).map((d) => [d.id, d.text]));
  const edge = graph.edges.find((e) => e.type === 'HAS_CONTRACT');
  const label = (id) => graph.nodes.find((n) => n.id === id).label;
  assert.ok(docs.get(edge.source).includes(label(edge.target)));
  assert.ok(docs.get(edge.target).includes(label(edge.source)));
});

test('the Cognee connector is a manifest that starts the published package, with a secret key and no code of ours', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'connectors/cognee-memory/manifest.json'), 'utf8'));
  assert.equal(m.name, 'cognee-memory');
  assert.equal(m.server.mcp_config.command, 'uvx');
  assert.ok(m.server.mcp_config.args.includes('cognee-mcp'));
  assert.equal(m.user_config.llm_api_key.sensitive, true);
  assert.equal(m.user_config.memory_folder.required, true);
  assert.deepEqual(m.tools.map((t) => t.name), ['remember', 'recall', 'forget']);
  assert.ok(MANIFEST_ONLY_CONNECTORS.includes('cognee-memory') && !LIBRARY_CONNECTORS.includes('cognee-memory'));
  assert.equal(BUNDLED_CONNECTORS.length, LIBRARY_CONNECTORS.length + 1);
});
