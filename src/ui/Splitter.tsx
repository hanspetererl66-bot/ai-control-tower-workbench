import { useRef } from 'react';
import { clampWidth, DEFAULT_WIDTHS, type PaneWidths } from '../pane-width';

/**
 * A draggable divider between two panes. "list" sits at the right edge of the left list, "dock" at the left edge of the Joule dock.
 * Drag with the mouse, use the arrow keys, or double-click to go back to the default width.
 */
export default function Splitter({ pane, width, onChange, onCommit, side = 'left' }: { pane: keyof PaneWidths; width: number; onChange: (w: number) => void; onCommit: (w: number) => void; side?: 'left' | 'right' }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const label = pane === 'list' ? 'Resize the list' : 'Resize the Joule panel';
  /* A list on the left grows when the divider moves right; a list docked on the right grows when it moves left. */
  const sign = pane === 'list' ? (side === 'right' ? -1 : 1) : -1;
  return (
    <div
      className={`splitter splitter-${pane} ${pane === 'list' && side === 'right' ? 'splitter-list-right' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={(e) => { drag.current = { x: e.clientX, w: width }; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
      onPointerMove={(e) => { if (drag.current) onChange(clampWidth(pane, drag.current.w + sign * (e.clientX - drag.current.x))); }}
      onPointerUp={(e) => { if (!drag.current) return; const w = clampWidth(pane, drag.current.w + sign * (e.clientX - drag.current.x)); drag.current = null; onCommit(w); }}
      onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => onCommit(DEFAULT_WIDTHS[pane])}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 12;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onCommit(clampWidth(pane, width + sign * (e.key === 'ArrowRight' ? step : -step))); }
      }}
    />
  );
}
