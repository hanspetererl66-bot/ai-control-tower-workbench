/** Pure helpers for the animated square grid on the cover sheet. */

export const GRID_CELL = 15;
export const GRID_GAP = 5;
export const GRID_PITCH = GRID_CELL + GRID_GAP;

/** Colours of the cubes that light up now and then (the rest of the grid stays grey). */
export const GRID_PALETTE = ['#8b5cf6', '#6d28d9', '#22c55e', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6'] as const;

/** Columns and rows that fit into a box, never fewer than 1. */
export function gridSize(width: number, height: number, pitch = GRID_PITCH): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.floor((width + GRID_GAP) / pitch)),
    rows: Math.max(1, Math.floor((height + GRID_GAP) / pitch)),
  };
}

/** How many new cubes light up in a frame: a steady share of the grid per second, with the remainder carried over. */
export function spawnCount(cells: number, elapsedMs: number, carry = 0, perSecond = 0.012): { count: number; carry: number } {
  const wanted = carry + cells * perSecond * (elapsedMs / 1000);
  const count = Math.floor(wanted);
  return { count, carry: wanted - count };
}

/** Brightness (0..1) of a grey cube: a slow shimmer per cube plus a wave that travels across the grid. */
export function shimmer(col: number, rows: number, row: number, phase: number, timeMs: number): number {
  const wave = 0.5 + 0.5 * Math.sin(col * 0.22 + row * 0.12 - timeMs * 0.0011);
  const own = 0.5 + 0.5 * Math.sin(phase + timeMs * 0.0006);
  return Math.min(1, 0.55 * own + 0.45 * wave * (0.6 + 0.4 * (row / Math.max(1, rows - 1))));
}

/** Opacity of a lit cube over its life: quick fade in, hold, slow fade out. */
export function litAlpha(ageMs: number, lifeMs: number): number {
  if (ageMs < 0 || ageMs >= lifeMs) return 0;
  const fadeIn = Math.min(1, ageMs / 180);
  const fadeOut = Math.min(1, (lifeMs - ageMs) / 700);
  return Math.min(fadeIn, fadeOut);
}
