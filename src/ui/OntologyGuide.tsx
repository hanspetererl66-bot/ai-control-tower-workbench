import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { placeBubble, stepsFor, type GuideTab, type Placement } from '../ontology-guide';

/**
 * Speech bubble of the Ontology Manager tour: points at the part of the page named by `data-guide="…"`, one step at a time, with
 * Back / Next / Done. "Turn off tips" switches the whole guide off (it is switched on again with the Tips switch in the header).
 * Parts that are not on screen (for example no term chosen yet) are skipped. Nothing moves with prefers-reduced-motion: reduce.
 */
export default function OntologyGuide({ tab, root, onDone, onOff }: { tab: GuideTab; root: React.RefObject<HTMLElement | null>; onDone: () => void; onOff: () => void }) {
  const all = stepsFor(tab);
  const [i, setI] = useState(0);
  const [place, setPlace] = useState<Placement | null>(null);
  const [present, setPresent] = useState<number[]>([]);
  const bubble = useRef<HTMLDivElement>(null);

  const find = useCallback((target: string) => root.current?.querySelector<HTMLElement>(`[data-guide="${target}"]`) ?? null, [root]);

  // Which steps have a part on screen right now (re-evaluated when the tab changes).
  useLayoutEffect(() => { setPresent(all.map((s, n) => (find(s.target) ? n : -1)).filter((n) => n >= 0)); setI(0); }, [tab, all, find]);

  const step = present.length ? all[present[Math.min(i, present.length - 1)]] : null;

  const measure = useCallback(() => {
    if (!step) return;
    const el = find(step.target), b = bubble.current;
    if (!el || !b) return;
    const r = el.getBoundingClientRect();
    setPlace(placeBubble({ left: r.left, top: r.top, width: r.width, height: r.height }, { width: b.offsetWidth, height: b.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, step.side));
  }, [step, find]);

  useLayoutEffect(() => {
    const el = step ? find(step.target) : null;
    el?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    measure();
  }, [step, find, measure]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); document.removeEventListener('scroll', measure, true); };
  }, [measure]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onDone]);

  if (!step) return null;
  const pos = Math.min(i, present.length - 1), last = pos === present.length - 1;
  return (
    <div ref={bubble} className={`om-guide om-guide-${place?.side ?? 'below'}`} role="note" aria-label={`Tip: ${step.title}`}
      style={{ left: place?.left ?? -9999, top: place?.top ?? -9999, ['--arrow' as string]: `${place?.arrow ?? 24}px` }}>
      <p className="om-guide-step">Tip {pos + 1} of {present.length}</p>
      <h3>{step.title}</h3>
      <p>{step.text}</p>
      <div className="om-guide-actions">
        <button className="om-filter" onClick={onOff}>Turn off tips</button>
        <span className="om-guide-gap" />
        {pos > 0 && <button className="om-filter" onClick={() => setI(pos - 1)}>Back</button>}
        {last ? <button className="om-filter om-filter-on" onClick={onDone}>Done</button> : <button className="om-filter om-filter-on" onClick={() => setI(pos + 1)}>Next</button>}
      </div>
    </div>
  );
}
