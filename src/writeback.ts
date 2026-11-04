/**
 * Writing back to Jira: after something was built from Jira tickets, the person can note it on those tickets
 * (a label and one comment). Nothing is written without the person's confirmation: the registry shows the label and the
 * exact comment first, and the agent receives a prompt that allows exactly these two changes on exactly these tickets.
 * The Jira connector (0.2.0) has the tools jira_add_labels and jira_add_comment; Werkbank never gets the Jira token.
 */
import { stageText, TYPE_LABEL, type RItem } from './registry.ts';
import type { SourceRef } from './requirements.ts';

export const BASE_LABEL = 'werkbank';
export const MAX_TICKETS = 20;

/** The Jira tickets an item came from (at most MAX_TICKETS). */
export const ticketsOf = (item: Pick<RItem, 'refs'>): SourceRef[] => item.refs.filter((r) => r.source === 'jira' && /^[A-Z][A-Z0-9_]{1,19}-\d{1,8}$/.test(r.key)).slice(0, MAX_TICKETS);

/** Labels: one for all, one for the type. Jira labels have no spaces. */
export const labelsFor = (item: Pick<RItem, 'type'>): string[] => [BASE_LABEL, `${BASE_LABEL}-${item.type}`];

/** The first characters of the comment name the registry entry; the agent uses it to see that the ticket was noted already. */
export const markerOf = (item: Pick<RItem, 'id'>): string => `[Werkbank ${item.id.slice(0, 8)}]`;

export function commentFor(item: Pick<RItem, 'id' | 'type' | 'name' | 'rev' | 'stage' | 'approved' | 'extendsItem'>): string {
  const state = stageText(item);
  return [
    `${markerOf(item)} This requirement was picked up in the Werkbank as ${TYPE_LABEL[item.type].toLowerCase()} "${item.name}".`,
    `${item.extendsItem ? `It extends "${item.extendsItem.name}". ` : ''}Registry entry ${item.id}, revision ${item.rev}${state ? `, ${state}` : ''}.`,
    'Added from the Werkbank after the owner confirmed it. The registry keeps the full history.',
  ].join('\n');
}

export function writebackPrompt(keys: string[], labels: string[], comment: string): string {
  return [
    'The owner has confirmed that these Jira tickets get a note. Do exactly this and nothing else.',
    `Tickets: ${keys.join(', ')}`,
    `Labels to add: ${labels.join(', ')}`,
    'Comment text (pass it exactly as it stands between the markers, do not shorten or reword it):',
    '<<<COMMENT',
    comment,
    'COMMENT>>>',
    '',
    'For each ticket, in this order:',
    '1. jira_get_issue. If the labels already contain all of the labels, skip adding them. If a comment already starts with the first characters of the comment text above (the part in square brackets), skip the comment.',
    '2. Otherwise jira_add_labels with the labels, then jira_add_comment with the comment text.',
    'Use only jira_get_issue, jira_add_labels and jira_add_comment. Never change the status, the assignee, the description or any other field, never create or delete anything, and never touch a ticket that is not in the list. If a tool is missing or a call fails, report it for that ticket and go on with the next one.',
    'Answer with one JSON object only, inside a ```json block, no other text:',
    '{"results":[{"key":"ABC-1","labelled":true,"commented":true,"skipped":"<empty, or why something was skipped>","error":"<empty, or what failed>"}]}',
  ].join('\n');
}

export type WriteResult = { key: string; labelled: boolean; commented: boolean; skipped: string; error: string };

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The per-ticket result of an answer; every asked ticket appears exactly once (missing ones count as not done). null = not readable. */
export function parseWriteback(text: string, keys: string[]): WriteResult[] | null {
  const fence = /```[\w-]*[^\n]*\n([\s\S]*?)\n```/.exec(text);
  const start = text.search(/[{[]/);
  const body = fence ? fence[1] : start >= 0 ? text.slice(start, Math.max(text.lastIndexOf('}'), text.lastIndexOf(']')) + 1) : '';
  let raw: any;
  try { raw = JSON.parse(body); } catch { return null; }
  const list: unknown = Array.isArray(raw) ? raw : raw?.results;
  if (!Array.isArray(list)) return null;
  const byKey = new Map<string, WriteResult>();
  for (const r of list as any[]) {
    const key = cut(r?.key, 30).toUpperCase();
    if (!keys.includes(key) || byKey.has(key)) continue; // a ticket that was not asked for is ignored
    byKey.set(key, { key, labelled: r.labelled === true, commented: r.commented === true, skipped: cut(r.skipped, 200), error: cut(r.error, 200) });
  }
  return keys.map((key) => byKey.get(key) ?? { key, labelled: false, commented: false, skipped: '', error: 'No answer for this ticket.' });
}

/** A ticket counts as noted when the comment is there (written now, or skipped because it was there before). */
export const isDone = (r: WriteResult): boolean => !r.error && (r.commented || /comment|already|noted/i.test(r.skipped));

export function summaryOf(results: WriteResult[]): string {
  const done = results.filter(isDone).length;
  const failed = results.filter((r) => r.error);
  return `${done} of ${results.length} ticket${results.length === 1 ? '' : 's'} noted${failed.length ? `; failed: ${failed.map((r) => `${r.key} (${r.error})`).join(', ')}` : ''}.`.slice(0, 600);
}

// ---------- what was written, on this computer ----------

export const LOG_KEY = 'werkbank.jiraWriteback.v1';
export type Log = Record<string, { at: number; rev: number }>;
const logKey = (itemId: string, ticket: string) => `${itemId}:${ticket}`;

export function loadLog(store: Pick<Storage, 'getItem'>): Log {
  try {
    const raw = JSON.parse(store.getItem(LOG_KEY) ?? '{}');
    const out: Log = {};
    for (const [k, v] of Object.entries(raw ?? {}) as Array<[string, any]>) if (/^[\w-]{1,60}:[A-Z][A-Z0-9_]{1,19}-\d{1,8}$/.test(k) && Number(v?.at) > 0) out[k] = { at: Number(v.at), rev: Number(v.rev) || 0 };
    return out;
  } catch { return {}; }
}
export function saveLog(store: Pick<Storage, 'setItem'>, log: Log): void { try { store.setItem(LOG_KEY, JSON.stringify(log)); } catch { /* ignore */ } }
export function record(log: Log, itemId: string, rev: number, results: WriteResult[], now = Date.now()): Log {
  const out = { ...log };
  for (const r of results) if (isDone(r)) out[logKey(itemId, r.key)] = { at: now, rev };
  return out;
}
export const notedAt = (log: Log, itemId: string, ticket: string): { at: number; rev: number } | null => log[logKey(itemId, ticket)] ?? null;
