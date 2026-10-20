/**
 * Bridge between the sandboxed Sub4Me Space and the connector.
 * The Space has no network, so it asks the app by postMessage; the app answers by calling
 * two fixed tools of the bundled connector. Nothing else can be reached through here.
 */
export const SUB4ME_SPACE = 'sub4me';
export const SUB4ME_EXTENSION = 'ai-control-tower';

export type BridgeCall = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

const PRIORITIES = ['Low', 'Medium', 'High', 'Very high'];
const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const CUSTOMER_ID = /^[a-z0-9-]{1,30}$/;
const TICKET_ID = /^[A-Za-z0-9-]{1,40}$/;

/** Tickets of another customer that this customer follows arrive masked: only id, product and status are shown. */
function forPortal(ticket: any): Record<string, unknown> {
  if (!isObject(ticket)) return {};
  if (ticket.shared) return { ...ticket, title: 'Same issue as ' + String(ticket.id), description: '', followsId: ticket.id };
  return ticket;
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
      const customer = typeof data.customer === 'string' && CUSTOMER_ID.test(data.customer) ? data.customer : undefined;
      const { tickets } = parseToolResult(await call('list_tickets', customer ? { customer } : {}));
      return Array.isArray(tickets) ? { type: 's4m:tickets', ...(customer ? { customer } : {}), tickets: tickets.map(forPortal) } : { type: 's4m:error', message: 'unexpected ticket list' };
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
    const customer = typeof data.customer === 'string' && CUSTOMER_ID.test(data.customer) ? data.customer : undefined;
    const mode = data.mode === undefined ? 'new' : data.mode;
    if (mode !== 'new' && mode !== 'follow' && mode !== 'related') return fail('invalid mode');
    const targetId = typeof data.targetId === 'string' && TICKET_ID.test(data.targetId) ? data.targetId : undefined;
    if (mode !== 'new' && !targetId) return fail('invalid target ticket');
    const who = customer ? { customer } : {};
    try {
      if (mode === 'follow') {
        // Join the existing ticket: no new ticket is opened.
        parseToolResult(await call('link_ticket', { ticket: targetId, kind: 'follows', ...who }));
        const { tickets } = parseToolResult(await call('list_tickets', who));
        const joined = Array.isArray(tickets) ? tickets.find((t) => isObject(t) && t.id === targetId) : undefined;
        return joined ? { type: 's4m:ticket-created', requestId, ticket: forPortal({ ...joined, shared: true }) } : fail('ticket not found after linking');
      }
      const { ticket } = parseToolResult(await call('create_ticket', { title, product, priority, description, ...who }));
      if (!isObject(ticket)) return fail('unexpected answer');
      if (mode === 'related') {
        parseToolResult(await call('link_ticket', { ticket: targetId, kind: 'related', newTicket: ticket.id, ...who }));
        return { type: 's4m:ticket-created', requestId, ticket: { ...ticket, relatedTo: targetId } };
      }
      return { type: 's4m:ticket-created', requestId, ticket };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
  return null;
}
