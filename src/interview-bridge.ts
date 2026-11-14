/**
 * Bridge between the sandboxed Recruiting Workbench Space and the app, for the online interview.
 * The Space has no network, so it asks by postMessage. Three fixed requests can pass, nothing else:
 *  - iv:ask-request    a prompt for the AI check, the summary, the letter, the rubric levels or the thank-you line, run by the agent (Joule; the model provider is OpenRouter).
 *                      The first words of the prompt must match its kind, so this is not a general chat channel.
 *  - iv:save-request   the record for the hiring manager (main process, database; the agent has no tool for it).
 *  - iv:assess-save-request / iv:assess-list-request  one revision of the rubric assessment (application interview), and the saved revisions.
 *                      Main process, database, only for the hiring manager; the agent has no tool for either.
 *  - iv:listen-probe / iv:listen-start / iv:listen-stop / iv:listen-cancel  the microphone of the live avatar. The app records between start and stop, turns the audio into text
 *                      (speech service) and returns only the text. The audio is not kept. The app shows a badge while the microphone is on and stops it after two minutes.
 *  - iv:draft-request  the letter as a Gmail DRAFT. The Gmail connector cannot send; the hiring manager sends it from Gmail.
 * The interviewee's address is used for the draft only and is stored nowhere.
 */
import type { BridgeCall } from './sub4me-bridge.ts';

export const INTERVIEW_SPACE = 'recruiting-workbench';
const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const SESSION = /^[A-Z0-9-]{4,24}$/;
const REQUISITION = /^[A-Z]{2,5}-[0-9]{3,6}$/;
const MAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[A-Za-z]{2,}$/;
export const MAX_PROMPT = 16000;
const START: Record<string, RegExp> = {
  check: /^You check one task result against fixed criteria\./,
  summary: /^Write a short, neutral summary of an online interview/,
  letter: /^Write two short paragraphs of a warm, personal thank-you letter/,
  assess: /^You rate one interview against a fixed rubric\./,
  thanks: /^Write one short sentence for a thank-you e-mail after a job interview\./,
  turn: /^You are the interviewer avatar in a first online job interview for the job "/,
};

export type InterviewDeps = {
  /** Runs one working prompt through the agent and returns its answer ('' = stopped). */
  ask?: (prompt: string, title: string, session: string) => Promise<string>;
  save?: (requisition: string, record: Record<string, unknown>) => Promise<{ saved: boolean; note: string }>;
  saveAssessment?: (requisition: string, record: Record<string, unknown>) => Promise<{ saved: boolean; revision?: number; reviewed?: boolean }>;
  listAssessments?: (requisition: string) => Promise<Record<string, unknown>[]>;
  /** The Gmail connector's create_draft. */
  draft?: BridgeCall;
  /** Microphone and speech-to-text for the live avatar. The Space cannot reach the microphone; the app records only between start and stop and shows that it does. */
  listen?: { start: () => Promise<void>; stop: () => Promise<string>; cancel: () => void };
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const TITLES: Record<string, string> = { check: 'Interview: task check', summary: 'Interview: summary', letter: 'Interview: letter', assess: 'Interview: rubric levels', thanks: 'Interview: thank-you line', turn: 'Interview: avatar turn' };

/** What the agent is told on top of the prompt: no tools, JSON only. */
export function wrapPrompt(prompt: string): string {
  return 'Use no tools and read no files. Reply with the JSON object only, nothing before or after it.\n\n' + prompt;
}

export async function handleInterviewMessage(data: unknown, deps: InterviewDeps): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || typeof data.type !== 'string' || !data.type.startsWith('iv:')) return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'iv:error', requestId, message });
  try {
    if (data.type === 'iv:ask-request') {
      const kind = typeof data.kind === 'string' ? data.kind : '';
      const prompt = typeof data.prompt === 'string' ? data.prompt : '';
      const session = typeof data.session === 'string' && SESSION.test(data.session) ? data.session : '';
      if (!START[kind] || !START[kind].test(prompt)) return fail('This request is not one the interview may send.');
      if (prompt.length > MAX_PROMPT) return fail('The text is too long to check.');
      if (!session) return fail('The session code is not valid.');
      if (!deps.ask) return fail('The agent is not connected yet.');
      const text = await deps.ask(wrapPrompt(prompt), TITLES[kind], 'iv-' + session);
      if (!text) return fail('The check was stopped.');
      return { type: 'iv:ask-answer', requestId, kind, text: text.slice(0, 20000) };
    }
    if (data.type === 'iv:listen-probe') return { type: 'iv:listen-status', requestId, available: !!deps.listen };
    if (data.type === 'iv:listen-start') {
      if (!deps.listen) return fail('The microphone is available in the desktop app only. You can type instead.');
      await deps.listen.start();
      return { type: 'iv:listening', requestId };
    }
    if (data.type === 'iv:listen-stop') {
      if (!deps.listen) return fail('The microphone is available in the desktop app only. You can type instead.');
      const text = await deps.listen.stop();
      return { type: 'iv:heard', requestId, text: String(text ?? '').slice(0, 3000) };
    }
    if (data.type === 'iv:listen-cancel') {
      deps.listen?.cancel();
      return { type: 'iv:listen-cancelled', requestId };
    }
    if (data.type === 'iv:save-request') {
      const requisition = typeof data.requisition === 'string' && REQUISITION.test(data.requisition) ? data.requisition : '';
      if (!requisition || !isObject(data.record)) return fail('The record is not valid.');
      if (!deps.save) return fail('Saving needs the desktop app with the shared database set up.');
      const res = await deps.save(requisition, data.record);
      return { type: 'iv:saved', requestId, saved: res.saved === true, note: String(res.note ?? '').slice(0, 200) };
    }
    if (data.type === 'iv:assess-save-request') {
      const requisition = typeof data.requisition === 'string' && REQUISITION.test(data.requisition) ? data.requisition : '';
      if (!requisition || !isObject(data.record)) return fail('The assessment is not valid.');
      if (!deps.saveAssessment) return fail('Saving needs the desktop app with the shared database set up.');
      const res = await deps.saveAssessment(requisition, data.record);
      return { type: 'iv:assess-saved', requestId, saved: res.saved === true, revision: Number(res.revision) || 0, reviewed: res.reviewed === true };
    }
    if (data.type === 'iv:assess-list-request') {
      const requisition = typeof data.requisition === 'string' && REQUISITION.test(data.requisition) ? data.requisition : '';
      if (!requisition) return fail('The requisition is not valid.');
      if (!deps.listAssessments) return fail('Reading needs the desktop app with the shared database set up.');
      const items = await deps.listAssessments(requisition);
      return { type: 'iv:assess-list', requestId, items: Array.isArray(items) ? items.slice(0, 100) : [] };
    }
    if (data.type === 'iv:draft-request') {
      const to = typeof data.to === 'string' ? data.to.trim() : '';
      const subject = typeof data.subject === 'string' ? data.subject.trim().slice(0, 120) : '';
      const body = typeof data.body === 'string' ? data.body.slice(0, 6000) : '';
      if (!MAIL.test(to) || to.length > 120) return fail('Enter a valid e-mail address.');
      if (!subject || body.length < 40) return fail('The letter is empty.');
      if (!deps.draft) return fail('The Gmail connector is not connected. Import it under Connectors & Skills.');
      await deps.draft('create_draft', { to, subject, body });
      return { type: 'iv:drafted', requestId };
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  return null;
}
