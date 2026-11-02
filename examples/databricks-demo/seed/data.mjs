/**
 * Deterministic seed data for the Databricks demo (fictional).
 *
 * Three small data products tell three connected stories:
 *   fin  — DACH gross margin misses plan in Q3 (discount leakage, a supplier price rise, FX)
 *   ops  — last night's S/4 -> Delta load failed on schema drift; what does that break downstream?
 *   scm  — which purchase orders are likely to slip (data shared with the SAP mock connector)
 *
 * The scm rows come from connectors/sap-mock/server/data.mjs so SAP and the lakehouse agree.
 * Everything is generated from fixed numbers and a seeded generator: loading it twice gives the same rows.
 * `npm run sync:databricks-demo` turns this module into the SQL files; `npm test` fails on drift.
 */

export const CATALOG = 'werkbank_demo';

/* ---------------- deterministic noise ---------------- */

/** mulberry32: small, fast, and identical on every machine. */
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (value) => Math.round(value * 100) / 100;

/* ---------------- fin: margin against plan ---------------- */

export const REGIONS = [
  { code: 'DACH', scale: 1.0 },
  { code: 'UKI', scale: 0.8 },
  { code: 'FR', scale: 0.6 },
  { code: 'NORDICS', scale: 0.45 },
];

/** Plan percentages are shares of gross revenue. */
export const PRODUCT_LINES = [
  { name: 'Edge Gateways', baseRevenue: 1_800_000, cogsPct: 0.52, discountPct: 0.06, fxPct: 0.004 },
  { name: 'Industrial Sensors', baseRevenue: 1_300_000, cogsPct: 0.46, discountPct: 0.07, fxPct: 0.004 },
  { name: 'Control Software', baseRevenue: 1_100_000, cogsPct: 0.18, discountPct: 0.05, fxPct: 0.002 },
  { name: 'Service Contracts', baseRevenue: 900_000, cogsPct: 0.34, discountPct: 0.03, fxPct: 0.001 },
  { name: 'Spare Parts', baseRevenue: 600_000, cogsPct: 0.5, discountPct: 0.04, fxPct: 0.003 },
];

export const MONTHS = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];
const SEASONALITY = [0.92, 0.95, 1.02, 1.0, 1.03, 1.08, 0.9, 0.88, 1.12];

/** The story: from July, DACH only. Sensors are discounted too far, the gateway supplier raised prices, FX turns against us. */
export const DACH_Q3_EFFECTS = {
  discountExtraPct: { 'Industrial Sensors': [0.06, 0.075, 0.09] }, // percentage points of gross revenue, per month Jul, Aug, Sep
  cogsFactor: { 'Edge Gateways': [1.07, 1.1, 1.12] },
  fxExtraPct: [0.004, 0.005, 0.006], // all DACH product lines
};

export function marginRows() {
  const random = generator(20261027);
  const noise = (amount) => (random() * 2 - 1) * amount;
  const rows = [];
  for (const region of REGIONS) {
    for (const product of PRODUCT_LINES) {
      MONTHS.forEach((month, index) => {
        const planRevenue = product.baseRevenue * region.scale * SEASONALITY[index];
        const revenue = planRevenue * (1 + noise(0.03));
        let discountPct = product.discountPct + noise(0.008);
        let cogsFactor = 1 + noise(0.02);
        let fxPct = product.fxPct * (1 + noise(0.15));
        const quarterIndex = index - 6; // 0..2 for Jul..Sep
        if (region.code === 'DACH' && quarterIndex >= 0) {
          discountPct += DACH_Q3_EFFECTS.discountExtraPct[product.name]?.[quarterIndex] ?? 0;
          cogsFactor *= DACH_Q3_EFFECTS.cogsFactor[product.name]?.[quarterIndex] ?? 1;
          fxPct += DACH_Q3_EFFECTS.fxExtraPct[quarterIndex];
        }
        rows.push({
          month,
          region: region.code,
          productLine: product.name,
          revenue: round2(revenue),
          revenuePlan: round2(planRevenue),
          discount: round2(revenue * discountPct),
          discountPlan: round2(planRevenue * product.discountPct),
          cogs: round2(revenue * product.cogsPct * cogsFactor),
          cogsPlan: round2(planRevenue * product.cogsPct),
          fxCost: round2(revenue * fxPct),
          fxCostPlan: round2(planRevenue * product.fxPct),
        });
      });
    }
  }
  return rows;
}

const grossMargin = (row, plan = false) =>
  plan
    ? row.revenuePlan - row.discountPlan - row.cogsPlan - row.fxCostPlan
    : row.revenue - row.discount - row.cogs - row.fxCost;
const netRevenue = (row, plan = false) => (plan ? row.revenuePlan - row.discountPlan : row.revenue - row.discount);

/** Margin % and plan margin % for any slice of rows, for tests and for the README numbers. */
export function marginSummary(rows) {
  const actual = rows.reduce((sum, row) => sum + grossMargin(row), 0) / rows.reduce((sum, row) => sum + netRevenue(row), 0);
  const plan = rows.reduce((sum, row) => sum + grossMargin(row, true), 0) / rows.reduce((sum, row) => sum + netRevenue(row, true), 0);
  return { marginPct: actual * 100, planMarginPct: plan * 100, deltaPp: (actual - plan) * 100 };
}

/** Deals above the discount policy: the detail behind "discount leakage". Sample, not a reconciliation. */
export const DISCOUNT_POLICY_PCT = 12;
const DEAL_ROWS = [
  // [deal, month, region, product, segment, customer, listValue, discountPct, approval, approvedByRole]
  ['D-26-0611', '2026-07-01', 'DACH', 'Industrial Sensors', 'Mid-Market', 'C-DE-0412', 84000, 19.5, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0627', '2026-07-01', 'DACH', 'Industrial Sensors', 'Mid-Market', 'C-DE-0388', 61000, 21.0, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0634', '2026-07-01', 'DACH', 'Industrial Sensors', 'Enterprise', 'C-DE-0102', 176000, 17.5, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0702', '2026-07-01', 'DACH', 'Industrial Sensors', 'Mid-Market', 'C-AT-0207', 47000, 22.0, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0718', '2026-08-01', 'DACH', 'Industrial Sensors', 'Mid-Market', 'C-DE-0455', 72000, 23.5, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0733', '2026-08-01', 'DACH', 'Industrial Sensors', 'Mid-Market', 'C-DE-0412', 93000, 20.0, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0741', '2026-08-01', 'DACH', 'Industrial Sensors', 'Enterprise', 'C-CH-0061', 158000, 18.0, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0749', '2026-08-01', 'DACH', 'Industrial Sensors', 'Mid-Market', 'C-DE-0371', 55000, 24.0, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0802', '2026-09-01', 'DACH', 'Industrial Sensors', 'Mid-Market', 'C-DE-0388', 69000, 22.5, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0815', '2026-09-01', 'DACH', 'Industrial Sensors', 'Mid-Market', 'C-AT-0233', 51000, 24.0, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0821', '2026-09-01', 'DACH', 'Industrial Sensors', 'Enterprise', 'C-DE-0102', 182000, 19.0, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0829', '2026-09-01', 'DACH', 'Industrial Sensors', 'Mid-Market', 'C-DE-0455', 88000, 23.0, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0836', '2026-09-01', 'DACH', 'Industrial Sensors', 'Mid-Market', 'C-DE-0419', 43000, 25.0, 'Regional exception', 'Regional Sales Director'],
  ['D-26-0844', '2026-09-01', 'DACH', 'Industrial Sensors', 'Enterprise', 'C-CH-0074', 149000, 17.0, 'Regional exception', 'Regional Sales Director'],
  // Within policy, other regions and months: the contrast.
  ['D-26-0412', '2026-04-01', 'DACH', 'Industrial Sensors', 'Mid-Market', 'C-DE-0344', 66000, 9.5, 'Standard', 'Sales Manager'],
  ['D-26-0527', '2026-05-01', 'UKI', 'Industrial Sensors', 'Enterprise', 'C-UK-0120', 140000, 11.0, 'Standard', 'Sales Manager'],
  ['D-26-0618', '2026-06-01', 'FR', 'Edge Gateways', 'Mid-Market', 'C-FR-0098', 78000, 8.5, 'Standard', 'Sales Manager'],
  ['D-26-0731', '2026-07-01', 'UKI', 'Industrial Sensors', 'Mid-Market', 'C-UK-0144', 52000, 10.0, 'Standard', 'Sales Manager'],
  ['D-26-0811', '2026-08-01', 'NORDICS', 'Control Software', 'Enterprise', 'C-SE-0033', 120000, 7.0, 'Standard', 'Sales Manager'],
  ['D-26-0832', '2026-09-01', 'FR', 'Industrial Sensors', 'Mid-Market', 'C-FR-0107', 58000, 11.5, 'Standard', 'Sales Manager'],
];

export const dealRows = () =>
  DEAL_ROWS.map(([deal, month, region, productLine, segment, customer, listValue, discountPct, approval, role]) => ({
    deal,
    month,
    region,
    productLine,
    segment,
    customer,
    listValue,
    discountPct,
    policyLimitPct: DISCOUNT_POLICY_PCT,
    approval,
    approvedByRole: role,
  }));

/* ---------------- ops: a failed nightly load and its blast radius ---------------- */

export const JOBS = [
  { id: 9001, name: 's4_to_delta_nightly', ownerTeam: 'Data Platform', schedule: '0 0 2 * * ?', startHour: 2, startMinute: 0 },
  { id: 9002, name: 'margin_mart_refresh', ownerTeam: 'Finance Analytics', schedule: '0 30 4 * * ?', startHour: 4, startMinute: 30 },
  { id: 9003, name: 'po_risk_scoring', ownerTeam: 'Procurement Analytics', schedule: '0 15 5 * * ?', startHour: 5, startMinute: 15 },
];

const TASKS_9001 = ['extract_ekko', 'ingest_ekko', 'ingest_ekpo', 'ingest_lfa1', 'build_silver_po', 'publish_po_gold'];
const SCHEMA_ERROR =
  'A schema mismatch was detected when writing to the Delta table werkbank_demo.bronze.s4_ekpo: ' +
  'the source has a new column ZZ_EXPEDITE_FLAG (STRING) that is not in the target table. ' +
  'To accept new columns, enable schema evolution (mergeSchema) or add the column to the target first.';
const NETWORK_ERROR = 'Connection reset by peer while reading from the SAP S/4HANA extraction endpoint. The task was retried by the next scheduled run.';

/** Last 14 nights (offset -13..0). Offset 0 is the run that failed on schema drift. */
export function runData() {
  const runs = [];
  const tasks = [];
  let runId = 8800100;
  for (let offset = -13; offset <= 0; offset++) {
    for (const job of JOBS) {
      runId += 1;
      const isToday = offset === 0;
      const isTransient = job.id === 9001 && offset === -9;
      const failed = job.id === 9001 && (isToday || isTransient);
      runs.push({
        runId,
        jobId: job.id,
        dayOffset: offset,
        hour: job.startHour,
        minute: job.startMinute,
        durationMinutes: failed ? (isToday ? 11 : 4) : job.id === 9001 ? 38 : job.id === 9002 ? 22 : 17,
        resultState: failed ? 'FAILED' : 'SUCCESS',
      });
      if (job.id !== 9001) continue;
      TASKS_9001.forEach((taskKey, index) => {
        let state = 'SUCCESS';
        let errorClass = null;
        let errorMessage = null;
        if (isToday && taskKey === 'ingest_ekpo') {
          state = 'FAILED';
          errorClass = 'SCHEMA_MISMATCH';
          errorMessage = SCHEMA_ERROR;
        } else if (isToday && ['build_silver_po', 'publish_po_gold'].includes(taskKey)) {
          state = 'UPSTREAM_FAILED';
        } else if (isTransient && taskKey === 'extract_ekko') {
          state = 'FAILED';
          errorClass = 'TRANSIENT_NETWORK';
          errorMessage = NETWORK_ERROR;
        } else if (isTransient) {
          state = 'UPSTREAM_FAILED';
        }
        tasks.push({
          runId,
          taskKey,
          taskOrder: index + 1,
          state,
          errorClass,
          errorMessage,
          durationMinutes: state === 'SUCCESS' ? 4 + (index % 3) * 3 : state === 'FAILED' ? 2 : 0,
        });
      });
    }
  }
  return { runs, tasks };
}

const T = (name) => `${CATALOG}.${name}`;

/** [source, target, job, task]: metadata that mirrors the shape of system.access.table_lineage. */
export const LINEAGE_EDGES = [
  [T('bronze.s4_ekko'), T('silver.po_headers'), 's4_to_delta_nightly', 'build_silver_po'],
  [T('bronze.s4_ekpo'), T('silver.po_items'), 's4_to_delta_nightly', 'build_silver_po'],
  [T('bronze.s4_lfa1'), T('silver.vendors'), 's4_to_delta_nightly', 'build_silver_po'],
  [T('silver.po_headers'), T('scm.purchase_orders'), 's4_to_delta_nightly', 'publish_po_gold'],
  [T('silver.po_items'), T('scm.purchase_orders'), 's4_to_delta_nightly', 'publish_po_gold'],
  [T('silver.vendors'), T('scm.purchase_orders'), 's4_to_delta_nightly', 'publish_po_gold'],
  [T('scm.purchase_orders'), T('scm.v_po_delay_scores'), 'po_risk_scoring', 'score_open_pos'],
];

/** [asset, type, depends on table, owner, criticality, refresh SLA in hours, note] */
export const DOWNSTREAM_ASSETS = [
  ['Procurement Cockpit', 'dashboard', T('scm.purchase_orders'), 'Procurement Analytics', 'high', 24, 'Daily stand-up of the purchasing team'],
  ['Supplier OTIF weekly', 'dashboard', T('scm.purchase_orders'), 'Procurement Analytics', 'medium', 168, 'Weekly vendor review'],
  ['get_delay_risk_pos (buyer agent function)', 'uc_function', T('scm.v_po_delay_scores'), 'Procurement Analytics', 'high', 24, 'Called by buyer agents; stale scores mean missed expedites'],
  ['po_delay_risk scoring job', 'job', T('scm.purchase_orders'), 'Procurement Analytics', 'high', 24, 'Runs at 05:15 after the nightly load'],
];

/** Every table that is reachable from each source, with the number of hops (the source itself is hop 0). */
export function lineageClosure() {
  const next = new Map();
  for (const [source, target] of LINEAGE_EDGES) next.set(source, [...(next.get(source) ?? []), target]);
  const tables = new Set(LINEAGE_EDGES.flat().filter((value) => value.startsWith(CATALOG)));
  const rows = [];
  for (const start of [...tables].sort()) {
    const seen = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      for (const target of next.get(current) ?? []) {
        if (!seen.has(target)) {
          seen.set(target, seen.get(current) + 1);
          queue.push(target);
        }
      }
    }
    for (const [impacted, hops] of seen) rows.push([start, impacted, hops]);
  }
  return rows;
}

/* ---------------- finance pre-close: intercompany ---------------- */

/** [id, sellerCompany, buyerCompany, description, postingOffsetDays, sellerAmountEur, buyerAmountEur|null] null = not posted on the buyer side. */
export const IC_ITEMS = [
  ['IC-0001', 'DE01', 'PL01', 'Contract assembly services', -12, 120000, 120000],
  ['IC-0002', 'DE01', 'FR01', 'Software licence recharge', -10, 45000, 45000],
  ['IC-0003', 'PL01', 'DE01', 'Sub-assembly delivery', -9, 210400, 210400],
  ['IC-0004', 'FR01', 'DE01', 'Field service recharge', -8, 33800, 33800],
  ['IC-0005', 'DE01', 'PL01', 'Management fee Q3', -7, 84200, null],
  ['IC-0006', 'PL01', 'FR01', 'Component transfer', -6, 96250.4, 96238],
  ['IC-0007', 'DE01', 'FR01', 'Engineering services', -5, 78650, 60000],
  ['IC-0008', 'FR01', 'PL01', 'Tooling recharge', -4, 15400, 15400],
  ['IC-0009', 'DE01', 'PL01', 'IT services', -3, 22000, 22000],
  ['IC-0010', 'PL01', 'DE01', 'Logistics recharge', -2, 18900, 18900],
].map(([id, seller, buyer, description, postingOffset, sellerAmountEur, buyerAmountEur]) => ({ id, seller, buyer, description, postingOffset, sellerAmountEur, buyerAmountEur }));
