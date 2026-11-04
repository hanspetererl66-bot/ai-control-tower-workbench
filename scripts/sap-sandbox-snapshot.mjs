#!/usr/bin/env node
/**
 * SAP sandbox probe and snapshot (read only).
 * With your personal API key it checks which S/4HANA APIs the sandbox offers, reads the latest sales orders,
 * traces them through delivery and invoice, reads their customers and writes everything to one JSON file.
 * The file feeds the Cognee corpus (npm run cognee:corpus) and lets a demo run without a live sandbox.
 *
 *   SAP_API_KEY=... npm run sap-sandbox:snapshot -- [--orders 10] [--out examples/sap-sandbox/snapshot.json]
 *
 * The key is read from the environment only and is never written to the file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_CATALOG, createSandboxHandlers } from '../connectors/sap-sandbox/server/sandbox.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT = resolve(ROOT, 'examples/sap-sandbox/snapshot.json');

const message = (e) => (e instanceof Error ? e.message : String(e));

/** Probe the catalog, read the latest orders, trace them and read their customers. handlers: from createSandboxHandlers. */
export async function buildSnapshot(handlers, { orders = 10, customers = 6, now = () => new Date() } = {}) {
  const connection = await handlers.sap_sandbox_check_connection(); // a wrong key stops here, before anything else

  const probe = [];
  for (const api of API_CATALOG) {
    try {
      const r = await handlers.sap_sandbox_list_entity_sets({ service: api.service });
      probe.push({ service: api.service, ok: true, entity_sets: r.entity_sets.length, has_suggested: api.entity_sets.filter((e) => r.entity_sets.includes(e)) });
    } catch (e) {
      probe.push({ service: api.service, ok: false, error: message(e) });
    }
  }

  const scan = await handlers.sap_sandbox_o2c_scan({ top: Math.min(50, Math.max(1, orders)) });
  const traces = [];
  const errors = [];
  for (const o of scan.orders.slice(0, orders)) {
    try { traces.push(await handlers.sap_sandbox_order_to_cash({ sales_order: o.sales_order })); } catch (e) { errors.push({ sales_order: o.sales_order, error: message(e) }); }
  }

  const ids = [...new Set(scan.orders.map((o) => o.customer).filter(Boolean))].slice(0, customers);
  const customerViews = [];
  for (const id of ids) {
    try { customerViews.push(await handlers.sap_sandbox_customer_360({ customer: id })); } catch (e) { errors.push({ customer: id, error: message(e) }); }
  }

  const stages = {};
  for (const t of traces) stages[t.status.stage] = (stages[t.status.stage] ?? 0) + 1;
  return {
    fetched_at: now().toISOString(),
    source: 'SAP Business Accelerator Hub sandbox (S/4HANA Cloud), SAP sample data',
    base: connection.base,
    probe,
    orders: scan.orders,
    traces,
    customers: customerViews,
    summary: { apis_ok: probe.filter((p) => p.ok).length, apis_total: probe.length, orders_read: scan.read, traced: traces.length, stages, customers: customerViews.length, errors: errors.length },
    errors,
  };
}

function args(argv) {
  const out = { orders: 10, file: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--orders') out.orders = Number(argv[++i]);
    else if (argv[i] === '--out') out.file = resolve(argv[++i]);
  }
  if (!Number.isInteger(out.orders) || out.orders < 1 || out.orders > 50) throw new Error('--orders must be a whole number from 1 to 50.');
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { orders, file } = args(process.argv.slice(2));
    const snapshot = await buildSnapshot(createSandboxHandlers(), { orders });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
    const s = snapshot.summary;
    console.log(`APIs reachable: ${s.apis_ok} of ${s.apis_total}`);
    for (const p of snapshot.probe) console.log(`  ${p.ok ? 'ok  ' : 'FAIL'} ${p.service}${p.ok ? ` (${p.entity_sets} entity sets)` : `: ${p.error}`}`);
    console.log(`Orders read: ${s.orders_read}, traced: ${s.traced}, customers: ${s.customers}, errors: ${s.errors}`);
    console.log(`Stages: ${JSON.stringify(s.stages)}`);
    console.log(`Written: ${file}`);
  } catch (e) {
    console.error(`Snapshot failed: ${message(e)}`);
    process.exit(1);
  }
}
