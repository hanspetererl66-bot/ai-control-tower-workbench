/**
 * Map of the ontology catalog: terms, the resources they are derived from, the agents/skills/reports that declare they
 * use a term, and the ontology each belongs to, as one graph. Pure functions only: building the graph, a small
 * deterministic force layout, and the "what hangs on this" focus (same rule as `impactOf`). The canvas lives in
 * `ui/OntologyMap.tsx`.
 */
import { impactOf, type Governance, type Ontology } from './ontology-manager.ts';

export type MapKind = 'ontology' | 'class' | 'metric' | 'resource' | 'agent' | 'skill' | 'report';

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
}

export interface MapEdge {
  from: string;
  to: string;
  /** Property name (derivedFrom, dependsOn ...), `uses` for a declared consumer, `contains` for the ontology hub. */
  prop: string;
  /** Hub links are drawn faint and do not carry impact. */
  weak: boolean;
}

export interface GraphMap { nodes: MapNode[]; edges: MapEdge[] }

export const MAP_KIND_LABEL: Record<MapKind, string> = {
  ontology: 'Ontology', class: 'Class', metric: 'Metric', resource: 'Resource', agent: 'Agent', skill: 'Skill', report: 'Report',
};

const catalogId = (slug: string, id: string) => `${slug}:${id}`;
const consumerId = (slug: string, kind: string, name: string) => `${slug}:${kind}:${name.toLowerCase()}`;

export function buildMap(ontologies: Ontology[], gov: Governance): GraphMap {
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
  const ringR = slugs.length > 3 ? 120 + slugs.length * 62 : 220;
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
        if (d2 > 90000) continue;
        const d = Math.sqrt(d2), f = (2200 / d2) * alpha;
        dx /= d; dy /= d;
        vx[i] += dx * f; vy[i] += dy * f; vx[j] -= dx * f; vy[j] -= dy * f;
      }
    }
    for (const l of links) {
      const dx = x[l.b] - x[l.a], dy = y[l.b] - y[l.a], d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const len = l.weak ? 120 : 70, k = l.weak ? 0.012 : 0.05, f = (d - len) * k * alpha;
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
