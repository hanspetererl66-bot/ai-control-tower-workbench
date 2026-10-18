/** Manual order of the Spaces in the left list (drag and drop), kept in localStorage. */
export const SPACE_ORDER_KEY = 'werkbank.spaceOrder.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Saved order first; Spaces without a saved position keep their original order after them. */
export function orderSpaces<T extends { slug: string }>(spaces: T[], order: string[]): T[] {
  const position = new Map(order.map((slug, index) => [slug, index]));
  const known = spaces.filter((space) => position.has(space.slug));
  const unknown = spaces.filter((space) => !position.has(space.slug));
  known.sort((a, b) => (position.get(a.slug) ?? 0) - (position.get(b.slug) ?? 0));
  return [...known, ...unknown];
}

/** Move `from` next to `to` (before it, or after it when `after` is set). Returns a new list. */
export function moveSpace(slugs: string[], from: string, to: string, after = false): string[] {
  if (from === to || !slugs.includes(from) || !slugs.includes(to)) return slugs;
  const rest = slugs.filter((slug) => slug !== from);
  const index = rest.indexOf(to) + (after ? 1 : 0);
  return [...rest.slice(0, index), from, ...rest.slice(index)];
}

/** Move one step up (-1) or down (+1). */
export function nudgeSpace(slugs: string[], slug: string, direction: -1 | 1): string[] {
  const index = slugs.indexOf(slug);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= slugs.length) return slugs;
  const next = [...slugs];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function loadSpaceOrder(storage: StorageLike): string[] {
  try {
    const parsed = JSON.parse(storage.getItem(SPACE_ORDER_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function saveSpaceOrder(storage: StorageLike, order: string[]): void {
  try {
    storage.setItem(SPACE_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Order stays in memory if localStorage is unavailable or full.
  }
}
