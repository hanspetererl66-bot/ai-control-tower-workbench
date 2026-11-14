import { useEffect, useMemo, useRef, useState } from 'react';
import { CAT_PIXEL, FACE_COLS, GRID_ROWS, HEART, PHASES, afterFace, drawCat, faceDuration, heartCount, lookToward, nextFace, pawsUp, placement, runsOf, shareAt, type CatFace, type CatPrefs, type Pose } from '../cat-peek';

type Props = {
  cat: CatPrefs;
  reduceMotion: boolean;
  /** Called when the cat is dropped at a new place. */
  onMove: (to: Pick<CatPrefs, 'x' | 'y'>) => void;
};

type Fx = { id: number; kind: 'heart' | 'z'; left: number; size: number };

/** Casimir looks over a thin black ledge: only 60 % of his face shows. He blinks, flicks an ear, follows the pointer with his eyes, pulls a face now and then (yawns, falls asleep and snores, sends hearts when in love), rests his paws on the ledge, and can be dragged anywhere on the screen. */
export default function CatPeek({ cat, reduceMotion, onMove }: Props) {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [face, setFace] = useState<CatFace>('neutral');
  const [blink, setBlink] = useState(false);
  const [flick, setFlick] = useState<Pose['flick']>(null);
  const [look, setLook] = useState<NonNullable<Pose['look']>>({ x: 0, y: 0 });
  const [phase, setPhase] = useState(0);
  const [paws, setPaws] = useState(false);
  const [fx, setFx] = useState<Fx[]>([]);
  const fxId = useRef(0);
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const start = useRef<{ x: number; y: number; dx: number; dy: number; moved: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Life: blinks and ear flicks, and a new face after a while. With reduced motion he keeps still (a click still changes the face).
  useEffect(() => {
    if (reduceMotion || !cat.enabled) return undefined;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => { const t = window.setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const blinkLoop = () => { setBlink(true); later(() => setBlink(false), 140); later(blinkLoop, 2000 + Math.random() * 3000); };
    const earLoop = () => { setFlick(Math.random() < 0.5 ? 'left' : 'right'); later(() => setFlick(null), 180); later(earLoop, 5000 + Math.random() * 7000); };
    later(blinkLoop, 1500 + Math.random() * 2000);
    later(earLoop, 3000 + Math.random() * 4000);
    return () => { timers.forEach((t) => window.clearTimeout(t)); };
  }, [reduceMotion, cat.enabled]);

  const send = (kind: Fx['kind'], size = 1) => {
    const id = ++fxId.current;
    setFx((list) => [...list.slice(-5), { id, kind, left: 30 + Math.random() * 40, size }]);
    window.setTimeout(() => setFx((list) => list.filter((f) => f.id !== id)), 2600);
  };

  // What the current face does: its script (yawn, sleep), hearts when in love, and then the next face.
  useEffect(() => {
    setPhase(0);
    setPaws(pawsUp(face, Math.random()));
    if (reduceMotion || !cat.enabled) return undefined;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => { const t = window.setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const script = PHASES[face];
    if (script) {
      let step = 0;
      const tick = () => { step += 1; setPhase(step % script.steps); if (face === 'sleep' && step % 2 === 0) send('z', 1 + (step % 4 === 0 ? 1 : 0)); later(tick, script.ms); };
      later(tick, script.ms);
      if (face === 'sleep') later(() => send('z', 1), 300);
    }
    if (face === 'love') {
      const n = heartCount(Math.random());
      for (let i = 0; i < n; i++) later(() => send('heart'), 500 + i * 900);
    }
    later(() => setFace((f) => afterFace(f, Math.random())), faceDuration(face, Math.random()));
    return () => { timers.forEach((t) => window.clearTimeout(t)); };
  }, [face, reduceMotion, cat.enabled]);

  // The eyes follow the pointer (only when motion is allowed).
  useEffect(() => {
    if (reduceMotion || !cat.enabled) return undefined;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const r = root.current?.getBoundingClientRect();
        if (!r) return;
        const next = lookToward({ x: e.clientX, y: e.clientY }, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
        setLook((l) => (l.x === next.x && l.y === next.y ? l : next));
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => { window.removeEventListener('pointermove', onMove); if (frame) window.cancelAnimationFrame(frame); };
  }, [reduceMotion, cat.enabled]);

  const runs = useMemo(() => runsOf(drawCat({ face, blink, look, flick, phase, paws })), [face, blink, look, flick, phase, paws]);

  if (!cat.enabled) return null;

  const box = placement(cat, size.w, size.h);
  const at = drag ?? box;

  return (
    <div
      ref={root}
      className={`cat-peek ${drag ? 'cat-dragging' : ''} ${reduceMotion ? '' : 'cat-live'}`}
      style={{ left: at.left, top: at.top, width: box.width, height: box.height }}
      role="img"
      aria-label="Casimir the cat looks over a ledge. Drag to move him anywhere, click for another face."
      title="Casimir: drag me anywhere, click for another face"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY, dx: e.clientX - box.left, dy: e.clientY - box.top, moved: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 5) return;
        s.moved = true;
        const left = Math.min(Math.max(0, e.clientX - s.dx), Math.max(0, size.w - box.width));
        const top = Math.min(Math.max(0, e.clientY - s.dy), Math.max(0, size.h - box.height));
        setDrag({ left, top });
      }}
      onPointerUp={() => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        if (s.moved && drag) onMove(shareAt(drag.left, drag.top, size.w, size.h));
        else if (!s.moved) setFace((f) => (f === 'sleep' ? 'surprised' : nextFace(f, Math.random())));
        setDrag(null);
      }}
      onPointerCancel={() => { start.current = null; setDrag(null); }}
    >
      <div className="cat-clip">
        <svg key={face} className="cat-svg" width={box.width} height={box.height} viewBox={`0 0 ${FACE_COLS} ${GRID_ROWS}`} shapeRendering="crispEdges" aria-hidden="true" data-pixel={CAT_PIXEL}>
          {runs.map(([x, y, n, t]) => <rect key={`${x}-${y}`} x={x} y={y} width={n} height="1" fill={`var(--cat-${t})`} />)}
        </svg>
      </div>
      <div className="cat-fx" aria-hidden="true">
        {fx.map((f) => f.kind === 'heart'
          ? (
            <svg key={f.id} className="cat-heart" style={{ left: `${f.left}%` }} width="14" height="12" viewBox="0 0 7 6" shapeRendering="crispEdges">
              {HEART.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="var(--cat-8)" /> : null)))}
            </svg>
          )
          : <span key={f.id} className="cat-z" style={{ left: `${f.left}%`, fontSize: f.size > 1 ? 15 : 11 }}>{f.size > 1 ? 'Z' : 'z'}</span>)}
      </div>
    </div>
  );
}
