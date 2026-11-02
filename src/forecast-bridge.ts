/**
 * Bridge for the two Controlling forecasts. The Control Tower Space may ask for the budget forecast, the Finance
 * Pre-Close Space for the accrual estimate; each Space can send only its own request and nothing else reaches the
 * connector from here. The answer is cut down to the fields the Space renders.
 */
import { parseToolResult, type BridgeCall } from './sub4me-bridge.ts';

export const CONTROL_TOWER_BRIDGE_SPACE = 'ai-control-tower';
export const PRECLOSE_SPACE = 'finance-preclose';
/** Both tools live in the AI Control Tower connector. */
export const FORECAST_EXTENSION = 'ai-control-tower';

const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const ENTITY = /^[A-Z]{2}[0-9]{2}$/;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown, max: number): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject).slice(0, max) : []);

const header = (raw: Record<string, unknown>) => ({
  engine: str(raw.engine, 20), engineNote: str(raw.engineNote, 300), trainedOn: str(raw.trainedOn, 80), band: str(raw.band, 80),
});

export function pickBudgetForecast(raw: unknown): Record<string, unknown> | null {
  if (!isObject(raw) || !Array.isArray(raw.items)) return null;
  return {
    ...header(raw), month: str(raw.month, 7), day: num(raw.day), daysInMonth: num(raw.daysInMonth),
    items: list(raw.items, 50).map((i) => ({
      name: str(i.name, 60), budgetK: num(i.budgetK), spentK: num(i.spentK), runRateK: num(i.runRateK),
      p10K: num(i.p10K), p50K: num(i.p50K), p90K: num(i.p90K), p10Pct: num(i.p10Pct), p50Pct: num(i.p50Pct), p90Pct: num(i.p90Pct),
      overrunProbability: num(i.overrunProbability) ?? 0, status: str(i.status, 20),
    })),
  };
}

export function pickAccrualEstimate(raw: unknown): Record<string, unknown> | null {
  if (!isObject(raw) || !Array.isArray(raw.items)) return null;
  return {
    ...header(raw), tolerancePct: num(raw.tolerancePct) ?? 10, asOfWd: num(raw.asOfWd),
    items: list(raw.items, 200).map((i) => ({
      id: str(i.id, 40), entity: str(i.entity, 10), line: str(i.line, 30), amountK: num(i.amountK),
      p10K: num(i.p10K), p50K: num(i.p50K), p90K: num(i.p90K), correctionProbability: num(i.correctionProbability) ?? 0, risk: str(i.risk, 10),
    })),
  };
}

async function answer(requestId: string, call: BridgeCall | undefined, run: (call: BridgeCall) => Promise<Record<string, unknown> | null>, type: string, key: string) {
  const fail = (message: string) => ({ type: 'ct:error', requestId, message });
  if (!call) return fail('The agent is not connected yet.');
  try {
    const picked = await run(call);
    return picked ? { type, requestId, [key]: picked } : fail('unexpected answer');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Control Tower Space: `ct:budget-forecast-request` → `ct:budget-forecast`. */
export async function handleControlTowerForecastMessage(data: unknown, call: BridgeCall | undefined): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || data.type !== 'ct:budget-forecast-request') return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  return answer(requestId, call, async (c) => pickBudgetForecast(parseToolResult(await c('forecast_budget', {}))), 'ct:budget-forecast', 'forecast');
}

/** Pre-Close Space: `ct:accrual-estimate-request` → `ct:accrual-estimate`. */
export async function handlePrecloseForecastMessage(data: unknown, call: BridgeCall | undefined): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || data.type !== 'ct:accrual-estimate-request') return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const args: Record<string, unknown> = {};
  if (typeof data.entity === 'string' && ENTITY.test(data.entity)) args.entity = data.entity;
  if (typeof data.workingDay === 'number' && Number.isInteger(data.workingDay) && data.workingDay >= 1 && data.workingDay <= 22) args.working_day = data.workingDay;
  return answer(requestId, call, async (c) => pickAccrualEstimate(parseToolResult(await c('estimate_accruals', args))), 'ct:accrual-estimate', 'estimate');
}
