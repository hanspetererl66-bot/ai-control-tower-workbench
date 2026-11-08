/**
 * Bridge for the Agent Observability Space. The Space may send one kind of request and nothing else:
 *   ob:get-request {view, params} → ob:data {view, data}
 * The views are fixed (fleet, runs, trace, quality, safety, cost, alerts). The reading goes through the main process as the stored
 * e-mail, never through the agent, and only reads: nothing in this path can change a run, an alert or a review.
 * The answer is cut down by `clean`: depth, list length and text length are limited, so a wrong answer cannot flood the page.
 */
export const OBSERVABILITY_SPACE = 'agent-observability';

export const VIEWS = ['fleet', 'runs', 'trace', 'quality', 'safety', 'cost', 'alerts'] as const;
export type View = (typeof VIEWS)[number];

export interface ObservabilityHost {
  observe: (view: string, params: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const AGENT = /^[a-z0-9-]{2,60}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Only the parameters a view knows, in the expected form. Anything else is dropped. */
export function pickParams(view: View, raw: unknown): Record<string, unknown> {
  const p = isObject(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  const days = p.days;
  if ((view === 'fleet' || view === 'runs' || view === 'safety' || view === 'cost') && typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= 90) out.days = days;
  if (view === 'runs') {
    if (typeof p.agent === 'string' && AGENT.test(p.agent)) out.agent = p.agent;
    if (typeof p.status === 'string' && ['ok', 'error', 'blocked', 'escalated'].includes(p.status)) out.status = p.status;
    if (typeof p.limit === 'number' && Number.isInteger(p.limit) && p.limit >= 1 && p.limit <= 200) out.limit = p.limit;
    if (typeof p.before === 'number' && Number.isSafeInteger(p.before) && p.before >= 1) out.before = p.before;
    if (typeof p.minCost === 'number' && Number.isFinite(p.minCost) && p.minCost >= 0 && p.minCost <= 1000) out.minCost = p.minCost;
  }
  if (view === 'trace' && typeof p.runId === 'number' && Number.isSafeInteger(p.runId) && p.runId >= 1) out.runId = p.runId;
  if (view === 'alerts' && typeof p.status === 'string' && ['open', 'acknowledged', 'resolved'].includes(p.status)) out.status = p.status;
  return out;
}

/** Limits depth, list length and text length of whatever the database sent. Numbers, booleans and null pass unchanged. */
export function clean(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  if (typeof value === 'string') return value.slice(0, 300);
  if (depth >= 7) return null;
  if (Array.isArray(value)) return value.slice(0, 2000).map((v) => clean(v, depth + 1));
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 80)) out[k.slice(0, 40)] = clean(v, depth + 1);
    return out;
  }
  return null;
}

export async function handleObservabilityMessage(data: unknown, host: ObservabilityHost | undefined): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || data.type !== 'ob:get-request') return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'ct:error', requestId, message });
  const view = VIEWS.find((v) => v === data.view);
  if (!view) return fail('Unknown view.');
  if (!host) return fail('Agent observability needs the desktop app and the shared database.');
  try {
    const res = await host.observe(view, pickParams(view, data.params));
    return res.ok ? { type: 'ob:data', requestId, view, data: clean(res.data) } : fail(res.error);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
