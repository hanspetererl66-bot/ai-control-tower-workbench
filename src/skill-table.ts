import type { Skill } from './skills.ts';
import { levelOf, pendingFor, type LevelIndex, type PromotionRequest, type SkillGov } from './skill-governance.ts';

/** The table of the Skills view: one row per skill with its level, status and the result of the last automatic review. Pure helpers, no UI. */
export type SortKey = 'name' | 'level' | 'status' | 'checks';
export type SortDir = 'asc' | 'desc';
export type RowStatus = 'active' | 'review';
export type ChecksState = 'pass' | 'warn' | 'fail' | 'none';
export type TableFilter = { query: string; level: 'all' | LevelIndex; status: 'all' | RowStatus };
export type SkillRow = { skill: Skill; level: LevelIndex; status: RowStatus; checks: ChecksState; target?: LevelIndex };

export const NO_FILTER: TableFilter = { query: '', level: 'all', status: 'all' };

/** Worst result of the automatic review in the newest request of the skill that carries one; 'none' when there was no review yet. */
export function checksOf(gov: SkillGov, name: string): ChecksState {
  const latest = gov.requests.filter((r: PromotionRequest) => r.skill === name && r.checks?.length).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!latest?.checks) return 'none';
  return latest.checks.some((c) => c.status === 'fail') ? 'fail' : latest.checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
}

export function buildRows(skills: Skill[], gov: SkillGov): SkillRow[] {
  return skills.map((skill) => {
    const req = pendingFor(gov, skill.name);
    return { skill, level: levelOf(gov, skill.name), status: req ? 'review' : 'active', checks: checksOf(gov, skill.name), target: req?.to };
  });
}

export function filterRows(rows: SkillRow[], f: TableFilter): SkillRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) =>
    (!q || r.skill.name.toLowerCase().includes(q) || r.skill.description.toLowerCase().includes(q)) &&
    (f.level === 'all' || r.level === f.level) &&
    (f.status === 'all' || r.status === f.status));
}

const CHECK_RANK: Record<ChecksState, number> = { none: 0, pass: 1, warn: 2, fail: 3 };

/** Sorts by one column (ties by name, so the order never jumps around). */
export function sortRows(rows: SkillRow[], key: SortKey, dir: SortDir): SkillRow[] {
  const val = (r: SkillRow): number | string =>
    key === 'name' ? r.skill.name.toLowerCase() : key === 'level' ? r.level : key === 'status' ? (r.status === 'review' ? 1 : 0) : CHECK_RANK[r.checks];
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return c !== 0 ? c * sign : a.skill.name.localeCompare(b.skill.name);
  });
}

/** Clicking the header of the active column flips the direction; another column starts ascending. */
export function nextSort(cur: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
  return cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
}

/** Arrow keys, Home and End move the selected row; anything else returns null. Nothing selected: Down and Home pick the first, Up and End the last. */
export function moveSelection(names: string[], current: string | null, key: string): string | null {
  if (!names.length) return null;
  const i = current ? names.indexOf(current) : -1;
  if (key === 'Home') return names[0];
  if (key === 'End') return names[names.length - 1];
  if (key === 'ArrowDown') return names[i < 0 ? 0 : Math.min(names.length - 1, i + 1)];
  if (key === 'ArrowUp') return names[i < 0 ? names.length - 1 : Math.max(0, i - 1)];
  return null;
}
