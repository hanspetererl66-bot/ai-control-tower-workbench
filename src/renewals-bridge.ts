/**
 * Bridge between the sandboxed Renewals Space and the app, for the briefing of one renewal.
 * The Space has no network, so it asks by postMessage. One fixed request can pass, nothing else:
 *  - rn:brief-request   a prompt that starts with the fixed sentence BRIEF_START (so this is not a general chat channel), at most 16,000
 *                       characters. The agent runs it in a conversation of its own, without tools, and the plain-text answer comes back
 *                       as rn:brief-answer (cut to 6,000 characters). Nothing is written, sent or stored anywhere.
 * Errors (agent missing or busy, stopped, bad request) come back as rn:error with a message the page shows.
 * The Space shows the text as plain text and as a draft; a person checks it. The model provider is the one the agent uses.
 */
export const RENEWALS_SPACE = 'renewals';
export const MAX_BRIEF_PROMPT = 16_000;
export const MAX_BRIEF_ANSWER = 6_000;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
/** The first sentence every briefing prompt must start with. */
export const BRIEF_START = /^You prepare an account executive for a renewal talk\./;
export const BRIEF_TITLE = 'Renewal briefing';

export type RenewalsDeps = {
  /** Runs one working prompt through the agent and returns its answer ('' = stopped). */
  ask?: (prompt: string, title: string, session: string) => Promise<string>;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What the agent gets: no tools, no files, plain text. The Space's own prompt follows. */
export function wrapBriefPrompt(prompt: string): string {
  return 'Use no tools and read no files. Reply in plain text only, no JSON and no tables.\n\n' + prompt;
}

export async function handleRenewalsMessage(data: unknown, deps: RenewalsDeps): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || data.type !== 'rn:brief-request') return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'rn:error', requestId, message });
  try {
    if (data.kind !== 'brief') return fail('This request is not one the renewals page may send.');
    const prompt = typeof data.prompt === 'string' ? data.prompt : '';
    if (!BRIEF_START.test(prompt)) return fail('This request is not one the renewals page may send.');
    if (prompt.length > MAX_BRIEF_PROMPT) return fail('The briefing request is too long.');
    if (!deps.ask) return fail('The agent is not connected yet.');
    // No session key: every briefing gets a conversation of its own, earlier briefings do not flow into the next one.
    const text = await deps.ask(wrapBriefPrompt(prompt), BRIEF_TITLE, '');
    const clean = String(text ?? '').replace(/\u0000/g, '').trim();
    if (!clean) return fail('The briefing was stopped.');
    return { type: 'rn:brief-answer', requestId, text: clean.slice(0, MAX_BRIEF_ANSWER) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
