/**
 * Pure helpers for the motion of the Spaces overview (SpacesOverview.tsx): which Spaces count as recently changed and the
 * count-up curve. No DOM, no timers: the tests run them directly.
 */
import type { Space } from './spaces';

/** A Space counts as recently changed when it was updated within this many days. */
export const FRESH_DAYS = 3;
const DAY = 86_400_000;

/**
 * Slugs of the recently changed Spaces. After an install or an update of the examples every Space has the same new date and a marker
 * on all of them says nothing, so when half or more of the Spaces would qualify, none is marked.
 */
export function freshSlugs(spaces: readonly Pick<Space, 'slug' | 'updatedAt'>[], now: number = Date.now()): Set<string> {
  const fresh = spaces.filter((s) => s.updatedAt > 0 && s.updatedAt <= now + 60_000 && now - s.updatedAt <= FRESH_DAYS * DAY);
  if (!spaces.length || fresh.length * 2 >= spaces.length) return new Set();
  return new Set(fresh.map((s) => s.slug));
}

/** Ease-out curve of the count-up; 0 at the start, exactly 1 at the end. */
export function easeOut(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);
}

/** The shown number while counting up; at p >= 1 it is exactly the target. */
export function countAt(target: number, p: number): number {
  return p >= 1 ? target : Math.round(target * easeOut(p));
}
