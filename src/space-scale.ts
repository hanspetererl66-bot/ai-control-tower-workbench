/**
 * Text size of Spaces. Spaces are separate pages in sandboxed frames, so they cannot read the app's settings
 * and most use fixed pixel sizes. The host therefore injects one rule into the page it hands to the frame, which
 * works for every Space, including ones the agent wrote itself.
 * Chromium's `zoom` scales text, spacing and charts together, so proportions stay intact.
 */
export const SPACE_SCALE_STORAGE_KEY = 'werkbank.space-scale';
export const SPACE_SCALES = [1, 1.15, 1.3] as const;
export type SpaceScale = (typeof SPACE_SCALES)[number];
export const DEFAULT_SPACE_SCALE: SpaceScale = 1.15;

export function parseSpaceScale(value: unknown): SpaceScale {
  const number = typeof value === 'string' ? Number(value) : value;
  return SPACE_SCALES.find((scale) => scale === number) ?? DEFAULT_SPACE_SCALE;
}

export function readSpaceScale(storage?: Pick<Storage, 'getItem'>): SpaceScale {
  if (!storage) return DEFAULT_SPACE_SCALE;
  try {
    return parseSpaceScale(storage.getItem(SPACE_SCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_SPACE_SCALE;
  }
}

export function writeSpaceScale(scale: SpaceScale, storage?: Pick<Storage, 'setItem'>): void {
  if (!storage) return;
  try {
    storage.setItem(SPACE_SCALE_STORAGE_KEY, String(scale));
  } catch {
    // The setting still applies for this session without storage.
  }
}

const MARK = 'werkbank-space-scale';

/** Returns the page with the scale rule added once; 100% leaves the page untouched. */
export function applySpaceScale(html: string, scale: SpaceScale): string {
  if (scale === 1 || html.includes(`id="${MARK}"`)) return html;
  const rule = `<style id="${MARK}">html{zoom:${scale}}</style>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (open) => `${open}${rule}`);
  return rule + html;
}
