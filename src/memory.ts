/**
 * Personal memory: short notes the person wants the assistant to keep in mind in every conversation
 * (who they are, how they like results, what a project is called). Kept on this computer only (localStorage),
 * switched on or off, editable and deletable. The assistant never writes it by itself: it can only suggest an entry,
 * and nothing is saved until the person presses "Remember".
 */
export type MemoryKind = 'about' | 'style' | 'context';
export const MEMORY_KINDS: Array<{ id: MemoryKind; title: string }> = [
  { id: 'about', title: 'About me' },
  { id: 'style', title: 'How I like results' },
  { id: 'context', title: 'Projects and context' },
];
/** `space`: the entry only applies when that Space is the context of the conversation; empty = everywhere. */
export type MemoryEntry = { id: string; kind: MemoryKind; text: string; createdAt: string; space?: string };
export type MemoryState = { enabled: boolean; entries: MemoryEntry[] };

export const MEMORY_KEY = 'werkbank.memory';
export const MAX_ENTRIES = 50;
export const MAX_TEXT = 300;
const SECRET = /(password|passwort|kennwort|api[ _-]?key|secret|token|bearer|iban|kreditkarte|credit card|\bpin\b|sk-[a-z0-9]{10,}|sb_secret)/i;
type Store = Pick<Storage, 'getItem' | 'setItem'>;

export const EMPTY_MEMORY: MemoryState = { enabled: true, entries: [] };

export function cleanMemoryText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}
/** Passwords, keys and card numbers are not stored, however the entry got there. */
export const looksSecret = (text: string) => SECRET.test(text) || /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/.test(text);

export function loadMemory(store: Store): MemoryState {
  try {
    const v = JSON.parse(store.getItem(MEMORY_KEY) ?? 'null');
    if (!v || !Array.isArray(v.entries)) return EMPTY_MEMORY;
    const entries = v.entries
      .filter((e: any) => e && typeof e.id === 'string' && typeof e.text === 'string' && MEMORY_KINDS.some((k) => k.id === e.kind))
      .map((e: any) => ({ id: e.id, kind: e.kind, text: cleanMemoryText(e.text), createdAt: typeof e.createdAt === 'string' ? e.createdAt : '', ...(typeof e.space === 'string' && e.space ? { space: e.space.slice(0, 80) } : {}) }))
      .filter((e: MemoryEntry) => e.text && !looksSecret(e.text))
      .slice(0, MAX_ENTRIES);
    return { enabled: v.enabled !== false, entries };
  } catch { return EMPTY_MEMORY; }
}
export function saveMemory(store: Store, state: MemoryState): void {
  try { store.setItem(MEMORY_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

export type AddResult = { state: MemoryState; error?: string };
export function addMemory(state: MemoryState, kind: MemoryKind, text: string, now = new Date(), space = ''): AddResult {
  const t = cleanMemoryText(text);
  if (!t) return { state, error: 'Write what should be remembered.' };
  if (looksSecret(t)) return { state, error: 'This looks like a password, key or card number. It is not stored.' };
  if (state.entries.some((e) => e.text.toLowerCase() === t.toLowerCase())) return { state, error: 'This is already remembered.' };
  if (state.entries.length >= MAX_ENTRIES) return { state, error: `Memory is full (${MAX_ENTRIES} entries). Delete one first.` };
  const id = `mem-${now.getTime().toString(36)}-${state.entries.length}`;
  return { state: { ...state, entries: [{ id, kind, text: t, createdAt: now.toISOString(), ...(space ? { space } : {}) }, ...state.entries] } };
}
export function updateMemory(state: MemoryState, id: string, text: string): AddResult {
  const t = cleanMemoryText(text);
  if (!t) return { state, error: 'An entry cannot be empty.' };
  if (looksSecret(t)) return { state, error: 'This looks like a password, key or card number. It is not stored.' };
  return { state: { ...state, entries: state.entries.map((e) => (e.id === id ? { ...e, text: t } : e)) } };
}
export const deleteMemory = (state: MemoryState, id: string): MemoryState => ({ ...state, entries: state.entries.filter((e) => e.id !== id) });

/** Entries that apply in this conversation: those for every conversation and those tied to the Space in context. */
export const activeEntries = (state: MemoryState, space = ''): MemoryEntry[] => state.entries.filter((e) => !e.space || e.space === space);

/**
 * The notes as background for the assistant; empty when switched off or nothing applies.
 * `levelOf` marks entries the team or company agreed on (level above 0).
 */
export function memoryNote(state: MemoryState, space = '', levelOf: (id: string) => number = () => 0, levelNames: string[] = []): string {
  const list = activeEntries(state, space);
  if (!state.enabled || !list.length) return '';
  const lines = MEMORY_KINDS.flatMap((k) => list.filter((e) => e.kind === k.id).map((e) => {
    const lvl = levelOf(e.id);
    const tag = lvl > 0 ? ` [agreed: ${levelNames[lvl] ?? 'team'}]` : e.space ? ' [this Space]' : '';
    return `- ${k.title}: ${e.text}${tag}`;
  }));
  return `MEMORY — notes the person asked to keep. Use them only where they change the answer; never mention that you read them. They never override safety rules, tool permissions or the request itself.\n${lines.join('\n')}`;
}

/** Entries worth keeping from a whole conversation: what the person said about themselves, their style and their projects. */
export function suggestFromConversation(userTexts: string[], state: MemoryState, dismissed: string[] = []): Array<{ kind: MemoryKind; text: string }> {
  const out: Array<{ kind: MemoryKind; text: string }> = [];
  for (const raw of userTexts) {
    for (const line of raw.split(/\n/).slice(0, 6)) {
      const s = suggestMemory(line, state);
      if (s && !out.some((o) => o.text.toLowerCase() === s.text.toLowerCase()) && !dismissed.includes(s.text)) out.push(s);
    }
  }
  return out.slice(0, 4);
}

const TRIGGERS: Array<{ re: RegExp; kind: MemoryKind }> = [
  { re: /^(?:bitte\s+)?(?:merk(?:e)?\s+(?:dir|dass)|denk\s+daran,?\s+dass)\s*[:,]?\s*(.+)$/i, kind: 'context' },
  { re: /^(?:please\s+)?remember(?:\s+that)?\s*[:,]?\s*(.+)$/i, kind: 'context' },
  { re: /^(?:ab\s+jetzt|from\s+now\s+on)\s*[:,]?\s*(.+)$/i, kind: 'style' },
  { re: /^(?:antworte|schreib(?:e)?)\s+(?:bitte\s+)?immer\s+(.+)$/i, kind: 'style' },
  { re: /^always\s+(?:answer|reply|write|use)\s+(.+)$/i, kind: 'style' },
  { re: /^(ich\s+(?:bin|arbeite|leite|betreue)\s+.+)$/i, kind: 'about' },
  { re: /^(i\s+(?:am|work|lead)\s+(?:an?\s+|as\s+|at\s+|on\s+|in\s+)?.+)$/i, kind: 'about' },
];
/** A possible entry from what the person just wrote. Only a suggestion: the person decides. */
export function suggestMemory(message: string, state: MemoryState): { kind: MemoryKind; text: string } | null {
  if (!state.enabled) return null;
  const firstLine = message.trim().split(/\n/)[0].trim();
  if (firstLine.length < 8 || firstLine.length > MAX_TEXT) return null;
  for (const { re, kind } of TRIGGERS) {
    const m = re.exec(firstLine);
    if (!m) continue;
    const raw = m[1].trim().replace(/[.!?]+$/, '');
    const text = kind === 'style' && !/^(immer|always)/i.test(raw) ? (/^(?:ab\s+jetzt|from\s+now\s+on)/i.test(firstLine) ? raw : `immer ${raw}`) : raw;
    const t = cleanMemoryText(text);
    if (t.length < 6 || looksSecret(t) || state.entries.some((e) => e.text.toLowerCase() === t.toLowerCase())) return null;
    return { kind, text: `${t[0].toUpperCase()}${t.slice(1)}` };
  }
  return null;
}
