/**
 * Ontology Manager, catalog view: pure logic.
 *
 * The data model mirrors what the Ontology Manager connector knows: ontologies with terms (classes and certified
 * metrics), the links between resources (derivedFrom, dependsOn, measuredBy, appliesTo) and the owner of a term.
 * Until the view is connected to the connector's catalog, it shows the bundled Finance Pre-Close sample
 * (`connectors/ontology-manager/server/data`) as example data and says so.
 *
 * `impactOf` follows the same rule as the connector tool `impact_of_term`: everything that points at a term, hop by hop,
 * each resource once, plus the owners to ask. It only knows what is modelled.
 */

export type TermKind = 'metric' | 'class';
export type Health = 'complete' | 'missing';
export type TermFilter = 'all' | 'metrics' | 'classes' | 'attention';

export interface Term {
  id: string;
  label: string;
  kind: TermKind;
  /** Definition text; empty when the ontology has none. */
  definition: string;
  formula: string;
  /** Who certified or owns the term; empty when nobody does. */
  owner: string;
  /** Classes only: names of instances or subclasses, for the "used by" column. */
  members: string[];
  membersKind: 'instances' | 'subclasses' | 'none';
}

export interface Node {
  id: string;
  label: string;
  type: string;
  note: string;
}

export interface Edge {
  from: string;
  prop: string;
  to: string;
}

export interface Ontology {
  slug: string;
  title: string;
  status: 'published' | 'draft';
  /** Owner of the whole ontology; empty when not assigned. */
  owner: string;
  properties: number;
  openProposals: number;
  example: boolean;
  terms: Term[];
  /** Resources the links run between: metrics, datasets, checks, company codes. */
  nodes: Node[];
  edges: Edge[];
}

const PROP_LABEL: Record<string, string> = {
  derivedFrom: 'derived from', dependsOn: 'depends on', measuredBy: 'measured by', appliesTo: 'applies to',
};
export const propLabel = (p: string): string => PROP_LABEL[p] ?? p;

export const NOT_ASSIGNED = 'Not assigned';
export const ownerLabel = (t: { owner: string }): string => t.owner || NOT_ASSIGNED;

export function healthOf(t: Term): Health {
  if (!t.definition.trim()) return 'missing';
  if (t.kind === 'metric' && !t.owner.trim()) return 'missing';
  return 'complete';
}
export const HEALTH_LABEL: Record<Health, string> = { complete: 'Complete', missing: 'Definition missing' };

/** What the "used by" column says for a term. */
export function usedLabel(o: Ontology, t: Term): string {
  if (t.kind === 'metric') {
    const n = incoming(o, t.id).length;
    return n === 0 ? 'no links' : n === 1 ? '1 link' : `${n} links`;
  }
  const n = t.members.length;
  if (n === 0) return 'no links';
  const noun = t.membersKind === 'subclasses' ? (n === 1 ? 'subclass' : 'subclasses') : (n === 1 ? 'instance' : 'instances');
  return `${n} ${noun}`;
}

export interface Kpis {
  classes: number;
  metrics: number;
  properties: number;
  definedClasses: number;
  coverage: number;
  needAttention: number;
  openProposals: number;
  total: number;
}

export function kpis(o: Ontology): Kpis {
  const classes = o.terms.filter((t) => t.kind === 'class');
  const metrics = o.terms.filter((t) => t.kind === 'metric');
  const defined = classes.filter((t) => t.definition.trim()).length;
  return {
    classes: classes.length,
    metrics: metrics.length,
    properties: o.properties,
    definedClasses: defined,
    coverage: classes.length ? defined / classes.length : 1,
    needAttention: o.terms.filter((t) => healthOf(t) === 'missing').length,
    openProposals: o.openProposals,
    total: o.terms.length,
  };
}

/** Filter by tab and search text. The search looks at name, id, definition and owner. */
export function filterTerms(o: Ontology, filter: TermFilter, query: string): Term[] {
  const q = query.trim().toLowerCase();
  return o.terms.filter((t) => {
    if (filter === 'metrics' && t.kind !== 'metric') return false;
    if (filter === 'classes' && t.kind !== 'class') return false;
    if (filter === 'attention' && healthOf(t) !== 'missing') return false;
    if (!q) return true;
    return [t.label, t.id, t.definition, t.owner].some((s) => s.toLowerCase().includes(q));
  });
}

const nodeOf = (o: Ontology, id: string): Node =>
  o.nodes.find((n) => n.id === id) ?? { id, label: o.terms.find((t) => t.id === id)?.label ?? id, type: 'Resource', note: '' };

/** Links that point at a resource. */
export function incoming(o: Ontology, id: string): Edge[] {
  return o.edges.filter((e) => e.to === id);
}

export interface Dependent {
  node: Node;
  hop: number;
  via: Array<{ prop: string; target: string }>;
  links: Array<{ prop: string; to: string }>;
}

export interface Impact {
  dependsOn: Array<{ node: Node; prop: string }>;
  usedBy: Dependent[];
  byType: Record<string, number>;
  ask: string[];
  depth: number;
  /** True when more than `limit` resources depend on the term; the list is cut. */
  truncated: boolean;
}

export const IMPACT_DEPTH = 3;
const IMPACT_LIMIT = 200;

/** Everything that depends on a term, hop by hop (each resource once), what it depends on, and whom to ask. */
export function impactOf(o: Ontology, id: string, depth = IMPACT_DEPTH): Impact {
  const seen = new Map<string, number>([[id, 0]]);
  const via = new Map<string, Array<{ prop: string; target: string }>>();
  const queue: Array<[string, number]> = [[id, 0]];
  while (queue.length) {
    const [cur, d] = queue.shift() as [string, number];
    if (d >= depth) continue;
    for (const e of incoming(o, cur)) {
      via.set(e.from, [...(via.get(e.from) ?? []), { prop: e.prop, target: cur }]);
      if (!seen.has(e.from)) { seen.set(e.from, d + 1); queue.push([e.from, d + 1]); }
    }
  }
  const all: Dependent[] = [...seen.entries()]
    .filter(([n]) => n !== id)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([n, hop]) => ({
      node: nodeOf(o, n), hop, via: via.get(n) ?? [],
      links: o.edges.filter((e) => e.from === n).map((e) => ({ prop: e.prop, to: nodeOf(o, e.to).label })),
    }));
  const usedBy = all.slice(0, IMPACT_LIMIT);
  const byType: Record<string, number> = {};
  for (const d of usedBy) byType[d.node.type] = (byType[d.node.type] ?? 0) + 1;
  const owners = new Set<string>();
  for (const nid of [id, ...usedBy.map((d) => d.node.id)]) {
    const t = o.terms.find((x) => x.id === nid);
    if (t?.owner) owners.add(t.owner);
  }
  return {
    dependsOn: o.edges.filter((e) => e.from === id).map((e) => ({ node: nodeOf(o, e.to), prop: e.prop })),
    usedBy, byType, ask: [...owners].sort(), depth, truncated: all.length > IMPACT_LIMIT,
  };
}

/** Company codes a change reaches: resources of type "Company Code" that dependents apply to. */
export function companyCodesIn(o: Ontology, impact: Impact): string[] {
  const codes = new Set<string>();
  for (const d of impact.usedBy) {
    for (const e of o.edges) if (e.from === d.node.id && nodeOf(o, e.to).type === 'Company Code') codes.add(nodeOf(o, e.to).label);
  }
  return [...codes].sort();
}

// ---------------------------------------------------------------- example data (bundled Finance Pre-Close sample)

const cls = (id: string, label: string, definition: string, members: string[] = [], membersKind: Term['membersKind'] = 'instances'): Term =>
  ({ id, label, kind: 'class', definition, formula: '', owner: '', members, membersKind: members.length ? membersKind : 'none' });
const metric = (id: string, label: string, definition: string, formula: string, owner: string): Term =>
  ({ id, label, kind: 'metric', definition, formula, owner, members: [], membersKind: 'none' });

/** The bundled sample: werkbank_fin (as in `server/data/werkbank_fin*.ttl`) and the draft built from the demo document. */
export function exampleOntologies(): Ontology[] {
  const fin: Ontology = {
    slug: 'werkbank_fin',
    title: 'Werkbank Finance Pre-Close',
    status: 'published',
    owner: '',
    properties: 13,
    openProposals: 1,
    example: true,
    terms: [
      metric('Margin', 'Margin', 'Contribution margin I as a percentage of net revenue, before overheads, in company code currency.',
        '(Net revenue - Cost of goods) / Net revenue', 'Group Controlling'),
      metric('DSO', 'Days Sales Outstanding', 'Average number of days until open customer receivables are paid.',
        'Open receivables / Net revenue * Days in period', 'Group Treasury'),
      metric('OpenPOExposure', 'Open PO exposure', 'Sum of purchase order items not yet delivered and not yet invoiced at the key date.',
        '', 'Group Procurement'),
      metric('MarginAfterAccruals', 'Margin after accruals', 'Margin adjusted for accruals on undelivered-not-invoiced goods in the pre-close.',
        '', 'Group Controlling'),
      cls('PreCloseCheck', 'Pre-Close Check', 'A step before period close, for example open items, accruals, reconciliation.',
        ['chk_dso', 'chk_margin', 'chk_po']),
      cls('CompanyCode', 'Company Code', 'Legal entity, for example DE10, FR10, UK10.', ['DE10', 'FR10', 'UK10']),
      cls('Dataset', 'Dataset', 'A table or view in the catalog werkbank_demo.', ['ds_invoices', 'ds_gl', 'ds_po']),
      cls('Metric', 'Metric', 'A certified business metric with one clear definition.', ['Margin', 'DSO', 'OpenPOExposure', 'MarginAfterAccruals']),
      cls('FinancialDocument', 'Financial Document', '', ['Invoice', 'Journal Entry'], 'subclasses'),
      cls('Invoice', 'Invoice', ''),
      cls('JournalEntry', 'Journal Entry', ''),
      cls('GLAccount', 'G/L Account', ''),
    ],
    nodes: [
      { id: 'ds_invoices', label: 'ds_invoices', type: 'Dataset', note: 'werkbank_demo.fin.invoices' },
      { id: 'ds_gl', label: 'ds_gl', type: 'Dataset', note: 'werkbank_demo.fin.gl_entries' },
      { id: 'ds_po', label: 'ds_po', type: 'Dataset', note: 'werkbank_demo.scm.purchase_orders' },
      { id: 'Margin', label: 'Margin', type: 'Metric', note: '' },
      { id: 'DSO', label: 'Days Sales Outstanding', type: 'Metric', note: '' },
      { id: 'OpenPOExposure', label: 'Open PO exposure', type: 'Metric', note: '' },
      { id: 'MarginAfterAccruals', label: 'Margin after accruals', type: 'Metric', note: '' },
      { id: 'chk_dso', label: 'DSO plausibility (chk_dso)', type: 'Pre-Close Check', note: '' },
      { id: 'chk_margin', label: 'Margin deviation (chk_margin)', type: 'Pre-Close Check', note: '' },
      { id: 'chk_po', label: 'Open purchase orders (chk_po)', type: 'Pre-Close Check', note: '' },
      { id: 'DE10', label: 'DE10', type: 'Company Code', note: '' },
      { id: 'FR10', label: 'FR10', type: 'Company Code', note: '' },
      { id: 'UK10', label: 'UK10', type: 'Company Code', note: '' },
    ],
    edges: [
      { from: 'Margin', prop: 'derivedFrom', to: 'ds_invoices' }, { from: 'Margin', prop: 'derivedFrom', to: 'ds_gl' },
      { from: 'DSO', prop: 'derivedFrom', to: 'ds_invoices' }, { from: 'OpenPOExposure', prop: 'derivedFrom', to: 'ds_po' },
      { from: 'MarginAfterAccruals', prop: 'dependsOn', to: 'Margin' },
      { from: 'chk_dso', prop: 'measuredBy', to: 'DSO' }, { from: 'chk_dso', prop: 'appliesTo', to: 'DE10' },
      { from: 'chk_dso', prop: 'appliesTo', to: 'FR10' }, { from: 'chk_dso', prop: 'appliesTo', to: 'UK10' },
      { from: 'chk_margin', prop: 'measuredBy', to: 'Margin' }, { from: 'chk_margin', prop: 'measuredBy', to: 'MarginAfterAccruals' },
      { from: 'chk_margin', prop: 'appliesTo', to: 'DE10' }, { from: 'chk_margin', prop: 'appliesTo', to: 'FR10' },
      { from: 'chk_po', prop: 'measuredBy', to: 'OpenPOExposure' }, { from: 'chk_po', prop: 'appliesTo', to: 'UK10' },
    ],
  };
  const proc: Ontology = {
    slug: 'procurement_docs',
    title: 'Procurement (from documents)',
    status: 'draft',
    owner: '',
    properties: 2,
    openProposals: 0,
    example: true,
    terms: [
      cls('Supplier', 'Supplier', 'A company that delivers goods or services.'),
      cls('PurchaseOrder', 'Purchase Order', 'An order placed with a supplier.'),
    ],
    nodes: [],
    edges: [],
  };
  return [fin, proc];
}
