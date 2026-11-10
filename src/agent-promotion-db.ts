/**
 * Studio agents: request and decide a higher level in the shared database (migration 044), the same rules as for skills.
 * Pure helpers around the connector tools request_agent_promotion, list_agent_requests, decide_agent_request, withdraw_agent_request.
 * The page never sees the key: the calls go through window.host.workCall (electron/work-store.mjs).
 */
import { reconcile, type DbRequest } from './skill-db.ts';
import type { SkillGov } from './skill-governance.ts';
import type { Api } from './work-sync.ts';

/** A row of list_agent_requests. */
export type AgentRequestRow = {
  id: string; item_id: string; name?: string; rev?: number; to: 'team' | 'company';
  status: 'blocked' | 'review' | 'approved' | 'rejected' | 'withdrawn'; reason?: string; decided_at?: string | null; can_decide?: boolean;
  requested_by?: string; checks?: Array<{ id: string; status: 'pass' | 'warn' | 'fail'; detail: string }>;
};

const rowsOf = (data: any): AgentRequestRow[] => (Array.isArray(data?.requests) ? data.requests : []).filter((r: any) => r && typeof r.id === 'string' && typeof r.item_id === 'string');

/** The database requests as the shape `reconcile` (skill-db.ts) reads. The agent is identified by its item id, so slug carries it. */
export const asDbRequests = (rows: AgentRequestRow[]): DbRequest[] => rows.map((r) => ({ id: r.id, slug: r.item_id, to_scope: r.to, status: r.status, reason: r.reason, can_decide: r.can_decide, decided_at: r.decided_at }));

/** Read the requests and bring the local queue in line (the database decides). `canDecide` is per database request id. */
export async function loadAgentRequests(api: Api, gov: SkillGov): Promise<{ gov: SkillGov; canDecide: Record<string, boolean>; rows: AgentRequestRow[] }> {
  const rows = rowsOf(await api.call('list_agent_requests', {}));
  return { gov: reconcile(gov, asDbRequests(rows)), canDecide: Object.fromEntries(rows.map((r) => [r.id, !!r.can_decide])), rows };
}

/** The target for the next step: from level 0 to the department, from level 1 to the organization. */
export const targetFor = (level: 0 | 1 | 2): 'team' | 'company' | null => (level === 0 ? 'team' : level === 1 ? 'company' : null);

/**
 * Ask for the next level. A request the database's own checks block is withdrawn at once, so nothing is left open, and the failed checks are named.
 */
export async function requestAgentLevel(api: Api, a: { itemId: string; level: 0 | 1 | 2; groupId?: string; note?: string }): Promise<{ id?: string; error?: string; warnings?: string[] }> {
  const to = targetFor(a.level);
  if (!to) return { error: 'The agent is already on the top level.' };
  if (to === 'team' && !a.groupId) return { error: 'Choose the department first.' };
  const res = await api.call('request_agent_promotion', { id: a.itemId, to, ...(to === 'team' ? { group: a.groupId } : {}), note: (a.note ?? '').slice(0, 400) });
  const req = res?.request;
  if (!req?.id) return { error: 'The database did not return a request.' };
  const list = rowsOf(await api.call('list_agent_requests', {})).find((r) => r.id === req.id);
  if (req.status === 'blocked') {
    await api.call('withdraw_agent_request', { id: req.id }).catch(() => undefined);
    const failed = (list?.checks ?? []).filter((c) => c.status === 'fail').map((c) => c.detail).join(' ');
    return { error: `The automatic checks failed. ${failed || 'Fix the agent and ask again.'}`.trim() };
  }
  return { id: req.id, warnings: (list?.checks ?? []).filter((c) => c.status === 'warn').map((c) => c.detail) };
}

export async function decideAgentRequest(api: Api, dbId: string, approve: boolean, reason: string): Promise<{ ok: boolean; error?: string }> {
  try { await api.call('decide_agent_request', { id: dbId, approve, reason: reason.slice(0, 400) }); return { ok: true }; }
  catch (e) { return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }; }
}
