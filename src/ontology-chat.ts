/**
 * Terms of the ontology in the chat (act B, step 3, docs/ontology-akt-b-concept.md): the ask-back when a name means something
 * different in two ontologies, the short vocabulary note that can go along with a message, and the text of the card. Pure
 * functions on top of `ontology-glossary.ts`: no DOM, no network, no storage; the tests call everything directly.
 *
 * Nothing here decides for the person: an ambiguous name is never resolved by the app, only by a choice the person made
 * (`Choices`), and the vocabulary note leaves out every name that is still ambiguous.
 */
import { ambiguousMentions, buildIndex, findMentions, isAcronym, newBudget, shorten, MAX_DEFINITION, type Glossary, type GlossaryEntry, type Mention } from './ontology-glossary.ts';
import { norm } from './ontology-usage.ts';

export const MAX_CONTEXT_TERMS = 5;
/** Marks the choice "none of these": the name stays unresolved and is left out of the vocabulary note. */
export const NONE = 'none';

/** Choices of one conversation, by name group (`groupId`) → the key of the chosen term, or NONE. */
export type Choices = Record<string, string>;

const entriesOf = (g: Glossary | readonly GlossaryEntry[]): readonly GlossaryEntry[] => (Array.isArray(g) ? (g as readonly GlossaryEntry[]) : (g as Glossary).entries);
const slugOf = (key: string) => key.slice(0, key.indexOf('|'));

/** The same name group always gets the same id, whatever the spelling in the text. */
export const groupId = (keys: readonly string[]): string => [...keys].sort().join('+');

export interface AskOption { key: string; label: string; ontology: string; definition: string }
export interface Ambiguity {
  id: string;
  /** The name as the person wrote it (first occurrence). */
  text: string;
  options: AskOption[];
}

const optionOf = (e: GlossaryEntry): AskOption => ({ key: e.key, label: e.label, ontology: e.ontology, definition: e.definition });

/** Names in the draft that mean something different in two ontologies and that the person has not decided yet. */
export function pendingChoices(text: string, glossary: Glossary | readonly GlossaryEntry[], choices: Choices): Ambiguity[] {
  const byKey = new Map(entriesOf(glossary).map((e) => [e.key, e]));
  const out: Ambiguity[] = [];
  for (const m of ambiguousMentions(text, glossary)) {
    const id = groupId(m.keys);
    if (choices[id] !== undefined || out.some((x) => x.id === id)) continue;
    const options = m.keys.map((k) => byKey.get(k)).filter((e): e is GlossaryEntry => Boolean(e)).map(optionOf);
    if (options.length > 1) out.push({ id, text: m.text, options });
  }
  return out;
}

/** The choice the person made; a key that is not one of the options (or NONE) is not accepted. */
export function choose(choices: Choices, ambiguity: Ambiguity, key: string): Choices {
  if (key !== NONE && !ambiguity.options.some((o) => o.key === key)) return choices;
  return { ...choices, [ambiguity.id]: key };
}

/** Visible labels for the message: "Customer = Sales ontology". Names the person skipped get no label. */
export function choiceLabels(text: string, glossary: Glossary | readonly GlossaryEntry[], choices: Choices): string[] {
  const byKey = new Map(entriesOf(glossary).map((e) => [e.key, e]));
  const out: string[] = [];
  for (const m of ambiguousMentions(text, glossary)) {
    const key = choices[groupId(m.keys)];
    const e = key && key !== NONE ? byKey.get(key) : undefined;
    if (!e || !m.keys.includes(e.key)) continue;
    const label = `${m.text.trim()} = ${e.ontology}`;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

// ---------------------------------------------------------------- vocabulary note for the model

/** A name that is marked in a text by the usual rules: two or more words, or a capital acronym. */
const markable = (text: string): boolean => isAcronym(text) || norm(text).includes(' ');

export interface TermContext { lines: string[]; keys: string[]; /** Terms that did not fit under MAX_CONTEXT_TERMS. */ cut: number }

/**
 * One line per term in the message, for the model: name, ontology, status and definition. Owners are left out (the text goes
 * to the model provider). A name that is still ambiguous is left out too; a single everyday word counts only where two ontologies
 * share it and the person chose a meaning for it.
 */
export function termContext(text: string, glossary: Glossary | readonly GlossaryEntry[], choices: Choices): TermContext {
  const entries = entriesOf(glossary);
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const index = buildIndex(entries, { singleWords: true });
  const keys: string[] = [];
  for (const m of findMentions(text, index, newBudget())) {
    let key: string | undefined;
    if (m.keys.length > 1 && new Set(m.keys.map(slugOf)).size > 1) {
      const chosen = choices[groupId(m.keys)];
      key = chosen && chosen !== NONE && m.keys.includes(chosen) ? chosen : undefined;
    } else if (markable(m.text)) key = m.keys[0];
    if (key && !keys.includes(key)) keys.push(key);
  }
  const lines = keys.slice(0, MAX_CONTEXT_TERMS).map((k) => {
    const e = byKey.get(k)!;
    const state = e.status === 'deprecated' ? `deprecated${e.replacedBy ? `, now: ${e.replacedBy}` : ''}` : 'approved';
    return shorten(`- ${e.label} (${e.ontology}, ${state}): ${e.definition || 'no definition yet'}`, MAX_DEFINITION + 80);
  });
  return { lines, keys: keys.slice(0, MAX_CONTEXT_TERMS), cut: Math.max(0, keys.length - MAX_CONTEXT_TERMS) };
}

/** The block added to the prompt; empty when there is nothing to say. */
export function termsNote(ctx: TermContext): string {
  if (!ctx.lines.length) return '';
  return ['VOCABULARY — definitions from the company ontology for terms used in the message below. Use them as given; do not invent other meanings.', ...ctx.lines].join('\n');
}

// ---------------------------------------------------------------- the card

export interface CardItem { key: string; title: string; status: string; definition: string; meta: string[]; ontology: string }

/** What the card shows for one term: the same facts as in the Spaces (definition, status, owner, synonyms, mapping). */
export function describeEntry(e: GlossaryEntry): CardItem {
  const synonyms = e.phrases.filter((p) => norm(p) !== norm(e.label)).slice(0, 6);
  const meta = [`Owner: ${e.owner || 'Not assigned'} · ${e.ontology}`];
  if (synonyms.length) meta.push(`Also called: ${synonyms.join(', ')}`);
  for (const m of e.mappings.slice(0, 3)) meta.push(`${m.system}: ${m.ref}`);
  return {
    key: e.key, title: e.label, ontology: e.ontology, meta,
    status: e.status === 'deprecated' ? `Deprecated${e.replacedBy ? `, replaced by ${e.replacedBy}` : ''}` : 'Approved',
    definition: e.definition || 'No definition yet.',
  };
}

/** Splits a text into plain and marked pieces (for the person's own message). */
export function splitByMentions(text: string, mentions: readonly Mention[]): Array<{ text: string; keys?: string[] }> {
  const out: Array<{ text: string; keys?: string[] }> = [];
  let pos = 0;
  for (const m of mentions) {
    if (m.start > pos) out.push({ text: text.slice(pos, m.start) });
    out.push({ text: text.slice(m.start, m.end), keys: m.keys });
    pos = m.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}
