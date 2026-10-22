/**
 * Bridge between the sandboxed Sub4Me Space and the connector.
 * The Space has no network, so it asks the app by postMessage; the app answers by calling
 * a few fixed tools of the bundled connector. Nothing else can be reached through here.
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

  if (data.type === 's4m:check-request') {
    // Before a ticket is sent: look for a solution (SAP Help Portal, SAP Community) and for the same issue in open tickets.
    const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
    if (!requestId) return null;
    const fail = (message: string) => ({ type: 's4m:error', requestId, message });
    if (!call) return fail('The agent is not connected yet.');
    const { title } = data;
    const product = typeof data.product === 'string' ? data.product.trim().slice(0, 80) : '';
    const description = typeof data.description === 'string' ? data.description.slice(0, 2000) : '';
    if (typeof title !== 'string' || !title.trim() || title.length > 120) return fail('invalid ticket');
    const customer = typeof data.customer === 'string' && CUSTOMER_ID.test(data.customer) ? data.customer : undefined;
    const who = customer ? { customer } : {};
    const query = `${product} ${title.trim()}`.trim().slice(0, 200);
    const settle = async (tool: string, args: Record<string, unknown>): Promise<{ ok: true; data: any } | { ok: false; error: string }> => {
      try {
        return { ok: true, data: parseToolResult(await call(tool, args)) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    };
    const [dup, help, community] = await Promise.all([
      settle('find_similar_tickets', { title: title.trim(), ...(product ? { product } : {}), ...(description ? { description } : {}), ...who }),
      settle('search_sap_help', { q: query, limit: 3 }),
      settle('search_sap_community', { q: query, limit: 3 }),
    ]);
    const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
    const web = (r: typeof help, kind: 'help' | 'community') =>
      r.ok
        ? { ok: true, results: (Array.isArray(r.data?.results) ? r.data.results : []).slice(0, 3).filter(isObject).map((h: Record<string, unknown>) => ({ title: str(h.title, 200), url: str(h.url, 400), excerpt: str(h.excerpt, 400), label: kind === 'help' ? str(h.product, 120) : str(h.board, 120) })) }
        : { ok: false, error: r.error.slice(0, 200) };
    const duplicates = dup.ok
      ? {
          ok: true,
          notes: (Array.isArray(dup.data?.notes) ? dup.data.notes : []).filter(isObject).map((n: Record<string, unknown>) => ({ id: str(n.id, 40), title: str(n.title, 200), product: str(n.product, 80), solution: str(n.solution, 1000), updated: str(n.updated, 20), score: Number(n.score) || 0, strength: n.strength === 'strong' ? 'strong' : 'possible' })),
          // Tickets of other customers arrive without title or customer name.
          tickets: (Array.isArray(dup.data?.tickets) ? dup.data.tickets : []).filter(isObject).map((t: Record<string, unknown>) => ({
            id: str(t.id, 40), title: t.sameCustomer ? str(t.title, 200) : 'Same issue reported by another customer', product: str(t.product, 80),
            status: str(t.status, 40), created: str(t.created, 20), sameCustomer: Boolean(t.sameCustomer), score: Number(t.score) || 0, strength: t.strength === 'strong' ? 'strong' : 'possible',
          })),
          dataSource: str(dup.data?.dataSource, 40),
        }
      : { ok: false, error: dup.error.slice(0, 200) };
    return { type: 's4m:check-result', requestId, ...(customer ? { customer } : {}), duplicates, help: web(help, 'help'), community: web(community, 'community') };
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
