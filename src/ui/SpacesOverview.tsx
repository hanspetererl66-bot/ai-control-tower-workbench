import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { flushSync } from 'react-dom';
import type { Space } from '../spaces';
import { relativeTime, spaceHighlight } from '../spaces';
import { countAt, freshSlugs } from '../overview-motion';
import DomainIcon from './DomainIcon';
import type { OverviewLayout, TileStyle } from '../preferences';

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const stagger = (i: number): CSSProperties => ({ ['--i' as string]: Math.min(i, 14) });

/** Counts up to the real number and ends on it (no running counter); with reduced motion it shows the number at once. */
function Count({ to }: { to: number }) {
  const [v, setV] = useState(() => (reducedMotion() ? to : 0));
  useEffect(() => {
    if (reducedMotion()) { setV(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => { const p = (t - t0) / 700; setV(countAt(to, p)); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{v}</>;
}

/** Changes the view with a shared-element transition where the browser has one (tile name becomes the page title and back). */
function transition(run: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (reducedMotion() || !doc.startViewTransition) { run(); return; }
  doc.startViewTransition(() => flushSync(run));
}

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
  layout = 'grid',
  tileStyle = 'classic',
}: {
  domains: OverviewDomain[];
  active: string | null;
  onActive: (name: string | null) => void;
  onOpen: (slug: string) => void;
  parentOf: (slug: string) => string;
  /** Opens the Space Designer with a new page. */
  onDesign?: () => void;
  /** How the page is laid out and how a tile looks (Settings, Spaces overview). */
  layout?: OverviewLayout;
  tileStyle?: TileStyle;
}) {
  const total = domains.reduce((n, d) => n + d.spaces.length, 0);
  const fresh = useMemo(() => freshSlugs(domains.flatMap((d) => d.spaces)), [domains]);
  /** The domain whose name takes part in the transition (clicked tile, or the tile we come back to). */
  const lastDomain = useRef<string | null>(null);
  const open = (e: MouseEvent<HTMLElement>, name: string) => {
    document.querySelectorAll<HTMLElement>('.sov-tile-name').forEach((n) => { n.style.viewTransitionName = ''; });
    const label = e.currentTarget.querySelector<HTMLElement>('.sov-tile-name');
    if (label) label.style.viewTransitionName = 'sov-title';
    lastDomain.current = name;
    transition(() => onActive(name));
  };
  const current = active ? domains.find((d) => d.name === active) : undefined;

  if (current) {
    const top = current.spaces.filter((s) => !parentOf(s.slug));
    const kids = (slug: string) => current.spaces.filter((s) => parentOf(s.slug) === slug);
    return (
      <main className="main sov" data-overview={layout} data-tile={tileStyle}>
        <div className="sov-inner">
          <button className="sov-back" onClick={() => { lastDomain.current = current.name; transition(() => onActive(null)); }}>← Alle Domains</button>
          <h1 className="sov-title sov-title-shared">{current.name}</h1>
          <p className="sov-sub">{current.spaces.length} {current.spaces.length === 1 ? 'Space' : 'Spaces'}</p>
          {current.spaces.length === 0 && <p className="sov-sub">In dieser Domain gibt es noch keine Spaces.</p>}
          <div className="sov-spaces">
            {top.map((s, i) => (
              <div key={s.slug} className="sov-space" style={stagger(i)}>
                <button className="sov-card" data-fresh={fresh.has(s.slug) ? '' : undefined} onPointerMove={track} onClick={() => onOpen(s.slug)}>
                  <span className="sov-card-title">{s.title}{fresh.has(s.slug) && <span className="sov-new" title={`aktualisiert ${relativeTime(s.updatedAt)}`}>kürzlich geändert</span>}</span>
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
    <main className="main sov" data-overview={layout} data-tile={tileStyle}>
      <div className="sov-inner">
        <div className="sov-titlebar">
          <h1 className="sov-title">Spaces</h1>
          {onDesign && <button className="ghost-btn sov-design" onClick={onDesign} title="Build a Space from blocks: tables, charts, boxes side by side and more">+ Design a Space</button>}
        </div>
        <p className="sov-sub" aria-label={`${total} Spaces in ${domains.length} ${domains.length === 1 ? 'Domain' : 'Domains'}. Wähle eine Domain, um ihre Spaces zu sehen.`}>
          <span aria-hidden="true"><Count to={total} /> Spaces in <Count to={domains.length} /> {domains.length === 1 ? 'Domain' : 'Domains'}. Wähle eine Domain, um ihre Spaces zu sehen.</span>
        </p>
        <div className="sov-grid">
          {domains.map((d, i) => {
            const top = d.spaces.filter((s) => !parentOf(s.slug));
            const news = top.filter((s) => fresh.has(s.slug)).length;
            return (
              <button key={d.name} className="sov-tile" style={stagger(i)} onPointerMove={track} onClick={(e) => open(e, d.name)}>
                <DomainIcon name={d.name} />
                <span className="sov-tile-head">
                  <span className="sov-tile-name" style={lastDomain.current === d.name ? { viewTransitionName: 'sov-title' } : undefined}>{d.name}</span>
                  <span className="sov-go" aria-hidden="true">→</span>
                </span>
                <span className="sov-tile-count">{d.spaces.length} {d.spaces.length === 1 ? 'Space' : 'Spaces'}{news > 0 && <span className="sov-tile-new"> · {news} kürzlich geändert</span>}</span>
                <span className="sov-tile-list">
                  {top.map((s) => <span key={s.slug}>{s.title}</span>)}
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
