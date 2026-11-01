/**
 * Skill governance: every skill lives on one of three organisation levels (lowest to highest).
 * The level names are the person's own. A skill moves up one level at a time, and only after a request is approved.
 */
export type LevelIndex = 0 | 1 | 2;
export const DEFAULT_LEVELS: [string, string, string] = ['Personal', 'Department', 'Company'];
export const CHECKS = ['Purpose and owner are documented', 'No secrets or personal data inside', 'Tried out with sample data', 'Data access is limited to what it needs'] as const;

export type PromotionRequest = {
  id: number;
  skill: string;
  from: LevelIndex;
  to: LevelIndex;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  decidedAt?: number;
  reason?: string;
  /** Result of the automatic review at the time of the request. */
  checks?: { id: string; status: 'pass' | 'warn' | 'fail'; detail: string }[];
};

export type SkillGov = {
  levels: [string, string, string];
  /** Level per skill name; a skill without an entry is on level 0. */
  skills: Record<string, LevelIndex>;
  requests: PromotionRequest[];
  seq: number;
};

export const GOV_KEY = 'werkbank.skillGovernance';

export function defaultGov(): SkillGov {
  return { levels: [...DEFAULT_LEVELS], skills: {}, requests: [], seq: 0 };
}

export function levelOf(gov: SkillGov, skill: string): LevelIndex {
  return gov.skills[skill] ?? 0;
}

export function pendingFor(gov: SkillGov, skill: string): PromotionRequest | undefined {
  return gov.requests.find((r) => r.skill === skill && r.status === 'pending');
}

/** Rename a level. Names are trimmed, 1-40 characters and unique; an invalid name leaves the levels unchanged. */
export function renameLevel(gov: SkillGov, index: LevelIndex, name: string): SkillGov {
  const next = name.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!next) return gov;
  if (gov.levels.some((n, i) => i !== index && n.toLowerCase() === next.toLowerCase())) return gov;
  const levels = [...gov.levels] as SkillGov['levels'];
  levels[index] = next;
  return { ...gov, levels };
}

/** Ask to move a skill one level up. Refused for the top level and while a request is pending. */
export function requestPromotion(gov: SkillGov, skill: string, note: string, now: number, checks?: PromotionRequest['checks']): SkillGov {
  const from = levelOf(gov, skill);
  if (from >= 2 || pendingFor(gov, skill)) return gov;
  const seq = gov.seq + 1;
  const req: PromotionRequest = { id: seq, skill, from, to: (from + 1) as LevelIndex, note: note.trim().slice(0, 400), status: 'pending', createdAt: now, ...(checks ? { checks } : {}) };
  return { ...gov, seq, requests: [req, ...gov.requests].slice(0, 200) };
}

/** Approve (the skill moves up) or reject a pending request. */
export function decide(gov: SkillGov, id: number, approve: boolean, reason: string, now: number): SkillGov {
  const req = gov.requests.find((r) => r.id === id);
  if (!req || req.status !== 'pending') return gov;
  const requests = gov.requests.map((r) => (r.id === id ? { ...r, status: approve ? 'approved' as const : 'rejected' as const, decidedAt: now, reason: reason.trim().slice(0, 400) } : r));
  const skills = approve ? { ...gov.skills, [req.skill]: req.to } : gov.skills;
  return { ...gov, requests, skills };
}

/** Take a skill back down to a lower level (for example after a rejection of its use). */
export function demote(gov: SkillGov, skill: string): SkillGov {
  const from = levelOf(gov, skill);
  if (from <= 0) return gov;
  return { ...gov, skills: { ...gov.skills, [skill]: (from - 1) as LevelIndex } };
}

export const MEMORY_GOV_KEY = 'werkbank.memoryGovernance';

export function loadGov(storage?: Pick<Storage, 'getItem'>, key: string = GOV_KEY): SkillGov {
  const base = defaultGov();
  try {
    const raw = (storage ?? window.localStorage).getItem(key);
    if (!raw) return base;
    const p = JSON.parse(raw);
    const levels = Array.isArray(p.levels) && p.levels.length === 3 && p.levels.every((n: unknown) => typeof n === 'string' && n.trim())
      ? (p.levels.map((n: string) => n.trim().slice(0, 40)) as SkillGov['levels']) : base.levels;
    const skills: Record<string, LevelIndex> = {};
    for (const [k, v] of Object.entries(p.skills ?? {})) if (v === 0 || v === 1 || v === 2) skills[k] = v;
    const requests = (Array.isArray(p.requests) ? p.requests : []).filter((r: any) => r && typeof r.skill === 'string' && typeof r.id === 'number' && (r.status === 'pending' || r.status === 'approved' || r.status === 'rejected') && [0, 1].includes(r.from) && [1, 2].includes(r.to));
    return { levels, skills, requests, seq: typeof p.seq === 'number' ? p.seq : requests.reduce((m: number, r: any) => Math.max(m, r.id), 0) };
  } catch {
    return base;
  }
}

export function saveGov(gov: SkillGov, storage?: Pick<Storage, 'setItem'>, key: string = GOV_KEY): void {
  try { (storage ?? window.localStorage).setItem(key, JSON.stringify(gov)); } catch { /* ignore */ }
}
