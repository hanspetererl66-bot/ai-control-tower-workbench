/**
 * Text size of Spaces. Spaces are separate pages in sandboxed frames, so they cannot read the app's settings
 * and most use fixed pixel sizes. The host therefore injects one rule into the page it hands to the frame, which
 * works for every Space, including ones the agent wrote itself.
 * Chromium's `zoom` scales text, spacing and charts together, so proportions stay intact.
 */
export const SPACE_SCALE_STORAGE_KEY = 'werkbank.space-scale';
export const SPACE_SCALES = [0.85, 1, 1.15, 1.3, 1.5] as const;
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

/**
 * Pins the page to the app's theme. Spaces are sandboxed pages that only see the operating system's colour scheme,
 * so without this a Space stays dark when the app is set to Light. The design system reads data-theme on <html>.
 */
export function applySpaceTheme(html: string, theme: 'light' | 'dark'): string {
  const attr = `data-theme="${theme}"`;
  if (/<html\b[^>]*\sdata-theme=/i.test(html)) return html.replace(/(<html\b[^>]*\s)data-theme="[^"]*"/i, `$1${attr}`);
  if (/<html\b/i.test(html)) return html.replace(/<html\b/i, `<html ${attr}`);
  return html;
}

const SCROLL_MARK = 'werkbank-space-scroll';

/**
 * Every Space can be moved sideways when the window is narrower than its content. A Space cannot hide the sideways
 * scroll bar of the page or of a wide row (tabs, boards, tables) any more, and the bar is thick enough to grab.
 * Only the horizontal bar is touched; vertical bars and the look of the Space are left alone.
 */
export const SPACE_SCROLL_CSS =
  'html{overflow-x:auto!important}body{overflow-x:visible!important}' +
  '*::-webkit-scrollbar:horizontal{display:block!important;height:10px!important}' +
  '*::-webkit-scrollbar-track:horizontal{background:rgba(128,128,128,.14)!important}' +
  '*::-webkit-scrollbar-thumb:horizontal{background:rgba(128,128,128,.55)!important;border-radius:5px!important;min-width:40px}' +
  '*::-webkit-scrollbar-thumb:horizontal:hover{background:rgba(128,128,128,.8)!important}';

/** Returns the page with the scroll rule added once. */
export function applySpaceScroll(html: string): string {
  if (!html || html.includes(`id="${SCROLL_MARK}"`)) return html;
  const rule = `<style id="${SCROLL_MARK}">${SPACE_SCROLL_CSS}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${rule}</head>`);
  return rule + html;
}
