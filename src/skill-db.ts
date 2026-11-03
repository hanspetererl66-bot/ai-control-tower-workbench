import { decide, type SkillGov } from './skill-governance.ts';

/** A request as the database lists it (skills_promotion_list). */
export type DbRequest = { id: string; slug: string; to_scope: 'team' | 'company'; status: 'blocked' | 'review' | 'approved' | 'rejected' | 'withdrawn'; reason?: string; can_decide?: boolean; decided_at?: string | null };

/**
 * Bring the local copy of the approval queue in line with the database, which decides.
 * Only requests that carry a database id and are still pending locally are touched: approved moves the skill up,
 * rejected, withdrawn or blocked closes the request. Nothing is ever created from the database here.
 */
export function reconcile(gov: SkillGov, rows: DbRequest[], now = Date.now()): SkillGov {
  let next = gov;
  for (const r of gov.requests) {
    if (r.status !== 'pending' || !r.dbId) continue;
    const row = rows.find((x) => x.id === r.dbId);
    if (!row) continue;
    const at = row.decided_at ? Date.parse(row.decided_at) || now : now;
    if (row.status === 'approved') next = decide(next, r.id, true, row.reason ?? '', at);
    else if (row.status === 'rejected' || row.status === 'withdrawn' || row.status === 'blocked') next = decide(next, r.id, false, row.reason || (row.status === 'withdrawn' ? 'Withdrawn' : row.status === 'blocked' ? 'Blocked by an automatic check' : ''), at);
  }
  return next;
}

/** Which database level a local level step means. */
export const dbTarget = (to: 1 | 2): 'team' | 'company' => (to === 1 ? 'team' : 'company');
