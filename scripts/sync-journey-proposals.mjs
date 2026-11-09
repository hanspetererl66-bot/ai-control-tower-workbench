/**
 * Writes the Customer 360 proposals of Lindenau into the Sales deals they belong to (field `proposal`, shown in the deal drawer).
 *   node scripts/sync-journey-proposals.mjs          write
 *   node scripts/sync-journey-proposals.mjs --check  fail when the deals are out of date
 * The proposals are computed from the Customer 360 data (connectors/_lib/server/customer-360.mjs); test/journey.test.mjs checks the same.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLogic } from '../connectors/_lib/server/customer-360.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALES = join(ROOT, 'examples/sales/pipeline.json');
const sales = JSON.parse(readFileSync(SALES, 'utf8'));
for (const d of sales.deals) delete d.proposal;
const recs = makeLogic(JSON.parse(readFileSync(join(ROOT, 'examples/customer-360/data-lindenau.json'), 'utf8'))).recommendations();
for (const r of recs) for (const id of r.deals ?? []) {
  const d = sales.deals.find((x) => x.id === id);
  if (!d) throw new Error(`${r.id} points at ${id}, which is not a Sales deal`);
  d.proposal = { rec: r.id, rank: r.rank, title: r.title };
}
const next = JSON.stringify(sales, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (next !== readFileSync(SALES, 'utf8')) { console.error('Sales proposals are out of date — run: node scripts/sync-journey-proposals.mjs'); process.exit(1); }
  console.log('Sales proposals are in sync.');
} else { writeFileSync(SALES, next); console.log(`Wrote ${recs.reduce((n, r) => n + (r.deals?.length ?? 0), 0)} proposals into the Sales deals.`); }
