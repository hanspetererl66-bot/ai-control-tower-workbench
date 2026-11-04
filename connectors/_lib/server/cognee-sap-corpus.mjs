/**
 * Turns a SAP sandbox snapshot (scripts/sap-sandbox-snapshot.mjs) into plain-text documents for Cognee:
 * one short document per customer, sales order, delivery, invoice and material, with facts and connections as sentences.
 * Identifiers stay in brackets (sap-order:5), the same convention as the sample graph, so Cognee keeps them in the entity names.
 * Pure; nothing here needs Cognee or the network.
 */

const sentence = (text) => `${String(text).replace(/\s+/g, ' ').trim().replace(/[.;:]+$/, '')}.`;
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const day = (v) => (has(v) ? String(v).slice(0, 10) : null);
const money = (amount, currency) => (has(amount) ? `${amount}${currency ? ` ${currency}` : ''}` : null);
const words = (stage) => String(stage ?? '').replaceAll('_', ' ');

const ref = {
  customer: (id) => `sap-customer:${id}`,
  order: (id) => `sap-order:${id}`,
  delivery: (id) => `sap-delivery:${id}`,
  invoice: (id) => `sap-invoice:${id}`,
  material: (id) => `sap-material:${id}`,
};

/** @returns {{ id: string, name: string, text: string }[]} */
export function snapshotToDocuments(snapshot) {
  const docs = new Map();
  const doc = (id, name) => docs.get(id) ?? docs.set(id, { id, name, lines: [] }).get(id);
  const add = (id, name, text) => { if (text) doc(id, name).lines.push(sentence(text)); };

  const nameOf = new Map();
  for (const c of snapshot.customers ?? []) if (has(c.customer)) nameOf.set(String(c.customer), has(c.name) ? c.name : `Customer ${c.customer}`);
  const customerLabel = (id) => nameOf.get(String(id)) ?? `Customer ${id}`;

  for (const c of snapshot.customers ?? []) {
    if (!has(c.customer)) continue;
    const id = ref.customer(c.customer);
    const label = customerLabel(c.customer);
    add(id, label, `${label} is a SAP sandbox Customer (${id}), business partner ${c.customer}`);
    add(id, label, has(c.country) && `${label}: country is ${c.country}`);
    add(id, label, has(c.latest_order) && `${label}: latest order is from ${day(c.latest_order)}`);
    for (const [currency, t] of Object.entries(c.by_currency ?? {})) {
      add(id, label, `${label}: in ${currency}, ${t.orders} orders worth ${t.ordered} were read, ${t.invoiced} invoiced and ${t.open_to_invoice} not yet fully invoiced`);
    }
    for (const a of c.needs_attention ?? []) {
      add(id, label, `${label} has order ${a.sales_order} (${ref.order(a.sales_order)}) that needs attention: ${words(a.stage)}`);
    }
  }

  for (const t of snapshot.traces ?? []) {
    const oid = ref.order(t.sales_order);
    const oname = `Sales order ${t.sales_order}`;
    const cust = has(t.customer) ? { id: ref.customer(t.customer), label: customerLabel(t.customer) } : null;
    add(oid, oname, `${oname} is a SAP sandbox Sales order (${oid})`);
    add(oid, oname, has(t.order?.type) && `${oname}: order type is ${t.order.type}`);
    add(oid, oname, has(t.order?.created) && `${oname}: created on ${day(t.order.created)}`);
    add(oid, oname, money(t.order?.net_amount, t.order?.currency) && `${oname}: net amount is ${money(t.order.net_amount, t.order.currency)}`);
    add(oid, oname, has(t.order?.delivery_status) && `${oname}: delivery status is ${t.order.delivery_status}`);
    add(oid, oname, has(t.order?.billing_status) && `${oname}: billing status is ${t.order.billing_status}`);
    add(oid, oname, t.status && `${oname}: order-to-cash stage is ${words(t.status.stage)}. ${t.status.message}`);
    if (t.status && t.status.gap_amount > 0) add(oid, oname, `${oname}: ${money(t.status.gap_amount, t.status.currency)} is not yet invoiced`);
    if (cust) {
      add(oid, oname, `${oname} was placed by ${cust.label} (${cust.id})`);
      add(cust.id, cust.label, `${cust.label} has order ${t.sales_order} (${oid})`);
    }
    for (const it of t.items?.first ?? []) {
      if (!has(it.material)) continue;
      const mid = ref.material(it.material);
      add(oid, oname, `${oname} contains material ${it.material} (${mid}), quantity ${it.quantity ?? 'unknown'}`);
      add(mid, `Material ${it.material}`, `Material ${it.material} is a SAP sandbox Material (${mid})`);
      add(mid, `Material ${it.material}`, `Material ${it.material} is part of sales order ${t.sales_order} (${oid})`);
    }
    for (const d of t.deliveries ?? []) {
      const did = ref.delivery(d.delivery);
      const dname = `Delivery ${d.delivery}`;
      add(oid, oname, `${oname} has delivery ${d.delivery} (${did})`);
      add(did, dname, `${dname} is a SAP sandbox Delivery (${did}) for sales order ${t.sales_order} (${oid})`);
      add(did, dname, d.goods_issued ? `${dname}: goods issue was posted${has(d.goods_issue_date) ? ` on ${day(d.goods_issue_date)}` : ''}` : `${dname}: goods issue is not posted yet`);
    }
    for (const b of t.billings ?? []) {
      const bid = ref.invoice(b.billing_document);
      const bname = `Invoice ${b.billing_document}`;
      add(oid, oname, `${oname} has invoice ${b.billing_document} (${bid})`);
      add(bid, bname, `${bname} is a SAP sandbox Invoice (${bid}) for sales order ${t.sales_order} (${oid})`);
      add(bid, bname, money(b.amount, b.currency) && `${bname}: amount is ${money(b.amount, b.currency)}`);
      add(bid, bname, has(b.date) && `${bname}: billing date is ${day(b.date)}`);
      add(bid, bname, b.cancelled && `${bname}: was cancelled`);
      if (cust) add(cust.id, cust.label, `${cust.label} was invoiced with ${bname} (${bid})`);
    }
  }

  return [...docs.values()].map((d) => ({ id: d.id, name: d.name, text: d.lines.join('\n') }));
}
