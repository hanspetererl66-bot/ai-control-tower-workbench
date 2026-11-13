/** Position of the small "JouleX Design Study" badge, which the user can move. Pure helpers, no UI. */
export type BadgePos = { x: number; y: number };
export const BADGE_SIZE = { w: 150, h: 46 } as const;
const MARGIN = 6;
const KEY = 'werkbank.study-badge';

/** Keeps the badge fully inside the window (with a small margin). */
export function clampBadge(pos: BadgePos, win: { w: number; h: number }): BadgePos {
  const maxX = Math.max(MARGIN, win.w - BADGE_SIZE.w - MARGIN);
  const maxY = Math.max(MARGIN, win.h - BADGE_SIZE.h - MARGIN);
  return { x: Math.round(Math.min(maxX, Math.max(MARGIN, pos.x))), y: Math.round(Math.min(maxY, Math.max(MARGIN, pos.y))) };
}

/** Parses a stored value; anything unusable means "never moved" (null, the badge keeps its default place). */
export function parseBadge(raw: string | null | undefined): BadgePos | null {
  try {
    const o = raw ? JSON.parse(raw) : null;
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x, y: o.y };
  } catch { /* fall through */ }
  return null;
}

/** Arrow keys move the badge by 10 px (Shift: 40 px); other keys return null. */
export function nudgeBadge(pos: BadgePos, key: string, shift: boolean): BadgePos | null {
  const d = shift ? 40 : 10;
  if (key === 'ArrowLeft') return { x: pos.x - d, y: pos.y };
  if (key === 'ArrowRight') return { x: pos.x + d, y: pos.y };
  if (key === 'ArrowUp') return { x: pos.x, y: pos.y - d };
  if (key === 'ArrowDown') return { x: pos.x, y: pos.y + d };
  return null;
}

export function loadBadge(): BadgePos | null {
  try { return parseBadge(localStorage.getItem(KEY)); } catch { return null; }
}
export function saveBadge(pos: BadgePos | null): void {
  try { if (pos) localStorage.setItem(KEY, JSON.stringify(pos)); else localStorage.removeItem(KEY); } catch { /* storage may be unavailable */ }
}
