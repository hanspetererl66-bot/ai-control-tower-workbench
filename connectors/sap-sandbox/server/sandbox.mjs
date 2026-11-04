/**
 * SAP Business Accelerator Hub sandbox connector: read-only OData V2 queries against the S/4HANA Cloud
 * sandbox (sandbox.api.sap.com) with the personal API key. No dependencies.
 * fetch and the environment are injected so tests never touch a network.
 * The key is sent only to sandbox.api.sap.com and never appears in results or errors.
 * Only GET is ever used. The sandbox data is SAP's fixed sample data and cannot be changed.
 */
import { classify, flagStage, summarizeCustomer, STATUS_TEXT } from './o2c.mjs';

export class SapSandboxError extends Error {}
const fatal = (message) => Object.assign(new SapSandboxError(message), { fatal: true });

export const DEFAULT_BASE = 'https://sandbox.api.sap.com/s4hanacloud';
const SANDBOX_HOST = 'sandbox.api.sap.com';
const ODATA_ROOT = '/sap/opu/odata/sap';
const MAX_TOP = 100;
const MAX_TEXT = 60_000;

/** Suggestions for the agent. Names follow the SAP API Business Hub; any other API_* service may be tried. Not verified against the sandbox. */
export const API_CATALOG = [
  { service: 'API_BUSINESS_PARTNER', entity_sets: ['A_BusinessPartner', 'A_Customer', 'A_Supplier', 'A_BusinessPartnerAddress'], about: 'Customers, suppliers and business partners.' },
  { service: 'API_SALES_ORDER_SRV', entity_sets: ['A_SalesOrder', 'A_SalesOrderItem'], about: 'Sales orders with items.' },
  { service: 'API_PURCHASEORDER_PROCESS_SRV', entity_sets: ['A_PurchaseOrder', 'A_PurchaseOrderItem'], about: 'Purchase orders with items.' },
  { service: 'API_BILLING_DOCUMENT_SRV', entity_sets: ['A_BillingDocument', 'A_BillingDocumentItem'], about: 'Billing documents (customer invoices).' },
  { service: 'API_OUTBOUND_DELIVERY_SRV', entity_sets: ['A_OutbDeliveryHeader', 'A_OutbDeliveryItem'], about: 'Outbound deliveries.' },
  { service: 'API_PRODUCT_SRV', entity_sets: ['A_Product', 'A_ProductDescription'], about: 'Products and materials.' },
  { service: 'API_SUPPLIERINVOICE_PROCESS_SRV', entity_sets: ['A_SupplierInvoice'], about: 'Supplier invoices.' },
  { service: 'API_MATERIAL_DOCUMENT_SRV', entity_sets: ['A_MaterialDocumentHeader', 'A_MaterialDocumentItem'], about: 'Goods movements.' },
  { service: 'API_JOURNALENTRYITEMBASIC_SRV', entity_sets: ['A_JournalEntryItemBasic'], about: 'Journal entry line items.' },
];

const NAME = /^[A-Za-z][A-Za-z0-9_]{1,80}$/;
const SERVICE = /^API_[A-Z0-9_]{2,80}$/;
const clip = (v, max = 400) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max - 1)}…` : v);

/** The base URL, only ever https on sandbox.api.sap.com, so the key cannot be sent anywhere else. */
export function baseOf(value) {
  const raw = String(value ?? '').trim() || DEFAULT_BASE;
  let url;
  try { url = new URL(raw); } catch { throw new SapSandboxError('SAP_SANDBOX_BASE is not a valid URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== SANDBOX_HOST || url.port) throw new SapSandboxError(`SAP_SANDBOX_BASE must be https://${SANDBOX_HOST}/... (the key is only sent there).`);
  return `https://${SANDBOX_HOST}${url.pathname.replace(/\/+$/, '')}`;
}

/** OData V2 date "/Date(1700000000000)/" to an ISO string; other values are returned unchanged. */
export function fixDate(v) {
  const m = typeof v === 'string' ? /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(v) : null;
  return m ? new Date(Number(m[1])).toISOString() : v;
}

/** One entity as a plain object: no __metadata, no deferred navigation links, readable dates. */
export function cleanEntity(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === '__metadata' || (v && typeof v === 'object' && '__deferred' in v)) continue;
    if (v && typeof v === 'object' && Array.isArray(v.results)) out[k] = v.results.map(cleanEntity);
    else if (v && typeof v === 'object') out[k] = cleanEntity(v);
    else out[k] = clip(fixDate(v), 300);
  }
  return out;
}

function service(args) {
  const s = String(args.service ?? '').trim();
  if (!SERVICE.test(s)) throw new SapSandboxError('service must be an SAP API name such as API_SALES_ORDER_SRV (see sap_sandbox_list_apis).');
  return s;
}
function entitySet(args) {
  const e = String(args.entity_set ?? '').trim();
  if (!NAME.test(e)) throw new SapSandboxError('entity_set must be an entity set name such as A_SalesOrder (see sap_sandbox_list_entity_sets).');
  return e;
}
const optionText = (value, name, max = 500) => {
  if (value === undefined || value === null || value === '') return undefined;
  const t = String(value).trim();
  if (t.length > max) throw new SapSandboxError(`${name} is too long.`);
  return t;
};

/** The key part of a single-entity request: ('1000') for one value, F1='a',F2='b' for a composite key. */
export function keyPart(key) {
  const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const bad = (v) => !/^[^\u0000-\u001f]{1,100}$/.test(String(v));
  if (typeof key === 'string' || typeof key === 'number') {
    if (bad(key)) throw new SapSandboxError('key is empty or too long.');
    return `(${quote(key)})`;
  }
  if (key && typeof key === 'object' && !Array.isArray(key)) {
    const parts = Object.entries(key);
    if (!parts.length || parts.length > 6) throw new SapSandboxError('key needs one to six fields.');
    return `(${parts.map(([f, v]) => { if (!NAME.test(f) || bad(v)) throw new SapSandboxError('key fields must be names with short text values.'); return `${f}=${quote(v)}`; }).join(',')})`;
  }
  throw new SapSandboxError('key is required: one value, or an object with the key fields.');
}

export function createSandboxHandlers({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const key = () => {
    const k = String(env.SAP_API_KEY ?? '').trim();
    if (!k) throw new SapSandboxError('SAP_API_KEY is missing. Log in at api.sap.com, open your profile, "Show API Key", and enter it in the connector settings.');
    return k;
  };

  async function get(path, query = {}) {
    const k = key();
    const base = baseOf(env.SAP_SANDBOX_BASE);
    const parts = Object.entries({ $format: 'json', ...query }).filter(([, v]) => v !== undefined).map(([n, v]) => `${n}=${encodeURIComponent(v)}`);
    const url = `${base}${ODATA_ROOT}/${path}?${parts.join('&')}`;
    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', headers: { APIKey: k, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      throw fatal(`Could not reach the SAP sandbox: ${String(error.message).split(k).join('***')}`);
    }
    if (response.status === 401 || response.status === 403) throw fatal(`The sandbox does not accept the API key (HTTP ${response.status}). Copy it again from api.sap.com (profile, "Show API Key").`);
    if (response.status === 404) throw new SapSandboxError('The sandbox did not find that (HTTP 404): wrong service, entity set or key. Check sap_sandbox_list_apis and sap_sandbox_list_entity_sets; not every API is offered in the sandbox.');
    if (response.status === 429) throw fatal('The sandbox asks to slow down (rate limit). Try again in a minute.');
    if (!response.ok) {
      let detail = '';
      try { const b = await response.json(); detail = String(b?.error?.message?.value ?? b?.error?.message ?? ''); } catch { /* no body */ }
      throw new SapSandboxError(`The sandbox answered HTTP ${response.status}${detail ? `: ${detail.slice(0, 250)}` : ''}`);
    }
    try { return await response.json(); } catch { throw new SapSandboxError('The sandbox did not answer with JSON.'); }
  }

  const rows = async (svc, ent, query) => ((await get(`${svc}/${ent}`, query))?.d?.results ?? []).map(cleanEntity);
  const one = async (svc, ent, keyValue) => cleanEntity((await get(`${svc}/${ent}${keyPart(keyValue)}`))?.d);
  const orFilter = (field, values) => values.map((v) => `${field} eq '${v}'`).join(' or ');
  const safeId = (v) => (/^[A-Za-z0-9]{1,20}$/.test(String(v ?? '')) ? String(v) : null);
  const docNo = (v, name) => { const id = safeId(String(v ?? '').trim()); if (!id) throw new SapSandboxError(`${name} must be a document or partner number (letters and digits only).`); return id; };
  /** A step that may fail without spoiling the rest (the sandbox does not offer every API or field). Key, network and rate-limit errors still stop everything. */
  const attempt = async (label, fn, notes, fallback) => {
    try { return await fn(); } catch (error) {
      if (!(error instanceof SapSandboxError) || error.fatal) throw error;
      notes.push(`${label}: ${error.message}`);
      return fallback;
    }
  };
  const uniq = (list, field) => [...new Set(list.map((r) => safeId(r[field])).filter(Boolean))];

  return {
    async sap_sandbox_check_connection() {
      const res = await get('API_BUSINESS_PARTNER/A_BusinessPartner', { $top: 1, $select: 'BusinessPartner' });
      const n = res?.d?.results?.length ?? 0;
      return { ok: true, base: baseOf(env.SAP_SANDBOX_BASE), sample_rows: n, note: 'The key works. The sandbox holds fixed SAP sample data and is read only here.' };
    },
    async sap_sandbox_list_apis() {
      return { count: API_CATALOG.length, apis: API_CATALOG, note: 'Suggestions. Any other API_* service of the SAP API Business Hub may be tried; the sandbox does not offer every API.' };
    },
    async sap_sandbox_list_entity_sets(args) {
      const s = service(args);
      const res = await get(`${s}/`);
      const sets = res?.d?.EntitySets ?? [];
      return { service: s, count: sets.length, entity_sets: sets };
    },
    async sap_sandbox_query(args) {
      const s = service(args);
      const e = entitySet(args);
      const top = Math.min(MAX_TOP, Math.max(1, Number.isInteger(args.top) ? args.top : 20));
      const skip = Number.isInteger(args.skip) && args.skip > 0 ? args.skip : undefined;
      const res = await get(`${s}/${e}`, {
        $top: top,
        $skip: skip,
        $filter: optionText(args.filter, 'filter'),
        $select: optionText(args.select, 'select', 300),
        $orderby: optionText(args.orderby, 'orderby', 200),
        $expand: optionText(args.expand, 'expand', 200),
        $inlinecount: args.count === true ? 'allpages' : undefined,
      });
      const rows = (res?.d?.results ?? []).map(cleanEntity);
      const total = res?.d?.__count !== undefined ? Number(res.d.__count) : undefined;
      let text = JSON.stringify(rows);
      let shown = rows;
      while (text.length > MAX_TEXT && shown.length > 1) { shown = shown.slice(0, Math.ceil(shown.length / 2)); text = JSON.stringify(shown); }
      return { service: s, entity_set: e, count: shown.length, total, truncated: shown.length < rows.length || undefined, rows: shown };
    },
    async sap_sandbox_get(args) {
      const s = service(args);
      const e = entitySet(args);
      const res = await get(`${s}/${e}${keyPart(args.key)}`, { $select: optionText(args.select, 'select', 300), $expand: optionText(args.expand, 'expand', 200) });
      return { service: s, entity_set: e, entity: cleanEntity(res?.d) };
    },

    async sap_sandbox_o2c_scan(args) {
      const top = Math.min(50, Math.max(1, Number.isInteger(args.top) ? args.top : 25));
      const filter = args.customer ? `SoldToParty eq '${docNo(args.customer, 'customer')}'` : undefined;
      const flagged = (await rows('API_SALES_ORDER_SRV', 'A_SalesOrder', { $top: top, $orderby: 'CreationDate desc', $filter: filter })).map(flagStage);
      const list = args.only_attention === true ? flagged.filter((o) => o.attention) : flagged;
      return { read: flagged.length, attention: flagged.filter((o) => o.attention).length, orders: list, note: 'Stage comes from the status flags of the order header only; use sap_sandbox_order_to_cash for the document chain of one order.' };
    },
    async sap_sandbox_order_to_cash(args) {
      const so = docNo(args.sales_order, 'sales_order');
      const notes = [];
      const order = await one('API_SALES_ORDER_SRV', 'A_SalesOrder', so);
      const items = await attempt('items', () => rows('API_SALES_ORDER_SRV', 'A_SalesOrderItem', { $filter: `SalesOrder eq '${so}'`, $top: 50 }), notes, []);
      const dItems = await attempt('deliveries', () => rows('API_OUTBOUND_DELIVERY_SRV', 'A_OutbDeliveryItem', { $filter: `ReferenceSDDocument eq '${so}'`, $top: 100 }), notes, []);
      const delNos = uniq(dItems, 'DeliveryDocument').slice(0, 5);
      const dHeads = delNos.length ? await attempt('delivery headers', () => rows('API_OUTBOUND_DELIVERY_SRV', 'A_OutbDeliveryHeader', { $filter: orFilter('DeliveryDocument', delNos) }), notes, []) : [];
      const orderDelivered = String(order.OverallDeliveryStatus ?? '').toUpperCase() === 'C';
      const deliveries = delNos.map((no) => {
        const h = dHeads.find((x) => x.DeliveryDocument === no);
        const date = h?.ActualGoodsMovementDate ?? null;
        return { delivery: no, goods_issue_date: date, goods_issued: h ? (String(h.OverallGoodsMovementStatus ?? '').toUpperCase() === 'C' || Boolean(date)) : orderDelivered };
      });
      const bItems = await attempt('billing items', () => rows('API_BILLING_DOCUMENT_SRV', 'A_BillingDocumentItem', { $filter: orFilter('ReferenceSDDocument', [so, ...delNos]), $top: 100 }), notes, []);
      const bNos = uniq(bItems, 'BillingDocument').slice(0, 5);
      const bHeads = bNos.length ? await attempt('billing documents', () => rows('API_BILLING_DOCUMENT_SRV', 'A_BillingDocument', { $filter: orFilter('BillingDocument', bNos) }), notes, []) : [];
      const billings = bNos.map((no) => {
        const h = bHeads.find((x) => x.BillingDocument === no);
        const fromItems = bItems.filter((i) => i.BillingDocument === no).reduce((sum, i) => sum + (Number(i.NetAmount) || 0), 0);
        return { billing_document: no, date: h?.BillingDocumentDate ?? null, amount: h ? h.TotalNetAmount : fromItems, currency: h?.TransactionCurrency ?? order.TransactionCurrency ?? null, cancelled: h ? (h.BillingDocumentIsCancelled === true || String(h.BillingDocumentIsCancelled).toLowerCase() === 'true') : false };
      });
      return {
        sales_order: so,
        customer: order.SoldToParty ?? null,
        order: { type: order.SalesOrderType ?? null, created: order.CreationDate ?? null, net_amount: order.TotalNetAmount ?? null, currency: order.TransactionCurrency ?? null, delivery_status: STATUS_TEXT[String(order.OverallDeliveryStatus ?? '').toUpperCase()] ?? order.OverallDeliveryStatus ?? null, billing_status: STATUS_TEXT[String(order.OverallOrdReltdBillgStatus ?? '').toUpperCase()] ?? order.OverallOrdReltdBillgStatus ?? null },
        items: { count: items.length, first: items.slice(0, 10).map((i) => ({ item: i.SalesOrderItem ?? null, material: i.Material ?? null, quantity: i.RequestedQuantity ?? null, net_amount: i.NetAmount ?? null })) },
        deliveries,
        billings,
        status: classify({ order, deliveries, billings }),
        notes,
      };
    },
    async sap_sandbox_customer_360(args) {
      const c = docNo(args.customer, 'customer');
      const notes = [];
      const partner = await attempt('business partner', () => one('API_BUSINESS_PARTNER', 'A_BusinessPartner', c), notes, {});
      const customer = await attempt('customer', () => one('API_BUSINESS_PARTNER', 'A_Customer', c), notes, {});
      const orders = await attempt('sales orders', () => rows('API_SALES_ORDER_SRV', 'A_SalesOrder', { $filter: `SoldToParty eq '${c}'`, $orderby: 'CreationDate desc', $top: 20 }), notes, []);
      const billings = await attempt('billing documents', () => rows('API_BILLING_DOCUMENT_SRV', 'A_BillingDocument', { $filter: `SoldToParty eq '${c}'`, $orderby: 'BillingDocumentDate desc', $top: 20 }), notes, []);
      const found = Boolean(Object.keys(partner).length || Object.keys(customer).length || orders.length || billings.length);
      return { found, ...summarizeCustomer({ partner, customer, orders, billings }), recent_orders: orders.slice(0, 10).map(flagStage), notes };
    },
  };
}

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const SVC = { type: 'string', description: 'SAP API name, e.g. API_SALES_ORDER_SRV.' };
const ENT = { type: 'string', description: 'Entity set, e.g. A_SalesOrder.' };
export const TOOL_DEFINITIONS = [
  { name: 'sap_sandbox_check_connection', description: 'Check the SAP API key against the S/4HANA sandbox with one small business partner request. Read only.', inputSchema: obj({}) },
  { name: 'sap_sandbox_list_apis', description: 'List the suggested S/4HANA APIs and their main entity sets (sales orders, purchase orders, business partners, billing, products, journal entries). Local list, no request.', inputSchema: obj({}) },
  { name: 'sap_sandbox_list_entity_sets', description: 'List the entity sets of one S/4HANA API in the sandbox. Read only.', inputSchema: obj({ service: SVC }, ['service']) },
  { name: 'sap_sandbox_query', description: 'Read rows of an entity set with OData V2 options (filter, select, orderby, expand, top, skip, count). At most 100 rows. Read only; the sandbox cannot be changed.', inputSchema: obj({ service: SVC, entity_set: ENT, filter: { type: 'string', description: "OData $filter, e.g. \"SoldToParty eq '10100001' and TotalNetAmount gt 1000\"." }, select: { type: 'string', description: 'Comma-separated fields to return.' }, orderby: { type: 'string', description: 'e.g. "CreationDate desc".' }, expand: { type: 'string', description: 'Navigation property, e.g. "to_Item".' }, top: { type: 'integer', description: '1 to 100 (default 20).' }, skip: { type: 'integer', description: 'Rows to skip.' }, count: { type: 'boolean', description: 'Also return the total number of matching rows.' } }, ['service', 'entity_set']) },
  { name: 'sap_sandbox_get', description: 'Read one entity by key, e.g. one sales order. Key = one value, or an object with the key fields for a composite key. Read only.', inputSchema: obj({ service: SVC, entity_set: ENT, key: { description: "One key value ('1' becomes ('1')) or an object like {\"SalesOrder\":\"1\",\"SalesOrderItem\":\"10\"}.", oneOf: [{ type: 'string' }, { type: 'object' }] }, select: { type: 'string', description: 'Comma-separated fields to return.' }, expand: { type: 'string', description: 'Navigation property to include.' } }, ['service', 'entity_set', 'key']) },
  { name: 'sap_sandbox_o2c_scan', description: 'Order-to-cash overview: the latest sales orders with delivery and billing status from the order header, and which ones need attention (delivered but not fully invoiced, delivery blocked). One request. Read only.', inputSchema: obj({ customer: { type: 'string', description: 'Only this sold-to party (customer number).' }, top: { type: 'integer', description: '1 to 50 (default 25).' }, only_attention: { type: 'boolean', description: 'Return only the orders that need attention.' } }) },
  { name: 'sap_sandbox_order_to_cash', description: 'Trace one sales order through delivery, goods issue and invoice, and say where it is stuck and how much is not yet invoiced. Steps the sandbox does not offer are listed in "notes". Read only.', inputSchema: obj({ sales_order: { type: 'string', description: 'Sales order number.' } }, ['sales_order']) },
  { name: 'sap_sandbox_customer_360', description: 'One customer from business partner, sales orders and invoices: totals per currency, orders needing attention, latest order. Payment behaviour is not part of these APIs. Read only.', inputSchema: obj({ customer: { type: 'string', description: 'Customer / business partner number.' } }, ['customer']) },
];
