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

import { extraExampleGovernance, extraExampleHistory, extraExampleOntologies } from './ontology-examples.ts';

export type TermKind = 'metric' | 'class';
export type Health = 'complete' | 'missing';
export type TermFilter = 'all' | 'metrics' | 'classes' | 'attention' | 'deprecated';

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
  /** Business domain, e.g. Finance; empty when not assigned. */
  domain: string;
  /** Who approves changes to it; empty when not assigned. */
  approver: string;
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

/** Filter by tab and search text. The search looks at name, id, definition and owner, and with `gov` also at synonyms and mapped names. */
export function filterTerms(o: Ontology, filter: TermFilter, query: string, gov?: Governance): Term[] {
  const q = query.trim().toLowerCase();
  return o.terms.filter((t) => {
    if (filter === 'metrics' && t.kind !== 'metric') return false;
    if (filter === 'classes' && t.kind !== 'class') return false;
    if (filter === 'attention' && healthOf(t) !== 'missing') return false;
    if (filter === 'deprecated' && !(gov && statusOf(o, gov, t) === 'deprecated')) return false;
    if (!q) return true;
    const meta = gov ? metaOf(gov, o.slug, t.id) : null;
    return [t.label, t.id, t.definition, t.owner, ...(meta ? [...meta.synonyms, ...meta.mappings.map((x) => `${x.system} ${x.ref}`)] : [])].some((x) => x.toLowerCase().includes(q));
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

// ---------------------------------------------------------------- where the data comes from

/** Where the shown ontologies come from. */
export type OntologySource =
  | { kind: 'loading' }
  | { kind: 'catalog'; folder: string; instances: 'bundled' | 'configured' | 'none'; warnings: string[] }
  | { kind: 'example'; reason: string };

/** What the desktop app answers when the view asks for the catalog (`electron/ontology-store.mjs`). */
export interface CatalogAnswer {
  ok: boolean;
  code?: string;
  detail?: string;
  ontologies?: Ontology[];
  warnings?: string[];
  folder?: string;
  instances?: 'bundled' | 'configured' | 'none';
  proposals?: Proposal[];
  history?: Record<string, VersionEntry[]>;
  governance?: Governance;
}

/** Everything the Ontology screens show. */
export interface OntologyData {
  ontologies: Ontology[];
  source: OntologySource;
  proposals: Proposal[];
  history: Record<string, VersionEntry[]>;
  governance: Governance;
}

/** The real catalog when the app could read it, otherwise the bundled example with the reason, never a silent mix. */
export function resolveCatalog(answer: CatalogAnswer | null | undefined): OntologyData {
  if (answer?.ok && Array.isArray(answer.ontologies)) {
    const governance = answer.governance ?? emptyGovernance();
    return {
      ontologies: applyGovernance(answer.ontologies, governance),
      source: { kind: 'catalog', folder: answer.folder ?? '', instances: answer.instances ?? 'none', warnings: answer.warnings ?? [] },
      proposals: answer.proposals ?? [], history: answer.history ?? {}, governance,
    };
  }
  const reason = answer
    ? (answer.detail || 'The catalog could not be read.')
    : 'The catalog can only be read in the desktop app.';
  const governance = mergeGovernance(exampleGovernance(), extraExampleGovernance());
  return {
    ontologies: applyGovernance([...exampleOntologies(), ...extraExampleOntologies()], governance), source: { kind: 'example', reason },
    proposals: exampleProposals(), history: { ...exampleHistory(), ...extraExampleHistory() }, governance,
  };
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
    owner: '', domain: '', approver: '',
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
    owner: '', domain: '', approver: '',
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


// ---------------------------------------------------------------- governance: owners, bindings, views, plans

export type ConsumerKind = 'agent' | 'skill' | 'report';
export const CONSUMER_KINDS: ConsumerKind[] = ['agent', 'skill', 'report'];

/** An agent, skill or report that declares it uses a term. Declared by a person; the app cannot see inside an agent. */
export interface Binding { slug: string; term: string; kind: ConsumerKind; name: string }
/** The ontologies an agent gets as its view (`compose` in the connector). */
export interface AgentView { name: string; slugs: string[] }
export type PlanStatus = 'draft' | 'asked' | 'approved' | 'rejected';
/** What the approver saw when the change was approved: kept with the plan as its record. */
export interface PlanApproval {
  by: string;
  at: string;
  /** The users at that moment (at most 50): name, kind, state (declared, confirmed or suspected) and owner. */
  users: Array<{ name: string; kind: string; state: string; owner: string }>;
  confirmed: number;
  suspected: number;
  dismissed: number;
  owners: string[];
  /** Competency questions that name the term (their text, at most 5). */
  questions: string[];
}
export interface Plan { id: string; slug: string; term: string; change: string; status: PlanStatus; createdAt: string; asked: string[]; approval?: PlanApproval }
export interface OntologyMeta { owner: string; domain: string; approver: string }
/** A person's decision about a found user of a term (key `<slug>|<term>|<kind>:<ref>`, see ontology-usage.ts). Found users are never stored, only these decisions. */
export interface UsageDecision { decision: 'confirmed' | 'dismissed'; by: string; at: string; /** Display name of the user at the time of the decision (the key only holds the registry id, skill directory or space slug). */ name?: string }
export interface Governance {
  version: number;
  ontologies: Record<string, OntologyMeta>;
  bindings: Binding[];
  views: AgentView[];
  plans: Plan[];
  /** Lifecycle, synonyms and mappings per term, keyed `<slug>|<term id>`. Lives in governance.json, not in the Turtle. */
  termMeta: Record<string, TermMeta>;
  /** Competency questions: what an ontology must be able to answer. */
  questions: Question[];
  /** What people decided about found users of terms (confirmed or dismissed). Additive: older files have none. */
  usageDecisions: Record<string, UsageDecision>;
}

export const emptyGovernance = (): Governance => ({ version: 1, ontologies: {}, bindings: [], views: [], plans: [], termMeta: {}, questions: [], usageDecisions: {} });

// ---------------------------------------------------------------- lifecycle, synonyms, mappings

export type TermStatus = 'draft' | 'approved' | 'deprecated';
export const TERM_STATUSES: TermStatus[] = ['draft', 'approved', 'deprecated'];
export const STATUS_LABEL: Record<TermStatus, string> = { draft: 'Draft', approved: 'Approved', deprecated: 'Deprecated' };
/** A name for the same thing in another system or standard, for example SAP S/4HANA "Business Partner". */
export interface Mapping { system: string; ref: string }
export interface TermMeta {
  /** Empty = not set: a term of a published ontology counts as approved, of a draft ontology as draft. */
  status: TermStatus | '';
  /** The term that took its place (deprecated terms only). */
  replacedBy: string;
  synonyms: string[];
  mappings: Mapping[];
}
export interface Question { id: string; slug: string; text: string; terms: string[] }

export const MAX_SYNONYMS = 20;
export const MAX_MAPPINGS = 10;
export const metaKey = (slug: string, id: string): string => `${slug}|${id}`;
const blankMeta = (): TermMeta => ({ status: '', replacedBy: '', synonyms: [], mappings: [] });

export function metaOf(gov: Governance, slug: string, id: string): TermMeta {
  return { ...blankMeta(), ...(gov.termMeta?.[metaKey(slug, id)] ?? {}) };
}
export function statusOf(o: Ontology, gov: Governance, t: Term): TermStatus {
  return metaOf(gov, o.slug, t.id).status || (o.status === 'published' ? 'approved' : 'draft');
}

const cleanList = (list: string[], max: number): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = String(raw).trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase()); out.push(v);
    if (out.length >= max) break;
  }
  return out;
};

/** Changes lifecycle, replacement, synonyms or mappings of one term. An empty result removes the entry. */
export function setTermMeta(gov: Governance, slug: string, id: string, patch: Partial<TermMeta>): Governance {
  const cur = metaOf(gov, slug, id);
  const next: TermMeta = {
    status: patch.status !== undefined ? patch.status : cur.status,
    replacedBy: patch.replacedBy !== undefined ? patch.replacedBy.trim().slice(0, 120) : cur.replacedBy,
    synonyms: cleanList(patch.synonyms ?? cur.synonyms, MAX_SYNONYMS),
    mappings: (patch.mappings ?? cur.mappings)
      .map((x) => ({ system: x.system.trim().slice(0, 60), ref: x.ref.trim().slice(0, 120) }))
      .filter((x) => x.system && x.ref).slice(0, MAX_MAPPINGS),
  };
  if (next.status !== 'deprecated') next.replacedBy = '';
  const termMeta = { ...gov.termMeta };
  const key = metaKey(slug, id);
  if (!next.status && !next.replacedBy && !next.synonyms.length && !next.mappings.length) delete termMeta[key]; else termMeta[key] = next;
  return { ...gov, termMeta };
}
export const addSynonym = (gov: Governance, slug: string, id: string, word: string): Governance =>
  setTermMeta(gov, slug, id, { synonyms: [...metaOf(gov, slug, id).synonyms, word] });
export const removeSynonym = (gov: Governance, slug: string, id: string, word: string): Governance =>
  setTermMeta(gov, slug, id, { synonyms: metaOf(gov, slug, id).synonyms.filter((x) => x !== word) });

/** Everything a term can be called: its label and its synonyms. */
export const namesOf = (o: Ontology, gov: Governance, t: Term): string[] => [t.label, ...metaOf(gov, o.slug, t.id).synonyms];

// ---------------------------------------------------------------- competency questions

export type QuestionState = 'answerable' | 'partial' | 'blocked';
export const QUESTION_LABEL: Record<QuestionState, string> = { answerable: 'Can be answered', partial: 'Partly', blocked: 'Cannot be answered yet' };
export interface QuestionProblem { term: string; kind: 'missing' | 'undefined' | 'deprecated' | 'draft'; message: string }
export interface QuestionCheck { question: Question; state: QuestionState; problems: QuestionProblem[]; found: number }

/**
 * Can the ontology answer the question? Every term the question needs must exist (else it is blocked), and should have a definition,
 * not be deprecated and not be a draft (else it is only partly answerable). It checks the vocabulary, not the data.
 */
export function checkQuestion(o: Ontology, gov: Governance, q: Question): QuestionCheck {
  const problems: QuestionProblem[] = [];
  let found = 0;
  for (const id of q.terms) {
    const t = o.terms.find((x) => x.id === id);
    if (!t) { problems.push({ term: id, kind: 'missing', message: `"${id}" is not in the ontology.` }); continue; }
    found++;
    if (!t.definition.trim()) problems.push({ term: id, kind: 'undefined', message: `${t.label} has no definition.` });
    const st = statusOf(o, gov, t);
    if (st === 'deprecated') problems.push({ term: id, kind: 'deprecated', message: `${t.label} is deprecated${metaOf(gov, o.slug, id).replacedBy ? `, use ${metaOf(gov, o.slug, id).replacedBy}` : ''}.` });
    else if (st === 'draft') problems.push({ term: id, kind: 'draft', message: `${t.label} is still a draft.` });
  }
  const state: QuestionState = problems.some((p) => p.kind === 'missing') ? 'blocked' : problems.length ? 'partial' : 'answerable';
  return { question: q, state, problems, found };
}
export function questionsOf(gov: Governance, slug: string): Question[] { return gov.questions.filter((q) => q.slug === slug); }
export function questionCoverage(o: Ontology, gov: Governance): { total: number; answerable: number; partial: number; blocked: number; share: number } {
  const checks = questionsOf(gov, o.slug).map((q) => checkQuestion(o, gov, q));
  const c = (s: QuestionState) => checks.filter((x) => x.state === s).length;
  return { total: checks.length, answerable: c('answerable'), partial: c('partial'), blocked: c('blocked'), share: checks.length ? c('answerable') / checks.length : 1 };
}
export function addQuestion(gov: Governance, slug: string, text: string, terms: string[], now = Date.now()): Governance {
  const t = text.trim().slice(0, 300);
  const ids = [...new Set(terms.map((x) => x.trim()).filter(Boolean))].slice(0, 20);
  if (!t || !ids.length || gov.questions.length >= 500) return gov;
  if (gov.questions.some((q) => q.slug === slug && q.text.toLowerCase() === t.toLowerCase())) return gov;
  return { ...gov, questions: [...gov.questions, { id: `q${now.toString(36)}`, slug, text: t, terms: ids }] };
}
export const removeQuestion = (gov: Governance, id: string): Governance => ({ ...gov, questions: gov.questions.filter((q) => q.id !== id) });

/** Owner, domain and approver per ontology come from the governance file, not from the Turtle. */
export function applyGovernance(ontologies: Ontology[], gov: Governance): Ontology[] {
  return ontologies.map((o) => {
    const m = gov.ontologies[o.slug];
    return m ? { ...o, owner: m.owner, domain: m.domain, approver: m.approver } : o;
  });
}

export function setMeta(gov: Governance, slug: string, meta: Partial<OntologyMeta>): Governance {
  const cur = gov.ontologies[slug] ?? { owner: '', domain: '', approver: '' };
  return { ...gov, ontologies: { ...gov.ontologies, [slug]: { ...cur, ...meta } } };
}

const sameBinding = (a: Binding, b: Binding) =>
  a.slug === b.slug && a.term === b.term && a.kind === b.kind && a.name.toLowerCase() === b.name.toLowerCase();

export function addBinding(gov: Governance, b: Binding): Governance {
  const item = { ...b, name: b.name.trim() };
  if (!item.name || gov.bindings.some((x) => sameBinding(x, item))) return gov;
  return { ...gov, bindings: [...gov.bindings, item] };
}
export const removeBinding = (gov: Governance, b: Binding): Governance => ({ ...gov, bindings: gov.bindings.filter((x) => !sameBinding(x, b)) });

export function upsertView(gov: Governance, v: AgentView): Governance {
  const name = v.name.trim();
  if (!name) return gov;
  const rest = gov.views.filter((x) => x.name.toLowerCase() !== name.toLowerCase());
  return { ...gov, views: [...rest, { name, slugs: [...new Set(v.slugs)] }] };
}
export const removeView = (gov: Governance, name: string): Governance => ({ ...gov, views: gov.views.filter((x) => x.name !== name) });

/** Who declares a term: those bound to the term itself and, in `viaDependents`, those bound to something that depends on it. */
export interface Consumer { kind: ConsumerKind; name: string; term: string; direct: boolean }
export function consumersOf(gov: Governance, o: Ontology, termId: string, impact: Impact): Consumer[] {
  const dependents = new Set(impact.usedBy.map((d) => d.node.id));
  const out: Consumer[] = [];
  for (const b of gov.bindings) {
    if (b.slug !== o.slug) continue;
    if (b.term === termId) out.push({ kind: b.kind, name: b.name, term: b.term, direct: true });
    else if (dependents.has(b.term)) out.push({ kind: b.kind, name: b.name, term: b.term, direct: false });
  }
  return out.sort((a, b) => Number(b.direct) - Number(a.direct) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/** The agent's view: the ontologies it gets, as the connector's `compose` takes them. */
export function viewPrompt(v: AgentView): string {
  return `Use the Ontology Manager tool compose with slugs ${JSON.stringify(v.slugs)} and show me which classes and properties the agent "${v.name}" would see. Change nothing.`;
}

// ---------------------------------------------------------------- change plans

/** A readable request to the people who stand behind a term, built from the impact. Nothing is sent by the app. */
export function planRequest(o: Ontology, termId: string, change: string, impact: Impact, consumers: Consumer[], codes: string[]): string {
  const t = o.terms.find((x) => x.id === termId);
  const lines = [
    `Proposed change to "${t?.label ?? termId}" in ${o.title} (${o.slug}):`,
    change.trim(),
    '',
    `Reaches ${impact.usedBy.length} modelled ${impact.usedBy.length === 1 ? 'thing' : 'things'}${codes.length ? ` and the company codes ${codes.join(', ')}` : ''}.`,
  ];
  if (impact.usedBy.length) lines.push(`Affected: ${impact.usedBy.map((d) => d.node.label).join(', ')}.`);
  if (consumers.length) lines.push(`Declared users: ${consumers.map((c) => `${c.name} (${c.kind})`).join(', ')}.`);
  lines.push(`Please confirm or object. Approver for this ontology: ${o.approver || 'not assigned'}.`);
  return lines.join('\n');
}

export function newPlan(o: Ontology, termId: string, change: string, impact: Impact, now: number): Plan {
  return {
    id: `p${now.toString(36)}`, slug: o.slug, term: termId, change: change.trim(), status: 'draft',
    createdAt: new Date(now).toISOString(), asked: [...new Set([...impact.ask, ...(o.approver ? [o.approver] : [])])],
  };
}
export const setPlanStatus = (gov: Governance, id: string, status: PlanStatus): Governance =>
  ({ ...gov, plans: gov.plans.map((p) => (p.id === id ? { ...p, status } : p)) });
export const addPlan = (gov: Governance, plan: Plan): Governance => ({ ...gov, plans: [plan, ...gov.plans] });
export const PLAN_LABEL: Record<PlanStatus, string> = { draft: 'Draft', asked: 'Owners asked', approved: 'Approved', rejected: 'Rejected' };

// ---------------------------------------------------------------- quality rules

export type Severity = 'high' | 'medium' | 'low';
export interface Finding { id: string; severity: Severity; rule: string; slug: string; term: string; message: string }
export const RULE_LABEL: Record<string, string> = {
  'no-owner': 'Metric without owner', 'no-definition': 'No definition', 'no-formula': 'Metric without formula',
  unused: 'Not used anywhere', duplicate: 'Possible duplicate', 'ontology-owner': 'Ontology without owner',
  'deprecated-used': 'Deprecated but still used', 'no-replacement': 'Deprecated without replacement', 'synonym-clash': 'Synonym is ambiguous',
  'question-blocked': 'Question cannot be answered',
};

const words = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^a-z0-9äöüß ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1));
function similar(a: string, b: string): boolean {
  const x = words(a); const y = words(b);
  if (!x.size || !y.size) return false;
  const both = [...x].filter((w) => y.has(w)).length;
  return both / (x.size + y.size - both) >= 0.8;
}

/** What a steward should look at, per rule. Rules: owner, definition, formula, use, duplicates (also across ontologies), ontology owner. */
export function qualityFindings(ontologies: Ontology[], gov: Governance): Finding[] {
  const out: Finding[] = [];
  const add = (severity: Severity, rule: string, o: Ontology, term: string, message: string) =>
    out.push({ id: `${rule}:${o.slug}:${term}`, severity, rule, slug: o.slug, term, message });
  for (const o of ontologies) {
    if (!o.owner.trim()) add('medium', 'ontology-owner', o, '', `${o.title} has no owner. Nobody is asked before it changes.`);
    for (const t of o.terms) {
      if (t.kind === 'metric' && !t.owner.trim()) add('high', 'no-owner', o, t.id, `${t.label} is a metric but nobody certified it.`);
      if (!t.definition.trim()) add('medium', 'no-definition', o, t.id, `${t.label} has no definition.`);
      if (t.kind === 'metric' && !t.formula.trim()) add('medium', 'no-formula', o, t.id, `${t.label} has no formula.`);
      const bound = gov.bindings.some((b) => b.slug === o.slug && b.term === t.id);
      const used = t.kind === 'metric' ? incoming(o, t.id).length > 0 : t.members.length > 0 || incoming(o, t.id).length > 0;
      if (!used && !bound) add('low', 'unused', o, t.id, `${t.label} is not linked from anything modelled and no agent, skill or report declares it.`);
      const meta = metaOf(gov, o.slug, t.id);
      if (statusOf(o, gov, t) === 'deprecated') {
        const users = incoming(o, t.id).length + gov.bindings.filter((b) => b.slug === o.slug && b.term === t.id).length;
        const repl = o.terms.find((x) => x.id === meta.replacedBy);
        if (!meta.replacedBy) add('medium', 'no-replacement', o, t.id, `${t.label} is deprecated but names no replacement.`);
        else if (!repl || statusOf(o, gov, repl) === 'deprecated') add('medium', 'no-replacement', o, t.id, `${t.label} points to ${meta.replacedBy}, which does not exist or is deprecated itself.`);
        if (users > 0) add('high', 'deprecated-used', o, t.id, `${t.label} is deprecated but ${users} ${users === 1 ? 'thing still uses' : 'things still use'} it${repl ? `. Move them to ${repl.label}` : ''}.`);
      }
    }
    const claimed = new Map<string, string>();
    for (const t of o.terms) claimed.set(t.label.toLowerCase(), t.id);
    for (const t of o.terms) {
      for (const w of metaOf(gov, o.slug, t.id).synonyms) {
        const other = claimed.get(w.toLowerCase());
        // The old name of a deprecated term is a good synonym of its replacement; that is how people find the new term.
        if (other && other !== t.id && metaOf(gov, o.slug, other).status === 'deprecated' && metaOf(gov, o.slug, other).replacedBy === t.id) continue;
        if (other && other !== t.id) add('medium', 'synonym-clash', o, t.id, `"${w}" is a synonym of ${t.label} but also a name or synonym of ${other}. People would not know which is meant.`);
        else if (!other) claimed.set(w.toLowerCase(), t.id);
      }
    }
    for (const q of questionsOf(gov, o.slug)) {
      const c = checkQuestion(o, gov, q);
      if (c.state === 'blocked') {
        const gone = c.problems.filter((p) => p.kind === 'missing').map((p) => p.term);
        out.push({ id: `question-blocked:${o.slug}:${q.id}`, severity: 'medium', rule: 'question-blocked', slug: o.slug, term: '', message: `"${q.text}" cannot be answered: ${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} missing.` });
      }
    }
  }
  const flat = ontologies.flatMap((o) => o.terms.map((t) => ({ o, t })));
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i]; const b = flat[j];
      if (a.t.kind === b.t.kind && similar(a.t.label, b.t.label)) {
        add('medium', 'duplicate', a.o, a.t.id, `${a.t.label} looks like ${b.t.label}${b.o.slug !== a.o.slug ? ` in ${b.o.slug}` : ''}. One term should win.`);
      }
    }
  }
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.slug.localeCompare(b.slug) || a.term.localeCompare(b.term));
}

// ---------------------------------------------------------------- proposals and history

export interface ProposalItem {
  name: string; action: 'new' | 'extend' | 'reuse'; description: string; evidence: string[];
  domain: string; range: string; baseline: string; confidence: string; rationale: string;
}
export interface Proposal {
  id: string; slug: string; mode: 'new' | 'extend'; label: string; status: string; createdAt: string; model: string; error: string;
  documents: Array<{ file: string; chunks: number }>;
  counts: Record<string, { new?: number; extend?: number; reuse?: number }>;
  classes: ProposalItem[]; datatypeProperties: ProposalItem[]; objectProperties: ProposalItem[];
  needsAttention: Array<{ kind: string; name: string; why: string }>;
  warnings: string[];
}
export interface VersionEntry { file: string; at: string; terms: number; added: string[]; removed: string[] }

/** Totals over the three groups for the review header. */
export function proposalTotals(p: Proposal): { new: number; extend: number; reuse: number; total: number } {
  const t = { new: 0, extend: 0, reuse: 0, total: 0 };
  for (const it of [...p.classes, ...p.datatypeProperties, ...p.objectProperties]) { t[it.action] += 1; t.total += 1; }
  return t;
}

/** An item needs a look when it has no evidence quote or the alignment was not confident. */
export function needsLook(p: Proposal, it: ProposalItem): boolean {
  return it.evidence.length === 0 || it.confidence === 'low' || p.needsAttention.some((n) => n.name === it.name);
}

// The agent runs these only after the person pressed the button next to them. Applying and discarding need confirmed=true.
export const applyPrompt = (p: Proposal): string =>
  `The person reviewed the ontology proposal ${p.id} (${p.mode} ${p.slug}) and confirmed it. Call apply_ontology_proposal with proposal_id "${p.id}" and confirmed=true. Then say in two sentences what was applied. Do nothing else.`;
export const discardPrompt = (p: Proposal): string =>
  `The person decided to throw away the ontology proposal ${p.id}. Call discard_ontology_proposal with proposal_id "${p.id}" and confirmed=true. Then confirm in one sentence. Do nothing else.`;
export function proposePrompt(slug: string, mode: 'new' | 'extend', docsHint: string): string {
  return `Call propose_ontology_from_documents with slug "${slug}", mode "${mode}"${docsHint.trim() ? ` and the documents ${docsHint.trim()}` : ' (use document_ontology_settings first to see the documents folder and take the files in it)'}. Do not apply anything. Then say how many classes and properties were proposed and which need attention.`;
}

// ---------------------------------------------------------------- example data for governance, proposals, history

/** Adds the parts of `extra` to `base` (used for the bigger example set). */
export function mergeGovernance(base: Governance, extra: Partial<Governance>): Governance {
  return {
    ...base,
    ontologies: { ...base.ontologies, ...(extra.ontologies ?? {}) },
    bindings: [...base.bindings, ...(extra.bindings ?? [])],
    views: [...base.views, ...(extra.views ?? [])],
    plans: [...base.plans, ...(extra.plans ?? [])],
    termMeta: { ...base.termMeta, ...(extra.termMeta ?? {}) },
    questions: [...base.questions, ...(extra.questions ?? [])],
    usageDecisions: { ...(base.usageDecisions ?? {}), ...(extra.usageDecisions ?? {}) },
  };
}

export function exampleGovernance(): Governance {
  return {
    version: 1,
    termMeta: {
      'werkbank_fin|DSO': { status: 'approved', replacedBy: '', synonyms: ['days sales outstanding', 'receivable days'], mappings: [{ system: 'SAP S/4HANA', ref: 'Credit Management: DSO' }] },
      'werkbank_fin|Margin': { status: 'approved', replacedBy: '', synonyms: ['contribution margin I', 'CM1'], mappings: [] },
    },
    questions: [
      { id: 'q-fin-1', slug: 'werkbank_fin', text: 'Which company codes have a DSO plausibility problem?', terms: ['DSO', 'CompanyCode', 'PreCloseCheck'] },
      { id: 'q-fin-2', slug: 'werkbank_fin', text: 'What is the margin after accruals per company code?', terms: ['MarginAfterAccruals', 'CompanyCode'] },
      { id: 'q-fin-3', slug: 'werkbank_fin', text: 'Which accruals exist for goods received but not invoiced?', terms: ['Accrual', 'GRIRItem'] },
      { id: 'q-fin-4', slug: 'werkbank_fin', text: 'How are invoices and journal entries classified?', terms: ['FinancialDocument', 'Invoice'] },
    ],
    ontologies: {
      werkbank_fin: { owner: 'Group Controlling', domain: 'Finance', approver: 'Group Controlling' },
      procurement_docs: { owner: '', domain: 'Procurement', approver: '' },
    },
    bindings: [
      { slug: 'werkbank_fin', term: 'DSO', kind: 'agent', name: 'Finance Pre-Close agent' },
      { slug: 'werkbank_fin', term: 'chk_dso', kind: 'skill', name: 'dso-plausibility' },
      { slug: 'werkbank_fin', term: 'Margin', kind: 'agent', name: 'Margin analyst' },
      { slug: 'werkbank_fin', term: 'Margin', kind: 'report', name: 'Monthly margin report' },
    ],
    views: [{ name: 'Finance Pre-Close agent', slugs: ['werkbank_fin'] }],
    usageDecisions: {},
    plans: [],
  };
}

export function exampleProposals(): Proposal[] {
  const item = (name: string, action: ProposalItem['action'], description: string, evidence: string[], extra: Partial<ProposalItem> = {}): ProposalItem =>
    ({ name, action, description, evidence, domain: '', range: '', baseline: '', confidence: '', rationale: '', ...extra });
  return [{
    id: 'werkbank_fin-20261105T091500Z-a1b2', slug: 'werkbank_fin', mode: 'extend', label: 'Werkbank Finance Pre-Close', status: 'proposed',
    createdAt: '2026-11-05T09:15:00Z', model: 'example', error: '',
    documents: [{ file: 'finance-closing-handbook.md', chunks: 6 }],
    counts: { classes: { new: 2, extend: 1, reuse: 1 }, datatype_properties: { new: 1, extend: 0, reuse: 0 }, object_properties: { new: 1, extend: 0, reuse: 0 } },
    classes: [
      item('Accrual', 'new', 'An amount booked for a delivery that was received but not yet invoiced.', ['An accrual is booked for every delivery that has been received but not yet invoiced.']),
      item('GR/IR Item', 'new', 'An open balance between goods received and invoices received for one purchase order line.', ['A GR/IR item is an open balance between goods received and invoices received for one purchase order line.']),
      item('Pre-Close Check', 'extend', 'Check run before the period is closed; the handbook adds working day 3 as the timing.', ['The pre-close runs on working day 3 before the period is closed.'], { baseline: 'PreCloseCheck [werkbank_fin]', confidence: 'high', rationale: 'Same concept, more detail.' }),
      item('Company Code', 'reuse', 'Legal entity such as DE10, FR10, UK10.', ['Company codes are DE10, FR10 and UK10.'], { baseline: 'CompanyCode [werkbank_fin]', confidence: 'high', rationale: 'Identical.' }),
    ],
    datatypeProperties: [item('approvalThreshold', 'new', 'Amount above which an accrual needs approval.', [], { domain: 'Accrual', range: 'decimal' })],
    objectProperties: [item('escalatedTo', 'new', 'The team a GR/IR item is escalated to.', ['Items open for more than 60 days are escalated to Group Procurement.'], { domain: 'GR/IR Item', range: 'Team' })],
    needsAttention: [{ kind: 'datatype_properties', name: 'approvalThreshold', why: 'no evidence quote' }],
    warnings: [],
  }];
}

export function exampleHistory(): Record<string, VersionEntry[]> {
  return {
    werkbank_fin: [
      { file: 'werkbank_fin-20261101T080000Z.ttl', at: '2026-11-01T08:00:00Z', terms: 21, added: [], removed: [] },
      { file: 'current', at: '', terms: 24, added: ['Accrual', 'GR/IR Item', 'escalatedTo'], removed: [] },
    ],
  };
}
