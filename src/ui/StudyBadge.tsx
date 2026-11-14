import { useEffect, useRef, useState } from 'react';
import { clampBadge, loadBadge, nudgeBadge, saveBadge, type BadgePos } from '../study-badge';

/** The small "JouleX Design Study" badge with its running bar. Drag it anywhere, arrow keys move it, a double click puts it back. */
export default function StudyBadge() {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<BadgePos | null>(() => loadBadge());
  const win = () => ({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampBadge(p, win()) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function current(): BadgePos {
    const r = ref.current!.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const c = current();
    drag.current = { dx: e.clientX - c.x, dy: e.clientY - c.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setPos(clampBadge({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, win()));
  }
  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    setPos((p) => { saveBadge(p); return p; });
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const next = nudgeBadge(pos ?? current(), e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    const c = clampBadge(next, win());
    setPos(c);
    saveBadge(c);
  }
  function reset() { setPos(null); saveBadge(null); }

  return (
    <div
      ref={ref}
      className={`study-badge ${pos ? 'study-badge-moved' : ''}`}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      role="group"
      tabIndex={0}
      aria-label="JouleX Design Study badge. Drag it or use the arrow keys to move it; double click puts it back."
      title="Drag to move, double click to put back"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
    >
      <span className="study-bar"><i /></span>
      <span className="study-name">JouleX Design Study</span>
    </div>
  );
}
