/**
 * Two TabPFN forecasts for the Controlling area, both read-only and both answered by the service in services/tabpfn:
 *  - forecast_budget:   where each cost group's monthly AI budget will end, with a band and the chance of an overrun
 *  - estimate_accruals: for the proposed month-end accruals, between which amounts the invoice will probably land and
 *                       which proposals will probably have to be corrected
 * The models are trained on synthetic history. Without a configured service the tools say so and never invent numbers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serviceUrl } from './payment-risk.mjs';

export const FINANCE_FORECAST_TOOL_DEFINITIONS = [
  {
    name: 'forecast_budget',
    description:
      'Forecast the month-end spend of each cost group against its monthly AI budget. Returns, per group, the spend so far, the expected month-end spend with an 80 % band (10th to 90th percentile), the probability of ending above budget and a status (on track, at risk, likely over), plus the model engine (TabPFN or a fallback baseline). Based on the spend so far this month and the last six months; trained on synthetic data, so it shows the method and is not a binding forecast. Use it for questions such as "Welche Teams überschreiten ihr AI-Budget diesen Monat?". Read-only.',
    inputSchema: {
      type: 'object',
      properties: { group: { type: 'string', description: 'Optional: only this cost group, for example "Engineering".' } },
      additionalProperties: false,
    },
  },
  {
    name: 'estimate_accruals',
    description:
      'Estimate the proposed month-end accruals of the Finance Pre-Close sample (fictional group "Nordlicht"): for each proposal an interval (10th to 90th percentile) for the amount the supplier invoice will probably show, and the probability that the final amount differs by more than 10 % so the accrual has to be corrected. Highest correction risk first. Returns the model engine (TabPFN or a fallback baseline). Trained on synthetic data, so it shows the method and is not an audit statement. Use it for questions such as "Welche Rückstellungen muss ich wahrscheinlich korrigieren?". Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Optional company code, for example "DE10", "FR10", "UK10" or "US10".' },
        working_day: { type: 'integer', minimum: 1, maximum: 22, description: 'Optional working day of the close; proposals made after that day are not yet known. Default: the day of the sample data.' },
      },
      additionalProperties: false,
    },
  },
];

const TIMEOUT_MS = 90000;
const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Bundled copy first, then the repository's source of truth when running from a checkout. */
export function loadPreclose() {
  const found = [process.env.PRECLOSE_DATA, here('../data/preclose.json'), here('../../../examples/finance-preclose/preclose.json')].filter(Boolean).find((path) => existsSync(path));
  if (!found) throw new Error('preclose.json not found');
  return JSON.parse(readFileSync(found, 'utf8'));
}

const common = (body) => ({
  engine: text(body.engine, 20),
  engineNote: text(body.engineNote, 300),
  trainedOn: text(body.trainedOn, 80),
  band: text(body.band, 80),
});

export function checkBudgetForecast(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) throw new Error('the forecast service returned an unexpected answer');
  const STATUS = ['on track', 'at risk', 'likely over'];
  return {
    ...common(body),
    day: number(body.day),
    daysInMonth: number(body.daysInMonth),
    items: body.items.slice(0, 50).filter((i) => i && typeof i === 'object').map((i) => ({
      name: text(i.name, 60),
      budgetK: number(i.budgetK), spentK: number(i.spentK), runRateK: number(i.runRateK),
      p10K: number(i.p10K), p50K: number(i.p50K), p90K: number(i.p90K),
      p10Pct: number(i.p10Pct), p50Pct: number(i.p50Pct), p90Pct: number(i.p90Pct),
      overrunProbability: Math.min(1, Math.max(0, number(i.overrunProbability) ?? 0)),
      status: STATUS.includes(i.status) ? i.status : 'on track',
    })),
  };
}

export function checkAccrualEstimate(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) throw new Error('the forecast service returned an unexpected answer');
  const RISKS = ['high', 'medium', 'low'];
  return {
    ...common(body),
    tolerancePct: number(body.tolerancePct) ?? 10,
    asOfWd: number(body.asOfWd),
    items: body.items.slice(0, 200).filter((i) => i && typeof i === 'object').map((i) => ({
      id: text(i.id, 40), entity: text(i.entity, 10), line: text(i.line, 30),
      amountK: number(i.amountK), p10K: number(i.p10K), p50K: number(i.p50K), p90K: number(i.p90K),
      correctionProbability: Math.min(1, Math.max(0, number(i.correctionProbability) ?? 0)),
      risk: RISKS.includes(i.risk) ? i.risk : 'low',
    })),
  };
}

export function createFinanceForecastHandlers({ loadTower, ToolError, env = process.env, fetchImpl = fetch, preclose = loadPreclose }) {
  async function post(path, payload, check) {
    let url;
    try {
      url = serviceUrl(env.TABPFN_SERVICE_URL);
    } catch (error) {
      throw new ToolError(error.message);
    }
    if (!url) throw new ToolError('The forecast service is not configured. Start services/tabpfn (see its README) and set TABPFN_SERVICE_URL, for example http://127.0.0.1:8808.');
    const headers = { 'Content-Type': 'application/json' };
    if (env.TABPFN_SERVICE_TOKEN?.trim()) headers.Authorization = `Bearer ${env.TABPFN_SERVICE_TOKEN.trim()}`;
    let response;
    try {
      response = await fetchImpl(new URL(path, url), { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new ToolError(`The forecast service did not answer (${error.name === 'TimeoutError' ? 'timeout' : 'not reachable'}). Is services/tabpfn running?`);
    }
    if (!response.ok) throw new ToolError(`The forecast service answered HTTP ${response.status}.`);
    try {
      return check(await response.json());
    } catch (error) {
      throw new ToolError(error.message);
    }
  }

  return {
    async forecast_budget(args = {}) {
      const { data, source } = await loadTower();
      const budget = data?.budget;
      const context = budget?.forecastContext;
      const wanted = typeof args.group === 'string' ? args.group.trim().toLowerCase() : '';
      const groups = (budget?.groups ?? []).filter((g) => !wanted || g.name.toLowerCase() === wanted);
      if (!context || !groups.length || groups.some((g) => !Array.isArray(g.historyK))) {
        throw new ToolError(wanted && !groups.length ? `No cost group called "${args.group}".` : 'The budget data has no month context or history for the forecast.');
      }
      const forecast = await post('/forecast/budget', {
        day: context.day, daysInMonth: context.daysInMonth,
        groups: groups.map((g) => ({ name: g.name, budgetK: g.budgetK, mtdK: Math.round((g.budgetK * g.utilisationPct) / 100), historyK: g.historyK })),
      }, checkBudgetForecast);
      return {
        month: text(context.month, 7),
        ...forecast,
        overBudget: forecast.items.filter((i) => i.status === 'likely over').map((i) => i.name),
        dataSource: source,
        disclaimer: 'Demo: trained on synthetic data, not a binding forecast.',
        view: { space: 'ai-control-tower', tab: 'gov' },
      };
    },

    async estimate_accruals(args = {}) {
      const data = preclose();
      const wd = Number.isInteger(args.working_day) ? args.working_day : data.asOfWd;
      const entity = typeof args.entity === 'string' ? args.entity.trim().toUpperCase() : '';
      if (entity && !data.entities.some((e) => e.id === entity)) throw new ToolError(`Unknown company code "${args.entity}". Known: ${data.entities.map((e) => e.id).join(', ')}.`);
      const accruals = data.accruals.filter((a) => a.fromWd <= wd && (!entity || a.entity === entity));
      if (!accruals.length) throw new ToolError('No accrual proposals for that company code and working day.');
      const estimate = await post('/estimate/accruals', {
        asOfWd: wd,
        accruals: accruals.map((a) => ({ id: a.id, entity: a.entity, line: a.line, amountK: a.amountK, confidence: a.confidence, fromWd: a.fromWd })),
      }, checkAccrualEstimate);
      return {
        period: text(data.periodLabel, 40),
        unit: text(data.unit, 20),
        ...estimate,
        likelyCorrections: estimate.items.filter((i) => i.risk === 'high').map((i) => i.id),
        disclaimer: 'Demo: fictional group, trained on synthetic data, not an audit statement.',
        view: { space: 'finance-preclose' },
      };
    },
  };
}
