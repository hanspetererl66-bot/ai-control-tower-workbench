#!/usr/bin/env node
/**
 * SAP mock — MCP server over stdio. No dependencies.
 * Newline-delimited JSON-RPC 2.0, as used by MCP's stdio transport.
 * stdout carries protocol messages only; diagnostics go to stderr.
 *
 * A stand-in for an S/4HANA purchasing API in demos. All data is fictional.
 * Reading is free. Writing is a two-step gate enforced here, not only by the client:
 *   1. draft_expedite_request / draft_supplier_inquiry / draft_accrual_posting  -> changes nothing, returns a draft and a token
 *   2. submit_draft with confirmed=true and that token  -> posts once, writes an audit entry
 * State is in memory; restart the agent to reset the demo.
 */
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  ALTERNATIVES,
  BUYERS,
  COMPANY_CODES,
  GRIR_ITEMS,
  classifyGrir,
  LANE_CONGESTION,
  MATERIALS,
  PLANTS,
  PURCHASE_ORDERS,
  VENDORS,
  vendorOf,
} from './data.mjs';

const SERVER_INFO = { name: 'sap-mock', version: '0.1.0' };
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DRAFT_TTL_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

class ToolError extends Error {}

/* ---------------- time ---------------- */

/** SAP_MOCK_TODAY=YYYY-MM-DD pins "today" so a recorded demo can be repeated exactly. */
function today() {
  const pinned = process.env.SAP_MOCK_TODAY?.trim();
  if (pinned) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pinned) || Number.isNaN(Date.parse(pinned))) {
      throw new Error('SAP_MOCK_TODAY must be an ISO date such as 2026-10-27');
    }
    return new Date(`${pinned}T00:00:00Z`);
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const isoDay = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);

/* ---------------- state ---------------- */

const nonce = randomBytes(16).toString('hex');
const drafts = new Map();
const audit = [];
const expedites = new Map(); // po -> { requestedDate, reason, changeDocument }
const inquiries = [];
const accruals = new Map(); // `${po}-${item}` -> { amountEur, accrualDocument, changeDocument }
let accrualSequence = 0;
let sequence = 0;
let changeSequence = 0;

function record(action, details) {
  const entry = { seq: audit.length + 1, at: new Date().toISOString(), action, ...details };
  audit.push(entry);
  const file = process.env.SAP_MOCK_AUDIT_LOG?.trim();
  if (file) {
    try {
      appendFileSync(file, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      console.error('audit log write failed:', error.message);
    }
  }
  return entry;
}

const tokenFor = (draft) =>
  createHash('sha256').update(`${nonce}|${draft.id}|${JSON.stringify(draft.payload)}`).digest('hex').slice(0, 12);

/* ---------------- views ---------------- */

const buyerName = (id) => BUYERS.find((buyer) => buyer.id === id)?.name ?? id;
const plantName = (id) => PLANTS.find((plant) => plant.id === id)?.name ?? id;
const materialOf = (id) => MATERIALS.find((material) => material.id === id);

function materialize(row, base) {
  const vendor = vendorOf(row.vendor);
  const expedite = expedites.get(row.po);
  return {
    po_number: row.po,
    item: row.item,
    material: row.material,
    material_description: materialOf(row.material)?.description ?? '',
    vendor_id: row.vendor,
    vendor_name: vendor.name,
    plant: row.plant,
    plant_name: plantName(row.plant),
    buyer_id: row.buyer,
    buyer_name: buyerName(row.buyer),
    quantity: row.qty,
    unit_price_eur: row.unitPriceEur,
    net_value_eur: Math.round(row.qty * row.unitPriceEur * 100) / 100,
    order_date: isoDay(addDays(base, row.orderOffset)),
    requested_delivery_date: isoDay(addDays(base, row.requestedOffset)),
    confirmed_delivery_date: isoDay(addDays(base, row.confirmedOffset)),
    days_confirmed_after_requested: Math.max(row.confirmedOffset - row.requestedOffset, 0),
    inbound_lane: row.lane,
    status: row.status,
    // ZZ_EXPEDITE_FLAG is a custom field on the PO item. It is the same column that appears as schema drift in the Databricks demo.
    ZZ_EXPEDITE_FLAG: expedite ? 'X' : '',
    expedite_requested_date: expedite?.requestedDate ?? null,
  };
}

const summary = (po) => ({
  po_number: po.po_number,
  item: po.item,
  vendor_id: po.vendor_id,
  vendor_name: po.vendor_name,
  material: po.material,
  material_description: po.material_description,
  plant: po.plant,
  buyer_id: po.buyer_id,
  quantity: po.quantity,
  net_value_eur: po.net_value_eur,
  requested_delivery_date: po.requested_delivery_date,
  confirmed_delivery_date: po.confirmed_delivery_date,
  status: po.status,
  ZZ_EXPEDITE_FLAG: po.ZZ_EXPEDITE_FLAG,
});

const grirKey = (row) => `${row.po}-${row.item}`;
const round2 = (value) => Math.round(value * 100) / 100;

function grirView(row, base) {
  const posted = accruals.get(grirKey(row));
  const open = round2(row.grValueEur - row.invoicedValueEur);
  const classification = classifyGrir(row);
  return {
    po_number: row.po,
    item: row.item,
    company_code: row.companyCode,
    vendor_id: row.vendor,
    vendor_name: vendorOf(row.vendor).name,
    description: row.description,
    goods_receipt_date: isoDay(addDays(base, row.grOffset)),
    age_days: -row.grOffset,
    goods_receipt_value_eur: row.grValueEur,
    invoiced_value_eur: row.invoicedValueEur,
    open_value_eur: open,
    classification,
    accrued_eur: posted?.amountEur ?? 0,
    accrual_document: posted?.accrualDocument ?? null,
  };
}

/* ---------------- argument helpers ---------------- */

function optionalString(args, key, max = 200) {
  if (args[key] === undefined) return undefined;
  if (typeof args[key] !== 'string' || !args[key].trim()) throw new ToolError(`${key} must be a non-empty string`);
  // Free text comes from the model: keep it printable and bounded.
  const clean = args[key].replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  if (clean.length > max) throw new ToolError(`${key} must be at most ${max} characters`);
  return clean;
}

function requiredString(args, key, max) {
  const value = optionalString(args, key, max);
  if (value === undefined) throw new ToolError(`${key} is required`);
  return value;
}

function findPo(args) {
  const number = requiredString(args, 'po_number', 20);
  if (!/^45\d{8}$/.test(number)) throw new ToolError('po_number must look like 4500001001');
  const row = PURCHASE_ORDERS.find((candidate) => candidate.po === number);
  if (!row) throw new ToolError(`Purchase order ${number} was not found`);
  return row;
}

/* ---------------- tools ---------------- */

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const DRAFT_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: 'list_purchase_orders',
    description:
      'List purchase orders (demo data) with vendor, material, requested and confirmed delivery dates. Filter by buyer_id (for example B-100), vendor_id, plant or status. ' +
      'Use it to see what a buyer owns. It does not score delay risk; that comes from the Databricks risk function.',
    inputSchema: {
      type: 'object',
      properties: {
        buyer_id: { type: 'string', description: 'Buyer id such as B-100.' },
        vendor_id: { type: 'string', description: 'Vendor id such as V-1001.' },
        plant: { type: 'string', description: 'Plant id such as 1010.' },
        status: { type: 'string', enum: ['OPEN', 'PARTIALLY_DELIVERED'], description: 'Order status.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum rows, default 20.' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List purchase orders', ...READ_ONLY },
  },
  {
    name: 'get_purchase_order',
    description:
      'Get one purchase order by po_number with vendor performance, delivery dates and the ZZ_EXPEDITE_FLAG custom field. Use it before drafting any request about that order.',
    inputSchema: {
      type: 'object',
      properties: { po_number: { type: 'string', description: 'Ten-digit purchase order number such as 4500001007.' } },
      required: ['po_number'],
      additionalProperties: false,
    },
    annotations: { title: 'Get purchase order', ...READ_ONLY },
  },
  {
    name: 'list_alternative_suppliers',
    description:
      'List qualified alternative suppliers for a material, with price difference, lead time and on-time-in-full rate. Use it before drafting a supplier inquiry.',
    inputSchema: {
      type: 'object',
      properties: { material: { type: 'string', description: 'Material id such as M-2001.' } },
      required: ['material'],
      additionalProperties: false,
    },
    annotations: { title: 'List alternative suppliers', ...READ_ONLY },
  },
  {
    name: 'draft_expedite_request',
    description:
      'Prepare an expedite request for one purchase order. This DOES NOT post anything: it returns a draft with a draft_id and a confirmation_token. ' +
      'Show the draft to the person and wait for their explicit yes before calling submit_draft.',
    inputSchema: {
      type: 'object',
      properties: {
        po_number: { type: 'string', description: 'Ten-digit purchase order number.' },
        requested_date: { type: 'string', description: 'New requested delivery date, YYYY-MM-DD, within the next 60 days. Optional; defaults to the original requested date.' },
        reason: { type: 'string', description: 'Business reason for the vendor, at most 500 characters. No personal data.' },
      },
      required: ['po_number', 'reason'],
      additionalProperties: false,
    },
    annotations: { title: 'Draft expedite request', ...DRAFT_ONLY },
  },
  {
    name: 'draft_supplier_inquiry',
    description:
      'Prepare an inquiry to an alternative supplier for the material of a purchase order. This DOES NOT send anything: it returns a draft with a draft_id and a confirmation_token. ' +
      'Show the draft to the person and wait for their explicit yes before calling submit_draft.',
    inputSchema: {
      type: 'object',
      properties: {
        po_number: { type: 'string', description: 'Ten-digit purchase order number the inquiry is about.' },
        alternative_vendor_id: { type: 'string', description: 'Vendor id from list_alternative_suppliers.' },
        message: { type: 'string', description: 'Message to the supplier, at most 1000 characters. No personal data.' },
      },
      required: ['po_number', 'alternative_vendor_id', 'message'],
      additionalProperties: false,
    },
    annotations: { title: 'Draft supplier inquiry', ...DRAFT_ONLY },
  },
  {
    name: 'get_open_grir_items',
    description:
      'List goods received but not fully invoiced (GR/IR) for a company code, as SAP holds them: received value, invoiced value, open value, age and whether an accrual was already posted. ' +
      'Use it to check a figure from the lakehouse against the system of record before drafting an accrual.',
    inputSchema: {
      type: 'object',
      properties: {
        company_code: { type: 'string', description: 'Company code DE01, PL01 or FR01. Omit for all.' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List open GR/IR items', ...READ_ONLY },
  },
  {
    name: 'draft_accrual_posting',
    description:
      'Prepare an accrual for goods received and not yet invoiced on one purchase order item. This DOES NOT post anything: it returns a draft with a draft_id and a confirmation_token. ' +
      'The amount may not exceed the open GR/IR value. Show the draft to the person and wait for their explicit yes before calling submit_draft.',
    inputSchema: {
      type: 'object',
      properties: {
        po_number: { type: 'string', description: 'Ten-digit purchase order number from the GR/IR list.' },
        item: { type: 'string', description: 'Item number, for example 10.' },
        amount_eur: { type: 'number', description: 'Accrual amount in EUR, more than 0 and at most the open GR/IR value.' },
        reason: { type: 'string', description: 'Business reason for the posting text, at most 300 characters. No personal data.' },
      },
      required: ['po_number', 'item', 'amount_eur', 'reason'],
      additionalProperties: false,
    },
    annotations: { title: 'Draft accrual posting', ...DRAFT_ONLY },
  },
  {
    name: 'submit_draft',
    description:
      'WRITE. Post a draft created by draft_expedite_request, draft_supplier_inquiry or draft_accrual_posting. Call it only after the person has seen the draft and clearly said yes in this conversation. ' +
      'Requires the draft_id, the confirmation_token from the draft and confirmed=true. Each draft can be posted once.',
    inputSchema: {
      type: 'object',
      properties: {
        draft_id: { type: 'string', description: 'Draft id such as DRAFT-0001.' },
        confirmation_token: { type: 'string', description: 'Token returned with the draft.' },
        confirmed: { type: 'boolean', description: 'Must be true, and only when the person has approved this exact draft.' },
      },
      required: ['draft_id', 'confirmation_token', 'confirmed'],
      additionalProperties: false,
    },
    annotations: { title: 'Submit draft (write)', ...WRITE },
  },
  {
    name: 'get_audit_log',
    description: 'Every draft, submission and rejection since the server started, newest last. Use it to show what was and was not posted.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum entries, default 20.' } },
      additionalProperties: false,
    },
    annotations: { title: 'Get audit log', ...READ_ONLY },
  },
];

function newDraft(type, po, payload, preview) {
  sequence += 1;
  const draft = {
    id: `DRAFT-${String(sequence).padStart(4, '0')}`,
    type,
    po: po.po,
    payload,
    createdAt: Date.now(),
    status: 'DRAFT',
  };
  draft.token = tokenFor(draft);
  drafts.set(draft.id, draft);
  record('DRAFT_CREATED', { draft_id: draft.id, type, po_number: po.po });
  return {
    draft_id: draft.id,
    type,
    status: 'DRAFT — nothing has been posted',
    po_number: po.po,
    preview,
    confirmation_token: draft.token,
    expires_at: new Date(draft.createdAt + DRAFT_TTL_MS).toISOString(),
    next_step: 'Show this draft to the person. Only after they say yes, call submit_draft with this draft_id, the confirmation_token and confirmed=true.',
  };
}

const HANDLERS = {
  list_purchase_orders(args) {
    const base = today();
    const buyer = optionalString(args, 'buyer_id', 20);
    const vendor = optionalString(args, 'vendor_id', 20);
    const plant = optionalString(args, 'plant', 10);
    const status = optionalString(args, 'status', 30);
    if (status !== undefined && !['OPEN', 'PARTIALLY_DELIVERED'].includes(status)) {
      throw new ToolError('status must be OPEN or PARTIALLY_DELIVERED');
    }
    let limit = 20;
    if (args.limit !== undefined) {
      if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50) throw new ToolError('limit must be an integer from 1 to 50');
      limit = args.limit;
    }
    const rows = PURCHASE_ORDERS.filter(
      (row) => (!buyer || row.buyer === buyer) && (!vendor || row.vendor === vendor) && (!plant || row.plant === plant) && (!status || row.status === status),
    );
    return {
      as_of: isoDay(base),
      total: rows.length,
      returned: Math.min(rows.length, limit),
      purchase_orders: rows.slice(0, limit).map((row) => summary(materialize(row, base))),
    };
  },

  get_purchase_order(args) {
    const base = today();
    const row = findPo(args);
    const vendor = vendorOf(row.vendor);
    return {
      as_of: isoDay(base),
      purchase_order: materialize(row, base),
      vendor: {
        id: vendor.id,
        name: vendor.name,
        country: vendor.country,
        on_time_in_full_90d: vendor.otif90d,
        standard_lead_time_days: vendor.leadTimeDays,
      },
      inbound_lane_has_customs_backlog: LANE_CONGESTION[row.lane] === 1,
    };
  },

  list_alternative_suppliers(args) {
    const material = requiredString(args, 'material', 20);
    if (!materialOf(material)) throw new ToolError(`Material ${material} was not found`);
    const alternatives = (ALTERNATIVES[material] ?? []).map((alternative) => {
      const vendor = vendorOf(alternative.vendorId);
      return {
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        country: vendor.country,
        price_difference_pct: alternative.priceDeltaPct,
        lead_time_days: alternative.leadTimeDays,
        on_time_in_full_90d: vendor.otif90d,
        note: alternative.note,
      };
    });
    return { material, description: materialOf(material).description, alternatives };
  },

  draft_expedite_request(args) {
    const base = today();
    const row = findPo(args);
    if (row.status === 'DELIVERED') throw new ToolError('This purchase order is already delivered');
    const reason = requiredString(args, 'reason', 500);
    const original = isoDay(addDays(base, row.requestedOffset));
    const requested = optionalString(args, 'requested_date', 10) ?? original;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requested) || Number.isNaN(Date.parse(requested))) {
      throw new ToolError('requested_date must be a date such as 2026-11-04');
    }
    const earliest = isoDay(base);
    const latest = isoDay(addDays(base, 60));
    if (requested < earliest || requested > latest) throw new ToolError(`requested_date must be between ${earliest} and ${latest}`);
    const po = materialize(row, base);
    return newDraft('EXPEDITE_REQUEST', row, { requestedDate: requested, reason }, {
      vendor: `${po.vendor_name} (${po.vendor_id})`,
      material: `${po.material} ${po.material_description}`,
      quantity: po.quantity,
      net_value_eur: po.net_value_eur,
      current_requested_date: po.requested_delivery_date,
      current_confirmed_date: po.confirmed_delivery_date,
      new_requested_date: requested,
      reason,
      effect_if_posted: 'Sets ZZ_EXPEDITE_FLAG = X on the PO item and sends the request to the vendor.',
    });
  },

  get_open_grir_items(args) {
    const base = today();
    const company = optionalString(args, 'company_code', 10);
    if (company !== undefined && !COMPANY_CODES.some((code) => code.id === company)) {
      throw new ToolError(`company_code must be one of ${COMPANY_CODES.map((code) => code.id).join(', ')}`);
    }
    const items = GRIR_ITEMS.filter((row) => company === undefined || row.companyCode === company).map((row) => grirView(row, base));
    return { count: items.length, items };
  },

  draft_accrual_posting(args) {
    const base = today();
    const number = requiredString(args, 'po_number', 20);
    const item = requiredString(args, 'item', 6);
    const row = GRIR_ITEMS.find((candidate) => candidate.po === number && candidate.item === item);
    if (!row) throw new ToolError(`No GR/IR item for purchase order ${number} item ${item}; call get_open_grir_items first`);
    if (typeof args.amount_eur !== 'number' || !Number.isFinite(args.amount_eur) || args.amount_eur <= 0) {
      throw new ToolError('amount_eur must be a number greater than 0');
    }
    const amount = round2(args.amount_eur);
    const reason = requiredString(args, 'reason', 300);
    const view = grirView(row, base);
    if (view.classification === 'INVOICE_BEFORE_GOODS') throw new ToolError('This item was invoiced before the goods arrived; there is nothing to accrue. Clarify it with the vendor instead');
    if (view.classification === 'STALE_REVIEW') throw new ToolError(`This item is older than 90 days (${view.age_days}); it needs a clearing review, not an accrual`);
    if (accruals.has(grirKey(row))) throw new ToolError(`An accrual of ${accruals.get(grirKey(row)).amountEur} EUR is already posted for this item`);
    if (amount > view.open_value_eur) throw new ToolError(`amount_eur ${amount} is above the open GR/IR value ${view.open_value_eur}`);
    return newDraft('ACCRUAL_POSTING', { po: row.po }, { item: row.item, amountEur: amount, reason, companyCode: row.companyCode }, {
      company_code: row.companyCode,
      vendor: `${view.vendor_name} (${view.vendor_id})`,
      po_item: `${row.po}/${row.item}`,
      goods_receipt_date: view.goods_receipt_date,
      open_gr_ir_value_eur: view.open_value_eur,
      accrual_amount_eur: amount,
      reason,
      effect_if_posted: 'Posts an accrual document (expense against accrued liabilities, reversal on the first day of next period). The purchase order is not changed.',
    });
  },

  draft_supplier_inquiry(args) {
    const base = today();
    const row = findPo(args);
    const vendorId = requiredString(args, 'alternative_vendor_id', 20);
    const message = requiredString(args, 'message', 1000);
    const allowed = (ALTERNATIVES[row.material] ?? []).find((alternative) => alternative.vendorId === vendorId);
    if (!allowed) throw new ToolError(`${vendorId} is not a qualified alternative for ${row.material}; call list_alternative_suppliers first`);
    const po = materialize(row, base);
    const vendor = vendorOf(vendorId);
    return newDraft('SUPPLIER_INQUIRY', row, { vendorId, message }, {
      to: `${vendor.name} (${vendor.id})`,
      material: `${po.material} ${po.material_description}`,
      quantity: po.quantity,
      needed_by: po.requested_delivery_date,
      message,
      effect_if_posted: 'Creates a request for quotation to the alternative supplier. The existing purchase order is not changed.',
    });
  },

  submit_draft(args) {
    const id = requiredString(args, 'draft_id', 30);
    const token = requiredString(args, 'confirmation_token', 30);
    const draft = drafts.get(id);
    if (!draft) {
      record('SUBMIT_REJECTED', { draft_id: id, reason: 'unknown draft' });
      throw new ToolError(`Draft ${id} does not exist`);
    }
    if (args.confirmed !== true) {
      record('SUBMIT_REJECTED', { draft_id: id, reason: 'confirmed was not true' });
      throw new ToolError('Not posted: confirmed must be true, and only after the person approved this draft');
    }
    if (draft.status === 'POSTED') {
      return { status: 'ALREADY_POSTED', draft_id: id, change_document: draft.changeDocument, note: 'Nothing was posted again.' };
    }
    if (token !== draft.token) {
      record('SUBMIT_REJECTED', { draft_id: id, reason: 'token mismatch' });
      throw new ToolError('Not posted: the confirmation_token does not match this draft');
    }
    if (Date.now() - draft.createdAt > DRAFT_TTL_MS) {
      record('SUBMIT_REJECTED', { draft_id: id, reason: 'draft expired' });
      throw new ToolError('Not posted: the draft expired after 30 minutes; create a new one');
    }

    draft.status = 'POSTED';
    changeSequence += 1;
    draft.changeDocument = `CHG-${4900000000 + changeSequence}`;
    if (draft.type === 'ACCRUAL_POSTING') {
      accrualSequence += 1;
      const accrualDocument = `ACC-${5100000000 + accrualSequence}`;
      accruals.set(`${draft.po}-${draft.payload.item}`, { amountEur: draft.payload.amountEur, accrualDocument, changeDocument: draft.changeDocument });
      draft.accrualDocument = accrualDocument;
    } else if (draft.type === 'EXPEDITE_REQUEST') {
      expedites.set(draft.po, { requestedDate: draft.payload.requestedDate, reason: draft.payload.reason, changeDocument: draft.changeDocument });
    } else {
      inquiries.push({ po: draft.po, ...draft.payload, changeDocument: draft.changeDocument });
    }
    record('SUBMITTED', { draft_id: id, type: draft.type, po_number: draft.po, change_document: draft.changeDocument });
    return {
      status: 'POSTED',
      draft_id: id,
      type: draft.type,
      po_number: draft.po,
      change_document: draft.changeDocument,
      ...(draft.accrualDocument ? { accrual_document: draft.accrualDocument } : {}),
      note:
        draft.type === 'ACCRUAL_POSTING'
          ? `Accrual document ${draft.accrualDocument} posted for ${draft.payload.amountEur} EUR.`
          : draft.type === 'EXPEDITE_REQUEST'
            ? 'ZZ_EXPEDITE_FLAG is now X on this purchase order.'
            : 'Request for quotation created.',
    };
  },

  get_audit_log(args) {
    let limit = 20;
    if (args.limit !== undefined) {
      if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) throw new ToolError('limit must be an integer from 1 to 100');
      limit = args.limit;
    }
    return { total: audit.length, entries: audit.slice(-limit) };
  },
};

/* ---------------- protocol ---------------- */

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const reply = (id, result) => send({ id, result });
const fail = (id, code, message) => send({ id, error: { code, message } });

function callTool(name, args) {
  if (!Object.hasOwn(HANDLERS, name)) throw new RangeError(`Unknown tool: ${name}`);
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    throw new ToolError('arguments must be an object');
  }
  return { content: [{ type: 'text', text: JSON.stringify(HANDLERS[name](args ?? {}), null, 2) }] };
}

function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;

  if (typeof method !== 'string') {
    if (isRequest) fail(id, -32600, 'Invalid request');
    return;
  }

  switch (method) {
    case 'initialize': {
      const wanted = params?.protocolVersion;
      reply(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(wanted) ? wanted : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Mock SAP purchasing with fictional data. Read tools are free. Writing is two steps: draft_* tools change nothing and return a draft; ' +
          'submit_draft posts it and needs the confirmation_token plus confirmed=true. Never call submit_draft before the person has approved the draft in the conversation.',
      });
      return;
    }
    case 'ping':
      if (isRequest) reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: TOOLS });
      return;
    case 'tools/call':
      try {
        reply(id, callTool(params?.name, params?.arguments));
      } catch (error) {
        if (error instanceof ToolError) reply(id, { content: [{ type: 'text', text: error.message }], isError: true });
        else if (error instanceof RangeError) fail(id, -32602, error.message);
        else fail(id, -32603, `Internal error: ${error.message}`);
      }
      return;
    default:
      // Notifications (e.g. notifications/initialized) have no id and need no reply.
      if (isRequest) fail(id, -32601, `Method not found: ${method}`);
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    fail(null, -32700, 'Parse error');
    return;
  }
  try {
    handle(message);
  } catch (error) {
    console.error('unhandled error:', error);
    if (message?.id !== undefined && message?.id !== null) fail(message.id, -32603, 'Internal error');
  }
});
lines.on('close', () => process.exit(0));
