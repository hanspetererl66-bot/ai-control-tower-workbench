import type { PointerEvent } from 'react';
import type { Space } from '../spaces';
import { relativeTime, spaceHighlight } from '../spaces';

/** Feeds the pointer position to the CSS spotlight of a tile (no re-render). */
function track(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

export type OverviewDomain = { name: string; spaces: Space[] };

/**
 * Landing page of the Spaces view: one tile per domain, a click shows the Spaces of that domain.
 * Subspaces are listed under their parent Space.
 */
export default function SpacesOverview({
  domains,
  active,
  onActive,
  onOpen,
  parentOf,
  onDesign,
}: {
  domains: OverviewDomain[];
  active: string | null;
  onActive: (name: string | null) => void;
  onOpen: (slug: string) => void;
  parentOf: (slug: string) => string;
  /** Opens the Space Designer with a new page. */
  onDesign?: () => void;
}) {
  const total = domains.reduce((n, d) => n + d.spaces.length, 0);
  const current = active ? domains.find((d) => d.name === active) : undefined;

  if (current) {
    const top = current.spaces.filter((s) => !parentOf(s.slug));
    const kids = (slug: string) => current.spaces.filter((s) => parentOf(s.slug) === slug);
    return (
      <main className="main sov">
        <div className="sov-inner">
          <button className="sov-back" onClick={() => onActive(null)}>← Alle Domains</button>
          <h1 className="sov-title">{current.name}</h1>
          <p className="sov-sub">{current.spaces.length} {current.spaces.length === 1 ? 'Space' : 'Spaces'}</p>
          {current.spaces.length === 0 && <p className="sov-sub">In dieser Domain gibt es noch keine Spaces.</p>}
          <div className="sov-spaces">
            {top.map((s) => (
              <div key={s.slug} className="sov-space">
                <button className="sov-card" onPointerMove={track} onClick={() => onOpen(s.slug)}>
                  <span className="sov-card-title">{s.title}</span>
                  {s.description && <span className="sov-card-desc">{s.description}</span>}
                  {spaceHighlight(s.insights) && <span className="sov-card-hint">{spaceHighlight(s.insights)}</span>}
                  <span className="sov-card-meta">
                    {kids(s.slug).length > 0 ? `${kids(s.slug).length} ${kids(s.slug).length === 1 ? 'Subspace' : 'Subspaces'} · ` : ''}aktualisiert {relativeTime(s.updatedAt)}
                  </span>
                </button>
                {kids(s.slug).length > 0 && (
                  <div className="sov-kids">
                    {kids(s.slug).map((k) => (
                      <button key={k.slug} className="sov-kid" onPointerMove={track} onClick={() => onOpen(k.slug)}>
                        <span className="sov-card-title">{k.title}</span>
                        {k.description && <span className="sov-card-desc">{k.description}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="main sov">
      <div className="sov-inner">
        <div className="sov-titlebar">
          <h1 className="sov-title">Spaces</h1>
          {onDesign && <button className="ghost-btn sov-design" onClick={onDesign} title="Build a Space from blocks: tables, charts, boxes side by side and more">+ Design a Space</button>}
        </div>
        <p className="sov-sub">{total} Spaces in {domains.length} {domains.length === 1 ? 'Domain' : 'Domains'}. Wähle eine Domain, um ihre Spaces zu sehen.</p>
        <div className="sov-grid">
          {domains.map((d) => {
            const top = d.spaces.filter((s) => !parentOf(s.slug));
            return (
              <button key={d.name} className="sov-tile" onPointerMove={track} onClick={() => onActive(d.name)}>
                <span className="sov-tile-head">
                  <span className="sov-tile-name">{d.name}</span>
                  <span className="sov-go" aria-hidden="true">→</span>
                </span>
                <span className="sov-tile-count">{d.spaces.length} {d.spaces.length === 1 ? 'Space' : 'Spaces'}</span>
                <span className="sov-tile-list">
                  {top.slice(0, 4).map((s) => <span key={s.slug}>{s.title}</span>)}
                  {top.length > 4 && <span className="sov-more">+ {top.length - 4} weitere</span>}
                  {top.length === 0 && <span className="sov-more">noch leer</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}
