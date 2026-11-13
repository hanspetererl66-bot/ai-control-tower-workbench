/**
 * Who uses a term of the ontology? Pure functions for act A of the Ontology Manager demo ("what breaks if I approve this?",
 * docs/ontology-akt-a-concept.md): turn registry cards, skills and spaces into plain text sources, find the terms in them,
 * apply the decisions of people, and say whether a change may be approved. No DOM, no network, no storage: the tests call
 * everything directly.
 *
 * A found usage is only ever "suspected". It becomes "confirmed" when a person says so (`UsageDecision`), and a usage that
 * somebody declared by hand (`Binding`) is "declared". The app never writes the catalog; nothing here changes anything.
 */
import { metaOf, type Binding, type Governance, type Ontology, type UsageDecision } from './ontology-manager.ts';
import type { RItem } from './registry.ts';

// ---------------------------------------------------------------- types

export type UsageKind = 'agent' | 'workflow' | 'feature' | 'skill' | 'space' | 'report';
export type Field = 'relation.data' | 'relation.process' | 'relation.capability' | 'relation.other' | 'tag' | 'name' | 'purpose' | 'body';
export type Strength = 'strong' | 'medium' | 'weak';
export type UsageState = 'declared' | 'confirmed' | 'suspected';
export type Via = 'label' | 'synonym' | 'mapping';

/** What the finder reads from one thing: plain text fields. No registry, skill or space types leak in here. */
export interface Source {
  kind: UsageKind;
  /** Registry id, skill directory or space slug. */
  ref: string;
  name: string;
  /** Accountable person; empty when unknown. */
  owner: string;
  /** Registry criticality (administrative, operational, critical, mission-critical); empty when unknown. */
  criticality: string;
  fields: Array<{ field: Field; text: string }>;
}

/** One name a term can be found under. */
export interface SearchTerm { slug: string; id: string; label: string; synonyms: string[]; mappings: string[] }

export interface Evidence { field: Field; strength: Strength; excerpt: string; via: Via; phrase: string }

export interface Usage {
  /** `<slug>|<term>|<kind>:<ref>` */
  key: string;
  slug: string;
  term: string;
  kind: UsageKind;
  ref: string;
  name: string;
  owner: string;
  criticality: string;
  state: UsageState;
  /** The best strength of the evidence; declared usages count as strong. */
  strength: Strength;
  evidence: Evidence[];
  /** The phrase belongs to terms of two ontologies: the finder cannot say which one is meant. */
  ambiguous: boolean;
}

export type { UsageDecision };
export type DecisionMap = Record<string, UsageDecision>;

export const MAX_USAGES_PER_TERM = 50;
export const MAX_EVIDENCE = 3;
export const EXCERPT_CHARS = 120;
/** Phrases shorter than this, or in GENERIC, count only in strong fields. */
export const MIN_PHRASE = 4;
export const GENERIC = new Set(['order', 'item', 'items', 'status', 'type', 'name', 'data', 'date', 'value', 'amount', 'user', 'case', 'task', 'plan', 'rule', 'check', 'report', 'agent', 'skill', 'space', 'text', 'list', 'view', 'time', 'year', 'month']);
export const CRITICAL = new Set(['critical', 'mission-critical']);

// ---------------------------------------------------------------- normalising

/** Lower case, umlauts and accents folded, sharp s to ss, white space collapsed. Same idea as the search of the Spaces. */
export function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** The normalised text and, for every normalised character, where it came from in the original (to cut the excerpt from the original). */
function normMap(text: string): { norm: string; at: number[] } {
  let out = '';
  const at: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const piece = text[i].toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const ch of piece) {
      if (/\s/.test(ch)) { pendingSpace = out.length > 0; continue; }
      if (pendingSpace) { out += ' '; at.push(i); pendingSpace = false; }
      out += ch; at.push(i);
    }
  }
  return { norm: out, at };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A phrase as a whole word (or words); a trailing "s" or "es" still counts (Contract, Contracts). */
const phraseRe = (phrase: string) => new RegExp(`(?:^|[^a-z0-9])(${escapeRe(phrase)}(?:e?s)?)(?=$|[^a-z0-9])`, 'g');

// ---------------------------------------------------------------- search terms

/** Every term of every ontology with the names it can be found under: label, synonyms, and the names it is mapped to. */
export function searchTerms(ontologies: readonly Ontology[], gov: Governance): SearchTerm[] {
  const out: SearchTerm[] = [];
  for (const o of ontologies) {
    for (const t of o.terms) {
      const meta = metaOf(gov, o.slug, t.id);
      out.push({ slug: o.slug, id: t.id, label: t.label, synonyms: meta.synonyms, mappings: meta.mappings.map((m) => m.ref).filter(Boolean) });
    }
  }
  return out;
}

const namesOf = (t: SearchTerm): Array<{ phrase: string; via: Via; norm: string }> => {
  const seen = new Set<string>();
  const out: Array<{ phrase: string; via: Via; norm: string }> = [];
  const add = (phrase: string, via: Via) => {
    const n = norm(phrase);
    if (!n || seen.has(n)) return;
    seen.add(n); out.push({ phrase, via, norm: n });
  };
  add(t.label, 'label');
  t.synonyms.forEach((s) => add(s, 'synonym'));
  t.mappings.forEach((m) => add(m, 'mapping'));
  return out;
};

// ---------------------------------------------------------------- strength

export function fieldStrength(field: Field): Strength {
  if (field === 'relation.data' || field === 'relation.process') return 'strong';
  if (field === 'purpose' || field === 'body') return 'weak';
  return 'medium';
}
const RANK: Record<Strength, number> = { strong: 3, medium: 2, weak: 1 };
const best = (list: Strength[]): Strength => list.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'weak' as Strength);

/**
 * The weakest field a name may be found in. Short and generic names are too easy to hit by accident: they count only where
 * somebody wrote the relation on purpose (strong). A single everyday word (Customer, Offer, Source) counts in structured
 * fields (relation, tag, name) but not in running text; only phrases of two or more words are searched in prose. Probe on
 * the example data: nearly all weak hits of single words in prose were wrong.
 */
function weakestField(normPhrase: string): Strength {
  if (normPhrase.length < MIN_PHRASE || GENERIC.has(normPhrase)) return 'strong';
  return normPhrase.includes(' ') ? 'weak' : 'medium';
}

// ---------------------------------------------------------------- finding

const keyOf = (slug: string, term: string, kind: UsageKind, ref: string) => `${slug}|${term}|${kind}:${ref}`;

function excerptOf(text: string, at: number[], start: number, end: number): string {
  const from = at[start] ?? 0;
  const to = (at[Math.min(end, at.length) - 1] ?? text.length - 1) + 1;
  const room = Math.max(0, EXCERPT_CHARS - (to - from));
  let a = Math.max(0, from - Math.floor(room / 2));
  let b = Math.min(text.length, to + Math.ceil(room / 2));
  if (b - a > EXCERPT_CHARS) b = a + EXCERPT_CHARS;
  const cut = text.slice(a, b).replace(/\s+/g, ' ').trim();
  return `${a > 0 ? '…' : ''}${cut}${b < text.length ? '…' : ''}`;
}

export interface Found { usages: Usage[]; /** Terms (`slug|id`) that had more than MAX_USAGES_PER_TERM and were cut. */ capped: string[] }

/**
 * Looks for every term in every source. One usage per term and source, with up to MAX_EVIDENCE places where it was found
 * (strongest first). The result is a list of suspicions, not facts.
 */
export function findUsages(terms: readonly SearchTerm[], sources: readonly Source[]): Found {
  // Which terms (of which ontology) own a phrase: a phrase owned by two ontologies is ambiguous.
  const owners = new Map<string, Set<string>>();
  for (const t of terms) for (const n of namesOf(t)) {
    const set = owners.get(n.norm) ?? new Set<string>();
    set.add(t.slug); owners.set(n.norm, set);
  }
  const names = new Map<string, ReturnType<typeof namesOf>>(terms.map((t) => [`${t.slug}|${t.id}`, namesOf(t)]));

  const all: Usage[] = [];
  for (const s of sources) {
    const mapped = s.fields.map((f) => ({ f, ...normMap(f.text) }));
    for (const t of terms) {
      const evidence: Evidence[] = [];
      let ambiguous = false;
      for (const n of names.get(`${t.slug}|${t.id}`) ?? []) {
        const re = phraseRe(n.norm);
        for (const m of mapped) {
          const strength = fieldStrength(m.f.field);
          if (RANK[strength] < RANK[weakestField(n.norm)]) continue;
          re.lastIndex = 0;
          const hit = re.exec(m.norm);
          if (!hit) continue;
          const start = hit.index + hit[0].indexOf(hit[1]);
          evidence.push({ field: m.f.field, strength, excerpt: excerptOf(m.f.text, m.at, start, start + hit[1].length), via: n.via, phrase: n.phrase });
          if ((owners.get(n.norm)?.size ?? 0) > 1) ambiguous = true;
        }
      }
      if (!evidence.length) continue;
      evidence.sort((a, b) => RANK[b.strength] - RANK[a.strength]);
      all.push({
        key: keyOf(t.slug, t.id, s.kind, s.ref), slug: t.slug, term: t.id, kind: s.kind, ref: s.ref, name: s.name, owner: s.owner, criticality: s.criticality,
        state: 'suspected', strength: best(evidence.map((e) => e.strength)), evidence: evidence.slice(0, MAX_EVIDENCE), ambiguous,
      });
    }
  }
  return capUsages(all);
}

function capUsages(all: Usage[]): Found {
  const byTerm = new Map<string, Usage[]>();
  for (const u of all) byTerm.set(`${u.slug}|${u.term}`, [...(byTerm.get(`${u.slug}|${u.term}`) ?? []), u]);
  const usages: Usage[] = [];
  const capped: string[] = [];
  for (const [term, list] of byTerm) {
    list.sort((a, b) => RANK[b.strength] - RANK[a.strength] || a.name.localeCompare(b.name));
    if (list.length > MAX_USAGES_PER_TERM) capped.push(term);
    usages.push(...list.slice(0, MAX_USAGES_PER_TERM));
  }
  return { usages, capped: capped.sort() };
}

// ---------------------------------------------------------------- people decide

const BINDING_KIND: Record<Binding['kind'], UsageKind> = { agent: 'agent', skill: 'skill', report: 'report' };

/** The usages somebody declared by hand (tab Use), in the same shape. Their strength is strong: a person said so. */
export function declaredUsages(gov: Governance): Usage[] {
  return gov.bindings.map((b) => ({
    key: keyOf(b.slug, b.term, BINDING_KIND[b.kind], b.name), slug: b.slug, term: b.term, kind: BINDING_KIND[b.kind], ref: b.name, name: b.name, owner: '', criticality: '',
    state: 'declared' as const, strength: 'strong' as const, evidence: [], ambiguous: false,
  }));
}

export interface Decided { usages: Usage[]; dismissed: number }

/**
 * Found usages, declared usages and the decisions of people in one list. A confirmed decision turns "suspected" into
 * "confirmed", a dismissed one removes the suspicion (the count stays visible). A declared usage wins over a found one
 * with the same kind and name; the evidence of the found one is kept on it.
 */
export function applyDecisions(found: readonly Usage[], declared: readonly Usage[], decisions: DecisionMap): Decided {
  const out = new Map<string, Usage>();
  const byName = new Map<string, string>(); // slug|term|kind|norm(name) -> key of the declared usage
  for (const d of declared) { out.set(d.key, d); byName.set(`${d.slug}|${d.term}|${d.kind}|${norm(d.name)}`, d.key); }
  let dismissed = 0;
  for (const u of found) {
    const declaredKey = byName.get(`${u.slug}|${u.term}|${u.kind}|${norm(u.name)}`);
    if (declaredKey) {
      const d = out.get(declaredKey) as Usage;
      out.set(declaredKey, { ...d, owner: d.owner || u.owner, criticality: d.criticality || u.criticality, evidence: u.evidence, ambiguous: u.ambiguous });
      continue;
    }
    const decision = decisions[u.key]?.decision;
    if (decision === 'dismissed') { dismissed++; continue; }
    out.set(u.key, decision === 'confirmed' ? { ...u, state: 'confirmed' } : u);
  }
  return { usages: [...out.values()].sort((a, b) => stateRank(a.state) - stateRank(b.state) || RANK[b.strength] - RANK[a.strength] || a.name.localeCompare(b.name)), dismissed };
}
const stateRank = (s: UsageState) => (s === 'suspected' ? 1 : 0);

/** Records a decision; asking again with the same decision takes it back (a person may change their mind). Returns a new map. */
export function decide(decisions: DecisionMap, key: string, decision: UsageDecision['decision'], by: string, now: number): DecisionMap {
  const next = { ...decisions };
  if (next[key]?.decision === decision) delete next[key];
  else next[key] = { decision, by: by.trim().slice(0, 120), at: new Date(now).toISOString() };
  return next;
}

// ---------------------------------------------------------------- summary and approval

export interface UsageSummary {
  total: number;
  /** Declared or confirmed by a person. */
  confirmed: number;
  suspected: number;
  /** Suspected and found only in weak fields. */
  weak: number;
  ambiguous: number;
  dismissed: number;
  /** Distinct owners to ask (confirmed and suspected users). */
  owners: string[];
  /** Suspected users whose criticality is critical or mission-critical: still undecided. */
  openCritical: Usage[];
  byKind: Record<string, number>;
}

export function summarize(decided: Decided): UsageSummary {
  const list = decided.usages;
  const byKind: Record<string, number> = {};
  for (const u of list) byKind[u.kind] = (byKind[u.kind] ?? 0) + 1;
  return {
    total: list.length,
    confirmed: list.filter((u) => u.state !== 'suspected').length,
    suspected: list.filter((u) => u.state === 'suspected').length,
    weak: list.filter((u) => u.state === 'suspected' && u.strength === 'weak').length,
    ambiguous: list.filter((u) => u.ambiguous).length,
    dismissed: decided.dismissed,
    owners: [...new Set(list.map((u) => u.owner).filter(Boolean))].sort(),
    openCritical: list.filter((u) => u.state === 'suspected' && CRITICAL.has(u.criticality)),
    byKind,
  };
}

export interface ApprovalSettings { blockOnCritical: boolean }
export const DEFAULT_APPROVAL: ApprovalSettings = { blockOnCritical: true };

export interface ApprovalCheck { allowed: boolean; reason: string }

/**
 * May this person approve the change? Only the approver of the ontology; never an AI actor; and, when the rule is on, not
 * while a critical user is still only suspected. Identity in the Werkbank is a label (an e-mail), not protection.
 */
export function mayApprove(args: { approver: string; actor: string; actorIsAgent: boolean; summary: UsageSummary; settings?: ApprovalSettings }): ApprovalCheck {
  const settings = args.settings ?? DEFAULT_APPROVAL;
  if (args.actorIsAgent) return { allowed: false, reason: 'An AI actor cannot approve. A person decides.' };
  if (!args.approver.trim()) return { allowed: false, reason: 'No approver is assigned to this ontology.' };
  if (norm(args.actor) !== norm(args.approver)) return { allowed: false, reason: `Only the approver (${args.approver.trim()}) approves this change.` };
  if (settings.blockOnCritical && args.summary.openCritical.length) {
    const names = args.summary.openCritical.map((u) => u.name).slice(0, 3).join(', ');
    return { allowed: false, reason: `${args.summary.openCritical.length} critical ${args.summary.openCritical.length === 1 ? 'user is' : 'users are'} still only suspected (${names}). Confirm or dismiss ${args.summary.openCritical.length === 1 ? 'it' : 'them'} first.` };
  }
  return { allowed: true, reason: '' };
}

// ---------------------------------------------------------------- sources

const clip = (s: unknown, n = 4000) => String(s ?? '').slice(0, n);
const relationField = (kind: string): Field => (kind === 'data' ? 'relation.data' : kind === 'process' ? 'relation.process' : kind === 'capability' ? 'relation.capability' : 'relation.other');

/** Registry items (agent, workflow, feature, code) as sources. Items without a register card still count by their name. */
export function sourcesFromRegister(items: readonly RItem[]): Source[] {
  return items.filter((i) => !i.archived && i.type !== 'code').map((i) => {
    const card = i.card;
    const fields: Source['fields'] = [{ field: 'name', text: clip(i.name, 200) }];
    if (card) {
      if (card.purpose) fields.push({ field: 'purpose', text: clip(card.purpose) });
      for (const t of card.tags) fields.push({ field: 'tag', text: clip(t, 80) });
      for (const r of card.relations) fields.push({ field: relationField(r.kind), text: clip(`${r.name}${r.note ? ` ${r.note}` : ''}`, 300) });
    }
    return { kind: i.type as UsageKind, ref: i.id, name: i.name, owner: card?.steward || i.owner || '', criticality: card?.criticality ?? '', fields };
  });
}

/** Skills (SKILL.md) as sources: name, description and the text. */
export function sourcesFromSkills(skills: ReadonlyArray<{ name: string; description: string; dir: string }>, texts: Readonly<Record<string, string>> = {}): Source[] {
  return skills.map((s) => {
    const fields: Source['fields'] = [{ field: 'name', text: clip(s.name, 200) }];
    if (s.description) fields.push({ field: 'purpose', text: clip(s.description) });
    if (texts[s.dir]) fields.push({ field: 'body', text: clip(texts[s.dir], 20000) });
    return { kind: 'skill' as const, ref: s.dir, name: s.name, owner: '', criticality: '', fields };
  });
}

/** Spaces as sources: title, description, hints, and, when given, the text of the page. */
export function sourcesFromSpaces(spaces: ReadonlyArray<{ slug: string; title: string; description: string; insights: readonly string[] }>, texts: Readonly<Record<string, string>> = {}): Source[] {
  return spaces.map((s) => {
    const fields: Source['fields'] = [{ field: 'name', text: clip(s.title, 200) }];
    if (s.description) fields.push({ field: 'purpose', text: clip(s.description) });
    for (const line of s.insights) if (line) fields.push({ field: 'body', text: clip(line, 500) });
    if (texts[s.slug]) fields.push({ field: 'body', text: clip(texts[s.slug], 20000) });
    return { kind: 'space' as const, ref: s.slug, name: s.title, owner: '', criticality: '', fields };
  });
}

// ---------------------------------------------------------------- decisions in the governance file

/** The decisions of people as stored in `governance.json` (older files have none). */
export const decisionsOf = (gov: Governance): DecisionMap => gov.usageDecisions ?? {};

/**
 * Records (or takes back) a decision about one found user. Returns a new Governance; the caller saves it like every other
 * governance change. Nothing else changes: no binding is created and the catalog is never touched.
 */
export function setUsageDecision(gov: Governance, key: string, decision: UsageDecision['decision'], by: string, now: number): Governance {
  return { ...gov, usageDecisions: decide(decisionsOf(gov), key, decision, by, now) };
}
