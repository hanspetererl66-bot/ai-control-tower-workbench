// Writes the Werkbank sample graph as text documents for Cognee: dist/cognee-corpus.json
// Usage: npm run cognee:corpus   (then: npm run cognee:seed)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractGraph } from '../connectors/_lib/server/graph.mjs';
import { graphToDocuments } from '../connectors/_lib/server/cognee-corpus.mjs';
import { customer360Documents } from '../connectors/_lib/server/customer-360.mjs';
import { salesDocuments } from '../connectors/_lib/server/cognee-sales-corpus.mjs';
import { snapshotToDocuments } from '../connectors/_lib/server/cognee-sap-corpus.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export function buildCorpus() {
  return graphToDocuments(extractGraph(readFileSync(join(ROOT, 'examples/knowledge-graph/index.html'), 'utf8')));
}
/** Documents of the Customer 360 Space (Nordlicht group): one per node, ids in brackets, for the dataset customer-360. */
export function buildCustomer360Corpus(file = join(ROOT, 'examples/customer-360/data.json')) {
  return customer360Documents(JSON.parse(readFileSync(file, 'utf8')));
}
/** Documents of the Sales Space (deals, customers, competitors, skills) for the dataset sales-deals. */
export function buildSalesCorpus(file = join(ROOT, 'examples/sales/pipeline.json')) {
  return salesDocuments(JSON.parse(readFileSync(file, 'utf8')));
}
/** Documents from the SAP sandbox snapshot (npm run sap-sandbox:snapshot); null if there is no snapshot yet. */
export function buildSapCorpus(file = join(ROOT, 'examples/sap-sandbox/snapshot.json')) {
  return existsSync(file) ? snapshotToDocuments(JSON.parse(readFileSync(file, 'utf8'))) : null;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const docs = buildCorpus();
  const out = join(ROOT, 'dist/cognee-corpus.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(docs, null, 2));
  console.log(`Wrote ${docs.length} documents to ${out}`);
  const c360 = buildCustomer360Corpus();
  const c360Out = join(ROOT, 'dist/cognee-corpus-customer-360.json');
  writeFileSync(c360Out, JSON.stringify(c360, null, 2));
  console.log(`Wrote ${c360.length} Customer 360 documents to ${c360Out} (load them with: .venv-cognee/bin/python scripts/cognee-seed.py --corpus dist/cognee-corpus-customer-360.json --dataset customer-360)`);
  const c360L = buildCustomer360Corpus(join(ROOT, 'examples/customer-360/data-lindenau.json'));
  const c360LOut = join(ROOT, 'dist/cognee-corpus-customer-360-lindenau.json');
  writeFileSync(c360LOut, JSON.stringify(c360L, null, 2));
  console.log(`Wrote ${c360L.length} Customer 360 documents (Lindenau) to ${c360LOut} (load them with: .venv-cognee/bin/python scripts/cognee-seed.py --corpus dist/cognee-corpus-customer-360-lindenau.json --dataset customer-360-lindenau)`);
  const sales = buildSalesCorpus();
  const salesOut = join(ROOT, 'dist/cognee-corpus-sales.json');
  writeFileSync(salesOut, JSON.stringify(sales, null, 2));
  console.log(`Wrote ${sales.length} Sales documents to ${salesOut} (load them with: .venv-cognee/bin/python scripts/cognee-seed.py --corpus dist/cognee-corpus-sales.json --dataset sales-deals)`);
  const sap = buildSapCorpus();
  if (sap) {
    const sapOut = join(ROOT, 'dist/cognee-corpus-sap.json');
    writeFileSync(sapOut, JSON.stringify(sap, null, 2));
    console.log(`Wrote ${sap.length} SAP sandbox documents to ${sapOut} (add them with: .venv-cognee/bin/python scripts/cognee-seed.py --corpus dist/cognee-corpus-sap.json, without --reset)`);
  } else {
    console.log('No SAP sandbox snapshot yet (npm run sap-sandbox:snapshot); only the sample graph was written.');
  }
}
