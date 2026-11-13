/**
 * The vocabulary for act B of the Ontology Manager demo ("terms are visible everywhere", docs/ontology-akt-b-concept.md):
 * a small, bounded glossary built from the catalog, and the rule that says which words in a text count as a term.
 * Pure functions, no DOM, no network, no storage. Nothing here writes the catalog; the host (Spaces, chat) decides what to do
 * with a mention.
 */
import { metaOf, statusOf, type Governance, type Mapping, type Ontology, type TermStatus } from './ontology-manager.ts';
import { norm, normMap } from './ontology-usage.ts';

export const MAX_TERMS = 400;
export const MAX_PHRASES = 12;
export const MAX_DEFINITION = 240;
export const MAX_PER_TERM = 2;
export const MAX_PER_PAGE = 200;

export interface GlossaryEntry {
  /** `<slug>|<term id>` */
  key: string;
  label: string;
  /** Label, synonyms and mapped names, without duplicates, at most MAX_PHRASES. */
  phrases: string[];
  definition: string;
  owner: string;
  /** Draft terms are never in the glossary. */
  status: Exclude<TermStatus, 'draft'>;
  /** Label of the term that took the place of a deprecated one; empty otherwise. */
  replacedBy: string;
  mappings: Mapping[];
  ontology: string;
  /** Keys of terms of OTHER ontologies that can be found under one of the same phrases. */
  alsoIn: string[];
}

export interface Glossary { entries: GlossaryEntry[]; /** Terms that did not fit under MAX_TERMS. */ cut: number }

export function shorten(text: string, max = MAX_DEFINITION): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Only approved terms are shown as terms; deprecated ones with a pointer to the replacement; drafts never. */
export function buildGlossary(ontologies: readonly Ontology[], gov: Governance): Glossary {
  const all: GlossaryEntry[] = [];
  for (const o of ontologies) {
    for (const t of o.terms) {
      const status = statusOf(o, gov, t);
      if (status === 'draft') continue;
      const meta = metaOf(gov, o.slug, t.id);
      const seen = new Set<string>();
      const phrases: string[] = [];
      for (const p of [t.label, ...meta.synonyms, ...meta.mappings.map((m) => m.ref)]) {
        const n = norm(p);
        if (!n || seen.has(n) || phrases.length >= MAX_PHRASES) continue;
        seen.add(n); phrases.push(String(p).trim());
      }
      const repl = status === 'deprecated' && meta.replacedBy ? o.terms.find((x) => x.id === meta.replacedBy) : undefined;
      all.push({
        key: `${o.slug}|${t.id}`, label: t.label, phrases, definition: shorten(t.definition), owner: t.owner || '', status,
        replacedBy: status === 'deprecated' ? (repl ? repl.label : meta.replacedBy) : '',
        mappings: meta.mappings.filter((m) => m.ref), ontology: o.title, alsoIn: [],
      });
    }
  }
  const entries = all.slice(0, MAX_TERMS);
  const byPhrase = new Map<string, GlossaryEntry[]>();
  for (const e of entries) for (const p of e.phrases) { const n = norm(p); byPhrase.set(n, [...(byPhrase.get(n) ?? []), e]); }
  const slugOf = (k: string) => k.slice(0, k.indexOf('|'));
  for (const e of entries) {
    const other = new Set<string>();
    for (const p of e.phrases) for (const x of byPhrase.get(norm(p)) ?? []) if (slugOf(x.key) !== slugOf(e.key)) other.add(x.key);
    e.alsoIn = [...other];
  }
  return { entries, cut: all.length - entries.length };
}

// ---------------------------------------------------------------- recognising

/** All capitals, two to six letters (DSO, VAT): found only in exactly this spelling. */
export const isAcronym = (phrase: string): boolean => /^[A-Z]{2,6}$/.test(phrase.trim());

export interface IndexedPhrase { phrase: string; norm: string; acronym: boolean; keys: string[] }
export interface PhraseIndex { phrases: IndexedPhrase[] }

/**
 * What counts as a term in running text. Phrases of two or more words always; acronyms only in capitals; a single everyday
 * word (Customer, Offer) only when `singleWords` is set: that is for the ask-back in the chat, never for marking (in the probe
 * of act A nearly every hit of such a word was wrong). Terms that share a phrase are listed under it together.
 */
export function buildIndex(glossary: Glossary | readonly GlossaryEntry[], opts: { singleWords?: boolean } = {}): PhraseIndex {
  const entries: readonly GlossaryEntry[] = Array.isArray(glossary) ? (glossary as readonly GlossaryEntry[]) : (glossary as Glossary).entries;
  const map = new Map<string, IndexedPhrase>();
  for (const e of entries) {
    for (const p of e.phrases) {
      const acronym = isAcronym(p);
      const n = norm(p);
      if (!acronym && !n.includes(' ') && !opts.singleWords) continue;
      const id = acronym ? `A:${p.trim()}` : `P:${n}`;
      const cur = map.get(id) ?? { phrase: acronym ? p.trim() : n, norm: n, acronym, keys: [] };
      if (!cur.keys.includes(e.key)) cur.keys.push(e.key);
      map.set(id, cur);
    }
  }
  return { phrases: [...map.values()].sort((a, b) => b.phrase.length - a.phrase.length || (a.phrase < b.phrase ? -1 : 1)) };
}

export interface Mention {
  /** Position in the ORIGINAL text, end exclusive. */
  start: number;
  end: number;
  /** The text as written. */
  text: string;
  /** The terms it can mean; more than one means the phrase is ambiguous. */
  keys: string[];
}

/** What has been marked so far on one page, so that several text nodes share one budget. */
export interface Budget { perTerm: Map<string, number>; total: number }
export const newBudget = (): Budget => ({ perTerm: new Map(), total: 0 });

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The mentions in one piece of text, in reading order. Longest phrase first (so "Days Sales Outstanding" wins over any
 * shorter name inside it), no overlaps, at most MAX_PER_TERM per term and MAX_PER_PAGE in total over the same `budget`.
 */
export function findMentions(text: string, index: PhraseIndex, budget: Budget = newBudget()): Mention[] {
  const src = String(text ?? '');
  if (!src.trim() || !index.phrases.length) return [];
  const { norm: n, at } = normMap(src);
  const hits: Array<{ start: number; end: number; keys: string[] }> = [];
  for (const p of index.phrases) {
    if (p.acronym) {
      const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(p.phrase)}(?![A-Za-z0-9])`, 'g');
      for (const m of src.matchAll(re)) hits.push({ start: m.index!, end: m.index! + m[0].length, keys: p.keys });
    } else {
      const re = new RegExp(`(?<![a-z0-9])(${escapeRe(p.norm)}(?:e?s)?)(?![a-z0-9])`, 'g');
      for (const m of n.matchAll(re)) {
        const a = m.index!, b = a + m[1].length;
        hits.push({ start: at[a] ?? 0, end: (at[b - 1] ?? src.length - 1) + 1, keys: p.keys });
      }
    }
  }
  // longest first, then reading order; drop what overlaps something already taken
  hits.sort((x, y) => (y.end - y.start) - (x.end - x.start) || x.start - y.start);
  const taken: typeof hits = [];
  for (const h of hits) if (!taken.some((t) => h.start < t.end && t.start < h.end)) taken.push(h);
  taken.sort((x, y) => x.start - y.start);
  const out: Mention[] = [];
  for (const h of taken) {
    if (budget.total >= MAX_PER_PAGE) break;
    if (h.keys.some((k) => (budget.perTerm.get(k) ?? 0) >= MAX_PER_TERM)) continue;
    for (const k of h.keys) budget.perTerm.set(k, (budget.perTerm.get(k) ?? 0) + 1);
    budget.total++;
    out.push({ start: h.start, end: h.end, text: src.slice(h.start, h.end), keys: h.keys });
  }
  return out;
}

/** Phrases of the chat draft that belong to terms of two ontologies: the ask-back lists their meanings. Single words count here. */
export function ambiguousMentions(text: string, glossary: Glossary | readonly GlossaryEntry[]): Mention[] {
  const entries: readonly GlossaryEntry[] = Array.isArray(glossary) ? (glossary as readonly GlossaryEntry[]) : (glossary as Glossary).entries;
  const slugOf = (k: string) => k.slice(0, k.indexOf('|'));
  return findMentions(text, buildIndex(entries, { singleWords: true }), newBudget())
    .filter((m) => new Set(m.keys.map(slugOf)).size > 1);
}
