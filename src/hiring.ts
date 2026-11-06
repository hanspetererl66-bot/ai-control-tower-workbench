/**
 * Pure helpers of the hiring approval screen. The database decides who may release a proposal (only the hiring manager of the
 * requisition) and keeps the decision final; this file only shapes what the screen shows.
 */
export type Proposal = {
  id: number; requisition: string; candidate: string; kind: 'move' | 'remind' | 'ask'; tool: string; text: string; basis: string;
  status: 'proposed' | 'released' | 'declined'; proposedBy: string; at: string; decidedBy: string | null; decidedAt: string | null; note: string;
};

export const KIND_LABEL: Record<Proposal['kind'], string> = { move: 'Move to the next stage', remind: 'Remind the hiring manager', ask: 'Ask the hiring manager' };

const KINDS = new Set(['move', 'remind', 'ask']);
const STATUS = new Set(['proposed', 'released', 'declined']);

/** Reads the rows of recruiting_list_proposals; rows that do not look right are dropped, never repaired. */
export function readProposals(rows: unknown): Proposal[] {
  if (!Array.isArray(rows)) return [];
  const out: Proposal[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object') continue;
    if (!Number.isInteger(r.id) || typeof r.requisition !== 'string' || typeof r.candidate !== 'string' || typeof r.text !== 'string') continue;
    if (!KINDS.has(String(r.kind)) || !STATUS.has(String(r.status))) continue;
    out.push({
      id: r.id as number, requisition: r.requisition, candidate: r.candidate, kind: r.kind as Proposal['kind'], tool: String(r.tool ?? ''),
      text: r.text, basis: String(r.basis ?? ''), status: r.status as Proposal['status'], proposedBy: String(r.proposedBy ?? ''),
      at: String(r.at ?? ''), decidedBy: typeof r.decidedBy === 'string' ? r.decidedBy : null, decidedAt: typeof r.decidedAt === 'string' ? r.decidedAt : null,
      note: String(r.note ?? ''),
    });
  }
  return out;
}

/** Proposals grouped by requisition, requisitions in id order, newest proposal first inside a group. */
export function groupByRequisition(list: Proposal[]): Array<{ requisition: string; items: Proposal[] }> {
  const map = new Map<string, Proposal[]>();
  for (const p of list) map.set(p.requisition, [...(map.get(p.requisition) ?? []), p]);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([requisition, items]) => ({ requisition, items: [...items].sort((x, y) => y.at.localeCompare(x.at)) }));
}

export function countByStatus(list: Proposal[]): Record<Proposal['status'], number> {
  const n = { proposed: 0, released: 0, declined: 0 };
  for (const p of list) n[p.status] += 1;
  return n;
}

/** Why a click on Release or Decline failed, in plain words. */
export function decisionError(raw: string): string {
  if (/only the hiring manager/i.test(raw)) return 'Only the hiring manager of this requisition can decide. You are signed in with a different e-mail.';
  if (/already decided/i.test(raw)) return 'This proposal was already decided. Reload the list.';
  return raw;
}

/** One criterion of a requisition, as the criteria editor shows it (same shape as the snapshot). */
export type Criterion = { id: string; must: boolean; text: string; kind: 'text' | 'years'; min: number | null; needles: string[]; partial: string[] };
export type MyRequisition = { id: string; title: string; dept: string; criteria: Criterion[] };

export function readMyRequisitions(rows: unknown): MyRequisition[] {
  if (!Array.isArray(rows)) return [];
  const out: MyRequisition[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    if (!r || typeof r.id !== 'string' || typeof r.title !== 'string' || !Array.isArray(r.criteria)) continue;
    const criteria: Criterion[] = [];
    for (const c of r.criteria as Array<Record<string, unknown>>) {
      if (!c || typeof c.id !== 'string' || typeof c.text !== 'string' || typeof c.must !== 'boolean' || (c.kind !== 'text' && c.kind !== 'years')) continue;
      const strs = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []);
      criteria.push({ id: c.id, must: c.must, text: c.text, kind: c.kind, min: Number.isInteger(c.min) ? (c.min as number) : null, needles: strs(c.needles), partial: strs(c.partial) });
    }
    out.push({ id: r.id, title: r.title, dept: String(r.dept ?? ''), criteria });
  }
  return out;
}

/** Splits a typed list (commas or new lines) into terms: trimmed, no empty ones, no repeats, at most ten. */
export function parseNeedles(text: string): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const raw of text.split(/[\n,;]/)) {
    const t = raw.trim().slice(0, 80);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out.slice(0, 10);
}

// Mirrors the database check (migration 028) so the screen can say no early. The database stays the authority.
const PROTECTED = /\b(age|aged|young|younger|older|gender|sex|sexual|nationality|ethnicity|ethnic|religion|religious|marital|married|pregnant|pregnancy|disability|photo|born|alter|geschlecht|staatsangeh\w*|familienstand|schwanger\w*|behinderung)\b/i;

export type CriterionDraft = { label: string; kind: 'text' | 'years'; minYears: string; needles: string; partial: string };

/** Returns a message when the draft cannot be saved, otherwise ''. */
export function validateCriterion(d: CriterionDraft, existing: number): string {
  if (!d.label.trim()) return 'Describe the criterion in a few words.';
  if (existing >= 12) return 'A requisition can have at most 12 criteria.';
  if (d.kind === 'years') {
    const n = Number(d.minYears);
    if (!Number.isInteger(n) || n < 1 || n > 40) return 'Give the minimum number of years as a whole number between 1 and 40.';
  } else if (parseNeedles(d.needles).length === 0) return 'Give at least one word or phrase to look for in the CV.';
  const all = [d.label, d.needles, d.partial].join(' ');
  if (PROTECTED.test(all)) return 'Criteria must not refer to age, gender, nationality, religion, family status, health or similar traits.';
  return '';
}

export function criterionError(raw: string): string {
  if (/only the hiring manager/i.test(raw)) return 'Only the hiring manager of this open requisition can change its criteria.';
  if (/cannot change between/i.test(raw)) return 'A must-have cannot become a nice-to-have. Delete it and add a new one.';
  if (/at most 12/i.test(raw)) return 'A requisition can have at most 12 criteria.';
  return raw;
}
