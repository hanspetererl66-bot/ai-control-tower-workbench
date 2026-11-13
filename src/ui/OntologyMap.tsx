import { useEffect, useMemo, useRef, useState } from 'react';
import { CONSUMER_MAP_KINDS, MAP_KIND_LABEL, buildMap, LANES, createSimulation, describeFocus, focusOf, layoutLanes, layoutMap, linkWord, searchMap, startingPoints, visibleMap, type LanePanel, type MapEdge, type MapKind, type MapNode } from '../graph-map';
import { cachedSuspected } from './useTermUsage';
import { consumersOf, impactOf, ownerLabel, statusOf, type Governance, type Ontology, type TermStatus } from '../ontology-manager';

const ALL_KINDS: MapKind[] = ['ontology', 'class', 'metric', 'resource', 'agent', 'skill', 'report', 'workflow', 'feature', 'space'];
const SHAPE: Record<MapKind, 'hex' | 'round' | 'circle' | 'square' | 'diamond'> = {
  ontology: 'hex', class: 'round', metric: 'circle', resource: 'square', agent: 'diamond', skill: 'diamond', report: 'diamond', workflow: 'diamond', feature: 'diamond', space: 'diamond',
};
const RADIUS: Record<MapKind, number> = { ontology: 17, class: 10, metric: 9, resource: 7, agent: 8, skill: 8, report: 8, workflow: 8, feature: 8, space: 8 };
const HEAT_START = 1, HEAT_STOP = 0.025, HEAT_DECAY = 0.985;

interface Cam { k: number; x: number; y: number }

type TourStep = 'overview' | 'select' | 'ask' | 'try';

/** One shape of the key, drawn the same way as on the canvas. */
function Glyph({ kind }: { kind: MapKind }) {
  const color = kind === 'ontology' ? 'var(--ink)' : kind === 'class' ? 'var(--accent)' : kind === 'metric' ? 'var(--om-ok)' : kind === 'resource' ? 'var(--muted)' : 'var(--om-warn)';
  const shape = SHAPE[kind];
  return (
    <svg className="om-glyph" viewBox="-12 -12 24 24" width="18" height="18" aria-hidden="true">
      {shape === 'hex' && <polygon points="10,0 5,8.7 -5,8.7 -10,0 -5,-8.7 5,-8.7" fill={color} />}
      {shape === 'round' && <rect x="-8" y="-8" width="16" height="16" rx="4" fill={color} />}
      {shape === 'circle' && <circle r="8" fill={color} />}
      {shape === 'square' && <rect x="-7" y="-7" width="14" height="14" fill={color} />}
      {shape === 'diamond' && <polygon points="0,-10 10,0 0,10 -10,0" fill={color} />}
    </svg>
  );
}

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

/** A colour token as rgba with the given alpha (hex and rgb() tokens; anything else is returned as it is). */
function rgba(col: string, a: number): string {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(col.trim());
  if (h) {
    const v = h[1].length === 3 ? h[1].split('').map((x) => x + x).join('') : h[1];
    return `rgba(${parseInt(v.slice(0, 2), 16)},${parseInt(v.slice(2, 4), 16)},${parseInt(v.slice(4, 6), 16)},${a})`;
  }
  const r = /^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(col.trim());
  return r ? `rgba(${r[1]},${r[2]},${r[3]},${a})` : col;
}

const reduced = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const hash = (s: string): number => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

/**
 * Map: the whole catalog as one living graph. The layout settles on screen (it is a real force simulation: drag a node and the
 * others move out of the way), ontologies are soft coloured areas, links curve and carry small lights when something is selected.
 * Click a node to see what hangs on it (the same rule as the impact table), who declared they use it, and whom to ask.
 * Drag the background to move the view, scroll to zoom, drag the small overview to jump. Everything also exists as lists beside the
 * map, so the map is never the only way to read it. With reduced motion the finished layout is shown and nothing moves by itself.
 */
export default function OntologyMap({ ontologies, gov, onOpen }: { ontologies: Ontology[]; gov: Governance; onOpen: (slug: string, term: string) => void }) {
  // Users that were searched for in this window and are still only suspected join the map dashed (nothing is read here).
  const suspected = useMemo(() => cachedSuspected(ontologies, gov), [ontologies, gov]);
  const map = useMemo(() => buildMap(ontologies, gov, suspected), [ontologies, gov, suspected]);
  const index = useMemo(() => new Map(map.nodes.map((n, i) => [n.id, i])), [map]);
  const status = useMemo(() => {
    const m = new Map<string, TermStatus>();
    for (const o of ontologies) for (const t of o.terms) m.set(`${o.slug}:${t.id}`, statusOf(o, gov, t));
    return m;
  }, [ontologies, gov]);
  const [kinds, setKinds] = useState<Set<MapKind>>(new Set(ALL_KINDS));
  const [slug, setSlug] = useState('all');
  const [depth, setDepth] = useState(3);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tour, setTour] = useState<number | null>(null);
  /** Sorted: one panel per ontology with lanes from left to right. Free: the living force layout. */
  const [mode, setMode] = useState<'sorted' | 'free'>('sorted');
  const starts = useMemo(() => startingPoints(map, 4, depth), [map, depth]);
  const shown = useMemo(() => visibleMap(map, kinds, slug), [map, kinds, slug]);
  const shownIds = useMemo(() => new Set(shown.nodes.map((n) => n.id)), [shown]);
  const focus = useMemo(() => (sel && shownIds.has(sel) ? focusOf(shown, sel, depth) : null), [shown, shownIds, sel, depth]);
  const results = useMemo(() => searchMap(shown, query), [shown, query]);

  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Cam>({ k: 1, x: 0, y: 0 });
  const camTo = useRef<Cam | null>(null);
  const size = useRef({ w: 800, h: 520 });
  const sim = useRef<ReturnType<typeof createSimulation> | null>(null);
  const heat = useRef(0);
  const born = useRef(0);
  const vis = useRef(new Map<string, number>());
  /** True once the person has moved or zoomed the view themselves; until then the map keeps itself centred. */
  const touched = useRef(false);
  const raf = useRef(0);
  const panels = useRef<LanePanel[]>([]);
  const live = useRef({ shown, focus, sel, hover, status, index, mode });
  live.current = { shown, focus, sel, hover, status, index, mode };
  const quiet = useMemo(reduced, []);

  const fitTarget = (): Cam | null => {
    const sm = sim.current;
    const list = shown.nodes.map((n) => index.get(n.id) as number);
    if (!sm || !list.length) return null;
    // the 3 % at each end are left out, so one stray node does not make everything else small
    const xs = list.map((i) => sm.x[i]).sort((p, q) => p - q), ys = list.map((i) => sm.y[i]).sort((p, q) => p - q);
    const cut = list.length > 20 ? Math.floor(list.length * 0.03) : 0;
    let x0 = xs[cut], x1 = xs[xs.length - 1 - cut], y0 = ys[cut], y1 = ys[ys.length - 1 - cut];
    if (mode === 'sorted' && panels.current.length) {
      // fit the boxes themselves (of the ontologies shown), so none is cut off
      const own = panels.current.filter((pn) => shown.nodes.some((n) => n.slug === pn.slug));
      if (own.length) { x0 = Math.min(...own.map((pn) => pn.x)); x1 = Math.max(...own.map((pn) => pn.x + pn.w)); y0 = Math.min(...own.map((pn) => pn.y)); y1 = Math.max(...own.map((pn) => pn.y + pn.h)); }
    }
    const { w, h } = size.current, pad = 70, top = 78, bottom = 44; // room for the buttons above and the hint below
    const k = Math.min((w - pad * 2) / Math.max(60, x1 - x0), (h - top - bottom) / Math.max(60, y1 - y0), 2.4);
    return { k, x: w / 2 - ((x0 + x1) / 2) * k, y: top + (h - top - bottom) / 2 - ((y0 + y1) / 2) * k };
  };
  const fitRef = useRef<() => void>(() => {});
  const fit = () => { touched.current = false; const t = fitTarget(); if (!t) return; if (quiet) cam.current = t; else camTo.current = t; kick(); };

  fitRef.current = fit;

  // ---------- one drawing routine, driven by the animation loop below
  const draw = (now: number) => {
    const c = cv.current, sm = sim.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !sm) return;
    const { shown: sh, focus: fo, sel: sl, hover: hv, status: st, index: ix, mode: md } = live.current;
    const sorted = md === 'sorted';
    const cs = getComputedStyle(c);
    const g = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
    const col = { bg: g('--panel', '#fff'), ink: g('--ink', '#111'), muted: g('--muted', '#777'), line: g('--line', '#ddd'), accent: g('--accent', '#6d28d9'), ok: g('--om-ok', '#1b7f3b'), warn: g('--om-warn', '#9a5a00'), bad: g('--om-bad', '#b3261e') };
    const kindColor: Record<MapKind, string> = { ontology: col.ink, class: col.accent, metric: col.ok, resource: col.muted, agent: col.warn, skill: col.warn, report: col.warn, workflow: col.warn, feature: col.warn, space: col.warn };
    const tints = [col.accent, col.ok, col.warn, col.bad, col.muted];
    const dpr = Math.min(2, window.devicePixelRatio || 1), { w, h } = size.current, { k, x: cx, y: cy } = cam.current;
    const t = now / 1000, intro = quiet ? 1 : Math.min(1, Math.max(0, (now - born.current) / 1400));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, w, h);
    // faint dot grid that moves with the view
    const step = 36 * Math.max(0.5, Math.min(2, k)), ox = ((cx % step) + step) % step, oy = ((cy % step) + step) % step;
    ctx.fillStyle = rgba(col.line, 0.5);
    for (let gx = ox; gx < w; gx += step) for (let gy = oy; gy < h; gy += step) ctx.fillRect(gx, gy, 1.3, 1.3);
    const sx = (i: number) => sm.x[i] * k + cx, sy = (i: number) => sm.y[i] * k + cy;
    const alphaOf = (id: string) => vis.current.get(id) ?? 1;

    // ontologies as soft coloured areas
    const slugs = [...new Set(sh.nodes.map((n) => n.slug))];
    if (sorted) {
      const present = new Set(sh.nodes.map((n) => n.slug));
      panels.current.forEach((pn, si) => {
        if (!present.has(pn.slug)) return;
        const tint = tints[si % tints.length], touched = !fo || sh.nodes.some((n) => n.slug === pn.slug && fo.level.has(n.id));
        ctx.globalAlpha = (touched ? 1 : 0.35) * intro;
        const px = pn.x * k + cx, py = pn.y * k + cy, pw = pn.w * k, ph = pn.h * k;
        if (px > w || py > h || px + pw < 0 || py + ph < 0) return;
        ctx.fillStyle = rgba(tint, 0.06); ctx.strokeStyle = rgba(tint, 0.38); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 16 * Math.min(1.4, k)); ctx.fill(); ctx.stroke();
        ctx.textAlign = 'left';
        ctx.font = `700 ${Math.max(10, Math.round(14 * Math.min(1.6, k)))}px ${cs.fontFamily}`; ctx.fillStyle = tint;
        ctx.fillText(pn.title.replace(/\s*\(.*$/, ''), px + 28 * k + 30 * Math.min(1.5, Math.max(0.6, k)), py + 29 * k + 4);
        ctx.font = `600 ${Math.max(8, Math.round(10.5 * Math.min(1.5, k)))}px ${cs.fontFamily}`;
        for (const ln of pn.lanes) {
          const lx = ln.x * k + cx;
          let head = ln.label.toUpperCase();
          while (head.length > 3 && ctx.measureText(head).width > ln.w * k - 16 * k) head = `${head.slice(0, -2)}…`;
          ctx.fillStyle = rgba(col.muted, 0.95); ctx.fillText(head, lx + 4 * k, py + 56 * k + 3);
          ctx.strokeStyle = rgba(tint, 0.25); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx + 4 * k, py + 60 * k); ctx.lineTo(lx + ln.w * k - 10 * k, py + 60 * k); ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
    } else slugs.forEach((sg, si) => {
      const mem = sh.nodes.filter((n) => n.slug === sg && !CONSUMER_MAP_KINDS.includes(n.kind));
      if (mem.length < 3) return;
      let mx = 0, my = 0;
      for (const n of mem) { const i = ix.get(n.id) as number; mx += sx(i); my += sy(i); }
      mx /= mem.length; my /= mem.length;
      let rr = 0;
      for (const n of mem) { const i = ix.get(n.id) as number; rr = Math.max(rr, Math.hypot(sx(i) - mx, sy(i) - my)); }
      rr += 46 * Math.min(1.4, Math.max(0.7, k));
      const tint = tints[si % tints.length];
      const gr = ctx.createRadialGradient(mx, my, rr * 0.15, mx, my, rr);
      gr.addColorStop(0, rgba(tint, 0.1 * intro)); gr.addColorStop(0.7, rgba(tint, 0.05 * intro)); gr.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(mx, my, rr, 0, Math.PI * 2); ctx.fill();
      if (k < 1.5 && sh.nodes.some((n) => n.slug === sg && n.kind === 'ontology')) {
        ctx.font = `600 ${Math.round(11 + 3 * Math.min(1, 1 / k))}px ${cs.fontFamily}`; ctx.textAlign = 'center';
        ctx.fillStyle = rgba(tint, 0.55 * intro);
        ctx.fillText((sh.nodes.find((n) => n.slug === sg && n.kind === 'ontology') as MapNode).label.replace(/\s*\(.*$/, '').toUpperCase(), mx, my - rr + 16); // the part in brackets ("draft, from the handbook") would run into the next area
      }
    });

    // links: curved, with arrow heads and, for what is selected, small lights moving the way a change travels
    const focusKeys = new Set(fo ? [...fo.edges].map((e) => `${e.from}>${e.to}`) : []);
    const curve = (e: MapEdge) => {
      const a = ix.get(e.from) as number, b = ix.get(e.to) as number;
      const ax = sx(a), ay = sy(a), bx = sx(b), by = sy(b), mx = (ax + bx) / 2, my = (ay + by) / 2;
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) + 0.01;
      const bend = e.weak ? 0 : (hash(e.from + e.to) % 2 ? 1 : -1) * Math.min(38, len * 0.16);
      return { ax, ay, bx, by, qx: mx - (dy / len) * bend, qy: my + (dx / len) * bend, len };
    };
    const at = (q: ReturnType<typeof curve>, u: number) => ({
      x: (1 - u) * (1 - u) * q.ax + 2 * (1 - u) * u * q.qx + u * u * q.bx, y: (1 - u) * (1 - u) * q.ay + 2 * (1 - u) * u * q.qy + u * u * q.by,
    });
    const lights: Array<{ q: ReturnType<typeof curve>; hot: boolean }> = [];
    const linkWords: Array<{ q: ReturnType<typeof curve>; text: string }> = [];
    for (const e of sh.edges) {
      if (sorted && e.weak) continue; // the panel already shows what belongs to which ontology
      const q = curve(e), inF = focusKeys.has(`${e.from}>${e.to}`);
      const touchesHover = hv !== null && (e.from === hv || e.to === hv);
      const va = Math.min(alphaOf(e.from), alphaOf(e.to));
      const base = fo ? (inF ? 0.95 : 0.05) : e.weak ? 0.1 : touchesHover ? 0.8 : sorted ? 0.24 : 0.4;
      ctx.globalAlpha = base * Math.max(0.25, va) * intro;
      ctx.strokeStyle = inF ? col.bad : touchesHover ? col.accent : col.muted; ctx.lineWidth = inF ? 2.2 : touchesHover ? 1.6 : 1;
      if (e.weak || e.uncertain) ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(q.ax, q.ay);
      if (e.weak) ctx.lineTo(q.bx, q.by); else ctx.quadraticCurveTo(q.qx, q.qy, q.bx, q.by);
      ctx.stroke(); ctx.setLineDash([]);
      if (!e.weak && k > 0.7 && (inF || touchesHover || !fo)) {
        const p = at(q, 0.82), p2 = at(q, 0.86), ang = Math.atan2(p2.y - p.y, p2.x - p.x), r = 4.5 * Math.min(1.4, k);
        ctx.fillStyle = inF ? col.bad : touchesHover ? col.accent : col.muted;
        ctx.beginPath(); ctx.moveTo(p2.x + Math.cos(ang) * r, p2.y + Math.sin(ang) * r);
        ctx.lineTo(p2.x + Math.cos(ang + 2.5) * r, p2.y + Math.sin(ang + 2.5) * r); ctx.lineTo(p2.x + Math.cos(ang - 2.5) * r, p2.y + Math.sin(ang - 2.5) * r); ctx.closePath(); ctx.fill();
      }
      if (!quiet && !e.weak && (inF || touchesHover)) lights.push({ q, hot: inF });
      // the name of a link ("derived from") is shown for the links of the node under the pointer or the selected one
      if (!e.weak && k > 0.55 && (touchesHover || (sl !== null && (e.from === sl || e.to === sl)))) linkWords.push({ q, text: linkWord(e.prop) });
    }
    ctx.globalAlpha = 1;
    // a change moves from the thing that is changed (to) to what depends on it (from)
    if (!quiet) {
      for (const l of lights) {
        const dots = l.hot ? 3 : 2;
        for (let d = 0; d < dots; d++) {
          const u = 1 - ((t * 0.42 + d / dots + (l.q.len % 7) / 7) % 1);
          for (let tail = 0; tail < 3; tail++) {
            const p = at(l.q, Math.min(1, u + tail * 0.025));
            ctx.globalAlpha = (0.9 - tail * 0.3) * intro; ctx.fillStyle = l.hot ? col.bad : col.accent;
            ctx.beginPath(); ctx.arc(p.x, p.y, (2.6 - tail * 0.6) * Math.min(1.4, Math.max(0.8, k)), 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // nodes
    const labels: Array<{ n: MapNode; x: number; y: number; strong: boolean; a: number }> = [];
    for (const n of sh.nodes) {
      const i = ix.get(n.id) as number, x = sx(i), y = sy(i);
      if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
      const lv = fo?.level.get(n.id), va = alphaOf(n.id);
      const r = (RADIUS[n.kind] + Math.min(6, Math.sqrt(n.degree))) * Math.min(1.5, Math.max(0.6, k)) * (0.4 + 0.6 * intro);
      const colr = fo && lv !== undefined && lv > 0 ? col.bad : kindColor[n.kind];
      const state = st.get(n.id);
      if (n.id === sl || n.id === hv || (lv !== undefined && lv > 0)) {
        const hr = r * (n.id === sl ? 4.2 : 3.2);
        const gl = ctx.createRadialGradient(x, y, r * 0.5, x, y, hr);
        gl.addColorStop(0, rgba(colr, 0.38)); gl.addColorStop(1, rgba(colr, 0));
        ctx.globalAlpha = 1; ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, hr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = Math.max(0.12, va) * (state === 'deprecated' ? 0.55 : 1);
      const fill = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.15);
      fill.addColorStop(0, rgba(colr, 0.78)); fill.addColorStop(1, colr);
      ctx.fillStyle = fill; ctx.strokeStyle = col.bg; ctx.lineWidth = 1.6;
      path(ctx, SHAPE[n.kind], x, y, r); ctx.fill(); ctx.stroke();
      if (n.uncertain) { ctx.setLineDash([3, 2]); ctx.strokeStyle = col.warn; ctx.lineWidth = 1.6; path(ctx, SHAPE[n.kind], x, y, r + 3); ctx.stroke(); ctx.setLineDash([]); }
      if (state === 'deprecated' || state === 'draft') { ctx.setLineDash([3, 2]); ctx.strokeStyle = state === 'deprecated' ? col.bad : col.warn; ctx.lineWidth = 1.6; path(ctx, SHAPE[n.kind], x, y, r + 3); ctx.stroke(); ctx.setLineDash([]); }
      if (n.id === sl) {
        ctx.globalAlpha = 1; ctx.strokeStyle = col.ink; ctx.lineWidth = 2; path(ctx, SHAPE[n.kind], x, y, r + 5); ctx.stroke();
        if (!quiet) { const ph = (t * 0.8) % 1; ctx.globalAlpha = (1 - ph) * 0.6; ctx.strokeStyle = colr; ctx.lineWidth = 1.5; path(ctx, SHAPE[n.kind], x, y, r + 6 + ph * 26); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
      const strong = n.id === sl || n.id === hv || (lv !== undefined && lv > 0);
      if (sorted ? (n.kind !== 'ontology' && (strong || k > 0.42)) : (strong || k > 1.1 || n.kind === 'ontology' || n.degree >= 3)) labels.push({ n, x: sorted ? x + r + 7 : x, y: sorted ? y + 4 : y + r + 12, strong, a: Math.max(0.15, va) });
    }
    ctx.font = `${sorted ? Math.max(9, Math.round(11.5 * Math.min(1.4, k))) : 11}px ${cs.fontFamily}`; ctx.textAlign = sorted ? 'left' : 'center'; ctx.lineJoin = 'round';
    const placed: number[][] = [];
    labels.sort((a, b) => Number(b.strong) - Number(a.strong) || b.n.degree - a.n.degree);
    for (const l of labels) {
      let text = l.n.label;
      if (sorted) { const maxW = Math.max(28, 176 * k - 12 * k - 26); while (text.length > 3 && ctx.measureText(text).width > maxW) text = `${text.slice(0, -2)}…`; }
      const tw = ctx.measureText(text).width, box = sorted ? [l.x, l.y - 9, l.x + tw, l.y + 3] : [l.x - tw / 2, l.y - 9, l.x + tw / 2, l.y + 3];
      if (!sorted && l.n.id !== sl && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
      placed.push(box);
      ctx.globalAlpha = l.a * intro;
      ctx.lineWidth = 3.5; ctx.strokeStyle = col.bg; ctx.strokeText(text, l.x, l.y);
      ctx.fillStyle = l.strong ? col.ink : col.muted; ctx.fillText(text, l.x, l.y);
    }
    ctx.globalAlpha = 1;
    ctx.font = `600 10px ${cs.fontFamily}`; ctx.textAlign = 'center';
    for (const lw of linkWords) {
      const p = at(lw.q, 0.5);
      ctx.lineWidth = 4; ctx.strokeStyle = col.bg; ctx.strokeText(lw.text, p.x, p.y + 3);
      ctx.fillStyle = col.accent; ctx.fillText(lw.text, p.x, p.y + 3);
    }

    // small overview in the corner
    const mw = 132, mh = 88, mx0 = w - mw - 12, my0 = h - mh - 12;
    if (w > 560 && sh.nodes.length > 8) {
      ctx.fillStyle = rgba(col.bg, 0.88); ctx.strokeStyle = col.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(mx0, my0, mw, mh, 8); ctx.fill(); ctx.stroke();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const n of sh.nodes) { const i = ix.get(n.id) as number; x0 = Math.min(x0, sm.x[i]); x1 = Math.max(x1, sm.x[i]); y0 = Math.min(y0, sm.y[i]); y1 = Math.max(y1, sm.y[i]); }
      const sc = Math.min((mw - 14) / Math.max(40, x1 - x0), (mh - 14) / Math.max(40, y1 - y0));
      const px = (v: number) => mx0 + mw / 2 + (v - (x0 + x1) / 2) * sc, py = (v: number) => my0 + mh / 2 + (v - (y0 + y1) / 2) * sc;
      for (const n of sh.nodes) { const i = ix.get(n.id) as number; ctx.fillStyle = fo && fo.level.has(n.id) ? col.bad : kindColor[n.kind]; ctx.globalAlpha = fo && !fo.level.has(n.id) ? 0.25 : 0.85; ctx.fillRect(px(sm.x[i]) - 1, py(sm.y[i]) - 1, 2.4, 2.4); }
      ctx.globalAlpha = 1; ctx.strokeStyle = col.accent; ctx.lineWidth = 1.2;
      const vx0 = px((0 - cx) / k), vy0 = py((0 - cy) / k), vx1 = px((w - cx) / k), vy1 = py((h - cy) / k);
      ctx.strokeRect(Math.max(mx0, vx0), Math.max(my0, vy0), Math.max(4, Math.min(mx0 + mw, vx1) - Math.max(mx0, vx0)), Math.max(4, Math.min(my0 + mh, vy1) - Math.max(my0, vy0)));
      mini.current = { mx0, my0, mw, mh, x0, x1, y0, y1, sc };
    } else mini.current = null;
  };
  const mini = useRef<{ mx0: number; my0: number; mw: number; mh: number; x0: number; x1: number; y0: number; y1: number; sc: number } | null>(null);

  // ---------- animation loop: runs only while something moves
  const kick = () => { if (!raf.current) raf.current = requestAnimationFrame(loop); };
  function loop(now: number) {
    raf.current = 0;
    const sm = sim.current;
    if (!sm) return;
    let busy = false;
    if (heat.current > HEAT_STOP) {
      for (let s = 0; s < 2; s++) { sm.tick(Math.max(0.02, heat.current)); heat.current *= HEAT_DECAY; }
      busy = true;
      if (heat.current > 0.2 && !camTo.current) { const f = fitTarget(); if (f) camTo.current = f; }
    }
    if (camTo.current) {
      const c = cam.current, tg = camTo.current, e = 0.12;
      const next = { k: c.k + (tg.k - c.k) * e, x: c.x + (tg.x - c.x) * e, y: c.y + (tg.y - c.y) * e };
      cam.current = next;
      if (Math.abs(tg.k - next.k) < 0.002 && Math.abs(tg.x - next.x) < 0.4 && Math.abs(tg.y - next.y) < 0.4) { cam.current = tg; camTo.current = null; } else busy = true;
    }
    const { focus: fo, sel: sl, hover: hv, shown: sh } = live.current;
    for (const n of sh.nodes) {
      const lv = fo?.level.has(n.id);
      const near = hv && !fo ? (n.id === hv || sh.edges.some((e) => (e.from === hv && e.to === n.id) || (e.to === hv && e.from === n.id))) : true;
      const target = fo ? (lv ? 1 : 0.14) : near ? 1 : 0.28;
      const cur = vis.current.get(n.id) ?? 1;
      const nx = Math.abs(target - cur) < 0.01 ? target : cur + (target - cur) * 0.18;
      if (nx !== cur) { vis.current.set(n.id, nx); busy = true; }
    }
    if (!quiet && (fo || sl || hv || now - born.current < 1500)) busy = true;
    draw(now);
    if (busy) kick();
  }

  // ---------- start or restart when the catalog changes
  useEffect(() => {
    const sm = createSimulation(map);
    sim.current = sm; vis.current = new Map(); born.current = performance.now();
    if (mode === 'sorted') {
      const lay = layoutLanes(map);
      sm.x.set(lay.x); sm.y.set(lay.y); panels.current = lay.panels; heat.current = 0;
    } else if (quiet) {
      const done = layoutMap(map);
      sm.x.set(done.x); sm.y.set(done.y); heat.current = 0;
    } else heat.current = HEAT_START;
    const f = fitTarget(); if (f) cam.current = f;
    kick();
    return () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [map, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fit(); }, [shown, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { kick(); }, [focus, sel, hover, status]); // eslint-disable-line react-hooks/exhaustive-deps
  // choosing a node brings it and what hangs on it into view; clearing the choice shows the whole map again
  useEffect(() => {
    const sm = sim.current;
    if (!sm) return;
    if (!focus) { if (!touched.current || sel === null) fit(); return; }
    const ids = [...focus.level.keys()].map((id) => index.get(id)).filter((i): i is number => i !== undefined);
    if (!ids.length) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const i of ids) { x0 = Math.min(x0, sm.x[i]); x1 = Math.max(x1, sm.x[i]); y0 = Math.min(y0, sm.y[i]); y1 = Math.max(y1, sm.y[i]); }
    const { w, h } = size.current, pad = 90;
    const k = Math.min((w - pad * 2) / Math.max(120, x1 - x0), (h - pad * 2) / Math.max(120, y1 - y0), 2.2);
    const target = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
    if (quiet) cam.current = target; else camTo.current = target;
    kick();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const measure = () => {
      const c = cv.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = el.clientWidth || 800, h = el.clientHeight || 520;
      size.current = { w, h };
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      if (!touched.current && !live.current.focus) fitRef.current(); // the first fit ran before the size was known
      kick();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pointer = (ev: { clientX: number; clientY: number }) => {
    const r = (cv.current as HTMLCanvasElement).getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const hit = (p: { x: number; y: number }): MapNode | null => {
    const sm = sim.current;
    if (!sm) return null;
    const { k, x: cx, y: cy } = cam.current;
    let best: MapNode | null = null, bd = 1e9;
    for (const n of shown.nodes) {
      const i = index.get(n.id) as number;
      const d = Math.hypot(sm.x[i] * k + cx - p.x, sm.y[i] * k + cy - p.y);
      const r = (RADIUS[n.kind] + Math.min(6, Math.sqrt(n.degree))) * Math.min(1.5, Math.max(0.6, k)) + 6;
      if (d < r && d < bd) { best = n; bd = d; }
    }
    return best;
  };
  const inMini = (p: { x: number; y: number }) => { const m = mini.current; return m && p.x >= m.mx0 && p.x <= m.mx0 + m.mw && p.y >= m.my0 && p.y <= m.my0 + m.mh ? m : null; };
  const jump = (p: { x: number; y: number }) => {
    const m = mini.current;
    if (!m) return;
    const wx = (p.x - m.mx0 - m.mw / 2) / m.sc + (m.x0 + m.x1) / 2, wy = (p.y - m.my0 - m.mh / 2) / m.sc + (m.y0 + m.y1) / 2, { k } = cam.current;
    cam.current = { k, x: size.current.w / 2 - wx * k, y: size.current.h / 2 - wy * k }; camTo.current = null; kick();
  };
  type Drag = { kind: 'pan'; p: { x: number; y: number }; cx: number; cy: number; moved: boolean } | { kind: 'node'; i: number; id: string; moved: boolean } | { kind: 'mini' };
  const drag = useRef<Drag | null>(null);
  const toWorld = (p: { x: number; y: number }) => ({ x: (p.x - cam.current.x) / cam.current.k, y: (p.y - cam.current.y) / cam.current.k });
  const onDown = (ev: React.PointerEvent) => {
    try { (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); } catch { /* a pointer that is already gone: nothing to capture */ }
    const p = pointer(ev);
    if (inMini(p)) { drag.current = { kind: 'mini' }; jump(p); return; }
    const n = hit(p);
    drag.current = n && !quiet ? { kind: 'node', i: index.get(n.id) as number, id: n.id, moved: false } : { kind: 'pan', p, cx: cam.current.x, cy: cam.current.y, moved: false };
  };
  const onMove = (ev: React.PointerEvent) => {
    const p = pointer(ev), d = drag.current, sm = sim.current;
    if (d?.kind === 'mini') { jump(p); return; }
    if (d?.kind === 'node' && sm) {
      d.moved = true; sm.pinned[d.i] = 1;
      const w = toWorld(p); sm.x[d.i] = w.x; sm.y[d.i] = w.y;
      if (live.current.mode === 'free') heat.current = Math.max(heat.current, 0.3);
      camTo.current = null; kick();
      return;
    }
    if (d?.kind === 'pan') {
      const dx = p.x - d.p.x, dy = p.y - d.p.y;
      if (Math.hypot(dx, dy) > 4) d.moved = true;
      if (d.moved) { touched.current = true; cam.current = { ...cam.current, x: d.cx + dx, y: d.cy + dy }; camTo.current = null; kick(); }
      return;
    }
    const n = hit(p);
    if (n?.id !== hover) setHover(n?.id ?? null);
  };
  const onUp = (ev: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.kind === 'mini') return;
    if (d.kind === 'node') {
      if (sim.current) sim.current.pinned[d.i] = 0;
      if (!d.moved) setSel(d.id === sel ? null : d.id);
      return;
    }
    if (!d.moved) { const n = hit(pointer(ev)); setSel(n ? (n.id === sel ? null : n.id) : null); }
  };
  const zoom = (f: number, at?: { x: number; y: number }) => {
    const { k, x, y } = cam.current, p = at ?? { x: size.current.w / 2, y: size.current.h / 2 };
    const nk = Math.max(0.2, Math.min(5, k * f));
    cam.current = { k: nk, x: p.x - ((p.x - x) / k) * nk, y: p.y - ((p.y - y) / k) * nk }; camTo.current = null; touched.current = true;
    kick();
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
    ev.preventDefault(); kick();
  };
  const rerun = () => { if (quiet || !sim.current) return; heat.current = HEAT_START * 0.7; born.current = performance.now(); fit(); kick(); };

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

  // ---------- guided tour: four steps that also move the map, so a person sees what the words say
  const steps: TourStep[] = starts.length ? ['overview', 'select', 'ask', 'try'] : ['overview', 'try'];
  const pick = (id: string) => { if (!shownIds.has(id)) { setKinds(new Set(ALL_KINDS)); setSlug('all'); } setSel(id); };
  const goTo = (i: number | null) => {
    if (i === null || i >= steps.length) { setTour(null); return; }
    const step = steps[i];
    if (step === 'overview') { setSel(null); setKinds(new Set(ALL_KINDS)); setSlug('all'); }
    else if ((step === 'select' || step === 'ask') && starts.length && !sel) pick(starts[0].node.id);
    setTour(Math.max(0, i));
  };
  const orgCount = counts.ontology ?? 0, termCount = (counts.class ?? 0) + (counts.metric ?? 0);
  const userCount = CONSUMER_MAP_KINDS.reduce((a, k) => a + (counts[k] ?? 0), 0);
  const summary = focus ? describeFocus(map, focus, depth) : '';
  const tourText = (step: TourStep): { title: string; text: string } => {
    if (step === 'overview') return {
      title: 'What you are looking at',
      text: `${orgCount} ${orgCount === 1 ? 'vocabulary' : 'vocabularies'} (${mode === 'sorted' ? `one box each; inside, the columns run left to right: ${LANES.map((l) => l.label).join(' → ')}` : 'the coloured areas'}), ${termCount} terms and ${userCount} agents, skills, reports or spaces that rely on them. A line with an arrow means "is built on": if the term at the arrow's tip changes, the term at the other end is affected. The key in the corner explains each shape.`,
    };
    if (step === 'select') return {
      title: selNode ? `You picked "${selNode.label}"` : 'Click a dot',
      text: focus ? `${summary} Red dots and red lines are that chain; the small lights run the way a change travels.` : 'Click any dot to see what depends on it. Everything not affected fades out.',
    };
    if (step === 'ask') return {
      title: 'Who needs to know',
      text: `The panel on the right names the agents, skills and reports that use it${impact && impact.ask.length ? ` and the owners to ask first: ${impact.ask.join(', ')}` : ''}. "Open in the catalog" shows the full definition and lets you plan the change.`,
    };
    return {
      title: 'Now you try',
      text: 'Click another dot, or search for a term above. Drag a dot to move it, drag the background to pan, scroll to zoom. "Depth" sets how many steps the red chain follows. Esc clears the selection. The Guide button brings this back.',
    };
  };

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
        {tour === null && <button className="om-filter" onClick={() => goTo(0)} aria-label="Show the guide to this map">? Guide</button>}
        <label className="om-map-depth">Depth
          <select className="om-select" value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="How many steps to follow">
            {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      </div>

      {tour !== null && (() => {
        const i = Math.min(tour, steps.length - 1), t = tourText(steps[i]);
        return (
          <div className="om-tour" role="region" aria-label="Guide to the map" aria-live="polite">
            <span className="om-tour-step">Step {i + 1} of {steps.length}</span>
            <p className="om-tour-body"><b>{t.title}.</b> {t.text}</p>
            <div className="om-tour-actions">
              {i > 0 && <button className="om-filter" onClick={() => goTo(i - 1)}>Back</button>}
              <button className="om-filter om-filter-on" onClick={() => goTo(i + 1)}>{i + 1 >= steps.length ? 'Done' : 'Next'}</button>
              {i + 1 < steps.length && <button className="om-tour-skip" onClick={() => goTo(null)}>Skip</button>}
            </div>
          </div>
        );
      })()}

      <div className="om-map-stage">
        <div className="om-map-canvas" ref={wrap}>
          <canvas ref={cv} tabIndex={0} role="application" onKeyDown={onKey} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
            onPointerLeave={() => { if (!drag.current) setHover(null); }}
            style={{ cursor: hover ? 'pointer' : drag.current ? 'grabbing' : 'grab' }}
            aria-label="Interactive map of the ontology catalog. Use the search box or the list beside it to pick a node. Plus and minus zoom, arrow keys move, 0 fits, Escape clears. You can drag a node to move it." />
          <div className="om-map-zoom">
            <span className="om-map-mode" role="group" aria-label="Arrangement">
              <button className={`om-filter ${mode === 'sorted' ? 'om-filter-on' : ''}`} aria-pressed={mode === 'sorted'} onClick={() => setMode('sorted')} title="One panel per ontology, left to right: data, terms, metrics, users">Sorted</button>
              <button className={`om-filter ${mode === 'free' ? 'om-filter-on' : ''}`} aria-pressed={mode === 'free'} onClick={() => setMode('free')} title="The map arranges itself by how things are linked">Free</button>
            </span>
            <button className="om-filter" onClick={() => zoom(1.3)} aria-label="Zoom in">+</button>
            <button className="om-filter" onClick={() => zoom(0.77)} aria-label="Zoom out">−</button>
            <button className="om-filter" onClick={fit} aria-label="Fit the map">Fit</button>
            {!quiet && mode === 'free' && <button className="om-filter" onClick={rerun} aria-label="Let the map settle again">Replay</button>}
          </div>
          <p className="om-map-hint">{hover
            ? `${map.nodes.find((n) => n.id === hover)?.label ?? ''} · ${MAP_KIND_LABEL[map.nodes.find((n) => n.id === hover)?.kind ?? 'class']}${hover === sel ? ' (selected)' : ' · click to see what depends on it'}`
            : selNode ? `Red = affected if "${selNode.label}" changes. Click it again or press Esc to go back.` : 'Click a dot to see what depends on it. Drag the background to pan, scroll to zoom.'}</p>
        </div>

        <aside className="om-map-side" aria-live="polite">
          {!selNode && (
            <>
              <h3>Start here</h3>
              <p className="om-note-small">Click any dot on the map, or try one of these. Each shows what would be affected if that term changed.</p>
              {starts.length > 0 && (
                <ul className="om-map-starts">
                  {starts.map((sp) => (
                    <li key={sp.node.id}>
                      <button onClick={() => pick(sp.node.id)}>
                        <b>{sp.node.label}</b>
                        <span className="om-dim">{ontologies.find((o) => o.slug === sp.node.slug)?.title ?? sp.node.slug} · {sp.affected} affected{sp.users ? `, ${sp.users} in use` : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <details className="om-map-keybox" open={!selNode}>
                <summary>Key to the map</summary>
              <ul>
                {mode === 'sorted' && <li className="om-key-lanes"><b>Boxes</b> are ontologies. <b>Columns</b>, left to right: {LANES.map((l) => l.label).join(' → ')}</li>}
                <li><Glyph kind="ontology" /> Ontology <span className="om-dim">a vocabulary</span></li>
                <li><Glyph kind="class" /> Class <span className="om-dim">a thing, e.g. Customer</span></li>
                <li><Glyph kind="metric" /> Metric <span className="om-dim">a certified number</span></li>
                <li><Glyph kind="resource" /> Resource <span className="om-dim">dataset, check, code</span></li>
                <li><Glyph kind="agent" /> User <span className="om-dim">agent, skill, report, space</span></li>
                <li><i className="om-key-red" /> Red <span className="om-dim">affected by a change</span></li>
                <li><i className="om-key-dash" /> Dashed <span className="om-dim">draft, deprecated or only suspected</span></li>
                <li><i className="om-key-arrow" /> Arrow <span className="om-dim">"is built on"</span></li>
              </ul>
              </details>
              <p className="om-note-small">{map.nodes.length} nodes, {map.edges.filter((e) => !e.weak).length} links{CONSUMER_MAP_KINDS.some((k) => counts[k]) ? '' : '. No user is declared or confirmed yet: add them in the tab Use or find them in the catalog.'}{suspected.length ? ` ${suspected.length} suspected (dashed).` : ''}</p>
            </>
          )}
          {selNode && (
            <>
              <p className="om-crumb">{MAP_KIND_LABEL[selNode.kind]}{selNode.type ? ` · ${selNode.type}` : ''} · {selOnt?.title ?? selNode.slug}</p>
              <h3>{selNode.label}</h3>
              {summary && <p className="om-map-sum">{summary}</p>}
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
