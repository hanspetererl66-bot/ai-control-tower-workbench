/**
 * Puts real SAP sandbox orders (snapshot from `npm run sap-sandbox:snapshot`) into the Customer 360 sample data as orders of ONE
 * Nordlicht company. The rest of the group stays invented. Every merged order carries `source: 'sap-sandbox'`, so the Space and the
 * Cognee documents can say where it came from. Pure: no network, no files.
 *
 * Honest limits: the sandbox customer is only a stand-in (its name is not used); amounts in other currencies need an explicit demo rate;
 * billing documents stay in the order note (no invoice nodes: the sandbox holds no payment dates); field names follow the snapshot,
 * which is written by the connector and has not been checked against the real sandbox yet.
 */
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const day = (v) => (has(v) ? String(v).slice(0, 10) : null);
const round = (n) => Math.round(n);
const STAGE_TEXT = {
  invoiced: 'delivered and fully invoiced',
  delivered_not_invoiced: 'goods issued, nothing invoiced yet',
  partly_invoiced: 'goods issued, only partly invoiced',
  goods_issue_open: 'delivery exists, goods issue not posted',
  delivery_blocked: 'delivery blocked',
  not_delivered: 'not delivered yet',
  delivered_no_document_found: 'marked delivered, no delivery document found',
};

/** What the snapshot offers: one row per customer with the orders that were traced for it. */
export function sandboxCustomers(snapshot) {
  const by = new Map();
  for (const t of snapshot.traces ?? []) {
    if (!has(t.customer)) continue;
    const row = by.get(String(t.customer)) ?? { customer: String(t.customer), name: null, orders: 0, stages: {} };
    row.orders += 1;
    row.stages[t.status?.stage ?? 'unknown'] = (row.stages[t.status?.stage ?? 'unknown'] ?? 0) + 1;
    by.set(row.customer, row);
  }
  for (const c of snapshot.customers ?? []) if (by.has(String(c.customer))) by.get(String(c.customer)).name = c.name ?? null;
  return [...by.values()].sort((a, b) => b.orders - a.orders);
}

/**
 * @param {object} data       the Customer 360 sample data (not changed)
 * @param {object} snapshot   the SAP sandbox snapshot
 * @param {{ customer: string, entity?: string, rates?: Record<string, number>, limit?: number }} options
 * @returns {{ data: object, orders: object[], skipped: { order: string, reason: string }[] }}
 */
export function mergeSandbox(data, snapshot, { customer, entity = 'nl-ma', rates = {}, limit = 6 } = {}) {
  if (!has(customer)) throw new Error('Name the sandbox customer to use.');
  if (!data.entities.some((e) => e.id === entity)) throw new Error(`Unknown company "${entity}".`);
  const contract = data.contracts.find((c) => c.entity === entity && c.status === 'Active') ?? data.contracts.find((c) => c.entity === entity);
  if (!contract) throw new Error(`Company "${entity}" has no contract to put the orders under.`);
  const traces = (snapshot.traces ?? []).filter((t) => String(t.customer) === String(customer));
  if (!traces.length) throw new Error(`The snapshot holds no traced order for customer ${customer}.`);

  const taken = new Set(data.orders.filter((o) => o.source !== 'sap-sandbox').map((o) => o.id));
  const orders = [], skipped = [];
  for (const t of traces.slice(0, limit)) {
    const currency = t.order?.currency || t.status?.currency || 'EUR';
    const rate = currency === 'EUR' ? 1 : rates[currency];
    if (!(rate > 0)) { skipped.push({ order: t.sales_order, reason: `amount is in ${currency}: give a demo rate for it` }); continue; }
    const net = Number(t.order?.net_amount);
    if (!Number.isFinite(net)) { skipped.push({ order: t.sales_order, reason: 'no net amount' }); continue; }
    const id = `SO-${t.sales_order}`;
    if (taken.has(id)) { skipped.push({ order: t.sales_order, reason: 'the number is already used by a sample order' }); continue; }
    const stage = t.status?.stage ?? 'unknown';
    const gap = Number(t.status?.gap_amount) || 0;
    const items = t.items?.count ?? t.items?.first?.length ?? 0;
    const material = t.items?.first?.find((i) => has(i.material))?.material;
    const docs = [
      ...(t.deliveries ?? []).map((d) => `delivery ${d.delivery}`),
      ...(t.billings ?? []).filter((b) => !b.cancelled).map((b) => `invoice ${b.billing_document}`),
    ];
    orders.push({
      id, entity, contract: contract.id,
      title: `SAP sales order ${t.sales_order}${items ? `, ${items} item${items === 1 ? '' : 's'}` : ''}${material ? `, material ${material}` : ''}`,
      netEur: round(net * rate), orderedOn: day(t.order?.created) ?? data.asOf,
      provisioned: true, billed: null,
      note: `SAP sandbox: ${STAGE_TEXT[stage] ?? stage}${docs.length ? ` (${docs.join(', ')})` : ''}.${currency === 'EUR' ? '' : ` Amount converted from ${currency} at the demo rate ${rate}.`}`,
      source: 'sap-sandbox',
      sap: { order: String(t.sales_order), stage, gapEur: round(gap * rate), currency, deliveries: (t.deliveries ?? []).map((d) => String(d.delivery)), billings: (t.billings ?? []).filter((b) => !b.cancelled).map((b) => String(b.billing_document)) },
    });
  }
  const next = JSON.parse(JSON.stringify(data));
  next.orders = [...next.orders.filter((o) => o.source !== 'sap-sandbox'), ...orders]; // running it again replaces the earlier merge
  return { data: next, orders, skipped };
}

/** The sample data without any merged sandbox order. */
export function removeSandbox(data) {
  const next = JSON.parse(JSON.stringify(data));
  next.orders = next.orders.filter((o) => o.source !== 'sap-sandbox');
  return next;
}
