import type { Space } from '../spaces';
import { relativeTime } from '../spaces';

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
}: {
  domains: OverviewDomain[];
  active: string | null;
  onActive: (name: string | null) => void;
  onOpen: (slug: string) => void;
  parentOf: (slug: string) => string;
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
                <button className="sov-card" onClick={() => onOpen(s.slug)}>
                  <span className="sov-card-title">{s.title}</span>
                  {s.description && <span className="sov-card-desc">{s.description}</span>}
                  <span className="sov-card-meta">aktualisiert {relativeTime(s.updatedAt)}</span>
                </button>
                {kids(s.slug).length > 0 && (
                  <div className="sov-kids">
                    {kids(s.slug).map((k) => (
                      <button key={k.slug} className="sov-kid" onClick={() => onOpen(k.slug)}>
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
        <h1 className="sov-title">Spaces</h1>
        <p className="sov-sub">{total} Spaces in {domains.length} {domains.length === 1 ? 'Domain' : 'Domains'}. Wähle eine Domain, um ihre Spaces zu sehen.</p>
        <div className="sov-grid">
          {domains.map((d) => {
            const top = d.spaces.filter((s) => !parentOf(s.slug));
            return (
              <button key={d.name} className="sov-tile" onClick={() => onActive(d.name)}>
                <span className="sov-tile-name">{d.name}</span>
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
