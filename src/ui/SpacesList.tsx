import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { PRODUCT_NAME } from '../product';
import { relativeTime, type Space } from '../spaces';

type Props = {
  spaces: Space[];
  selected: string | null;
  onSelect: (slug: string) => void;
  /** Drop `from` before `to`, or after it when `after` is set. */
  onReorder?: (from: string, to: string, after: boolean) => void;
  /** Alt+Arrow keys: move one step up or down. */
  onNudge?: (slug: string, direction: -1 | 1) => void;
  /** Pinned Spaces (kept at the top) and the toggle. */
  pinned?: string[];
  onTogglePin?: (slug: string) => void;
};

type DropMark = { slug: string; after: boolean };

export default function SpacesList({ spaces, selected, onSelect, onReorder, onNudge, pinned = [], onTogglePin }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [mark, setMark] = useState<DropMark | null>(null);

  function overCard(event: DragEvent<HTMLButtonElement>, slug: string) {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    setMark((current) => (current?.slug === slug && current.after === after ? current : { slug, after }));
  }

  function endDrag() {
    setDragging(null);
    setMark(null);
  }

  function dropOn(event: DragEvent<HTMLButtonElement>, slug: string) {
    event.preventDefault();
    const from = dragging ?? event.dataTransfer.getData('text/plain');
    const after = mark?.slug === slug ? mark.after : false;
    endDrag();
    if (from && onReorder) onReorder(from, slug, after);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>, slug: string) {
    if (!event.altKey || !onNudge) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      onNudge(slug, event.key === 'ArrowUp' ? -1 : 1);
    }
  }

  return (
    <aside className="list">
      <div className="list-head">
        <span className="list-title">Spaces</span>
        <button className="icon-btn" title="Search" aria-label="Search">
          <SearchIcon />
        </button>
        <button className="icon-btn" title="Filter" aria-label="Filter">
          <FilterIcon />
        </button>
      </div>

      {spaces.length === 0 ? (
        <p className="list-empty">
          No Spaces yet. Ask {PRODUCT_NAME} to create a dashboard from grounded data.
        </p>
      ) : (
        spaces.map((s) => (
          <button
            key={s.slug}
            className={[
              'card',
              selected === s.slug ? 'card-on' : '',
              dragging === s.slug ? 'card-dragging' : '',
              mark?.slug === s.slug && dragging !== s.slug ? (mark.after ? 'card-drop-after' : 'card-drop-before') : '',
            ].filter(Boolean).join(' ')}
            draggable={Boolean(onReorder)}
            title={onReorder ? 'Drag to reorder (or Alt+↑ / Alt+↓)' : undefined}
            onClick={() => onSelect(s.slug)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', s.slug);
              setDragging(s.slug);
            }}
            onDragOver={(event) => overCard(event, s.slug)}
            onDrop={(event) => dropOn(event, s.slug)}
            onDragEnd={endDrag}
            onKeyDown={(event) => keyDown(event, s.slug)}
          >
            <span className="card-head">
              <span className="card-icon"><SpaceIcon /></span>
              <span className="card-title-wrap">
                <span className="card-title">{s.title}</span>
                <span className="card-meta">Updated {relativeTime(s.updatedAt)}</span>
              </span>
              {onTogglePin ? (
                <span
                  role="button"
                  tabIndex={0}
                  className={`pin-btn ${pinned.includes(s.slug) ? 'pin-btn-on' : ''}`}
                  aria-pressed={pinned.includes(s.slug)}
                  aria-label={pinned.includes(s.slug) ? `Unpin ${s.title}` : `Pin ${s.title}`}
                  title={pinned.includes(s.slug) ? 'Unpin' : 'Pin to the top'}
                  onClick={(event) => { event.stopPropagation(); onTogglePin(s.slug); }}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onTogglePin(s.slug); } }}
                >{pinned.includes(s.slug) ? '★' : '☆'}</span>
              ) : (
                <span className="card-more" aria-hidden="true">···</span>
              )}
            </span>
            {s.description && <span className="card-desc">{s.description}</span>}
          </button>
        ))
      )}
    </aside>
  );
}

function SpaceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.8 6h12.4M6.4 6v7.4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.2 3.2h11.6L9.5 8.1v3.5l-3 1.5v-5z" fill="currentColor" />
    </svg>
  );
}
