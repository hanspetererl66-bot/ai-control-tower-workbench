/**
 * Sub4Me demo customer portal data (contracts, AI-unit consumption), read-only.
 * The data lives in the Sub4Me example Space; the repository copy is read straight from its HTML,
 * the .mcpb bundle carries an extracted data/sub4me.json. Fictional sample data.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from './tools.mjs';

const here = (path) => join(dirname(fileURLToPath(import.meta.url)), path);
export const CONTRACT_STATUSES = ['Active', 'Renewal due', 'Expired'];
export const OFFER_TYPES = ['Renewal', 'New product'];
export const OFFER_STATUSES = ['Open', 'In negotiation', 'Accepted', 'Declined', 'Expired'];

/** Pull the inline JSON out of the Sub4Me Space page. */
export function extractSub4MeData(html) {
  const match = /<script type="application\/json" id="s4m-data">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('Sub4Me data block not found');
  return JSON.parse(match[1]);
}

export function loadSub4MeData() {
  const candidates = [process.env.SUB4ME_DATA, here('../data/sub4me.json')].filter(Boolean);
  const file = candidates.find((path) => existsSync(path));
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  const page = here('../../../examples/sub4me/index.html');
  if (existsSync(page)) return extractSub4MeData(readFileSync(page, 'utf8'));
  throw new Error('Sub4Me sample data not found');
}

export const SUB4ME_TOOL_DEFINITIONS = [
  {
    name: 'list_contracts',
    description:
      'List the contracts of the fictional Sub4Me customer (Muster Industrie AG) with SAP, with status, term, notice period and annual value. Optionally filter by status (Active, Renewal due, Expired). Answers questions such as "how many contracts have expired?". Sample data from the Sub4Me example Space.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: CONTRACT_STATUSES, description: 'Only contracts with this status.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_offers',
    description:
      'List the open offers (quotes) SAP made to the Sub4Me customer: renewal offers for existing contracts and offers for new products such as Joule Work for Desktop, with term, annual value, change versus today, validity date and status. Optionally filter by type (Renewal, New product) or status. Answers questions such as "which offers are open?" or "what does the renewal of Ariba cost?". Sample data from the Sub4Me example Space.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: OFFER_TYPES, description: 'Only offers of this type.' },
        status: { type: 'string', enum: OFFER_STATUSES, description: 'Only offers with this status.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_ai_consumption',
    description:
      'AI-unit consumption of the Sub4Me customer: yearly allotment, units used so far, remaining units, year-end forecast, month of exhaustion, and per product the allotment, consumed, remaining, monthly values, share of the total and forecast. Without arguments it returns the overview; with `product` (for example "Joule copilots") it returns that product in detail; with `month` (1-12) the units used in that month in total and per product. Sample data from the Sub4Me example Space.',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'Product name, case-insensitive, partial names work (for example "ariba").' },
        month: { type: 'integer', minimum: 1, maximum: 12, description: 'Calendar month of the contract year (1 = January).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_customer_overview',
    description:
      'Everything about the Sub4Me test customer (Muster Industrie AG) in one answer: master data (name, customer number, contact, country), contracts by status with annual value and those ending soon, open offers, AI-unit consumption with forecast, service tickets by status and priority, plus highlights that need attention (renewals due, offers about to expire, products forecast to exceed their allotment). Use it for broad questions such as "give me the full picture of the customer". Sample data from the Sub4Me example Space; tickets come from Supabase when connected.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_product_overview',
    description:
      'Everything about one Sub4Me product in one answer: its contracts, offers (renewal or new), AI-unit consumption with forecast, and service tickets. Partial product names work (for example "ariba", "Joule"). Sample data from the Sub4Me example Space.',
    inputSchema: {
      type: 'object',
      properties: { product: { type: 'string', description: 'Product name, case-insensitive, partial names work.' } },
      required: ['product'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_contract',
    description:
      'One Sub4Me contract by id (for example "C-2025-0041"): terms, days until the end, the last day to give notice, linked renewal offers, consumption of the product and its service tickets. Sample data from the Sub4Me example Space.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Contract id.' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_offer',
    description:
      'One SAP offer to the Sub4Me customer by id: type, term, annual value versus today, validity, status and the contract it renews. Sample data from the Sub4Me example Space.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Offer id.' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_sub4me',
    description:
      'Free-text search across everything of the Sub4Me customer: products, contracts, offers and service tickets (ids, titles, products, status). Use it when the person names something and it is unclear what it is.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search text, at least 2 characters.' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const sum = (list) => list.reduce((a, b) => a + b, 0);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Year-end projection, the same rule the Space uses: the average of the last three full months continues;
 * the last value is the running (partial) month as of `asOf`.
 */
export function projectUnits(monthly, allotment, asOf) {
  const date = new Date(`${asOf}T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const fractionLeft = (daysInMonth - date.getUTCDate()) / daysInMonth;
  const monthsAfter = 12 - (date.getUTCMonth() + 1);
  const used = sum(monthly);
  const full = monthly.slice(-4, -1);
  const avg = full.length ? sum(full) / full.length : 0;
  const forecast = Math.round(used + avg * fractionLeft + avg * monthsAfter);
  let exhaustedIn = null;
  let running = used + avg * fractionLeft;
  if (running >= allotment) exhaustedIn = MONTHS[date.getUTCMonth()];
  for (let m = date.getUTCMonth() + 1; exhaustedIn === null && m < 12; m += 1) {
    running += avg;
    if (running >= allotment) exhaustedIn = MONTHS[m];
  }
  return {
    averagePerMonth: Math.round(avg),
    forecastYearEnd: forecast,
    forecastPct: pct(forecast, allotment),
    exhaustedIn: forecast > allotment ? exhaustedIn : null,
    lastMonthChangePct: monthly.length >= 3 && monthly.at(-2) ? pct(monthly.at(-2) - monthly.at(-3), monthly.at(-3)) : null,
  };
}

const countBy = (list, key) => list.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] ?? 0) + 1 }), {});
const sameProduct = (a, b) => {
  const x = String(a ?? '').toLowerCase();
  const y = String(b ?? '').toLowerCase();
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
};
const noticeDeadline = (contract) => new Date(Date.parse(`${contract.end}T00:00:00Z`) - (contract.noticeDays ?? 0) * 864e5).toISOString().slice(0, 10);

function matchProduct(d, name) {
  const needle = String(name ?? '').trim().toLowerCase();
  if (!needle) throw new ToolError('product is required');
  const match = d.products.find((p) => p.name.toLowerCase() === needle) ?? d.products.find((p) => p.name.toLowerCase().includes(needle));
  if (!match) throw new ToolError(`Unknown product "${name}". Known: ${d.products.map((p) => p.name).join(', ')}`);
  return match;
}

/** Real tickets live in Supabase; without a connection (or on an error) the sample tickets of the Space are used. */
async function ticketsOf(d, rpc) {
  if (rpc) {
    try {
      const list = await rpc('sub4me_tickets', {});
      if (Array.isArray(list)) return { list, dataSource: 'supabase' };
    } catch {
      // fall back to the sample tickets below
    }
  }
  return { list: d.tickets ?? [], dataSource: 'sample data (Supabase not connected)' };
}

export function createSub4MeHandlers(load = loadSub4MeData, rpc = null) {
  const data = () => {
    try {
      return load();
    } catch (error) {
      throw new ToolError(`Sub4Me sample data unavailable: ${error.message}`);
    }
  };
  const source = 'sample data (Sub4Me example Space)';
  const self = {
    list_contracts(args) {
      const { status } = args;
      if (status !== undefined && !CONTRACT_STATUSES.includes(status)) {
        throw new ToolError(`status must be one of: ${CONTRACT_STATUSES.join(', ')}`);
      }
      const d = data();
      const all = d.contracts;
      const list = status ? all.filter((c) => c.status === status) : all;
      const byStatus = Object.fromEntries(CONTRACT_STATUSES.map((s) => [s, all.filter((c) => c.status === s).length]));
      return {
        customer: d.customer?.name,
        asOf: d.asOf,
        count: list.length,
        totalContracts: all.length,
        byStatus,
        annualValueEur: list.reduce((sum, c) => sum + c.annualEur, 0),
        contracts: list,
        view: { space: 'sub4me', tab: 'contracts' },
        dataSource: source,
      };
    },
    list_offers(args = {}) {
      const { type, status } = args;
      if (type !== undefined && !OFFER_TYPES.includes(type)) throw new ToolError(`type must be one of: ${OFFER_TYPES.join(', ')}`);
      if (status !== undefined && !OFFER_STATUSES.includes(status)) throw new ToolError(`status must be one of: ${OFFER_STATUSES.join(', ')}`);
      const d = data();
      const all = d.offers ?? [];
      const asOf = new Date(`${d.asOf}T00:00:00Z`);
      const list = all
        .filter((o) => (!type || o.type === type) && (!status || o.status === status))
        .map((o) => ({
          ...o,
          changeVsTodayPct: o.currentAnnualEur ? Math.round((o.annualEur / o.currentAnnualEur - 1) * 1000) / 10 : null,
          daysUntilExpiry: Math.round((new Date(`${o.validUntil}T00:00:00Z`) - asOf) / 864e5),
        }));
      return {
        customer: d.customer?.name,
        asOf: d.asOf,
        count: list.length,
        totalOffers: all.length,
        byType: Object.fromEntries(OFFER_TYPES.map((t) => [t, all.filter((o) => o.type === t).length])),
        byStatus: Object.fromEntries(OFFER_STATUSES.map((st) => [st, all.filter((o) => o.status === st).length])),
        annualValueEur: sum(list.map((o) => o.annualEur)),
        offers: list,
        view: { space: 'sub4me', tab: 'contracts' },
        dataSource: source,
      };
    },
    get_ai_consumption(args = {}) {
      const { product, month } = args;
      if (month !== undefined && !(Number.isInteger(month) && month >= 1 && month <= 12)) {
        throw new ToolError('month must be an integer from 1 to 12');
      }
      const d = data();
      const allotment = d.aiUnits.allotment;
      const total = d.aiUnits.monthly;
      const used = sum(total);
      const describe = (p) => {
        const consumed = sum(p.monthly ?? []) || p.consumed;
        return {
          name: p.name,
          meters: p.meters,
          allotment: p.allotment,
          consumed,
          remaining: p.allotment - consumed,
          usedPct: pct(consumed, p.allotment),
          shareOfTotalPct: pct(consumed, used),
          monthly: p.monthly,
          ...(p.monthly ? projectUnits(p.monthly, p.allotment, d.asOf) : {}),
        };
      };
      let products = d.products.map(describe);
      if (product !== undefined) {
        const needle = String(product).trim().toLowerCase();
        products = needle ? products.filter((p) => p.name.toLowerCase().includes(needle)) : [];
        if (!products.length) {
          throw new ToolError(`Unknown product "${product}". Known: ${d.products.map((p) => p.name).join(', ')}`);
        }
      }
      const result = {
        customer: d.customer?.name,
        asOf: d.asOf,
        period: { start: d.aiUnits.periodStart, end: d.aiUnits.periodEnd },
        allotment,
        usedSoFar: used,
        usedPct: pct(used, allotment),
        remaining: allotment - used,
        ...projectUnits(total, allotment, d.asOf),
        monthly: total,
        monthNames: MONTHS.slice(0, total.length),
        products,
        productsConsumedTotal: sum(d.products.map((p) => sum(p.monthly ?? []) || p.consumed)),
        view: { space: 'sub4me', tab: 'usage' },
        dataSource: source,
      };
      if (month !== undefined) {
        const index = month - 1;
        result.month = {
          number: month,
          name: MONTHS[index],
          unitsTotal: total[index] ?? null,
          partial: index === total.length - 1,
          byProduct: products.map((p) => ({ name: p.name, units: p.monthly?.[index] ?? null })),
        };
      }
      return result;
    },

    /* ---- 360 degree views: built from the same sample data as the tools above ---- */
    async get_customer_overview() {
      const d = data();
      const asOf = new Date(`${d.asOf}T00:00:00Z`);
      const days = (iso) => Math.round((new Date(`${iso}T00:00:00Z`) - asOf) / 864e5);
      const { list: tickets, dataSource: ticketSource } = await ticketsOf(d, rpc);
      const consumption = self.get_ai_consumption({});
      const contracts = d.contracts;
      const offers = d.offers ?? [];
      const openOffers = offers.filter((o) => o.status === 'Open' || o.status === 'In negotiation');
      const endingSoon = contracts.filter((c) => c.status !== 'Expired' && days(c.end) >= 0 && days(c.end) <= 120).map((c) => ({ id: c.id, product: c.product, end: c.end, daysUntilEnd: days(c.end), noticeDeadline: noticeDeadline(c) }));
      const closed = (t) => t.status === 'Closed' || t.status === 'Solution provided';
      const atRisk = consumption.products.filter((p) => p.forecastYearEnd > p.allotment).map((p) => ({ name: p.name, forecastPct: p.forecastPct, exhaustedIn: p.exhaustedIn }));
      const expiringOffers = openOffers.filter((o) => days(o.validUntil) <= 30).map((o) => ({ id: o.id, product: o.product, validUntil: o.validUntil, daysLeft: days(o.validUntil) }));
      const highlights = [];
      for (const c of endingSoon) highlights.push(`Contract ${c.id} (${c.product}) ends in ${c.daysUntilEnd} days; notice deadline ${c.noticeDeadline}${c.noticeDeadline < d.asOf ? ' (already passed)' : ''}.`);
      for (const o of expiringOffers) highlights.push(`Offer ${o.id} (${o.product}) is valid for ${o.daysLeft} more days.`);
      for (const p of atRisk) highlights.push(`${p.name} is forecast to use ${p.forecastPct}% of its AI-unit allotment${p.exhaustedIn ? `, exhausted in ${p.exhaustedIn}` : ''}.`);
      const expired = contracts.filter((c) => c.status === 'Expired');
      if (expired.length) highlights.push(`${expired.length} contract(s) expired: ${expired.map((c) => c.id).join(', ')}.`);
      return {
        customer: d.customer,
        asOf: d.asOf,
        products: d.products.map((p) => p.name),
        contracts: {
          total: contracts.length,
          byStatus: Object.fromEntries(CONTRACT_STATUSES.map((st) => [st, contracts.filter((c) => c.status === st).length])),
          annualValueEur: sum(contracts.filter((c) => c.status !== 'Expired').map((c) => c.annualEur)),
          endingWithin120Days: endingSoon,
        },
        offers: {
          total: offers.length,
          byStatus: Object.fromEntries(OFFER_STATUSES.map((st) => [st, offers.filter((o) => o.status === st).length])),
          open: openOffers.map((o) => ({ id: o.id, type: o.type, product: o.product, annualEur: o.annualEur, validUntil: o.validUntil })),
          openValueEur: sum(openOffers.map((o) => o.annualEur)),
        },
        aiUnits: {
          allotment: consumption.allotment,
          usedSoFar: consumption.usedSoFar,
          usedPct: consumption.usedPct,
          remaining: consumption.remaining,
          forecastYearEnd: consumption.forecastYearEnd,
          forecastPct: consumption.forecastPct,
          exhaustedIn: consumption.exhaustedIn,
          productsForecastOverAllotment: atRisk,
        },
        tickets: {
          total: tickets.length,
          open: tickets.filter((t) => !closed(t)).length,
          byStatus: countBy(tickets, 'status'),
          byPriority: countBy(tickets, 'priority'),
          latest: tickets.slice(0, 5),
        },
        highlights,
        view: { space: 'sub4me', tab: 'overview' },
        dataSource: `${source}; tickets: ${ticketSource}`,
      };
    },
    async get_product_overview(args = {}) {
      const d = data();
      const match = matchProduct(d, args.product);
      const { list: tickets, dataSource: ticketSource } = await ticketsOf(d, rpc);
      const consumption = self.get_ai_consumption({ product: match.name });
      return {
        customer: d.customer?.name,
        asOf: d.asOf,
        product: match.name,
        consumption: consumption.products[0],
        contracts: d.contracts.filter((c) => sameProduct(c.product, match.name)),
        offers: (d.offers ?? []).filter((o) => sameProduct(o.product, match.name)),
        tickets: tickets.filter((t) => sameProduct(t.product, match.name)),
        view: { space: 'sub4me', tab: 'usage' },
        dataSource: `${source}; tickets: ${ticketSource}`,
      };
    },
    async get_contract(args = {}) {
      const d = data();
      const id = String(args.id ?? '').trim().toLowerCase();
      if (!id) throw new ToolError('id is required');
      const contract = d.contracts.find((c) => c.id.toLowerCase() === id);
      if (!contract) throw new ToolError(`No contract with id "${args.id}". Known ids: ${d.contracts.map((c) => c.id).join(', ')}`);
      const asOf = new Date(`${d.asOf}T00:00:00Z`);
      const { list: tickets, dataSource: ticketSource } = await ticketsOf(d, rpc);
      const consumption = d.products.some((p) => sameProduct(p.name, contract.product)) ? self.get_ai_consumption({ product: contract.product }).products[0] : null;
      return {
        customer: d.customer?.name,
        asOf: d.asOf,
        contract: {
          ...contract,
          daysUntilEnd: Math.round((new Date(`${contract.end}T00:00:00Z`) - asOf) / 864e5),
          noticeDeadline: noticeDeadline(contract),
        },
        renewalOffers: (d.offers ?? []).filter((o) => o.contractId === contract.id),
        consumption,
        tickets: tickets.filter((t) => sameProduct(t.product, contract.product)),
        view: { space: 'sub4me', tab: 'contracts' },
        dataSource: `${source}; tickets: ${ticketSource}`,
      };
    },
    get_offer(args = {}) {
      const d = data();
      const id = String(args.id ?? '').trim().toLowerCase();
      if (!id) throw new ToolError('id is required');
      const offers = d.offers ?? [];
      const offer = offers.find((o) => o.id.toLowerCase() === id);
      if (!offer) throw new ToolError(`No offer with id "${args.id}". Known ids: ${offers.map((o) => o.id).join(', ')}`);
      const asOf = new Date(`${d.asOf}T00:00:00Z`);
      return {
        customer: d.customer?.name,
        asOf: d.asOf,
        offer: {
          ...offer,
          changeVsTodayPct: offer.currentAnnualEur ? Math.round((offer.annualEur / offer.currentAnnualEur - 1) * 1000) / 10 : null,
          daysUntilExpiry: Math.round((new Date(`${offer.validUntil}T00:00:00Z`) - asOf) / 864e5),
        },
        renewsContract: offer.contractId ? d.contracts.find((c) => c.id === offer.contractId) ?? null : null,
        view: { space: 'sub4me', tab: 'contracts' },
        dataSource: source,
      };
    },
    async search_sub4me(args = {}) {
      const query = String(args.query ?? '').trim().toLowerCase();
      if (query.length < 2) throw new ToolError('query must be at least 2 characters');
      const d = data();
      const { list: tickets, dataSource: ticketSource } = await ticketsOf(d, rpc);
      const hit = (item) => Object.values(item).some((v) => typeof v === 'string' && v.toLowerCase().includes(query));
      const cap = (list) => list.slice(0, 10);
      return {
        query: args.query,
        products: cap(d.products.filter((p) => p.name.toLowerCase().includes(query)).map((p) => p.name)),
        contracts: cap(d.contracts.filter(hit)),
        offers: cap((d.offers ?? []).filter(hit)),
        tickets: cap(tickets.filter(hit)),
        dataSource: `${source}; tickets: ${ticketSource}`,
      };
    },
  };
  return self;
}
