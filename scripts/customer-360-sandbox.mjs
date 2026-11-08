// Puts real SAP sandbox orders into the Customer 360 sample data (as orders of one Nordlicht company).
//   npm run customer-360:sandbox                              list the customers of the snapshot
//   npm run customer-360:sandbox -- --customer 10100001        merge (add --entity nl-ma --rate USD=0.92 --limit 6)
//   npm run customer-360:sandbox -- --remove                   take the sandbox orders out again
// Then: npm run sync:mockups. Needs examples/sap-sandbox/snapshot.json (npm run sap-sandbox:snapshot).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeSandbox, removeSandbox, sandboxCustomers } from '../connectors/_lib/server/customer-360-sandbox.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'examples/customer-360/data.json');
const SNAPSHOT = join(ROOT, 'examples/sap-sandbox/snapshot.json');

export function parseArgs(argv) {
  const out = { rates: {}, entity: 'nl-ma', limit: 6 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--customer') out.customer = argv[++i];
    else if (a === '--entity') out.entity = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--remove') out.remove = true;
    else if (a === '--rate') {
      const [cur, val] = String(argv[++i]).split('=');
      if (!/^[A-Z]{3}$/.test(cur ?? '') || !(Number(val) > 0)) throw new Error('--rate needs the form USD=0.92');
      out.rates[cur] = Number(val);
    } else throw new Error(`Unknown option ${a}`);
  }
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 12) throw new Error('--limit must be a whole number from 1 to 12.');
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(DATA, 'utf8'));
    if (opts.remove) {
      writeFileSync(DATA, `${JSON.stringify(removeSandbox(data), null, 2)}\n`);
      console.log('Sandbox orders removed. Now run: npm run sync:mockups');
    } else {
      if (!existsSync(SNAPSHOT)) throw new Error('No snapshot yet. Run: SAP_API_KEY=... npm run sap-sandbox:snapshot');
      const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
      if (!opts.customer) {
        console.log('Customers in the snapshot (choose one with --customer):');
        for (const c of sandboxCustomers(snapshot)) console.log(`  ${c.customer}  ${c.name ?? '(no name read)'}  ${c.orders} orders  ${JSON.stringify(c.stages)}`);
      } else {
        const { data: next, orders, skipped } = mergeSandbox(data, snapshot, opts);
        writeFileSync(DATA, `${JSON.stringify(next, null, 2)}\n`);
        console.log(`Merged ${orders.length} sandbox orders into ${opts.entity}:`);
        for (const o of orders) console.log(`  ${o.id}  ${o.netEur} EUR  ${o.sap.stage}`);
        for (const s of skipped) console.log(`  skipped ${s.order}: ${s.reason}`);
        console.log('Now run: npm run sync:mockups');
      }
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
