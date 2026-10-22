/**
 * Zammad (open source help desk, AGPL-3.0) as ticket store for the Sub4Me ticket tools.
 * It answers the same three calls the Supabase functions answer (sub4me_tickets, sub4me_create_ticket,
 * sub4me_link_ticket), so list_tickets, create_ticket, find_similar_tickets and link_ticket work unchanged.
 * The REST API is part of Zammad itself (no extra module). Header: Authorization: Token token=<API token>.
 * Mapping: ticket id = ZM-<number>; the demo customer is a Zammad user <id>@sub4me-demo.example
 * (created on first use with "guess:"); product, priority, owner, "follows" and "related" are tags
 * (product:..., prio:..., cust:<id>, follows:<id>, related:ZM-n); "related" is also a Zammad link.
 * Endpoints follow the public Zammad API documentation (docs.zammad.org). NOT run against a live Zammad
 * from this repository's test environment. Self-contained apart from ToolError.
 */
import { ToolError } from './tools.mjs';

const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
export const ID_PREFIX = 'ZM-';
export const CUSTOMER_DOMAIN = 'sub4me-demo.example';

/** https://host, or http://localhost:port for a local Docker test; returns origin plus path without trailing slash. */
export function normalizeZammadUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('Bitte die Zammad-Adresse eintragen, z. B. https://support.firma.de');
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error('Die Zammad-Adresse ist keine gültige URL.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Die Zammad-Adresse muss mit https:// beginnen (http:// nur für localhost).');
  if (url.username || url.password) throw new Error('Die Zammad-Adresse darf keine Zugangsdaten enthalten.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const tagValue = (tags, key) => tags.find((t) => t.startsWith(`${key}:`))?.slice(key.length + 1) ?? '';
const day = (iso) => String(iso ?? '').slice(0, 10);
const email = (customer) => `${customer}@${CUSTOMER_DOMAIN}`;
const safeTag = (value) => String(value).replace(/[,]/g, ' ').trim().slice(0, 80);
const PRIORITY_FROM = { '1 low': 'Low', '2 normal': 'Medium', '3 high': 'High' };
const statusFrom = (state) => {
  const s = String(state ?? '').toLowerCase();
  if (s === 'new') return 'New';
  if (s.startsWith('pending')) return 'Waiting for customer';
  if (s === 'closed' || s === 'merged') return 'Closed';
  return 'In processing';
};

/** Maps one Zammad ticket (expand=true) plus its tag names to the ticket shape the Sub4Me tools use. */
export function toTicket(z, tags = [], forCustomer = null) {
  const mail = String(typeof z.customer === 'object' ? z.customer?.email : z.customer ?? '').toLowerCase();
  const owner = mail.endsWith(`@${CUSTOMER_DOMAIN}`) ? mail.split('@')[0] : tagValue(tags, 'cust');
  return {
    id: `${ID_PREFIX}${z.number ?? z.id}`,
    title: String(z.title ?? ''),
    product: tagValue(tags, 'product'),
    priority: tagValue(tags, 'prio') || PRIORITY_FROM[String(z.priority ?? '').toLowerCase()] || 'Medium',
    status: statusFrom(z.state),
    description: '',
    created: day(z.created_at),
    updated: day(z.updated_at ?? z.created_at),
    customer: owner || 'unknown',
    shared: forCustomer ? (owner || 'unknown') !== forCustomer : false,
    followers: tags.filter((t) => t.startsWith('follows:')).length,
    relatedTo: tagValue(tags, 'related') || null,
  };
}

export function createZammadRpc({ url, token, group = 'Users', fetchImpl = fetch } = {}) {
  const base = normalizeZammadUrl(url);
  if (!token) throw new Error('ZAMMAD_TOKEN fehlt.');
  const call = async (method, path, { query, body } = {}) => {
    const qs = query ? `?${new URLSearchParams(query)}` : '';
    let response;
    try {
      response = await fetchImpl(`${base}/api/v1/${path}${qs}`, {
        method,
        headers: { Authorization: `Token token=${token}`, Accept: 'application/json', 'X-Zammad-Suppress-Notifications': 'true', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ToolError(`Zammad not reachable: ${error.message}`);
    }
    if (response.status === 401 || response.status === 403) throw new ToolError('Zammad rejected the API token (needs an agent user with ticket.agent permission and "API token access").');
    if (!response.ok) {
      let detail = '';
      try { detail = ` ${JSON.stringify(await response.json()).slice(0, 200)}`; } catch { /* no body */ }
      throw new ToolError(`Zammad answered ${response.status} for ${method} ${path}.${detail}`);
    }
    try { return await response.json(); } catch { return null; }
  };
  const tagsOf = async (id) => {
    const r = await call('GET', 'tags', { query: { object: 'Ticket', o_id: String(id) } });
    return Array.isArray(r?.tags) ? r.tags.map(String) : [];
  };
  /** Newest tickets with their tags (one extra call per ticket, at most PAGE_SIZE * MAX_PAGES). */
  const all = async () => {
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const items = await call('GET', 'tickets', { query: { expand: 'true', page: String(page), per_page: String(PAGE_SIZE) } });
      if (!Array.isArray(items) || !items.length) break;
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    return Promise.all(out.map(async (z) => ({ z, tags: await tagsOf(z.id) })));
  };
  const find = async (ticket) => {
    const number = /^ZM-(\d+)$/i.exec(String(ticket).trim())?.[1];
    if (!number) throw new ToolError(`Ticket id must look like ZM-10001, got "${ticket}".`);
    const hit = (await all()).find(({ z }) => String(z.number) === number);
    if (!hit) throw new ToolError(`Ticket ${ID_PREFIX}${number} not found in Zammad.`);
    return hit;
  };
  const addTag = (id, item) => call('POST', 'tags/add', { body: { object: 'Ticket', o_id: id, item } });

  const rpc = async (fn, body = {}) => {
    switch (fn) {
      case 'sub4me_tickets': {
        const me = body.p_customer ?? null;
        const rows = await all();
        return rows
          .filter(({ z, tags }) => !me || toTicket(z, tags).customer === me || tags.includes(`follows:${me}`))
          .map(({ z, tags }) => toTicket(z, tags, me));
      }
      case 'sub4me_create_ticket': {
        const customer = body.p_customer ?? 'muster';
        const text = (body.p_description || body.p_title).trim();
        const z = await call('POST', 'tickets', {
          body: {
            title: body.p_title, group, customer_id: `guess:${email(customer)}`,
            article: { subject: body.p_title, body: text, type: 'note', internal: false, sender: 'Customer' },
          },
        });
        if (!z?.id) throw new ToolError('Zammad created the ticket but did not return its id.');
        const tags = [`product:${safeTag(body.p_product)}`, `prio:${safeTag(body.p_priority)}`, `cust:${customer}`];
        for (const item of tags) await addTag(z.id, item);
        return { ...toTicket({ ...z, customer: email(customer), state: 'new' }, tags), status: 'New', description: text };
      }
      case 'sub4me_link_ticket': {
        const target = await find(body.p_ticket);
        if (body.p_kind === 'follows') {
          await addTag(target.z.id, `follows:${body.p_customer}`);
        } else {
          const fresh = await find(body.p_new_ticket);
          await addTag(fresh.z.id, `related:${ID_PREFIX}${target.z.number}`);
          await call('POST', 'links/add', { body: { link_type: 'normal', link_object_target: 'Ticket', link_object_target_value: target.z.id, link_object_source: 'Ticket', link_object_source_number: String(fresh.z.number) } });
        }
        return { ticket: body.p_ticket, customer: body.p_customer, kind: body.p_kind, newTicket: body.p_new_ticket ?? null };
      }
      default:
        throw new ToolError(`Zammad adapter does not handle ${fn}`);
    }
  };
  rpc.label = 'zammad';
  rpc.handles = new Set(['sub4me_tickets', 'sub4me_create_ticket', 'sub4me_link_ticket']);
  return rpc;
}

/** Ticket calls go to Zammad, everything else (invoices, skills, ...) stays with the Supabase function. */
export function routeTicketCalls(zammad, other) {
  if (!zammad) return other;
  const routed = async (fn, body) => (zammad.handles.has(fn) ? zammad(fn, body) : other ? other(fn, body) : Promise.reject(new ToolError('Supabase is not configured for this call.')));
  routed.label = 'zammad';
  return routed;
}
