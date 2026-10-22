/**
 * Synthetic purchase-order data for the SAP mock connector.
 *
 * Everything here is fictional: vendors, materials, people and values. Dates are stored as
 * day offsets from "today", so the demo never goes stale and "late" always means late relative
 * to the day you present. The Databricks seed SQL is generated from these same rows
 * (scripts/gen-databricks-demo.mjs), so the SAP side and the lakehouse side tell one story.
 */

export const BUYERS = [
  { id: 'B-100', name: 'M. Keller', team: 'Strategic Purchasing DACH' },
  { id: 'B-200', name: 'S. Okafor', team: 'Direct Materials South' },
  { id: 'B-300', name: 'L. Brandt', team: 'Indirect Materials' },
];

export const PLANTS = [
  { id: '1010', name: 'Heidelberg Assembly', country: 'DE' },
  { id: '1020', name: 'Gdansk Plant', country: 'PL' },
  { id: '1030', name: 'Lyon Plant', country: 'FR' },
];

/** otif90d = on-time-in-full rate over the last 90 days; capacity = units per month. */
export const VENDORS = [
  { id: 'V-1001', name: 'Nordwerk Metall GmbH', country: 'DE', otif90d: 0.71, monthlyCapacityUnits: 1200, leadTimeDays: 21 },
  { id: 'V-1002', name: 'Neckar Elektronik AG', country: 'DE', otif90d: 0.93, monthlyCapacityUnits: 5000, leadTimeDays: 14 },
  { id: 'V-1003', name: 'Baltic Fasteners UAB', country: 'LT', otif90d: 0.88, monthlyCapacityUnits: 40000, leadTimeDays: 10 },
  { id: 'V-1004', name: 'Tessin Precision SA', country: 'CH', otif90d: 0.96, monthlyCapacityUnits: 900, leadTimeDays: 14 },
  { id: 'V-1005', name: 'Pannonia Cables Kft', country: 'HU', otif90d: 0.79, monthlyCapacityUnits: 6000, leadTimeDays: 12 },
  { id: 'V-1006', name: 'Anatolia Plastics A.S.', country: 'TR', otif90d: 0.84, monthlyCapacityUnits: 8000, leadTimeDays: 16 },
];

export const MATERIALS = [
  { id: 'M-2001', description: 'Aluminium housing 4U', unit: 'EA' },
  { id: 'M-2002', description: 'Industrial PCB rev C', unit: 'EA' },
  { id: 'M-2003', description: 'M6 fastener kit', unit: 'EA' },
  { id: 'M-2004', description: 'Precision encoder', unit: 'EA' },
  { id: 'M-2005', description: 'Cable harness 12-pin', unit: 'EA' },
  { id: 'M-2006', description: 'ABS enclosure', unit: 'EA' },
];

/** Lanes with a customs or port backlog (synthetic). 1 = congested. */
export const LANE_CONGESTION = {
  'DE-DE': 0, 'DE-PL': 0, 'CH-PL': 0, 'CH-DE': 0, 'LT-FR': 0, 'LT-DE': 0,
  'HU-DE': 1, 'HU-FR': 1, 'TR-DE': 1, 'TR-FR': 1, 'TR-PL': 1,
};

/** Qualified alternatives per material; priceDeltaPct is relative to the current vendor. */
export const ALTERNATIVES = {
  'M-2001': [{ vendorId: 'V-1004', priceDeltaPct: 18, leadTimeDays: 14, note: 'Machined from billet, higher unit price' }],
  'M-2005': [{ vendorId: 'V-1002', priceDeltaPct: 9, leadTimeDays: 12, note: 'Second source, qualified in 2025' }],
  'M-2006': [{ vendorId: 'V-1003', priceDeltaPct: 6, leadTimeDays: 10, note: 'Short lead time, smaller tooling set' }],
};

/**
 * The risk model that the Databricks side uses as a stand-in for a Model Serving endpoint.
 * Kept here so the SQL view and the tests are generated from the same constants.
 */
export const RISK_MODEL = {
  intercept: -1.6,
  otifReference: 0.9,
  otifWeight: 6.0,
  confirmGapWeight: 0.22,
  loadReference: 0.8,
  loadWeight: 1.1,
  laneWeight: 0.9,
  expectedDelayScale: 9,
};

export const DRIVER_LABELS = {
  otif: 'Vendor on-time-in-full rate is low',
  gap: 'Vendor confirmed later than requested',
  load: 'Order size is close to vendor capacity',
  lane: 'Inbound lane has a customs backlog',
};

/** [po, item, material, vendor, plant, buyer, qty, unitPriceEur, orderOffset, requestedOffset, confirmedOffset, lane, status] */
const ROWS = [
  // Buyer B-100 (the demo persona): twelve open orders, six of them at high risk.
  ['4500001001', '10', 'M-2001', 'V-1001', '1010', 'B-100', 600, 84.5, -24, 6, 12, 'DE-DE', 'OPEN'],
  ['4500001002', '10', 'M-2001', 'V-1001', '1020', 'B-100', 900, 84.5, -20, 9, 16, 'DE-PL', 'OPEN'],
  ['4500001003', '10', 'M-2005', 'V-1005', '1010', 'B-100', 4800, 6.2, -18, 5, 9, 'HU-DE', 'OPEN'],
  ['4500001004', '10', 'M-2006', 'V-1006', '1030', 'B-100', 6500, 3.1, -15, 8, 8, 'TR-FR', 'OPEN'],
  ['4500001005', '10', 'M-2002', 'V-1002', '1010', 'B-100', 2500, 18.9, -12, 12, 12, 'DE-DE', 'OPEN'],
  ['4500001006', '10', 'M-2004', 'V-1004', '1020', 'B-100', 300, 142.0, -10, 15, 15, 'CH-PL', 'OPEN'],
  ['4500001007', '20', 'M-2001', 'V-1001', '1010', 'B-100', 1100, 84.5, -8, 20, 30, 'DE-DE', 'OPEN'],
  ['4500001008', '10', 'M-2003', 'V-1003', '1030', 'B-100', 36000, 0.42, -14, 10, 13, 'LT-FR', 'PARTIALLY_DELIVERED'],
  ['4500001009', '10', 'M-2005', 'V-1005', '1030', 'B-100', 5700, 6.2, -9, 7, 14, 'HU-FR', 'OPEN'],
  ['4500001010', '10', 'M-2002', 'V-1002', '1010', 'B-100', 3000, 18.9, -6, 18, 18, 'DE-DE', 'OPEN'],
  ['4500001011', '10', 'M-2006', 'V-1006', '1010', 'B-100', 7800, 3.1, -5, 22, 25, 'TR-DE', 'OPEN'],
  ['4500001012', '10', 'M-2004', 'V-1004', '1010', 'B-100', 250, 142.0, -3, 25, 25, 'CH-DE', 'OPEN'],

  // Buyer B-200: a mixed book with two orders that deserve attention.
  ['4500002001', '10', 'M-2001', 'V-1001', '1020', 'B-200', 700, 84.5, -22, 11, 19, 'DE-PL', 'OPEN'],
  ['4500002002', '10', 'M-2002', 'V-1002', '1020', 'B-200', 2200, 18.9, -17, 14, 14, 'DE-PL', 'OPEN'],
  ['4500002003', '10', 'M-2003', 'V-1003', '1010', 'B-200', 28000, 0.42, -13, 9, 9, 'LT-DE', 'OPEN'],
  ['4500002004', '10', 'M-2005', 'V-1005', '1020', 'B-200', 3900, 6.2, -11, 13, 15, 'HU-DE', 'OPEN'],
  ['4500002005', '10', 'M-2006', 'V-1006', '1020', 'B-200', 5200, 3.1, -10, 16, 16, 'TR-PL', 'OPEN'],
  ['4500002006', '10', 'M-2004', 'V-1004', '1030', 'B-200', 280, 142.0, -9, 19, 19, 'CH-DE', 'OPEN'],
  ['4500002007', '10', 'M-2002', 'V-1002', '1030', 'B-200', 1800, 18.9, -7, 21, 21, 'DE-DE', 'OPEN'],
  ['4500002008', '10', 'M-2003', 'V-1003', '1020', 'B-200', 31000, 0.42, -4, 23, 23, 'LT-DE', 'OPEN'],

  // Buyer B-300: mostly low risk, the contrast case.
  ['4500003001', '10', 'M-2002', 'V-1002', '1010', 'B-300', 1500, 18.9, -15, 10, 10, 'DE-DE', 'OPEN'],
  ['4500003002', '10', 'M-2003', 'V-1003', '1010', 'B-300', 22000, 0.42, -12, 12, 12, 'LT-DE', 'OPEN'],
  ['4500003003', '10', 'M-2004', 'V-1004', '1030', 'B-300', 200, 142.0, -9, 17, 17, 'CH-DE', 'OPEN'],
  ['4500003004', '10', 'M-2002', 'V-1002', '1020', 'B-300', 1700, 18.9, -6, 20, 20, 'DE-PL', 'OPEN'],
  ['4500003005', '10', 'M-2003', 'V-1003', '1030', 'B-300', 25000, 0.42, -3, 24, 24, 'LT-FR', 'OPEN'],
  ['4500003006', '10', 'M-2005', 'V-1005', '1010', 'B-300', 2100, 6.2, -2, 26, 27, 'HU-DE', 'OPEN'],
];

export const PURCHASE_ORDERS = ROWS.map(
  ([po, item, material, vendor, plant, buyer, qty, unitPriceEur, orderOffset, requestedOffset, confirmedOffset, lane, status]) => ({
    po,
    item,
    material,
    vendor,
    plant,
    buyer,
    qty,
    unitPriceEur,
    orderOffset,
    requestedOffset,
    confirmedOffset,
    lane,
    status,
  }),
);

const vendorById = new Map(VENDORS.map((vendor) => [vendor.id, vendor]));
export const vendorOf = (id) => vendorById.get(id);

/**
 * Score one purchase order with the demo risk model.
 * Returns the delay probability, the expected delay in days and the two largest positive drivers.
 * The Databricks view `scm.v_po_delay_scores` is generated from the same constants.
 */
export function scorePo(row, model = RISK_MODEL) {
  const vendor = vendorOf(row.vendor);
  const gap = row.confirmedOffset - row.requestedOffset;
  const load = row.qty / vendor.monthlyCapacityUnits;
  const lane = LANE_CONGESTION[row.lane] ?? 0;
  const contributions = {
    otif: model.otifWeight * (model.otifReference - vendor.otif90d),
    gap: model.confirmGapWeight * Math.max(gap, 0),
    load: model.loadWeight * Math.max(load - model.loadReference, 0),
    lane: model.laneWeight * lane,
  };
  const z = model.intercept + Object.values(contributions).reduce((sum, value) => sum + value, 0);
  const delayProbability = 1 / (1 + Math.exp(-z));
  const drivers = Object.entries(contributions)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([key]) => DRIVER_LABELS[key]);
  return {
    delayProbability,
    expectedDelayDays: Math.round(delayProbability * model.expectedDelayScale * 10) / 10,
    drivers,
  };
}
