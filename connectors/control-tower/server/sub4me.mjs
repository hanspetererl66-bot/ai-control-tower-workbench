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
    name: 'get_ai_consumption',
    description:
      'AI-unit consumption of the Sub4Me customer: yearly allotment, units used so far, forecast, and the split by product (allotment, consumed, percent). Sample data from the Sub4Me example Space.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

export function createSub4MeHandlers(load = loadSub4MeData) {
  const data = () => {
    try {
      return load();
    } catch (error) {
      throw new ToolError(`Sub4Me sample data unavailable: ${error.message}`);
    }
  };
  const source = 'sample data (Sub4Me example Space)';
  return {
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
    get_ai_consumption() {
      const d = data();
      const used = d.aiUnits.monthly.reduce((a, b) => a + b, 0);
      const productsConsumed = d.products.reduce((sum, p) => sum + p.consumed, 0);
      return {
        customer: d.customer?.name,
        asOf: d.asOf,
        period: { start: d.aiUnits.periodStart, end: d.aiUnits.periodEnd },
        allotment: d.aiUnits.allotment,
        usedSoFar: used,
        usedPct: pct(used, d.aiUnits.allotment),
        monthly: d.aiUnits.monthly,
        products: d.products.map((p) => ({ ...p, usedPct: pct(p.consumed, p.allotment) })),
        productsConsumedTotal: productsConsumed,
        view: { space: 'sub4me', tab: 'usage' },
        dataSource: source,
      };
    },
  };
}
