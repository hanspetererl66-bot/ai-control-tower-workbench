/**
 * Where the register card lives and how it is changed. Pure functions, no network.
 *
 * The card is stored as a file `register.json` in the work item (like `policy.json`), so every revision carries the card as it
 * was, the registry can compare and restore it, and the project sync can keep it: the sync rewrites `project.json`, the
 * documents and `policy.json` from the project, but it cannot know the card, so on every push it reads `register.json` from the
 * newest revision and sends it along (work-sync.ts). `intent.register` repeats the card so that the list can show it without
 * reading files.
 *
 * Like the rest of the register this declares and enforces nothing. A field nobody typed stays "not declared".
 */
import {
  CRITICALITY_LABEL, DISCOVERY_LABEL, PHASE_LABEL, PHASES, RISK_LABEL, VERIFICATION_LABEL, sanitizeCard, type RegisterCard,
} from './registry-card.ts';

export const REGISTER_PATH = 'register.json';
export const REGISTER_FORMAT = 'werkbank.register-card.v1';

export type FileLike = { path: string; content?: string; language?: string };

/** A card with nothing declared: the starting point of the editor. Same least-favourable defaults as the reader. */
export function emptyCard(): RegisterCard {
  return sanitizeCard({})!;
}

export function registerFile(card: RegisterCard): { path: string; content: string; language: string } {
  return { path: REGISTER_PATH, content: JSON.stringify({ format: REGISTER_FORMAT, card }), language: 'json' };
}

/** The card inside a list of files, or null when there is none or it cannot be read. */
export function registerFrom(files: FileLike[]): RegisterCard | null {
  const text = files.find((f) => f.path === REGISTER_PATH)?.content;
  if (!text) return null;
  try {
    const doc = JSON.parse(text);
    return doc?.format === REGISTER_FORMAT ? sanitizeCard(doc.card) : null;
  } catch { return null; }
}

/** The same files with the card put in (or replaced). Every other file is copied exactly. */
export function withRegister<T extends FileLike>(files: T[], card: RegisterCard): Array<T | ReturnType<typeof registerFile>> {
  return [...files.filter((f) => f.path !== REGISTER_PATH), registerFile(card)];
}

// ---------- changing a card ----------

const addMonths = (isoDay: string, months: number): string => {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/**
 * "I checked this and it is right": sets the verification, who and when, and the next review (default six months). Does not touch
 * anything else. Identity is only what the person types (the app has no sign-in yet), so `by` is a name or an e-mail address as typed.
 */
export function markVerified(card: RegisterCard, by: string, today: string, months = 6): RegisterCard {
  return { ...card, verification: 'verified', verifiedBy: by.trim().slice(0, 120), verifiedAt: today, reviewDue: addMonths(today, months) };
}

/** What a person must still fix before the card is saved. Not about whether the content is true, only about whether it hangs together. */
export function cardProblems(c: RegisterCard): string[] {
  const out: string[] = [];
  if (c.verification === 'verified' && (!c.verifiedBy || !c.verifiedAt)) out.push('A verified entry needs who verified it and when.');
  if (c.verifiedAt && c.reviewDue && c.reviewDue <= c.verifiedAt) out.push('The next review must be after the day it was verified.');
  if (c.risk === 'high' && !c.riskReason) out.push('A high risk class needs a reason.');
  const dated = PHASES.filter((p) => c.dates[p]);
  for (let i = 1; i < dated.length; i++) if (c.dates[dated[i]]! < c.dates[dated[i - 1]]!) out.push(`${PHASE_LABEL[dated[i]]} is dated before ${PHASE_LABEL[dated[i - 1]]}.`);
  const seen = new Set<string>();
  for (const r of c.relations) {
    const k = `${r.kind}:${r.name.toLowerCase()}`;
    if (seen.has(k)) out.push(`"${r.name}" is listed twice.`);
    seen.add(k);
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The names of the groups that differ, for the revision note ("Register card: lifecycle, risk"). Empty when nothing differs. */
export function cardChanges(before: RegisterCard | null, after: RegisterCard): string[] {
  const b = before ?? emptyCard();
  const out: string[] = [];
  if (b.purpose !== after.purpose) out.push('purpose');
  if (b.organization !== after.organization || b.steward !== after.steward || b.provider !== after.provider || b.discovery !== after.discovery) out.push('ownership');
  if (b.phase !== after.phase || !same(b.dates, after.dates)) out.push('lifecycle');
  if (b.criticality !== after.criticality) out.push('criticality');
  if (b.verification !== after.verification || b.verifiedBy !== after.verifiedBy || b.verifiedAt !== after.verifiedAt || b.reviewDue !== after.reviewDue) out.push('verification');
  if (b.risk !== after.risk || b.riskReason !== after.riskReason) out.push('risk');
  if (!same(b.relations, after.relations)) out.push('connections');
  if (!same(b.tags, after.tags)) out.push('tags');
  return out;
}

export function cardNote(before: RegisterCard | null, after: RegisterCard): string {
  const c = cardChanges(before, after);
  return c.length ? `Register card: ${c.join(', ')}` : 'Register card saved';
}

/** One readable line per declared value, for the diff of a revision (register.json itself is a single line of JSON). */
export function cardLines(c: RegisterCard | null): string[] {
  if (!c) return [];
  const rows: Array<[string, string]> = [
    ['purpose', c.purpose], ['organization', c.organization], ['accountable', c.steward], ['runs on', c.provider], ['origin', DISCOVERY_LABEL[c.discovery]],
    ['phase', c.phase ? PHASE_LABEL[c.phase] : ''], ['criticality', c.criticality ? CRITICALITY_LABEL[c.criticality] : ''],
    ['verification', VERIFICATION_LABEL[c.verification]], ['verified by', c.verifiedBy], ['verified on', c.verifiedAt], ['next review', c.reviewDue],
    ['risk class', RISK_LABEL[c.risk]], ['risk reason', c.riskReason], ['tags', c.tags.join(', ')],
  ];
  for (const p of PHASES) if (c.dates[p]) rows.push([`date ${PHASE_LABEL[p].toLowerCase()}`, c.dates[p]!]);
  for (const r of c.relations) rows.push([`${r.kind}`, `${r.name}${r.access ? ` (${r.access})` : ''}${r.note ? ` – ${r.note}` : ''}`]);
  return rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
}
