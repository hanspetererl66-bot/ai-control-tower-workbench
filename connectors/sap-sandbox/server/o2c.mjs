/**
 * Order-to-cash logic for the SAP sandbox connector: pure functions, no network.
 * Input is what the sandbox returned (already cleaned by cleanEntity); every field may be missing,
 * because the sandbox data is SAP's sample data and not every document is complete.
 */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const DAY = 86_400_000;
const daysBetween = (iso, now) => (has(iso) && !Number.isNaN(Date.parse(iso)) ? Math.max(0, Math.floor((now - Date.parse(iso)) / DAY)) : null);
const round2 = (n) => Math.round(n * 100) / 100;

/** SAP status letters of the overall delivery / billing status. */
export const STATUS_TEXT = { A: 'not started', B: 'partly', C: 'complete' };
const statusText = (v) => (has(v) ? (STATUS_TEXT[String(v).trim().toUpperCase()] ?? String(v)) : null);

/**
 * Where is this order in the chain, and what is stuck?
 * order: A_SalesOrder row. deliveries: [{ delivery, goods_issue_date, goods_issued }]. billings: [{ billing_document, date, amount, currency, cancelled }].
 */
export function classify({ order = {}, deliveries = [], billings = [] }, now = Date.now()) {
  const net = num(order.TotalNetAmount);
  const currency = order.TransactionCurrency ?? null;
  const live = billings.filter((b) => !b.cancelled);
  const billed = round2(live.reduce((s, b) => s + num(b.amount), 0));
  const issued = deliveries.filter((d) => d.goods_issued);
  const lastIssue = issued.map((d) => d.goods_issue_date).filter(has).sort().at(-1) ?? null;

  if (has(order.DeliveryBlockReason)) {
    return { stage: 'delivery_blocked', severity: 'stuck', message: `The order has a delivery block (${order.DeliveryBlockReason}).`, billed, gap_amount: net, currency, days_open: daysBetween(order.CreationDate, now) };
  }
  if (!deliveries.length) {
    const flag = String(order.OverallDeliveryStatus ?? '').toUpperCase();
    if (flag === 'C') return { stage: 'delivered_no_document_found', severity: 'watch', message: 'The order says "delivered", but no delivery document was found for it in the sandbox.', billed, gap_amount: net - billed, currency, days_open: daysBetween(order.CreationDate, now) };
    return { stage: 'not_delivered', severity: 'watch', message: 'No delivery yet.', billed, gap_amount: net, currency, days_open: daysBetween(order.CreationDate, now) };
  }
  if (!issued.length) {
    return { stage: 'goods_issue_open', severity: 'watch', message: 'A delivery exists, but the goods issue has not been posted.', billed, gap_amount: net, currency, days_open: daysBetween(order.CreationDate, now) };
  }
  if (!live.length) {
    return { stage: 'delivered_not_invoiced', severity: 'stuck', message: 'Goods are issued, but nothing was invoiced: revenue is waiting to be billed.', billed, gap_amount: net, currency, days_open: daysBetween(lastIssue, now) };
  }
  if (net > 0 && billed < net * 0.999) {
    return { stage: 'partly_invoiced', severity: 'watch', message: `Invoiced ${billed} of ${net}${currency ? ` ${currency}` : ''}.`, billed, gap_amount: round2(net - billed), currency, days_open: daysBetween(lastIssue, now) };
  }
  return { stage: 'invoiced', severity: 'ok', message: 'Delivered and fully invoiced.', billed, gap_amount: 0, currency, days_open: 0 };
}

/** One-line view of an order from its header status flags only (one request, no document flow). */
export function flagStage(order = {}) {
  const d = String(order.OverallDeliveryStatus ?? '').trim().toUpperCase();
  const b = String(order.OverallOrdReltdBillgStatus ?? '').trim().toUpperCase();
  let stage = 'open';
  if (has(order.DeliveryBlockReason)) stage = 'delivery_blocked';
  else if (d === 'C' && b !== 'C') stage = 'delivered_not_fully_invoiced';
  else if (d === 'C' && b === 'C') stage = 'invoiced';
  else if (d === 'B') stage = 'partly_delivered';
  else if (d === 'A' || d === '') stage = 'not_delivered';
  return {
    sales_order: order.SalesOrder ?? null,
    customer: order.SoldToParty ?? null,
    created: order.CreationDate ?? null,
    net_amount: has(order.TotalNetAmount) ? num(order.TotalNetAmount) : null,
    currency: order.TransactionCurrency ?? null,
    delivery_status: statusText(order.OverallDeliveryStatus),
    billing_status: statusText(order.OverallOrdReltdBillgStatus),
    stage,
    attention: stage === 'delivered_not_fully_invoiced' || stage === 'delivery_blocked',
  };
}

/** Customer 360 from what the sandbox holds: partner, orders, invoices. Payment behaviour is not in these APIs. */
export function summarizeCustomer({ partner = {}, customer = {}, orders = [], billings = [] }) {
  const byCurrency = {};
  const slot = (c) => (byCurrency[c ?? '?'] ??= { orders: 0, ordered: 0, invoiced: 0, open_to_invoice: 0 });
  for (const o of orders) {
    const s = slot(o.TransactionCurrency);
    s.orders += 1;
    s.ordered = round2(s.ordered + num(o.TotalNetAmount));
    if (String(o.OverallOrdReltdBillgStatus ?? '').toUpperCase() !== 'C') s.open_to_invoice = round2(s.open_to_invoice + num(o.TotalNetAmount));
  }
  for (const b of billings) {
    if (b.BillingDocumentIsCancelled === true || String(b.BillingDocumentIsCancelled).toLowerCase() === 'true') continue;
    const s = slot(b.TransactionCurrency);
    s.invoiced = round2(s.invoiced + num(b.TotalNetAmount));
  }
  const flags = orders.map(flagStage);
  return {
    customer: partner.BusinessPartner ?? customer.Customer ?? null,
    name: partner.BusinessPartnerFullName ?? partner.BusinessPartnerName ?? customer.CustomerName ?? customer.OrganizationBPName1 ?? null,
    country: customer.Country ?? null,
    orders_read: orders.length,
    invoices_read: billings.length,
    by_currency: byCurrency,
    needs_attention: flags.filter((f) => f.attention).map((f) => ({ sales_order: f.sales_order, stage: f.stage, net_amount: f.net_amount, currency: f.currency })),
    latest_order: orders.map((o) => o.CreationDate).filter(has).sort().at(-1) ?? null,
    payment_behaviour: 'not read: the sandbox sales and billing APIs hold no payment dates. Late-payment risk needs open items or clearing dates (see the Sub4Me late-payment forecast).',
  };
}
