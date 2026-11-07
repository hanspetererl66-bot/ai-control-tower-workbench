/**
 * Reading the agent observability data (schema `observability`, migrations 036 and 037) for the Observability space.
 * Only the app's main process calls this, as the stored e-mail. Seven reading functions, no writing, no free SQL: the view name picks
 * the function and only the listed arguments are passed on. The database does the counting; this file only checks the form.
 */
export const VIEWS = {
  fleet: { fn: 'obs_dashboard', args: ['days'] },
  runs: { fn: 'obs_runs', args: ['agent', 'status', 'days', 'limit', 'before', 'minCost'] },
  trace: { fn: 'obs_trace', args: ['runId'] },
  quality: { fn: 'obs_quality', args: [] },
  safety: { fn: 'obs_safety', args: ['days'] },
  cost: { fn: 'obs_cost', args: ['days'] },
  alerts: { fn: 'obs_alerts', args: ['status'] },
};

const AGENT = /^[a-z0-9-]{2,60}$/;
const STATUS = ['ok', 'error', 'blocked', 'escalated'];
const ALERT_STATUS = ['open', 'acknowledged', 'resolved'];
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

/** The database argument object for a view, or throws when something is not in the expected form. */
export function observeArgs(view, params, actor) {
  const spec = VIEWS[view];
  if (!spec) throw new Error('Unknown view.');
  const p = params && typeof params === 'object' ? params : {};
  const out = { p_actor: actor };
  for (const k of spec.args) {
    const v = p[k];
    if (v === undefined || v === null || v === '') continue;
    if (k === 'days') { const d = int(v, 1, 90); if (d === null) throw new Error('days must be 1 to 90'); out.p_days = d; }
    else if (k === 'agent') { if (typeof v !== 'string' || !AGENT.test(v)) throw new Error('bad agent'); out.p_agent = v; }
    else if (k === 'status') {
      const allowed = view === 'alerts' ? ALERT_STATUS : STATUS;
      if (!allowed.includes(v)) throw new Error('bad status');
      out.p_status = v;
    }
    else if (k === 'limit') { const n = int(v, 1, 200); if (n === null) throw new Error('bad limit'); out.p_limit = n; }
    else if (k === 'before') { if (!Number.isSafeInteger(v) || v < 1) throw new Error('bad page'); out.p_before = v; }
    else if (k === 'minCost') { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000) throw new Error('bad cost'); out.p_min_cost = v; }
    else if (k === 'runId') { if (!Number.isSafeInteger(v) || v < 1) throw new Error('bad run'); out.p_run_id = v; }
  }
  if (view === 'trace' && out.p_run_id === undefined) throw new Error('A run is needed.');
  return out;
}

export async function observeCall(rpc, actor, view, params) {
  const spec = VIEWS[view];
  if (!spec) throw new Error('Unknown view.');
  return rpc(spec.fn, observeArgs(view, params, actor));
}
