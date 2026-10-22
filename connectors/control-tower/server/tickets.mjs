/**
 * Sub4Me demo tickets. The only write in this connector: it inserts a row into the demo
 * tickets table through public.sub4me_create_ticket (server-side key only). Nothing here
 * can change or delete existing rows.
 */
import { ToolError } from './tools.mjs';
import { customerRecords, loadSub4MeData } from './sub4me.mjs';
import { rank } from './ticket-match.mjs';

const PRIORITIES = ['Low', 'Medium', 'High', 'Very high'];
const STATUSES = ['New', 'In processing', 'Waiting for customer', 'Solution provided', 'Closed'];

const CUSTOMER = { type: 'string', description: 'Customer id, for example "muster" or "hanse" (see list_customers). Default: muster.' };

export const TICKET_TOOL_DEFINITIONS = [
  {
    name: 'list_tickets',
    description:
      'List the Sub4Me demo service tickets of one fictional customer (newest first; tickets it follows from another customer included). Optionally filter by status. Needs the Supabase connection.',
    inputSchema: {
      type: 'object',
      properties: { customer: CUSTOMER, status: { type: 'string', enum: STATUSES } },
      additionalProperties: false,
    },
  },
  {
    name: 'create_ticket',
    description:
      'Open a new Sub4Me demo service ticket (stored in the demo Supabase table, status New). Use only when the person asks to open a ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        customer: CUSTOMER,
        title: { type: 'string', description: 'Short summary, max 120 characters.' },
        product: { type: 'string', description: 'Affected product or service, for example "BTP AI Core".' },
        priority: { type: 'string', enum: PRIORITIES },
        description: { type: 'string', description: 'Optional details, max 2000 characters.' },
      },
      required: ['title', 'product', 'priority'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_similar_tickets',
    description:
      'Check a planned ticket before it is opened: finds open tickets (of this and other customers) that describe the same issue, and the sample knowledge-base notes with a solution. The SAP Notes MCP (search, fetch) should be asked in addition for real notes. Returns a recommendation: use a note, follow an existing ticket, link, or open a new one. Strong match is a score of 0.5 or more, possible 0.35. Read only.',
    inputSchema: {
      type: 'object',
      properties: {
        customer: CUSTOMER,
        title: { type: 'string', description: 'Planned ticket title.' },
        product: { type: 'string', description: 'Affected product (improves the match).' },
        description: { type: 'string', description: 'Optional details.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'link_ticket',
    description:
      'Connect a customer to an existing ticket instead of opening a new one ("follows": the customer is added as follower of the ticket and gets its updates), or record that a new ticket belongs to an existing one ("related"). Writes one row to the demo link table; never changes the ticket itself. Use only after the person confirmed.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Existing ticket id, for example "TKT-48107".' },
        customer: CUSTOMER,
        kind: { type: 'string', enum: ['follows', 'related'] },
        newTicket: { type: 'string', description: 'For "related": the id of the newly opened ticket.' },
      },
      required: ['ticket', 'kind'],
      additionalProperties: false,
    },
  },
];

function text(args, key, max, { optional = false } = {}) {
  const value = args[key];
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || !value.trim()) throw new ToolError(`${key} must be a non-empty string`);
  if (value.trim().length > max) throw new ToolError(`${key} must be at most ${max} characters`);
  return value.trim();
}

/** `rpc(name, body)` performs the Supabase call and returns parsed JSON. */
export function createTicketHandlers(rpc, load = loadSub4MeData) {
  const need = () => {
    if (!rpc) throw new ToolError('Tickets are stored in Supabase: add the Supabase URL and secret key to this connector.');
    return rpc;
  };
  const known = () => {
    try {
      return customerRecords(load());
    } catch (error) {
      throw new ToolError(`Sub4Me sample data unavailable: ${error.message}`);
    }
  };
  const customerId = (args) => {
    if (args.customer === undefined || args.customer === '') return 'muster';
    const id = String(args.customer).toLowerCase();
    if (!known().some((r) => r.id === id)) throw new ToolError(`Unknown customer "${args.customer}". Known: ${known().map((r) => r.id).join(', ')}`);
    return id;
  };
  return {
    async find_similar_tickets(args) {
      const title = text(args, 'title', 120);
      const description = text(args, 'description', 2000, { optional: true });
      const product = args.product ? text(args, 'product', 80) : '';
      const me = customerId(args);
      const candidate = { title, description, product };
      const records = known();
      let pool = records.flatMap((r) => r.tickets.map((t) => ({ ...t, customer: r.id, customerName: r.customer?.name })));
      let dataSource = 'sample data (Sub4Me example Space)';
      if (rpc) {
        try {
          const live = await rpc('sub4me_tickets', {});
          if (Array.isArray(live) && live.length) {
            pool = live.map((t) => ({ ...t, customerName: records.find((r) => r.id === t.customer)?.customer?.name ?? t.customer }));
            dataSource = rpc.label ?? 'supabase';
          }
        } catch {
          // keep the sample tickets
        }
      }
      const open = pool.filter((t) => t.status !== 'Closed' && t.status !== 'Solution provided');
      const tickets = rank(candidate, open).map(({ item, score, strength }) => ({
        id: item.id, title: item.title, product: item.product, status: item.status, created: item.created,
        customer: item.customer, customerName: item.customerName, sameCustomer: item.customer === me, score, strength,
      }));
      const notes = rank(candidate, records[0] ? (load().knowledge?.sapNotes ?? []) : []).map(({ item, score, strength }) => ({
        id: item.id, title: item.title, product: item.product, solution: item.solution, updated: item.updated, score, strength,
        sample: true,
      }));
      const other = tickets.find((t) => !t.sameCustomer && t.strength === 'strong');
      const own = tickets.find((t) => t.sameCustomer);
      const recommendation = notes.some((n) => n.strength === 'strong')
        ? `Try note ${notes.find((n) => n.strength === 'strong').id} first; it describes a solution.`
        : other ? `Follow ${other.id} (same issue at ${other.customerName}) with link_ticket kind "follows" instead of opening a new ticket.`
        : own ? `${own.id} is already open for this customer; add details there instead of opening a duplicate.`
        : tickets.length ? 'Possible matches only: show them to the person, then open a new ticket linked with kind "related" if they differ.'
        : 'No note or open ticket matches: open a new ticket.';
      return {
        customer: me, candidate: { title, product }, notes, tickets, recommendation, dataSource,
        sapNotesMcp: 'Not queried here. With the SAP Notes MCP installed, also call its search tool with the title and product; the notes above are fictional samples.',
      };
    },
    async link_ticket(args) {
      const kind = args.kind;
      if (!['follows', 'related'].includes(kind)) throw new ToolError('kind must be follows or related');
      const ticket = text(args, 'ticket', 40);
      const newTicket = args.newTicket === undefined ? null : text(args, 'newTicket', 40);
      if (kind === 'related' && !newTicket) throw new ToolError('newTicket is required for kind "related"');
      const link = await need()('sub4me_link_ticket', { p_ticket: ticket, p_customer: customerId(args), p_kind: kind, p_new_ticket: newTicket });
      return { link, status: kind === 'follows' ? 'customer now follows the ticket, no new ticket opened' : 'tickets linked', dataSource: rpc.label ?? 'supabase' };
    },
    async list_tickets(args) {
      const status = args.status;
      if (status !== undefined && !STATUSES.includes(status)) throw new ToolError(`status must be one of: ${STATUSES.join(', ')}`);
      const tickets = await need()('sub4me_tickets', { p_customer: customerId(args) });
      const list = status ? tickets.filter((t) => t.status === status) : tickets;
      return { count: list.length, tickets: list, dataSource: rpc.label ?? 'supabase' };
    },
    async create_ticket(args) {
      const title = text(args, 'title', 120);
      const product = text(args, 'product', 80);
      const description = text(args, 'description', 2000, { optional: true });
      if (!PRIORITIES.includes(args.priority)) throw new ToolError(`priority must be one of: ${PRIORITIES.join(', ')}`);
      const ticket = await need()('sub4me_create_ticket', { p_title: title, p_product: product, p_priority: args.priority, p_description: description, p_customer: customerId(args) });
      return { ticket, status: rpc.label === 'zammad' ? 'created in Zammad' : 'created (demo data, stored in Supabase)', dataSource: rpc.label ?? 'supabase' };
    },
  };
}
