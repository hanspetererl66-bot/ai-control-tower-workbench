import { useEffect, useMemo, useRef, useState } from 'react';
import { MAP_KIND_LABEL, buildMap, focusOf, layoutMap, searchMap, visibleMap, type MapKind, type MapNode } from '../graph-map';
import { consumersOf, impactOf, ownerLabel, type Governance, type Ontology } from '../ontology-manager';

const ALL_KINDS: MapKind[] = ['ontology', 'class', 'metric', 'resource', 'agent', 'skill', 'report'];
const SHAPE: Record<MapKind, 'hex' | 'round' | 'circle' | 'square' | 'diamond'> = {
  ontology: 'hex', class: 'round', metric: 'circle', resource: 'square', agent: 'diamond', skill: 'diamond', report: 'diamond',
};
const RADIUS: Record<MapKind, number> = { ontology: 15, class: 9, metric: 9, resource: 7, agent: 8, skill: 8, report: 8 };

interface Cam { k: number; x: number; y: number }

function path(c: CanvasRenderingContext2D, shape: string, x: number, y: number, r: number) {
  c.beginPath();
  if (shape === 'circle') c.arc(x, y, r, 0, Math.PI * 2);
  else if (shape === 'round') c.roundRect(x - r, y - r, r * 2, r * 2, r * 0.45);
  else if (shape === 'square') c.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
  else {
    const pts = shape === 'hex' ? 6 : 4;
    for (let i = 0; i < pts; i++) {
      const a = (shape === 'hex' ? 0 : -Math.PI / 2) + (i / pts) * Math.PI * 2, rr = shape === 'diamond' ? r * 1.2 : r;
      c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath();
  }
}

/**
 * Map: the whole catalog as one graph. Click a node to see what hangs on it (the same rule as the impact table), who
 * declared they use it, and whom to ask. Drag to move the view, scroll to zoom. Everything also exists as lists below
 * the map, so the map is never the only way to read it.
 */
export default function OntologyMap({ ontologies, gov, onOpen }: { ontologies: Ontology[]; gov: Governance; onOpen: (slug: string, term: string) => void }) {
  const map = useMemo(() => buildMap(ontologies, gov), [ontologies, gov]);
  const pos = useMemo(() => layoutMap(map), [map]);
  const index = useMemo(() => new Map(map.nodes.map((n, i) => [n.id, i])), [map]);
  const [kinds, setKinds] = useState<Set<MapKind>>(new Set(ALL_KINDS));
  const [slug, setSlug] = useState('all');
  const [depth, setDepth] = useState(3);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const shown = useMemo(() => visibleMap(map, kinds, slug), [map, kinds, slug]);
  const shownIds = useMemo(() => new Set(shown.nodes.map((n) => n.id)), [shown]);
  const focus = useMemo(() => (sel && shownIds.has(sel) ? focusOf(shown, sel, depth) : null), [shown, shownIds, sel, depth]);
  const results = useMemo(() => searchMap(shown, query), [shown, query]);

  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Cam>({ k: 1, x: 0, y: 0 });
  const size = useRef({ w: 800, h: 520 });
  const [tick, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);

  const fit = () => {
    const list = shown.nodes.map((n) => index.get(n.id) as number);
    if (!list.length) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const i of list) { x0 = Math.min(x0, pos.x[i]); x1 = Math.max(x1, pos.x[i]); y0 = Math.min(y0, pos.y[i]); y1 = Math.max(y1, pos.y[i]); }
    const { w, h } = size.current, pad = 60;
    const k = Math.min((w - pad * 2) / Math.max(60, x1 - x0), (h - pad * 2) / Math.max(60, y1 - y0), 2.4);
    cam.current = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
    redraw();
  };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const measure = () => {
      const c = cv.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = el.clientWidth || 800, h = el.clientHeight || 520;
      size.current = { w, h };
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      redraw();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { fit(); /* refit when the visible set changes */ }, [shown, pos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = cv.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const cs = getComputedStyle(c);
    const g = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
    const col = { bg: g('--panel', '#fff'), ink: g('--ink', '#111'), muted: g('--muted', '#777'), line: g('--line', '#ddd'), accent: g('--accent', '#6d28d9'), ok: g('--om-ok', '#1b7f3b'), warn: g('--om-warn', '#9a5a00'), bad: g('--om-bad', '#b3261e') };
    const kindColor: Record<MapKind, string> = { ontology: col.ink, class: col.accent, metric: col.ok, resource: col.muted, agent: col.warn, skill: col.warn, report: col.warn };
    const dpr = Math.min(2, window.devicePixelRatio || 1), { w, h } = size.current, { k, x: cx, y: cy } = cam.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, w, h);
    const sx = (i: number) => pos.x[i] * k + cx, sy = (i: number) => pos.y[i] * k + cy;
    const focusEdge = (e: { from: string; to: string }) => Boolean(focus && focus.level.has(e.from) && focus.level.has(e.to) && [...focus.edges].some((f) => f.from === e.from && f.to === e.to));
    for (const e of shown.edges) {
      const a = index.get(e.from) as number, b = index.get(e.to) as number;
      const inF = focusEdge(e);
      ctx.globalAlpha = focus ? (inF ? 0.95 : 0.06) : e.weak ? 0.12 : 0.42;
      ctx.strokeStyle = inF ? col.bad : col.muted; ctx.lineWidth = inF ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(sx(a), sy(a)); ctx.lineTo(sx(b), sy(b)); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const labels: Array<{ n: MapNode; x: number; y: number; strong: boolean }> = [];
    for (const n of shown.nodes) {
      const i = index.get(n.id) as number, x = sx(i), y = sy(i);
      if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
      const lv = focus?.level.get(n.id);
      const r = (RADIUS[n.kind] + Math.min(6, Math.sqrt(n.degree))) * Math.min(1.5, Math.max(0.6, k));
      ctx.globalAlpha = focus && lv === undefined ? 0.14 : 1;
      ctx.fillStyle = focus && lv !== undefined && lv > 0 ? col.bad : kindColor[n.kind];
      ctx.strokeStyle = col.bg; ctx.lineWidth = 1.6;
      path(ctx, SHAPE[n.kind], x, y, r); ctx.fill(); ctx.stroke();
      if (n.id === sel) { ctx.strokeStyle = col.ink; ctx.lineWidth = 2; path(ctx, SHAPE[n.kind], x, y, r + 5); ctx.stroke(); }
      ctx.globalAlpha = 1;
      const strong = n.id === sel || n.id === hover || (lv !== undefined && lv > 0);
      if (strong || k > 1.1 || n.kind === 'ontology' || n.degree >= 3) labels.push({ n, x, y: y + r + 12, strong });
    }
    ctx.font = `11px ${cs.fontFamily}`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    const placed: number[][] = [];
    labels.sort((a, b) => Number(b.strong) - Number(a.strong) || b.n.degree - a.n.degree);
    for (const l of labels) {
      const tw = ctx.measureText(l.n.label).width, box = [l.x - tw / 2, l.y - 9, l.x + tw / 2, l.y + 3];
      if (!l.strong && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
      placed.push(box);
      ctx.lineWidth = 3.5; ctx.strokeStyle = col.bg; ctx.strokeText(l.n.label, l.x, l.y);
      ctx.fillStyle = l.strong ? col.ink : col.muted; ctx.fillText(l.n.label, l.x, l.y);
    }
  }, [tick, shown, focus, sel, hover, pos, index]);

  const pointer = (ev: { clientX: number; clientY: number }) => {
    const r = (cv.current as HTMLCanvasElement).getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const hit = (p: { x: number; y: number }): MapNode | null => {
    const { k, x: cx, y: cy } = cam.current;
    let best: MapNode | null = null, bd = 1e9;
    for (const n of shown.nodes) {
      const i = index.get(n.id) as number;
      const d = Math.hypot(pos.x[i] * k + cx - p.x, pos.y[i] * k + cy - p.y);
      const r = (RADIUS[n.kind] + Math.min(6, Math.sqrt(n.degree))) * Math.min(1.5, Math.max(0.6, k)) + 6;
      if (d < r && d < bd) { best = n; bd = d; }
    }
    return best;
  };
  const drag = useRef<{ p: { x: number; y: number }; cx: number; cy: number; moved: boolean } | null>(null);
  const onDown = (ev: React.PointerEvent) => {
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    drag.current = { p: pointer(ev), cx: cam.current.x, cy: cam.current.y, moved: false };
  };
  const onMove = (ev: React.PointerEvent) => {
    const p = pointer(ev), d = drag.current;
    if (d) {
      const dx = p.x - d.p.x, dy = p.y - d.p.y;
      if (Math.hypot(dx, dy) > 4) d.moved = true;
      if (d.moved) { cam.current = { ...cam.current, x: d.cx + dx, y: d.cy + dy }; redraw(); }
      return;
    }
    const n = hit(p);
    if (n?.id !== hover) setHover(n?.id ?? null);
  };
  const onUp = (ev: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (d && !d.moved) { const n = hit(pointer(ev)); setSel(n ? (n.id === sel ? null : n.id) : null); }
  };
  const zoom = (f: number, at?: { x: number; y: number }) => {
    const { k, x, y } = cam.current, p = at ?? { x: size.current.w / 2, y: size.current.h / 2 };
    const nk = Math.max(0.2, Math.min(5, k * f));
    cam.current = { k: nk, x: p.x - ((p.x - x) / k) * nk, y: p.y - ((p.y - y) / k) * nk };
    redraw();
  };
  useEffect(() => {
    const c = cv.current;
    if (!c) return undefined;
    const wheel = (ev: WheelEvent) => { ev.preventDefault(); zoom(Math.exp(-ev.deltaY * 0.0015), pointer(ev)); };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const onKey = (ev: React.KeyboardEvent) => {
    const step = 50;
    if (ev.key === '+' || ev.key === '=') zoom(1.25);
    else if (ev.key === '-') zoom(0.8);
    else if (ev.key === '0') fit();
    else if (ev.key === 'ArrowLeft') cam.current = { ...cam.current, x: cam.current.x + step };
    else if (ev.key === 'ArrowRight') cam.current = { ...cam.current, x: cam.current.x - step };
    else if (ev.key === 'ArrowUp') cam.current = { ...cam.current, y: cam.current.y + step };
    else if (ev.key === 'ArrowDown') cam.current = { ...cam.current, y: cam.current.y - step };
    else if (ev.key === 'Escape') setSel(null);
    else return;
    ev.preventDefault(); redraw();
  };

  const toggle = (k: MapKind) => { const s = new Set(kinds); if (s.has(k)) s.delete(k); else s.add(k); setKinds(s); };
  const selNode = sel ? map.nodes.find((n) => n.id === sel) ?? null : null;
  const selOnt = selNode ? ontologies.find((o) => o.slug === selNode.slug) ?? null : null;
  const impact = selNode && selOnt && (selNode.kind === 'class' || selNode.kind === 'metric' || selNode.kind === 'resource') ? impactOf(selOnt, selNode.local, depth) : null;
  const consumers = selNode && selOnt && impact ? consumersOf(gov, selOnt, selNode.local, impact) : [];
  const dependents = focus ? [...focus.level.entries()].filter(([, l]) => l > 0).sort((a, b) => a[1] - b[1]).map(([id, l]) => ({ n: map.nodes.find((x) => x.id === id) as MapNode, l })) : [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of map.nodes) c[n.kind] = (c[n.kind] ?? 0) + 1;
    return c;
  }, [map]);

  if (map.nodes.length === 0) return <section className="om-table"><p className="om-empty">Nothing to draw yet. The map appears once the catalog has terms.</p></section>;

  return (
    <section className="om-map" aria-label="Ontology map">
      <div className="om-map-bar">
        <label className="om-map-search"><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a term, metric or agent…" aria-label="Find in the map" /></label>
        {results.length > 0 && (
          <ul className="om-map-results" role="listbox" aria-label="Matches">
            {results.map((n) => <li key={n.id}><button onClick={() => { setSel(n.id); setQuery(''); }}>{n.label} <span className="om-dim">{MAP_KIND_LABEL[n.kind]}</span></button></li>)}
          </ul>
        )}
        <div className="om-filters" role="group" aria-label="Show">
          {ALL_KINDS.filter((k) => counts[k]).map((k) => (
            <button key={k} className={`om-filter ${kinds.has(k) ? 'om-filter-on' : ''}`} aria-pressed={kinds.has(k)} onClick={() => toggle(k)}>{MAP_KIND_LABEL[k]} {counts[k]}</button>
          ))}
        </div>
        {ontologies.length > 1 && (
          <select className="om-select" value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="Ontology">
            <option value="all">All ontologies</option>
            {ontologies.map((o) => <option key={o.slug} value={o.slug}>{o.title}</option>)}
          </select>
        )}
        <label className="om-map-depth">Depth
          <select className="om-select" value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="How many steps to follow">
            {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      </div>

      <div className="om-map-stage">
        <div className="om-map-canvas" ref={wrap}>
          <canvas ref={cv} tabIndex={0} role="application" onKeyDown={onKey} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
            onPointerLeave={() => { if (!drag.current) setHover(null); }}
            style={{ cursor: hover ? 'pointer' : drag.current ? 'grabbing' : 'grab' }}
            aria-label="Interactive map of the ontology catalog. Use the search box or the list beside it to pick a node. Plus and minus zoom, arrow keys move, 0 fits, Escape clears." />
          <div className="om-map-zoom">
            <button className="om-filter" onClick={() => zoom(1.3)} aria-label="Zoom in">+</button>
            <button className="om-filter" onClick={() => zoom(0.77)} aria-label="Zoom out">−</button>
            <button className="om-filter" onClick={fit} aria-label="Fit the map">Fit</button>
          </div>
          <p className="om-map-hint">{hover ? map.nodes.find((n) => n.id === hover)?.label : 'Click a node: what hangs on it turns red. Drag to move, scroll to zoom.'}</p>
        </div>

        <aside className="om-map-side" aria-live="polite">
          {!selNode && (
            <>
              <h3>How to read this</h3>
              <p className="om-note-small">Each shape is a kind of thing: hexagon = ontology, rounded square = class, circle = metric, square = resource (dataset, check, company code), diamond = agent, skill or report that someone declared uses a term. A line means "derived from", "depends on" or "uses". Pick a node to see what breaks if it changes.</p>
              <p className="om-note-small">{map.nodes.length} nodes, {map.edges.filter((e) => !e.weak).length} links{counts.agent || counts.skill || counts.report ? '' : '. No agent, skill or report is declared yet: add them in the tab Use.'}</p>
            </>
          )}
          {selNode && (
            <>
              <p className="om-crumb">{MAP_KIND_LABEL[selNode.kind]}{selNode.type ? ` · ${selNode.type}` : ''} · {selOnt?.title ?? selNode.slug}</p>
              <h3>{selNode.label}</h3>
              {selNode.note && <p className="om-note-small">{selNode.note}</p>}
              {selOnt && (selNode.kind === 'class' || selNode.kind === 'metric') && <p className="om-note-small">Owner: {ownerLabel({ owner: selNode.owner })}</p>}
              {focus && (
                <>
                  <h4>{dependents.length === 0 ? 'Nothing depends on it' : `${dependents.length} depend on it (up to ${depth} steps)`}</h4>
                  {dependents.length > 0 && (
                    <ul className="om-map-list">
                      {dependents.map(({ n, l }) => <li key={n.id}><button onClick={() => setSel(n.id)}>{n.label}</button> <span className="om-dim">{MAP_KIND_LABEL[n.kind]} · step {l}</span></li>)}
                    </ul>
                  )}
                </>
              )}
              {consumers.length > 0 && (
                <>
                  <h4>Declared users</h4>
                  <ul className="om-map-list">{consumers.map((c) => <li key={`${c.kind}:${c.name}:${c.term}`}>{c.name} <span className="om-dim">{c.kind}{c.direct ? '' : ` via ${c.term}`}</span></li>)}</ul>
                </>
              )}
              {impact && impact.ask.length > 0 && <p className="om-note-small">Ask first: {impact.ask.join(', ')}</p>}
              {impact && impact.dependsOn.length > 0 && (
                <>
                  <h4>It depends on</h4>
                  <ul className="om-map-list">{impact.dependsOn.map((d) => <li key={`${d.prop}:${d.node.id}`}>{d.node.label} <span className="om-dim">{d.prop}</span></li>)}</ul>
                </>
              )}
              {selOnt && (selNode.kind === 'class' || selNode.kind === 'metric') && <button className="om-filter" onClick={() => onOpen(selNode.slug, selNode.local)}>Open in the catalog</button>}
              {' '}<button className="om-filter" onClick={() => setSel(null)}>Clear</button>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
