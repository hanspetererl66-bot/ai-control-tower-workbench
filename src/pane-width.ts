/** Widths of the two resizable panes (conversation / skills list on the left, Joule dock on the right). Pure helpers, no UI. */
export type PaneWidths = { list: number; dock: number };
export const DEFAULT_WIDTHS: PaneWidths = { list: 288, dock: 380 };
export const LIMITS = { list: { min: 180, max: 520 }, dock: { min: 280, max: 720 } } as const;
const KEY = 'werkbank.pane-widths';

export function clampWidth(pane: keyof PaneWidths, value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_WIDTHS[pane];
  return Math.round(Math.min(LIMITS[pane].max, Math.max(LIMITS[pane].min, n)));
}

/** Parses a stored value; anything unusable falls back to the defaults. */
export function parseWidths(raw: string | null | undefined): PaneWidths {
  try {
    const o = raw ? JSON.parse(raw) : null;
    return { list: clampWidth('list', o?.list), dock: clampWidth('dock', o?.dock) };
  } catch {
    return { ...DEFAULT_WIDTHS };
  }
}

export function loadWidths(): PaneWidths {
  try { return parseWidths(localStorage.getItem(KEY)); } catch { return { ...DEFAULT_WIDTHS }; }
}
export function saveWidths(w: PaneWidths): void {
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* storage may be unavailable */ }
}
