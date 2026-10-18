/**
 * Sub4Me demo tickets. The only write in this connector: it inserts a row into the demo
 * tickets table through public.sub4me_create_ticket (server-side key only). Nothing here
 * can change or delete existing rows.
 */
import { ToolError } from './tools.mjs';

const PRIORITIES = ['Low', 'Medium', 'High', 'Very high'];
const STATUSES = ['New', 'In processing', 'Waiting for customer', 'Solution provided', 'Closed'];

export const TICKET_TOOL_DEFINITIONS = [
  {
    name: 'list_tickets',
    description:
      'List the Sub4Me demo service tickets of the fictional customer (newest first). Optionally filter by status. Needs the Supabase connection.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: STATUSES } },
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
        title: { type: 'string', description: 'Short summary, max 120 characters.' },
        product: { type: 'string', description: 'Affected product or service, for example "BTP AI Core".' },
        priority: { type: 'string', enum: PRIORITIES },
        description: { type: 'string', description: 'Optional details, max 2000 characters.' },
      },
      required: ['title', 'product', 'priority'],
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
export function createTicketHandlers(rpc) {
  const need = () => {
    if (!rpc) throw new ToolError('Tickets are stored in Supabase: add the Supabase URL and secret key to this connector.');
    return rpc;
  };
  return {
    async list_tickets(args) {
      const status = args.status;
      if (status !== undefined && !STATUSES.includes(status)) throw new ToolError(`status must be one of: ${STATUSES.join(', ')}`);
      const tickets = await need()('sub4me_tickets', {});
      const list = status ? tickets.filter((t) => t.status === status) : tickets;
      return { count: list.length, tickets: list, dataSource: 'supabase' };
    },
    async create_ticket(args) {
      const title = text(args, 'title', 120);
      const product = text(args, 'product', 80);
      const description = text(args, 'description', 2000, { optional: true });
      if (!PRIORITIES.includes(args.priority)) throw new ToolError(`priority must be one of: ${PRIORITIES.join(', ')}`);
      const ticket = await need()('sub4me_create_ticket', { p_title: title, p_product: product, p_priority: args.priority, p_description: description });
      return { ticket, status: 'created (demo data, stored in Supabase)', dataSource: 'supabase' };
    },
  };
}
