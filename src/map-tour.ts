/**
 * Remembers in this browser whether the guided tour of the ontology map was already shown, so it opens by itself only the first
 * time. Nothing else depends on it: if storage is blocked or empty the tour is simply offered again. The storage is passed in so
 * the test can use a fake one.
 */
export const MAP_TOUR_KEY = 'werkbank.ontology-map.tour';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const browserStore = (): Store | null => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };

export function mapTourSeen(store: Store | null = browserStore()): boolean {
  try { return store?.getItem(MAP_TOUR_KEY) === 'done'; } catch { return false; }
}
export function markMapTourSeen(store: Store | null = browserStore()): void {
  try { store?.setItem(MAP_TOUR_KEY, 'done'); } catch { /* blocked: the tour is offered again next time */ }
}
