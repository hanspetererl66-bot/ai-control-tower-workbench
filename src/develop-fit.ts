/**
 * The Develop start page scales to the window so that every tile is always shown. It is laid out once at a fixed design width
 * (four tiles in a row) and then scaled as a whole: down when the window is small, up a little when it is large. Below a size the
 * text can still be read at, it falls back to the responsive grid (two columns, one column) and scrolls, as before.
 * Pure rule so it can be tested; DevelopHub.tsx measures and applies it.
 */
export const FIT_WIDTH = 1240;
export const FIT_MIN = 0.6;
export const FIT_MAX = 1.2;

/**
 * The scale that makes the page fit into the space it has, or null when that scale would be too small to read (below `min`).
 * Nothing measured yet (a size of 0) keeps the natural size.
 */
export function fitScale(avail: { w: number; h: number }, natural: { w: number; h: number }, min = FIT_MIN, max = FIT_MAX): number | null {
  if (!(natural.w > 0) || !(natural.h > 0) || !(avail.w > 0) || !(avail.h > 0)) return 1;
  const s = Math.min(avail.w / natural.w, avail.h / natural.h, max);
  return s >= min ? Math.round(s * 1000) / 1000 : null;
}
