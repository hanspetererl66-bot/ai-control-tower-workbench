/**
 * Pure helpers for the motion of the Spaces overview (SpacesOverview.tsx): which Spaces count as recently changed, the small
 * "constellation" of dots drawn on each domain tile, and the count-up curve. No DOM, no timers: the tests run them directly.
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

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const CONSTELLATION = { width: 240, height: 34, pad: 8, minGap: 18, maxDots: 12 } as const;
export type Dot = { x: number; y: number; delay: number; drift: number };
export type Constellation = { dots: Dot[]; links: [number, number][] };

/**
 * One dot per Space (at most 12), placed from the Space's name so the picture of a domain is always the same; dots keep a minimum gap.
 * Every dot is linked to its nearest neighbour (and to the second nearest when that one is close), so the dots read as a small graph.
 */
export function constellation(keys: readonly string[]): Constellation {
  const { width, height, pad, minGap, maxDots } = CONSTELLATION;
  const dots: Dot[] = [];
  keys.slice(0, maxDots).forEach((key) => {
    const rand = rng(hashString(key));
    let best: Dot | null = null, bestGap = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const d: Dot = { x: pad + rand() * (width - 2 * pad), y: pad + rand() * (height - 2 * pad), delay: Math.round(rand() * 900) / 1000, drift: 1.6 + Math.round(rand() * 20) / 10 };
      const gap = dots.length ? Math.min(...dots.map((o) => Math.hypot(o.x - d.x, o.y - d.y))) : Infinity;
      if (gap >= minGap) { best = d; break; }
      if (gap > bestGap) { best = d; bestGap = gap; }
    }
    if (best) dots.push({ ...best, x: Math.round(best.x * 10) / 10, y: Math.round(best.y * 10) / 10 });
  });
  const seen = new Set<string>();
  const links: [number, number][] = [];
  dots.forEach((d, i) => {
    const order = dots.map((o, j) => ({ j, dist: Math.hypot(o.x - d.x, o.y - d.y) })).filter((o) => o.j !== i).sort((a, b) => a.dist - b.dist);
    order.slice(0, 2).forEach((o, k) => {
      if (k === 1 && o.dist > 70) return;
      const key = i < o.j ? `${i}-${o.j}` : `${o.j}-${i}`;
      if (!seen.has(key)) { seen.add(key); links.push(i < o.j ? [i, o.j] : [o.j, i]); }
    });
  });
  return { dots, links };
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
