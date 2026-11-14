/**
 * Map of the ontology catalog: terms, the resources they are derived from, the agents/skills/reports that declare they
 * use a term, and the ontology each belongs to, as one graph. Pure functions only: building the graph, a small
 * deterministic force layout, and the "what hangs on this" focus (same rule as `impactOf`). The canvas lives in
 * `ui/OntologyMap.tsx`.
 */
import { impactOf, type Governance, type Ontology } from './ontology-manager.ts';

export type MapKind = 'ontology' | 'class' | 'metric' | 'resource' | 'agent' | 'skill' | 'report' | 'workflow' | 'feature' | 'space';
/** The kinds of things that use a term (everything the Use tab and the found users can name). */
export const CONSUMER_MAP_KINDS: MapKind[] = ['agent', 'skill', 'report', 'workflow', 'feature', 'space'];

export interface MapNode {
  /** `<slug>:<id>` for catalog items, `<slug>:<kind>:<name>` for consumers, `ontology:<slug>` for the hub. */
  id: string;
  label: string;
  kind: MapKind;
  slug: string;
  /** Term or resource id inside its ontology (empty for consumers and hubs). */
  local: string;
  /** Resource type (Dataset, Metric, Company Code, ...) or empty. */
  type: string;
  owner: string;
  note: string;
  /** Number of links, filled in by `buildMap`. */
  degree: number;
  /** A found user nobody has confirmed yet (drawn dashed). */
  uncertain?: boolean;
}

export interface MapEdge {
  from: string;
  to: string;
  /** Property name (derivedFrom, dependsOn ...), `uses` for a declared consumer, `contains` for the ontology hub. */
  prop: string;
  /** Hub links are drawn faint and do not carry impact. */
  weak: boolean;
  /** The user at the end is only suspected (drawn dashed). */
  uncertain?: boolean;
}

export interface GraphMap { nodes: MapNode[]; edges: MapEdge[] }

export const MAP_KIND_LABEL: Record<MapKind, string> = {
  ontology: 'Ontology', class: 'Class', metric: 'Metric', resource: 'Resource', agent: 'Agent', skill: 'Skill', report: 'Report', workflow: 'Workflow', feature: 'Feature', space: 'Space',
};

const catalogId = (slug: string, id: string) => `${slug}:${id}`;
const consumerId = (slug: string, kind: string, name: string) => `${slug}:${kind}:${name.toLowerCase()}`;

/** A found user that nobody has confirmed: it joins the map dashed. */
export interface SuspectedUser { slug: string; term: string; kind: string; name: string }

const isConsumerKind = (k: string): k is MapKind => (CONSUMER_MAP_KINDS as string[]).includes(k);

export function buildMap(ontologies: Ontology[], gov: Governance, suspected: readonly SuspectedUser[] = []): GraphMap {
  const nodes = new Map<string, MapNode>();
  const edges: MapEdge[] = [];
  const add = (n: Omit<MapNode, 'degree'>) => { if (!nodes.has(n.id)) nodes.set(n.id, { ...n, degree: 0 }); };
  const link = (from: string, to: string, prop: string, weak: boolean) => {
    if (from === to || !nodes.has(from) || !nodes.has(to)) return;
    if (edges.some((e) => e.from === from && e.to === to && e.prop === prop)) return;
    edges.push({ from, to, prop, weak });
  };

  for (const o of ontologies) {
    const hub = `ontology:${o.slug}`;
    add({ id: hub, label: o.title, kind: 'ontology', slug: o.slug, local: '', type: '', owner: o.owner, note: o.domain });
    for (const t of o.terms) {
      add({ id: catalogId(o.slug, t.id), label: t.label, kind: t.kind === 'metric' ? 'metric' : 'class', slug: o.slug, local: t.id, type: '', owner: t.owner, note: t.definition });
    }
    for (const r of o.nodes) {
      const id = catalogId(o.slug, r.id);
      if (nodes.has(id)) continue; // a metric that is both a term and a resource stays one node
      add({ id, label: r.label, kind: 'resource', slug: o.slug, local: r.id, type: r.type, owner: '', note: r.note });
    }
    for (const t of o.terms) link(hub, catalogId(o.slug, t.id), 'contains', true);
    for (const r of o.nodes) if (!o.terms.some((t) => t.id === r.id)) link(hub, catalogId(o.slug, r.id), 'contains', true);
    for (const e of o.edges) link(catalogId(o.slug, e.from), catalogId(o.slug, e.to), e.prop, false);
  }

  for (const b of gov.bindings) {
    const term = catalogId(b.slug, b.term);
    if (!nodes.has(term)) continue;
    const id = consumerId(b.slug, b.kind, b.name);
    add({ id, label: b.name, kind: b.kind, slug: b.slug, local: '', type: '', owner: '', note: '' });
    link(id, term, 'uses', false);
  }
  // Users a person confirmed (stored decisions; the key is `<slug>|<term>|<kind>:<ref>`, the name was kept with the decision).
  for (const [key, d] of Object.entries(gov.usageDecisions ?? {})) {
    if (d.decision !== 'confirmed') continue;
    const [slug, termId, rest = ''] = key.split('|');
    const kind = rest.split(':')[0];
    const term = catalogId(slug, termId);
    if (!nodes.has(term) || !isConsumerKind(kind)) continue;
    const name = d.name || rest.slice(kind.length + 1);
    const id = consumerId(slug, kind, name);
    add({ id, label: name, kind, slug, local: '', type: '', owner: '', note: '' });
    link(id, term, 'uses', false);
  }
  // Users that were only found: dashed, so nobody mistakes them for confirmed ones. The focus still reaches them (they might break).
  for (const u of suspected) {
    const term = catalogId(u.slug, u.term);
    if (!nodes.has(term) || !isConsumerKind(u.kind)) continue;
    const id = consumerId(u.slug, u.kind, u.name);
    if (nodes.has(id)) continue; // already declared or confirmed
    add({ id, label: u.name, kind: u.kind, slug: u.slug, local: '', type: '', owner: '', note: '', uncertain: true });
    link(id, term, 'uses', false);
    const e = edges.find((x) => x.from === id && x.to === term); if (e) e.uncertain = true;
  }

  const list = [...nodes.values()];
  const byId = new Map(list.map((n) => [n.id, n]));
  for (const e of edges) { byId.get(e.from)!.degree++; byId.get(e.to)!.degree++; }
  return { nodes: list, edges };
}

// ---------------------------------------------------------------- layout
export interface Positions { x: Float64Array; y: Float64Array }

/** Small seeded generator so the same catalog always lands in the same place. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** A force simulation that can run step by step (the screen animates it) or all at once (`layoutMap`). */
export interface Simulation {
  x: Float64Array; y: Float64Array; vx: Float64Array; vy: Float64Array;
  /** Nodes held in place (being dragged); everything else keeps moving around them. */
  pinned: Uint8Array;
  tick(alpha: number): void;
}

/** Repulsion between all nodes, springs on links (weak hub links are long and soft), ontologies on a ring. */
export function createSimulation(map: GraphMap, seed = 7): Simulation {
  const n = map.nodes.length;
  const x = new Float64Array(n), y = new Float64Array(n);
  const vx = new Float64Array(n), vy = new Float64Array(n);
  const pinned = new Uint8Array(n);
  const index = new Map(map.nodes.map((m, i) => [m.id, i]));
  const slugs = [...new Set(map.nodes.map((m) => m.slug))];
  const rand = rng(seed);
  // two or three ontologies sit close together; many need room, or their areas run into each other
  const ringR = slugs.length > 3 ? 150 + slugs.length * 70 : 260;
  const anchor = map.nodes.map((m) => {
    const k = Math.max(0, slugs.indexOf(m.slug));
    const a = (k / Math.max(1, slugs.length)) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a) * (slugs.length > 1 ? ringR : 0), y: Math.sin(a) * (slugs.length > 1 ? ringR : 0) };
  });
  map.nodes.forEach((_, i) => {
    const a = rand() * Math.PI * 2, r = 30 + rand() * 90;
    x[i] = anchor[i].x + Math.cos(a) * r; y[i] = anchor[i].y + Math.sin(a) * r;
  });
  const links = map.edges.map((e) => ({ a: index.get(e.from)!, b: index.get(e.to)!, weak: e.weak }));
  const tick = (alpha: number) => {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[i] - x[j], dy = y[i] - y[j];
        const d2 = dx * dx + dy * dy + 0.5;
        if (d2 > 160000) continue;
        const d = Math.sqrt(d2), f = (3600 / d2) * alpha;
        dx /= d; dy /= d;
        vx[i] += dx * f; vy[i] += dy * f; vx[j] -= dx * f; vy[j] -= dy * f;
      }
    }
    for (const l of links) {
      const dx = x[l.b] - x[l.a], dy = y[l.b] - y[l.a], d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const len = l.weak ? 150 : 92, k = l.weak ? 0.012 : 0.05, f = (d - len) * k * alpha;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      vx[l.a] += fx; vy[l.a] += fy; vx[l.b] -= fx; vy[l.b] -= fy;
    }
    for (let i = 0; i < n; i++) {
      if (pinned[i]) { vx[i] = 0; vy[i] = 0; continue; }
      vx[i] += (anchor[i].x - x[i]) * 0.004 * alpha; vy[i] += (anchor[i].y - y[i]) * 0.004 * alpha;
      vx[i] *= 0.78; vy[i] *= 0.78; x[i] += vx[i]; y[i] += vy[i];
    }
  };
  return { x, y, vx, vy, pinned, tick };
}

/** Force layout, run to the end at once. The same catalog always lands in the same place. */
export function layoutMap(map: GraphMap, iterations = 320, seed = 7): Positions {
  const sim = createSimulation(map, seed);
  for (let step = 0; step < iterations; step++) sim.tick(Math.max(0.02, 1 - step / iterations));
  return { x: sim.x, y: sim.y };
}

// ---------------------------------------------------------------- focus
export interface MapFocus {
  /** The selected node. */
  root: string;
  /** Hop distance from the root for everything that depends on it (the root is 0). */
  level: Map<string, number>;
  /** Links that carry the impact. */
  edges: Set<MapEdge>;
}

/**
 * What hangs on a node: follow links backwards (who is derived from it, depends on it or uses it), up to `depth` hops,
 * hub links excluded. This is the rule of `impactOf`; consumers are one hop beyond the term they declare.
 */
export function focusOf(map: GraphMap, root: string, depth = 3): MapFocus {
  const level = new Map<string, number>([[root, 0]]);
  const used = new Set<MapEdge>();
  const queue: string[] = [root];
  while (queue.length) {
    const cur = queue.shift() as string;
    const d = level.get(cur) as number;
    if (d >= depth) continue;
    for (const e of map.edges) {
      if (e.weak || e.to !== cur) continue;
      used.add(e);
      if (!level.has(e.from)) { level.set(e.from, d + 1); queue.push(e.from); }
    }
  }
  return { root, level, edges: used };
}

/** The same dependents `impactOf` reports for a term, as catalog ids, for checking the map against the table. */
export function impactIds(o: Ontology, term: string, depth = 3): string[] {
  return impactOf(o, term, depth).usedBy.map((d) => catalogId(o.slug, d.node.id));
}

export function visibleMap(map: GraphMap, kinds: Set<MapKind>, slug: string): GraphMap {
  const keep = new Set(map.nodes.filter((n) => kinds.has(n.kind) && (slug === 'all' || n.slug === slug)).map((n) => n.id));
  return { nodes: map.nodes.filter((n) => keep.has(n.id)), edges: map.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
}

export function searchMap(map: GraphMap, query: string, limit = 8): MapNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return map.nodes
    .filter((n) => n.label.toLowerCase().includes(q) || n.local.toLowerCase().includes(q))
    .sort((a, b) => Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)) || b.degree - a.degree || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// ---------------------------------------------------------------- guidance: where to start, and what a selection means in words
export interface StartPoint {
  node: MapNode;
  /** How many other things hang on it (within `depth` steps). */
  affected: number;
  /** How many of those are agents, skills, reports, workflows, features or spaces. */
  users: number;
}

const isTermKind = (k: MapKind) => k === 'class' || k === 'metric' || k === 'resource';

/**
 * The best places to click first: terms (not hubs or users) with the most things hanging on them, users counting double, so the
 * first selection always shows something. At most one per ontology until every ontology has had its turn, then the rest by size.
 */
export function startingPoints(map: GraphMap, limit = 4, depth = 3): StartPoint[] {
  const scored = map.nodes.filter((n) => isTermKind(n.kind)).map((node) => {
    const f = focusOf(map, node.id, depth);
    let users = 0;
    for (const id of f.level.keys()) { const k = map.nodes.find((n) => n.id === id)?.kind; if (k && CONSUMER_MAP_KINDS.includes(k)) users++; }
    return { node, affected: f.level.size - 1, users };
  }).filter((s) => s.affected > 0)
    .sort((a, b) => (b.affected + b.users) - (a.affected + a.users) || a.node.label.localeCompare(b.node.label));
  const out: StartPoint[] = [], seen = new Set<string>();
  for (const s of scored) if (!seen.has(s.node.slug) && out.length < limit) { out.push(s); seen.add(s.node.slug); }
  for (const s of scored) if (out.length < limit && !out.includes(s)) out.push(s);
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "6 things would be affected: 2 metrics, 1 report and 3 agents." for a focus; says plainly when nothing depends on it. */
export function describeFocus(map: GraphMap, focus: MapFocus, depth = 3): string {
  const root = map.nodes.find((n) => n.id === focus.root);
  if (!root) return '';
  const counts = new Map<MapKind, number>();
  for (const id of focus.level.keys()) {
    if (id === focus.root) continue;
    const k = map.nodes.find((n) => n.id === id)?.kind;
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return `Nothing depends on ${root.label} (within ${plural(depth, 'step')}). Changing it would not break anything that is on the map.`;
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => plural(n, MAP_KIND_LABEL[k].toLowerCase(), k === 'class' ? 'classes' : undefined));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `If ${root.label} changes, ${plural(total, 'other thing')} would be affected: ${list}.`;
}

/** The short name of a link the way a person reads it ("derived from"), shown on the map when a node is hovered. */
export const LINK_WORDS: Record<string, string> = {
  derivedFrom: 'derived from', dependsOn: 'depends on', measuredBy: 'measured by', appliesTo: 'applies to', uses: 'uses', partOf: 'part of', references: 'refers to', contains: 'contains',
};
export const linkWord = (prop: string): string => LINK_WORDS[prop] ?? prop;

// ---------------------------------------------------------------- sorted layout: one panel per ontology, lanes left to right
/** The lanes of a panel, in reading order: what feeds in, the terms, the numbers, and who uses them. */
export const LANES: Array<{ id: string; label: string; hint: string; kinds: MapKind[] }> = [
  { id: 'source', label: 'Data and checks', hint: 'where the numbers come from', kinds: ['resource'] },
  { id: 'term', label: 'Terms', hint: 'the things the business talks about', kinds: ['class'] },
  { id: 'metric', label: 'Metrics', hint: 'certified numbers', kinds: ['metric'] },
  { id: 'user', label: 'Used by', hint: 'agents, skills, reports, spaces', kinds: CONSUMER_MAP_KINDS },
];
const laneOf = (k: MapKind): number => LANES.findIndex((l) => l.kinds.includes(k));

export interface LanePanel {
  slug: string; title: string;
  x: number; y: number; w: number; h: number;
  /** Left edge and width of each lane (absolute), with its label; empty lanes are left out. */
  lanes: Array<{ id: string; label: string; hint: string; x: number; w: number }>;
}
export interface LaneLayout extends Positions { panels: LanePanel[] }

const ROW = 28, LANE_W = 176, SUB_ROWS = 14, PAD = 18, HEAD = 62, GAP = 46;

/**
 * Every ontology gets its own panel; inside it the nodes stand in lanes from left to right (data and checks, terms, metrics, users),
 * the best connected on top. Links then mostly run left to right, so it is easy to see what feeds what and who relies on it.
 * Panels sit in a grid whose width suits the window. Deterministic and free of overlaps.
 */
export function layoutLanes(map: GraphMap): LaneLayout {
  const slugs = [...new Set(map.nodes.map((n) => n.slug))];
  const x = new Float64Array(map.nodes.length), y = new Float64Array(map.nodes.length);
  const index = new Map(map.nodes.map((n, i) => [n.id, i]));
  type Built = { slug: string; title: string; w: number; h: number; lanes: Array<{ id: string; label: string; hint: string; dx: number; w: number; members: MapNode[]; cols: number }>; hub: MapNode | undefined };
  const built: Built[] = slugs.map((slug) => {
    const own = map.nodes.filter((n) => n.slug === slug);
    const hub = own.find((n) => n.kind === 'ontology');
    const lanes: Built['lanes'] = [];
    let dx = PAD;
    LANES.forEach((lane) => {
      const members = own.filter((n) => n.kind !== 'ontology' && laneOf(n.kind) === LANES.indexOf(lane))
        .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
      if (!members.length) return;
      const cols = Math.ceil(members.length / SUB_ROWS), w = cols * LANE_W;
      lanes.push({ id: lane.id, label: lane.label, hint: lane.hint, dx, w, members, cols });
      dx += w;
    });
    const w = Math.max(dx + PAD, 2 * LANE_W), rows = Math.max(1, ...lanes.map((l) => Math.min(SUB_ROWS, l.members.length)));
    return { slug, title: hub?.label ?? slug, w, h: HEAD + rows * ROW + PAD, lanes, hub };
  });

  const place = (cols: number) => {
    const colW: number[] = Array(cols).fill(0);
    built.forEach((bp, i) => { colW[i % cols] = Math.max(colW[i % cols], bp.w); });
    const colX = colW.map((_, c) => colW.slice(0, c).reduce((acc, w) => acc + w + GAP, 0));
    const out: Array<{ b: Built; px: number; py: number }> = [];
    let top = 0;
    for (let r = 0; r * cols < built.length; r++) {
      const row = built.slice(r * cols, r * cols + cols), rowH = Math.max(...row.map((bp) => bp.h));
      row.forEach((bp, c) => out.push({ b: bp, px: colX[c], py: top }));
      top += rowH + GAP;
    }
    const width = colW.reduce((acc, w) => acc + w, 0) + GAP * (cols - 1), height = top - GAP;
    return { out, width, height };
  };
  // as many panels side by side as make the best use of a window about twice as wide as high
  let best = place(1), bestScale = 0;
  for (let c = 1; c <= Math.min(6, Math.max(1, built.length)); c++) {
    const cand = place(c), scale = Math.min(2100 / cand.width, 1000 / cand.height);
    if (scale > bestScale + 1e-9) { best = cand; bestScale = scale; }
  }
  const panels: LanePanel[] = [];
  for (const { b, px, py } of best.out) {
    panels.push({ slug: b.slug, title: b.title, x: px, y: py, w: b.w, h: b.h, lanes: b.lanes.map((l) => ({ id: l.id, label: l.label, hint: l.hint, x: px + l.dx, w: l.w })) });
    if (b.hub) { const i = index.get(b.hub.id) as number; x[i] = px + PAD + 10; y[i] = py + 24; }
    for (const l of b.lanes) l.members.forEach((n, k) => {
      const i = index.get(n.id) as number, col = Math.floor(k / SUB_ROWS);
      x[i] = px + l.dx + col * LANE_W + 12; y[i] = py + HEAD + (k % SUB_ROWS) * ROW + ROW / 2;
    });
  }
  const top = best.height + GAP;
  // centre the whole thing on the origin, as the force layout is
  const x0 = Math.min(...panels.map((p) => p.x)), x1 = Math.max(...panels.map((p) => p.x + p.w)), y0 = 0, y1 = top - GAP;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (let i = 0; i < x.length; i++) { x[i] -= cx; y[i] -= cy; }
  for (const p of panels) { p.x -= cx; p.y -= cy; for (const l of p.lanes) l.x -= cx; }
  return { x, y, panels };
}

/** Which lane a kind of node stands in (index into `LANES`), or -1 for the ontology hub. */
export const laneIndexOf = (kind: MapKind): number => laneOf(kind);
