/**
 * Bridge for the shadow protocol of the Orchestrator Space. The Space may send three fixed requests and nothing else:
 *   sh:start-request   → sh:started   (the decisions of one run; the answer carries the id of each decision)
 *   sh:verdict-request → sh:verdict   (a person's verdict on one decision: agree, or disagree with a reason)
 *   sh:summary-request → sh:summary   (the numbers of the whole protocol)
 * Everything runs through the main process as the stored e-mail, not through the agent: the agent has no tool for it.
 * Requests and answers are cut down to the fields below.
 */
type Res = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
export interface ShadowHost {
  start: (run: Record<string, unknown>, decisions: Record<string, unknown>[]) => Promise<Res>;
  verdict?: (decisionId: number, verdict: string, reason: string, note: string) => Promise<Res>;
  summary?: () => Promise<Res>;
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const ID = /^[A-Za-z0-9._:-]{1,40}$/;
const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1_000_000, Math.round(v))) : 0);
export const SHADOW_REASONS = ['floor-missed', 'over-cautious', 'wrong-window', 'wrong-customer-rule', 'wrong-plan', 'other'];

export function pickDecisions(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const d of raw.slice(0, 100)) {
    if (!isObject(d) || typeof d.findingId !== 'string' || !ID.test(d.findingId) || typeof d.host !== 'string' || !HOST.test(d.host)) continue;
    out.push({ findingId: d.findingId, host: d.host, kind: str(d.kind, 20), template: str(d.template, 30), env: str(d.env, 3), customer: typeof d.customer === 'string' && /^[a-z0-9]{0,12}$/.test(d.customer) ? d.customer : '',
      deadlineDays: num(d.deadlineDays), mode: str(d.mode, 10), customerNeeded: d.customerNeeded === true, floors: (Array.isArray(d.floors) ? d.floors : []).slice(0, 5).map((f) => str(f, 20)).filter(Boolean),
      windowStart: typeof d.windowStart === 'string' && TIME.test(d.windowStart) ? d.windowStart : '', windowEnd: typeof d.windowEnd === 'string' && TIME.test(d.windowEnd) ? d.windowEnd : '', why: str(d.why, 300) });
  }
  return out;
}

export async function handleShadowMessage(data: unknown, host: ShadowHost | undefined): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || typeof data.type !== 'string' || !['sh:start-request', 'sh:verdict-request', 'sh:summary-request'].includes(data.type)) return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'ct:error', requestId, message });
  if (!host) return fail('The shadow protocol needs the desktop app and the shared database.');
  try {
    if (data.type === 'sh:start-request') {
      const run = isObject(data.run) ? { adapter: str(data.run.adapter, 30), fetchedAt: str(data.run.fetchedAt, 16), alerts: num(data.run.alerts), skipped: num(data.run.skipped), withheld: num(data.run.withheld) } : null;
      const decisions = pickDecisions(data.decisions);
      if (!run || !decisions.length) return fail('A run needs its numbers and at least one decision.');
      const res = await host.start(run, decisions);
      if (!res.ok) return fail(res.error);
      const ids: Record<string, number> = {};
      if (isObject(res.data.decisions)) for (const [k, v] of Object.entries(res.data.decisions)) if (ID.test(k) && typeof v === 'number') ids[k] = v;
      return { type: 'sh:started', requestId, runId: num(res.data.runId), decisions: ids };
    }
    if (data.type === 'sh:verdict-request') {
      const id = data.decisionId;
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return fail('Unknown decision.');
      const verdict = data.verdict === 'agree' || data.verdict === 'disagree' ? data.verdict : '';
      const reason = typeof data.reason === 'string' && SHADOW_REASONS.includes(data.reason) ? data.reason : '';
      if (!verdict) return fail('The verdict must be agree or disagree.');
      if (verdict === 'disagree' && !reason) return fail('A disagreement needs a reason.');
      if (!host.verdict) return fail('Judging needs the desktop app.');
      const res = await host.verdict(id, verdict, verdict === 'agree' ? '' : reason, str(data.note, 300).trim());
      return res.ok ? { type: 'sh:verdict', requestId, decisionId: id, verdict, reason: verdict === 'agree' ? '' : reason } : fail(res.error);
    }
    if (!host.summary) return fail('The summary needs the desktop app.');
    const res = await host.summary();
    if (!res.ok) return fail(res.error);
    const d = res.data, by: Record<string, number> = {};
    if (isObject(d.byReason)) for (const [k, v] of Object.entries(d.byReason)) if (SHADOW_REASONS.includes(k)) by[k] = num(v);
    return { type: 'sh:summary', requestId, summary: { runs: num(d.runs), decisions: num(d.decisions), auto: num(d.auto), judged: num(d.judged), agree: num(d.agree), disagree: num(d.disagree), floorMissed: num(d.floorMissed), byReason: by } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
