/**
 * Bridge between the sandboxed Sales Space (tab Knowledge) and the app, for the live Cognee question about one deal.
 * The Space has no network, so it asks by postMessage. One fixed request can pass, nothing else:
 *  - sales:knowledge-request   a deal id. The agent is told to search the Cognee dataset "sales-deals" (tool `recall`) and to answer with a
 *                              short JSON object: the answer and the ids of the documents it used. Nothing is written anywhere.
 * The answer is cut down and its ids are checked for shape; the Space marks the ids it knows and lists the others.
 * If Cognee is not installed or the dataset is not loaded the agent says so and the tab keeps showing its embedded graph.
 */
export const SALES_KNOWLEDGE_SPACE = 'sales';
export const MAX_ANSWER = 1200;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const DEAL_ID = /^[A-Za-z0-9-]{1,30}$/;
const NODE_ID = /^(deal|account|competitor|skill|call|thread|ticket):[A-Za-z0-9._-]{1,60}$/;

export type SalesKnowledgeDeps = {
  /** Runs one working prompt through the agent and returns its answer ('' = stopped). */
  ask?: (prompt: string, title: string, session: string) => Promise<string>;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The prompt the agent gets. Read-only: the only tool it may use is the memory search. */
export function knowledgePrompt(dealId: string): string {
  return [
    'Use only the Cognee memory tool "recall" to search the dataset "sales-deals" (fictional sales deals; documents with ids in brackets such as (deal:OFF-2026-0324), (account:...), (competitor:...), (skill:...), (call:...), (thread:...), (ticket:...)).',
    'Do not write, remember or forget anything and do not use any other tool.',
    `Find everything the memory knows about the deal ${dealId}: who the customer is, who competes, which risks, calls, mails and tickets are linked, and what the next step is. Answer in at most four sentences, only from what recall returns. Mark any conclusion that is not stated in a document with the word Inference.`,
    'Reply with a JSON object only: {"answer": "<text>", "ids": ["<id of each document you used>"]}. If recall is not available or finds nothing, reply {"answer": "", "ids": []}.',
  ].join('\n');
}

/** Reads the agent's reply: tolerant about fences and text around the object, strict about the shape. */
export function parseKnowledgeAnswer(text: string): { answer: string; ids: string[] } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!isObject(raw) || typeof raw.answer !== 'string' || !Array.isArray(raw.ids)) return null;
  const ids = [...new Set(raw.ids.filter((i): i is string => typeof i === 'string' && NODE_ID.test(i)))].slice(0, 20);
  const answer = raw.answer.trim().slice(0, MAX_ANSWER);
  if (!answer && !ids.length) return null;
  return { answer, ids };
}

export async function handleSalesKnowledgeMessage(data: unknown, deps: SalesKnowledgeDeps): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || data.type !== 'sales:knowledge-request') return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'sales:knowledge-error', requestId, message });
  const dealId = typeof data.dealId === 'string' && DEAL_ID.test(data.dealId) ? data.dealId : null;
  if (!dealId) return fail('The deal id is missing or has an unexpected shape.');
  if (!deps.ask) return fail('The agent is not connected yet.');
  try {
    const text = await deps.ask(knowledgePrompt(dealId), 'Sales: Cognee knowledge for ' + dealId, '');
    if (!text) return fail('The question was stopped.');
    const parsed = parseKnowledgeAnswer(text);
    if (!parsed) return fail('Cognee returned nothing usable (is the Cognee connector installed and the dataset sales-deals loaded?).');
    return { type: 'sales:knowledge-answer', requestId, dealId, answer: parsed.answer, ids: parsed.ids };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
