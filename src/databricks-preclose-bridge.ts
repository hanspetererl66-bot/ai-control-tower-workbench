/**
 * Bridge between the Finance Pre-Close Space and the Databricks demo data. The Space may ask for one thing: the open
 * goods receipts (GR/IR) and the intercompany differences from the lakehouse, checked against SAP when the mock SAP
 * is connected. The SQL is fixed here; the Space cannot send a statement of its own and cannot write anything. Posting
 * an accrual stays a conversation with approval, so the Space only shows the result and can ask Joule to prepare it.
 */
import { parseToolResult, type BridgeCall } from './sub4me-bridge.ts';

export const DATABRICKS_CATALOG = 'werkbank_demo';
const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const COMPANY = /^[A-Z]{2}[0-9]{2}$/;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const CLASSES = ['ACCRUE', 'STALE_REVIEW', 'INVOICE_BEFORE_GOODS'];
const CATEGORIES = ['MISSING_ON_BUYER_SIDE', 'AMOUNT_MISMATCH', 'ROUNDING'];

export const GRIR_SQL = (company?: string) =>
  `SELECT po_number, item, company_code, vendor_name, description, CAST(goods_receipt_date AS STRING) AS goods_receipt_date, age_days, gr_value_eur, invoiced_value_eur, open_value_eur, classification ` +
  `FROM ${DATABRICKS_CATALOG}.fin.v_grir_open WHERE classification <> 'CLEARED'${company ? ` AND company_code = '${company}'` : ''} ORDER BY ABS(open_value_eur) DESC, po_number`;
export const IC_SQL =
  `SELECT item_id, seller_company, buyer_company, description, CAST(posting_date AS STRING) AS posting_date, seller_amount_eur, buyer_amount_eur, difference_eur, category ` +
  `FROM ${DATABRICKS_CATALOG}.fin.v_ic_differences ORDER BY ABS(difference_eur) DESC, item_id`;

/** Which extension serves which tool for this Space. Everything else belongs to the AI Control Tower connector. */
export function precloseExtensionFor(tool: string, fallback: string): string {
  if (tool === 'databricks_run_sql') return 'databricks';
  if (tool === 'get_open_grir_items') return 'sap-mock';
  return fallback;
}

type Row = Record<string, unknown>;
const rowsOf = (raw: unknown): Row[] => (isObject(raw) && Array.isArray(raw.rows) ? raw.rows.filter(isObject).slice(0, 100) : []);

export function pickGrir(raw: unknown, sap: Map<string, Row> | null) {
  return rowsOf(raw).map((r) => {
    const po = str(r.po_number, 12);
    const item = str(r.item, 6);
    const open = num(r.open_value_eur);
    const s = sap?.get(`${po}-${item}`);
    const sapOpen = s ? num(s.open_value_eur) : null;
    return {
      po, item, company: str(r.company_code, 4), vendor: str(r.vendor_name, 60), description: str(r.description, 120),
      receivedOn: str(r.goods_receipt_date, 10), ageDays: num(r.age_days), receivedEur: num(r.gr_value_eur), invoicedEur: num(r.invoiced_value_eur),
      openEur: open, classification: CLASSES.includes(str(r.classification, 30)) ? str(r.classification, 30) : 'UNKNOWN',
      sapOpenEur: sapOpen,
      sapMatch: sap === null ? null : sapOpen !== null && open !== null && Math.abs(sapOpen - open) < 0.01,
      accruedEur: s ? num(s.accrued_eur) ?? 0 : null,
      accrualDocument: s && typeof s.accrual_document === 'string' ? s.accrual_document.slice(0, 20) : null,
    };
  });
}

export function pickIntercompany(raw: unknown) {
  return rowsOf(raw).map((r) => ({
    id: str(r.item_id, 20), seller: str(r.seller_company, 4), buyer: str(r.buyer_company, 4), description: str(r.description, 80),
    postedOn: str(r.posting_date, 10), sellerEur: num(r.seller_amount_eur), buyerEur: num(r.buyer_amount_eur), differenceEur: num(r.difference_eur),
    category: CATEGORIES.includes(str(r.category, 30)) ? str(r.category, 30) : 'UNKNOWN',
  }));
}

export function summarize(grir: ReturnType<typeof pickGrir>) {
  const total = (cls: string) => Math.round(grir.filter((g) => g.classification === cls).reduce((s, g) => s + (g.openEur ?? 0), 0) * 100) / 100;
  return {
    accrueEur: total('ACCRUE'), accrueCount: grir.filter((g) => g.classification === 'ACCRUE').length,
    staleEur: total('STALE_REVIEW'), staleCount: grir.filter((g) => g.classification === 'STALE_REVIEW').length,
    invoiceFirstEur: total('INVOICE_BEFORE_GOODS'), invoiceFirstCount: grir.filter((g) => g.classification === 'INVOICE_BEFORE_GOODS').length,
    accruedEur: Math.round(grir.reduce((s, g) => s + (g.accruedEur ?? 0), 0) * 100) / 100,
  };
}

/** Space: `ct:databricks-preclose-request` → `ct:databricks-preclose`. */
export async function handleDatabricksPrecloseMessage(data: unknown, call: BridgeCall | undefined): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || data.type !== 'ct:databricks-preclose-request') return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'ct:error', requestId, message });
  const company = typeof data.company === 'string' && COMPANY.test(data.company) ? data.company : undefined;
  if (!call) return fail('The agent is not connected yet.');
  let grirRaw: unknown;
  let icRaw: unknown;
  try {
    grirRaw = parseToolResult(await call('databricks_run_sql', { statement: GRIR_SQL(company), row_limit: 50 }));
    icRaw = parseToolResult(await call('databricks_run_sql', { statement: IC_SQL, row_limit: 50 }));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  // SAP is the system of record. If the mock SAP is not connected the Space still shows the lakehouse view and says so.
  let sap: Map<string, Row> | null = null;
  try {
    const answer = parseToolResult(await call('get_open_grir_items', company ? { company_code: company } : {}));
    if (isObject(answer) && Array.isArray(answer.items)) {
      sap = new Map(answer.items.filter(isObject).map((i): [string, Row] => [`${str(i.po_number, 12)}-${str(i.item, 6)}`, i]));
    }
  } catch {
    sap = null;
  }
  const grir = pickGrir(grirRaw, sap);
  return { type: 'ct:databricks-preclose', requestId, data: { company: company ?? 'ALL', sapConnected: sap !== null, grir, intercompany: pickIntercompany(icRaw), summary: summarize(grir) } };
}
