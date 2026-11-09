/**
 * Short messages ("toast") are cleared by timers that the callers start themselves (setTimeout(() => setToast(null), n)).
 * A timer from an earlier message used to clear a newer one after a moment. The gate keeps every message on screen for at
 * least MIN_VISIBLE_MS: a clear that comes too early is postponed to the end of that time.
 */
export const MIN_VISIBLE_MS = 4000;

export type ToastGate = { request: (value: string | null, apply: (value: string | null) => void) => void };

export function createToastGate(now: () => number = () => Date.now(), later: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms)): ToastGate {
  let shownAt = 0;
  const gate: ToastGate = {
    request(value, apply) {
      if (value !== null) { shownAt = now(); apply(value); return; }
      const left = MIN_VISIBLE_MS - (now() - shownAt);
      if (left > 0) later(() => gate.request(null, apply), left + 5);
      else apply(null);
    },
  };
  return gate;
}
