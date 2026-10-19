import { useEffect, useRef } from 'react';
import { GRID_CELL, GRID_PALETTE, GRID_PITCH, gridSize, litAlpha, shimmer, spawnCount } from '../cover-grid';

type Lit = { born: number; life: number; color: string };

/** Big rectangle of small squares: mostly grey and softly shimmering, now and then a cube lights up in a colour. */
export default function CoverGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let cols = 1;
    let rows = 1;
    let phases = new Float32Array(1);
    let lit = new Map<number, Lit>();
    let offsetX = 0;
    let offsetY = 0;
    let carry = 0;
    let last = 0;
    let frame = 0;
    let grey = '#6b7280';
    let pointer: { x: number; y: number } | null = null;

    const readTheme = () => {
      grey = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || grey;
    };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(box.width * ratio);
      canvas.height = Math.round(box.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ({ cols, rows } = gridSize(box.width, box.height));
      offsetX = (box.width - (cols * GRID_PITCH - (GRID_PITCH - GRID_CELL))) / 2;
      offsetY = (box.height - (rows * GRID_PITCH - (GRID_PITCH - GRID_CELL))) / 2;
      phases = Float32Array.from({ length: cols * rows }, () => Math.random() * Math.PI * 2);
      lit = new Map();
      readTheme();
    };

    const light = (index: number, now: number) => {
      if (lit.has(index)) return;
      lit.set(index, {
        born: now,
        life: 900 + Math.random() * 2600,
        color: GRID_PALETTE[Math.floor(Math.random() * GRID_PALETTE.length)],
      });
    };

    const draw = (now: number) => {
      const box = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, box.width, box.height);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const index = row * cols + col;
          const x = offsetX + col * GRID_PITCH;
          const y = offsetY + row * GRID_PITCH;
          let near = 0;
          if (pointer) {
            const d = Math.hypot(x + GRID_CELL / 2 - pointer.x, y + GRID_CELL / 2 - pointer.y);
            near = Math.max(0, 1 - d / 90);
          }
          ctx.globalAlpha = 0.1 + 0.24 * shimmer(col, rows, row, phases[index], now) + 0.3 * near;
          ctx.fillStyle = grey;
          ctx.fillRect(x, y, GRID_CELL, GRID_CELL);
          const cube = lit.get(index);
          if (cube) {
            if (now - cube.born >= cube.life) {
              lit.delete(index);
            } else {
              ctx.globalAlpha = litAlpha(now - cube.born, cube.life);
              ctx.fillStyle = cube.color;
              ctx.fillRect(x, y, GRID_CELL, GRID_CELL);
            }
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      const elapsed = last ? Math.min(100, now - last) : 16;
      last = now;
      const spawned = spawnCount(cols * rows, elapsed, carry);
      carry = spawned.carry;
      for (let i = 0; i < spawned.count; i += 1) {
        const index = Math.floor(Math.random() * cols * rows);
        light(index, now);
        // sometimes a small cluster: the neighbour to the right or below lights up too
        if (Math.random() < 0.2) light(Math.min(cols * rows - 1, index + (Math.random() < 0.5 ? 1 : cols)), now);
      }
      draw(now);
      frame = requestAnimationFrame(tick);
    };

    const onMove = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    const onLeave = () => {
      pointer = null;
    };

    const seedStatic = () => {
      for (let i = 0; i < Math.round(cols * rows * 0.04); i += 1) light(Math.floor(Math.random() * cols * rows), -400);
      draw(0);
    };
    resize();
    let observed = false;
    const observer = new ResizeObserver(() => {
      if (!observed) {
        // the first call only reports the initial size, which resize() above already handled
        observed = true;
        return;
      }
      resize();
      if (reduced) seedStatic();
    });
    observer.observe(canvas);
    if (reduced) {
      seedStatic();
    } else {
      frame = requestAnimationFrame(tick);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerleave', onLeave);
    }
    const themeTimer = window.setInterval(readTheme, 1000);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.clearInterval(themeTimer);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div className="cover-grid" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
