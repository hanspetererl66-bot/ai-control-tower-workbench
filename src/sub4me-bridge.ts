/**
 * Bridge between the sandboxed Sub4Me Space and the connector.
 * The Space has no network, so it asks the app by postMessage; the app answers by calling
 * three fixed tools of the bundled connector (list_tickets, create_ticket, enrich_ticket).
 * Nothing else can be reached through here.
 */
export const SUB4ME_SPACE = 'sub4me';
export const SUB4ME_EXTENSION = 'ai-control-tower';

export type BridgeCall = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

const PRIORITIES = ['Low', 'Medium', 'High', 'Very high'];
const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const TICKET_ID = /^TKT-[A-Za-z0-9-]{1,20}$/;

const strings = (value: unknown, max = 12): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, max) : [];

/** Only the fields the Space renders; everything else the connector returned stays here. */
export function pickEnrichment(raw: unknown): Record<string, unknown> | null {
  if (!isObject(raw) || !isObject(raw.ticket)) return null;
  const tower = isObject(raw.controlTower) ? raw.controlTower : {};
  return {
    ticketId: String(raw.ticket.id ?? ''),
    product: String(raw.ticket.product ?? ''),
    assessment: strings(raw.assessment),
    nextSteps: strings(raw.nextSteps),
    risks: (Array.isArray(tower.risks) ? tower.risks : []).filter(isObject).slice(0, 8).map((r) => ({
      id: String(r.id ?? ''),
      title: String(r.title ?? ''),
      owner: String(r.owner ?? ''),
      progressPct: typeof r.progressPct === 'number' ? r.progressPct : null,
    })),
    note: typeof raw.note === 'string' ? raw.note : '',
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Pull the JSON text out of an MCP tool result; tool errors become exceptions. */
export function parseToolResult(result: unknown): any {
  const r = isObject(result) ? result : {};
  const first = Array.isArray(r.content) ? r.content[0] : undefined;
  const text = isObject(first) && typeof first.text === 'string' ? first.text : '';
  if (r.isError) throw new Error(text || 'the connector reported an error');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('the connector returned an unexpected answer');
  }
}

/** Returns the reply to post back into the Space, or null when the message is not for us. */
export async function handleSub4meMessage(data: unknown, call: BridgeCall | undefined): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || typeof data.type !== 'string' || !data.type.startsWith('s4m:')) return null;

  if (data.type === 's4m:tickets-request') {
    if (!call) return { type: 's4m:error', message: 'The agent is not connected yet.' };
    try {
      const { tickets } = parseToolResult(await call('list_tickets', {}));
      return Array.isArray(tickets) ? { type: 's4m:tickets', tickets } : { type: 's4m:error', message: 'unexpected ticket list' };
    } catch (error) {
      return { type: 's4m:error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  if (data.type === 's4m:create-ticket') {
    const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
    if (!requestId) return null;
    const fail = (message: string) => ({ type: 's4m:error', requestId, message });
    if (!call) return fail('The agent is not connected yet.');
    const { title, product, priority } = data;
    const description = data.description === undefined ? '' : data.description;
    if (typeof title !== 'string' || typeof product !== 'string' || typeof description !== 'string' || typeof priority !== 'string') {
      return fail('invalid ticket');
    }
    if (!PRIORITIES.includes(priority)) return fail('invalid priority');
    try {
      const { ticket } = parseToolResult(await call('create_ticket', { title, product, priority, description }));
      return isObject(ticket) ? { type: 's4m:ticket-created', requestId, ticket } : fail('unexpected answer');
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  if (data.type === 's4m:enrich-request') {
    const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
    if (!requestId) return null;
    const fail = (message: string) => ({ type: 's4m:error', requestId, message });
    if (!call) return fail('The agent is not connected yet.');
    if (typeof data.ticketId !== 'string' || !TICKET_ID.test(data.ticketId)) return fail('invalid ticket id');
    try {
      const enrichment = pickEnrichment(parseToolResult(await call('enrich_ticket', { ticket_id: data.ticketId })));
      return enrichment ? { type: 's4m:enrichment', requestId, enrichment } : fail('unexpected answer');
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
  return null;
}
