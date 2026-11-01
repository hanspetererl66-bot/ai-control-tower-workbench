// Writes the Werkbank sample graph as text documents for Cognee: dist/cognee-corpus.json
// Usage: npm run cognee:corpus   (then: npm run cognee:seed)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractGraph } from '../connectors/_lib/server/graph.mjs';
import { graphToDocuments } from '../connectors/_lib/server/cognee-corpus.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export function buildCorpus() {
  return graphToDocuments(extractGraph(readFileSync(join(ROOT, 'examples/knowledge-graph/index.html'), 'utf8')));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const docs = buildCorpus();
  const out = join(ROOT, 'dist/cognee-corpus.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(docs, null, 2));
  console.log(`Wrote ${docs.length} documents to ${out}`);
}
