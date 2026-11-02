import { useEffect, useMemo, useRef } from 'react';
import { FACES, frame } from '../gem';

/**
 * The Werkbank diamond as a small three-dimensional gem that turns all the time. It is a cut stone: a flat table on top,
 * six crown facets, six pavilion facets down to the point. Every facet is lit by one light, and each time a facet turns to face
 * the viewer it flashes for a moment (and a little star sparkles), then the stone turns on. Drawn with plain SVG polygons that are
 * recomputed every frame, so it needs no library. With "reduce motion" the stone stands still at a pleasant angle.
 */

const PERIOD_MS = 12000; // one full turn

export default function SpinningDiamond({ size = 24, className = '' }: { size?: number; className?: string }) {
  const group = useRef<SVGGElement>(null);
  const starEl = useRef<SVGPathElement>(null);
  const els = useRef<Array<SVGPolygonElement | null>>([]);
  const still = useMemo(() => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ?? false, []);

  useEffect(() => {
    const draw = (turn: number) => {
      const f = frame(turn);
      const shown = new Set(f.faces.map((x) => x.index));
      els.current.forEach((el, i) => { if (el) el.style.display = shown.has(i) ? '' : 'none'; });
      for (const face of f.faces) { // painter's order: far to near
        const el = els.current[face.index];
        if (!el) continue;
        el.setAttribute('points', face.points);
        el.setAttribute('fill', face.fill);
        group.current?.appendChild(el);
      }
      const s = starEl.current;
      if (s) {
        const k = Math.min(1, f.glint * 1.4);
        s.setAttribute('transform', `translate(${f.star[0].toFixed(2)} ${f.star[1].toFixed(2)}) scale(${(0.22 + k * 0.4).toFixed(2)})`);
        s.style.opacity = String(k > 0.25 ? k : 0);
        group.current?.appendChild(s);
      }
    };
    if (still) { draw(0.5); return undefined; }
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => { draw(((now - start) / PERIOD_MS) * Math.PI * 2); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [still]);

  return (
    <svg className={className} width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <g ref={group} strokeLinejoin="round" stroke="rgb(255 255 255 / 28%)" strokeWidth="0.35">
        {FACES.map((_, i) => <polygon key={i} ref={(el) => { els.current[i] = el; }} />)}
        <path ref={starEl} d="M0 -9 L1.6 -1.6 L9 0 L1.6 1.6 L0 9 L-1.6 1.6 L-9 0 L-1.6 -1.6Z" fill="#fff" stroke="none" style={{ opacity: 0 }} />
      </g>
    </svg>
  );
}
