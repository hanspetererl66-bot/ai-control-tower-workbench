/**
 * Bridge between the sandboxed Spec Builder Space and the app. Two fixed requests can pass, nothing else:
 *  - spec:draft-request  a prompt that starts with the fixed sentence DRAFT_START (so this is not a general chat channel), at most 16,000
 *                        characters. The agent runs it in a conversation of its own, without tools, and the plain-text answer comes back
 *                        as spec:draft-answer (cut to 6,000 characters). Nothing is written, sent or stored anywhere.
 *  - spec:export-docx    the confirmed document as a Word file: only with `confirmed: true`, only through the save dialog of the app.
 * Errors come back as spec:error (draft) or spec:exported with ok: false (Word). The Space shows the draft as a proposal that a person checks.
 */
import { wrapBriefPrompt } from './renewals-bridge.ts';
import { exportDocxReply, type PrdHost } from './prd-bridge.ts';

export const SPEC_SPACE = 'spec-builder';
export const MAX_DRAFT_PROMPT = 16_000;
export const MAX_DRAFT_ANSWER = 6_000;
export const DRAFT_START = /^You draft one section of a software specification document\./;
export const DRAFT_TITLE = 'Specification draft';
const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type SpecDeps = PrdHost & {
  /** Runs one working prompt through the agent and returns its answer ('' = stopped). */
  ask?: (prompt: string, title: string, session: string) => Promise<string>;
};

export async function handleSpecMessage(data: unknown, deps: SpecDeps): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || typeof data.type !== 'string') return null;
  if (data.type === 'spec:export-docx') return exportDocxReply(data, deps, 'spec:exported');
  if (data.type !== 'spec:draft-request') return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'spec:error', requestId, message });
  try {
    const prompt = typeof data.prompt === 'string' ? data.prompt : '';
    if (!DRAFT_START.test(prompt)) return fail('This request is not one the Spec Builder may send.');
    if (prompt.length > MAX_DRAFT_PROMPT) return fail('The draft request is too long.');
    if (!deps.ask) return fail('The agent is not connected yet.');
    // No session key: every draft gets a conversation of its own, earlier drafts do not flow into the next one.
    const text = await deps.ask(wrapBriefPrompt(prompt), DRAFT_TITLE, '');
    const clean = String(text ?? '').replace(/\u0000/g, '').trim();
    if (!clean) return fail('The draft was stopped.');
    return { type: 'spec:draft-answer', requestId, text: clean.slice(0, MAX_DRAFT_ANSWER) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
