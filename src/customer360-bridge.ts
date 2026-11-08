/**
 * Bridge between the sandboxed Customer 360 Space and the app, for the live Cognee question.
 * The Space has no network, so it asks by postMessage. One fixed request can pass, nothing else:
 *  - c360:ask-request   one question (max 300 characters). The agent is told to search the Cognee memory (tool `recall`) and to answer
 *                       with a short JSON object: the answer and the node ids of the documents it used. Nothing is written anywhere.
 * The answer is cut down and its ids are checked for shape; the Space drops ids that are not in its graph.
 * If Cognee is not installed or the corpus is not loaded the agent says so and the Space falls back to its local ranking.
 */
export const CUSTOMER360_SPACE = 'customer-360';
export const MAX_QUESTION = 300;
export const MAX_ANSWER = 1200;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const NODE_ID = /^(group|entity|contact|contract|product|opportunity|order|invoice|pay|ticket|signal|rec):[A-Za-z0-9._-]{1,40}$/;

export type Customer360Deps = {
  /** Runs one working prompt through the agent and returns its answer ('' = stopped). */
  ask?: (prompt: string, title: string, session: string) => Promise<string>;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The prompt the agent gets. Read-only: the only tool it may use is the memory search. */
export function askPrompt(question: string): string {
  return [
    'Use only the Cognee memory tool "recall" to search the dataset "customer-360" (a fictional customer group, documents with ids in brackets such as (opportunity:O-7103)).',
    'Do not write, remember or forget anything and do not use any other tool.',
    'Answer the question in at most four sentences, only from what recall returns. Mark any conclusion that is not stated in a document with the word Inference.',
    'Reply with a JSON object only: {"answer": "<text>", "ids": ["<id of each document you used>"]}. If recall is not available or finds nothing, reply {"answer": "", "ids": []}.',
    '',
    'Question: ' + question,
  ].join('\n');
}

/** Reads the agent's reply: tolerant about fences and text around the object, strict about the shape. */
export function parseAnswer(text: string): { answer: string; ids: string[] } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!isObject(raw) || typeof raw.answer !== 'string' || !Array.isArray(raw.ids)) return null;
  const ids = [...new Set(raw.ids.filter((i): i is string => typeof i === 'string' && NODE_ID.test(i)))].slice(0, 12);
  const answer = raw.answer.trim().slice(0, MAX_ANSWER);
  if (!answer && !ids.length) return null;
  return { answer, ids };
}

export async function handleCustomer360Message(data: unknown, deps: Customer360Deps): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || data.type !== 'c360:ask-request') return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'c360:error', requestId, message });
  const question = typeof data.question === 'string' ? data.question.replace(/\s+/g, ' ').trim() : '';
  if (!question || question.length > MAX_QUESTION) return fail('The question is empty or too long.');
  if (!deps.ask) return fail('The agent is not connected yet.');
  try {
    const text = await deps.ask(askPrompt(question), 'Customer 360: Cognee question', '');
    if (!text) return fail('The question was stopped.');
    const parsed = parseAnswer(text);
    if (!parsed) return fail('Cognee returned nothing usable (is the Cognee connector installed and the corpus loaded?).');
    return { type: 'c360:ask-answer', requestId, answer: parsed.answer, ids: parsed.ids };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
