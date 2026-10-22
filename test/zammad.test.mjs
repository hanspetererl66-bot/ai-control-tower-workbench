import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createZammadRpc, normalizeZammadUrl, routeTicketCalls, toTicket } from '../connectors/control-tower/server/zammad.mjs';
import { createTicketHandlers } from '../connectors/control-tower/server/tickets.mjs';
import { extractSub4MeData } from '../connectors/control-tower/server/sub4me.mjs';

const all = extractSub4MeData(readFileSync(new URL('../examples/sub4me/index.html', import.meta.url), 'utf8'));
const load = () => all;

/** Minimal in-memory Zammad: the endpoints the adapter uses. */
function fakeZammad({ status = 200 } = {}) {
  const tickets = []; const tags = new Map(); const links = []; const calls = []; let seq = 10000;
  const json = (value, code = 200) => ({ ok: code < 400, status: code, json: async () => value });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url); const path = u.pathname.replace('/api/v1/', ''); const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, headers: init.headers, body, host: u.host });
    if (status !== 200) return json({ error: 'x' }, status);
    if (init.method === 'GET' && path === 'tickets') {
      const per = Number(u.searchParams.get('per_page')); const page = Number(u.searchParams.get('page'));
      return json(tickets.slice().reverse().slice((page - 1) * per, page * per));
    }
    if (init.method === 'POST' && path === 'tickets') {
      const id = ++seq; const mail = body.customer_id.replace('guess:', '');
      const z = { id, number: String(id + 90000), title: body.title, state: 'new', priority: '2 normal', customer: mail, created_at: '2026-10-22T10:00:00Z', updated_at: '2026-10-22T10:00:00Z' };
      tickets.push(z); tags.set(id, []); return json(z, 201);
    }
    if (init.method === 'GET' && path === 'tags') return json({ tags: tags.get(Number(u.searchParams.get('o_id'))) ?? [] });
    if (init.method === 'POST' && path === 'tags/add') { tags.get(body.o_id).push(body.item); return json(true, 201); }
    if (init.method === 'POST' && path === 'links/add') { links.push(body); return json({ id: 1 }, 201); }
    return json({}, 404);
  };
  return { fetchImpl, tickets, tags, links, calls };
}
const make = (opts) => { const fz = fakeZammad(opts); return { fz, rpc: createZammadRpc({ url: 'https://support.example.com/', token: 'tok-1', fetchImpl: fz.fetchImpl }) }; };

test('url must be https, or http only for localhost, without credentials', () => {
  assert.equal(normalizeZammadUrl('support.firma.de/'), 'https://support.firma.de');
  assert.equal(normalizeZammadUrl('http://localhost:8080'), 'http://localhost:8080');
  assert.throws(() => normalizeZammadUrl('http://support.firma.de'), /https/);
  assert.throws(() => normalizeZammadUrl('https://u:p@support.firma.de'), /Zugangsdaten/);
  assert.throws(() => normalizeZammadUrl(''), /eintragen/);
});

test('create, list, follow and relate through the ticket tools', async () => {
  const { fz, rpc } = make();
  const h = createTicketHandlers(rpc, load);
  const a = await h.create_ticket({ customer: 'muster', title: 'AI Core quota exceeded in eu10', product: 'BTP AI Core', priority: 'Very high', description: 'Deployments fail' });
  assert.equal(a.ticket.id, 'ZM-100001');
  assert.equal(a.ticket.status, 'New');
  assert.equal(a.dataSource, 'zammad');
  const create = fz.calls.find((c) => c.method === 'POST' && c.path === 'tickets');
  assert.equal(create.headers.Authorization, 'Token token=tok-1');
  assert.equal(create.body.customer_id, 'guess:muster@sub4me-demo.example');
  assert.equal(create.body.article.sender, 'Customer');
  assert.ok(fz.calls.every((c) => c.host === 'support.example.com'));

  const own = await h.list_tickets({ customer: 'muster' });
  assert.equal(own.count, 1);
  assert.deepEqual([own.tickets[0].product, own.tickets[0].priority, own.tickets[0].customer], ['BTP AI Core', 'Very high', 'muster']);
  assert.equal((await h.list_tickets({ customer: 'hanse' })).count, 0);

  const sim = await h.find_similar_tickets({ customer: 'hanse', title: 'AI Core quota exceeded', product: 'BTP AI Core' });
  assert.equal(sim.dataSource, 'zammad');
  assert.equal(sim.tickets[0].id, 'ZM-100001');
  assert.equal(sim.tickets[0].sameCustomer, false);

  const f = await h.link_ticket({ ticket: 'ZM-100001', customer: 'hanse', kind: 'follows' });
  assert.match(f.status, /no new ticket/);
  const hanse = await h.list_tickets({ customer: 'hanse' });
  assert.equal(hanse.count, 1);
  assert.equal(hanse.tickets[0].shared, true);
  assert.equal(hanse.tickets[0].followers, 1);

  const b = await h.create_ticket({ customer: 'hanse', title: 'Different thing', product: 'Joule copilots', priority: 'Low' });
  await h.link_ticket({ ticket: 'ZM-100001', customer: 'hanse', kind: 'related', newTicket: b.ticket.id });
  assert.equal(fz.links.length, 1);
  assert.deepEqual([fz.links[0].link_object_target_value, fz.links[0].link_object_source_number], [10001, '100002']);
  assert.equal((await h.list_tickets({ customer: 'hanse' })).tickets.find((t) => t.id === b.ticket.id).relatedTo, 'ZM-100001');
});

test('maps Zammad states and priorities', () => {
  assert.equal(toTicket({ id: 1, number: '5', state: 'pending reminder', priority: '3 high', customer: 'x@y.de' }).status, 'Waiting for customer');
  assert.equal(toTicket({ id: 1, number: '5', state: 'closed' }).status, 'Closed');
  assert.equal(toTicket({ id: 1, number: '5', state: 'open', priority: '3 high' }).priority, 'High');
  assert.equal(toTicket({ id: 1, number: '5', customer: { email: 'Muster@sub4me-demo.example' } }).customer, 'muster');
});

test('errors are readable and ids are checked', async () => {
  const bad = make({ status: 401 });
  await assert.rejects(bad.rpc('sub4me_tickets', {}), /rejected the API token/);
  const down = createZammadRpc({ url: 'https://z.example', token: 't', fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(down('sub4me_tickets', {}), /not reachable: offline/);
  const { rpc } = make();
  await assert.rejects(rpc('sub4me_link_ticket', { p_ticket: 'TKT-1', p_customer: 'muster', p_kind: 'follows' }), /ZM-10001/);
  await assert.rejects(rpc('sub4me_link_ticket', { p_ticket: 'ZM-5', p_customer: 'muster', p_kind: 'follows' }), /not found/);
  assert.throws(() => createZammadRpc({ url: 'https://z.example' }), /ZAMMAD_TOKEN/);
});

test('routing: tickets to Zammad, other calls to Supabase', async () => {
  const { rpc } = make();
  const other = async (fn) => ({ from: 'supabase', fn });
  const routed = routeTicketCalls(rpc, other);
  assert.deepEqual(await routed('sub4me_invoices', {}), { from: 'supabase', fn: 'sub4me_invoices' });
  assert.deepEqual(await routed('sub4me_tickets', {}), []);
  assert.equal(routeTicketCalls(null, other), other);
  await assert.rejects(routeTicketCalls(rpc, null)('sub4me_invoices', {}), /Supabase is not configured/);
});
