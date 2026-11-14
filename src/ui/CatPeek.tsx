import { useEffect, useRef, useState } from 'react';
import { FACE_COLS, VISIBLE_ROWS, faceCells, nextFace, placement, snapToEdge, turnFor, type CatFace, type CatPrefs } from '../cat-peek';

type Props = {
  cat: CatPrefs;
  reduceMotion: boolean;
  /** Called when the cat is dropped at a new place. */
  onMove: (to: Pick<CatPrefs, 'edge' | 'at'>) => void;
};

const KIND_FILL = { fur: 'var(--ink)', light: 'var(--bg)', dark: 'var(--ink)', accent: 'var(--accent)' } as const;

/** Casimir looks over a window edge: only 60 % of the face shows, it changes its face now and then, and it can be dragged to any edge. */
export default function CatPeek({ cat, reduceMotion, onMove }: Props) {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [face, setFace] = useState<CatFace>('neutral');
  const [drag, setDrag] = useState<Pick<CatPrefs, 'edge' | 'at'> | null>(null);
  const moved = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // A new face every 4 to 9 seconds. With reduced motion Casimir stays still; a click still changes the face.
  useEffect(() => {
    if (reduceMotion || !cat.enabled) return undefined;
    let timer = 0;
    const tick = () => {
      setFace((f) => nextFace(f, Math.random()));
      timer = window.setTimeout(tick, 4000 + Math.random() * 5000);
    };
    timer = window.setTimeout(tick, 2500 + Math.random() * 2500);
    return () => window.clearTimeout(timer);
  }, [reduceMotion, cat.enabled]);

  if (!cat.enabled) return null;

  const where = drag ?? cat;
  const box = placement(where, size.w, size.h);
  const turn = turnFor(where.edge);
  const cells = faceCells(face);
  const portrait = where.edge === 'left' || where.edge === 'right';

  return (
    <div
      className={`cat-peek cat-${where.edge} ${drag ? 'cat-dragging' : ''} ${reduceMotion ? '' : 'cat-live'}`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      role="img"
      aria-label="Casimir the cat peeks over the edge of the window. Drag to move him to another edge, click for another face."
      title="Casimir: drag me to another edge, click for another face"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY };
        moved.current = false;
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        if (!moved.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) < 5) return;
        moved.current = true;
        setDrag(snapToEdge(e.clientX, e.clientY, size.w, size.h));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const to = moved.current ? snapToEdge(e.clientX, e.clientY, size.w, size.h) : null;
        start.current = null;
        setDrag(null);
        if (to) onMove(to);
        else setFace((f) => nextFace(f, Math.random()));
      }}
      onPointerCancel={() => { start.current = null; setDrag(null); }}
    >
      <svg
        key={`${where.edge}-${face}`}
        className="cat-svg"
        width={box.width}
        height={box.height}
        viewBox={`0 0 ${portrait ? VISIBLE_ROWS : FACE_COLS} ${portrait ? FACE_COLS : VISIBLE_ROWS}`}
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <g transform={turnTransform(turn, FACE_COLS, VISIBLE_ROWS)}>
          {cells.filter((c) => c.y < VISIBLE_ROWS).map((c) => (
            <rect key={`${c.x}-${c.y}-${c.kind}`} x={c.x} y={c.y} width="1" height="1" fill={KIND_FILL[c.kind]} />
          ))}
        </g>
      </svg>
    </div>
  );
}

/** Turn the head by 90° steps inside a box of w × h cat pixels so that it stays inside the box (which swaps width and height when turned by 90°). */
function turnTransform(turn: number, w: number, h: number): string {
  switch (turn) {
    case 180: return `translate(${w} ${h}) rotate(180)`;
    case 90: return `translate(${h} 0) rotate(90)`;
    case -90: return `translate(0 ${w}) rotate(-90)`;
    default: return '';
  }
}
