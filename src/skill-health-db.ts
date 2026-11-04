/**
 * Skill health from the shared database: maps the rows of `skills_health_overview` (migration 024) onto the dashboard catalog.
 * Pure. What the database does not know stays honest: users are distinct anonymous devices, success is unknown (counted as good),
 * and connector needs are not stored, so no skill is reported broken from database data.
 */
import { DEFAULT_POLICY, type Catalog, type CSkill, type Level } from './skill-health.ts';

/** Where the dashboard numbers come from. */
export type SkillSource = { kind: 'database' | 'example' | 'offline'; detail: string; loadedAt?: number };

export type HealthRow = {
  slug: string; description?: string; owner?: string; version?: number; state?: string; scope?: string; team?: string; domain?: string;
  sunsetAt?: string | null; replacedBy?: string | null; updatedAt?: string | null; createdAt?: string | null;
  uses30?: number; uses90?: number; devices30?: number; devices90?: number; lastUsedAt?: string | null;
};

const time = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
};
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const title = (slug: string) => slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Level in the dashboard from the scope the database derives. */
export const levelOf = (scope: unknown): Level => (scope === 'company' ? 2 : scope === 'team' ? 1 : 0);

export function skillsFromRows(rows: unknown, previous: CSkill[] = [], now = Date.now()): CSkill[] {
  if (!Array.isArray(rows)) return [];
  const before = new Map(previous.map((s) => [s.id, s]));
  const out: CSkill[] = [];
  for (const raw of rows as HealthRow[]) {
    if (!raw || typeof raw.slug !== 'string' || !raw.slug) continue;
    const old = before.get(raw.slug);
    const created = time(raw.createdAt) ?? time(raw.updatedAt) ?? now;
    const state = raw.state === 'retired' ? 'retired' : raw.state === 'deprecated' ? 'deprecated' : 'active';
    const skill: CSkill = {
      id: raw.slug, name: title(raw.slug), description: String(raw.description ?? ''), owner: String(raw.owner ?? ''),
      department: raw.team || raw.domain || 'Personal', level: levelOf(raw.scope), createdAt: created,
      lastUsed: time(raw.lastUsedAt) ?? null, uses30: count(raw.uses30), uses90: count(raw.uses90), users90: count(raw.devices90),
      success: 1, deps: [], state,
    };
    const sunset = time(raw.sunsetAt);
    if (sunset !== undefined) skill.sunsetAt = sunset;
    if (raw.replacedBy) skill.replacedBy = raw.replacedBy;
    // Review dates and flags are kept locally; they are not in the database yet.
    if (old?.reviewedAt) skill.reviewedAt = old.reviewedAt;
    if (old?.remindedAt) skill.remindedAt = old.remindedAt;
    if (old?.promotionRequested !== undefined) skill.promotionRequested = old.promotionRequested;
    out.push(skill);
  }
  return out;
}

/** Replaces the skills of a catalog with the database rows; policy, log, stewards and dismissed proposals stay. */
export function catalogFromDatabase(previous: Catalog, rows: unknown, now = Date.now()): Catalog {
  const skills = skillsFromRows(rows, previous.skills, now);
  const people = [...new Set(skills.map((s) => s.owner).filter(Boolean))];
  return { ...previous, skills, people, policy: previous.policy ?? DEFAULT_POLICY };
}

export type LifecycleCall = { slug: string; action: 'deprecate' | 'retire' | 'restore'; reason: string; sunsetAt?: string; replacedBy?: string };

/**
 * The database calls that follow from a change of the catalog: a state that changed becomes deprecate, retire or restore.
 * Review dates, reminders, owner changes and promotion flags stay local, the database has no place for them yet.
 * The database phases out only shared skills, so an Individual skill is retired instead.
 */
export function lifecycleCalls(prev: Catalog, next: Catalog, now: number): LifecycleCall[] {
  const before = new Map(prev.skills.map((s) => [s.id, s]));
  const calls: LifecycleCall[] = [];
  for (const s of next.skills) {
    const old = before.get(s.id);
    if (!old || old.state === s.state) continue;
    const reason = 'Skill health: ' + (s.state === 'deprecated' ? 'phased out' : s.state === 'retired' ? 'retired' : 'restored');
    if (s.state === 'active') calls.push({ slug: s.id, action: 'restore', reason });
    else if (s.state === 'retired' || s.level === 0) calls.push({ slug: s.id, action: 'retire', reason });
    else {
      const days = Math.max(1, Math.round(((s.sunsetAt ?? now + next.policy.sunsetDays * 86_400_000) - now) / 86_400_000));
      calls.push({ slug: s.id, action: 'deprecate', reason, sunsetAt: new Date(now + days * 86_400_000).toISOString().slice(0, 10), ...(s.replacedBy ? { replacedBy: s.replacedBy } : {}) });
    }
  }
  return calls;
}
