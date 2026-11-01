import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { handleSub4meMessage } from '../src/sub4me-bridge.ts';
import { createSub4MeHandlers, customerRecords, extractSub4MeData } from '../connectors/_lib/server/sub4me.mjs';
import { createTicketHandlers } from '../connectors/_lib/server/tickets.mjs';
import { POSSIBLE, rank, similarity, STRONG } from '../connectors/_lib/server/ticket-match.mjs';

const html = readFileSync(new URL('../examples/sub4me/index.html', import.meta.url), 'utf8');
const all = extractSub4MeData(html);
const load = () => all;
const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });
const scenario = (label) => all.knowledge.scenarios.find((s) => s.label === label);

test('the page carries the same matching code as the connector module', () => {
  const block = (src) => /\/\*match:start\*\/([\s\S]*?)\/\*match:end\*\//.exec(src)[1];
  const module = readFileSync(new URL('../connectors/_lib/server/ticket-match.mjs', import.meta.url), 'utf8');
  assert.equal(block(html).trim(), block(module).trim());
});

test('sample scenarios give the intended result: note, shared ticket, or nothing', () => {
  const tickets = customerRecords(all).flatMap((r) => r.tickets.map((t) => ({ ...t, customer: r.id })));
  const notes = all.knowledge.sapNotes;
  const quota = rank(scenario('Quota error in eu10'), notes);
  assert.equal(quota[0].item.id, 'SAMPLE-1001');
  assert.equal(quota[0].strength, 'strong');
  const shared = rank(scenario('Quota error in eu10'), tickets).find((h) => h.item.customer === 'muster');
  assert.ok(shared && shared.score >= STRONG, 'the Muster ticket is a strong match for the Hanse scenario');
  const none = scenario('Export to PDF fails (no match)');
  assert.equal(rank(none, notes).length, 0);
  assert.equal(rank(none, tickets).length, 0);
  assert.ok(similarity({ title: 'a b c' }, { title: 'x y z' }) < POSSIBLE);
});

test('find_similar_tickets recommends following the other customer ticket and never writes', async () => {
  const calls = [];
  const h = createTicketHandlers(async (name, body) => (calls.push(name), []), load);
  const sc = scenario('Quota error in eu10');
  const r = await h.find_similar_tickets({ customer: 'hanse', title: sc.title, product: sc.product, description: sc.description });
  assert.ok(r.tickets.some((t) => !t.sameCustomer && t.strength === 'strong'));
  assert.ok(r.notes.some((n) => n.id === 'SAMPLE-1001' && n.sample));
  assert.match(r.sapNotesMcp, /SAP Notes MCP/);
  assert.deepEqual([...new Set(calls)], ['sub4me_tickets']);
  await assert.rejects(h.find_similar_tickets({ customer: 'nobody', title: 'x' }), /Unknown customer/);
});

test('link_ticket validates its arguments and calls the link function', async () => {
  const seen = [];
  const h = createTicketHandlers(async (name, body) => (seen.push([name, body]), { ok: true }), load);
  await h.link_ticket({ ticket: 'TKT-48107', customer: 'hanse', kind: 'follows' });
  assert.deepEqual(seen[0], ['sub4me_link_ticket', { p_ticket: 'TKT-48107', p_customer: 'hanse', p_kind: 'follows', p_new_ticket: null }]);
  await assert.rejects(h.link_ticket({ ticket: 'TKT-1', kind: 'related' }), /newTicket/);
  await assert.rejects(h.link_ticket({ ticket: 'TKT-1', kind: 'merge' }), /kind/);
});

test('every Sub4Me tool accepts a customer and answers for that customer', async () => {
  const h = createSub4MeHandlers(load);
  assert.equal((await h.list_customers()).count, 2);
  const a = await h.list_contracts({ customer: 'hanse' });
  const b = await h.list_contracts({});
  assert.notEqual(a.customer, b.customer);
  assert.equal(a.customer, 'Hanse Handelsgruppe AG');
  assert.ok((await h.list_invoices({ customer: 'hanse' })).count > 0);
  await assert.rejects(h.list_contracts({ customer: 'nobody' }), /Unknown customer/);
});

test('bridge: follow joins the existing ticket without creating one, with masked details', async () => {
  const calls = [];
  const call = async (tool, args) => {
    calls.push([tool, args]);
    if (tool === 'list_tickets') return ok({ tickets: [{ id: 'TKT-48107', title: 'Secret title of Muster', description: 'secret', product: 'BTP AI Core', priority: 'High', status: 'In processing', created: '2026-10-12', updated: '2026-10-15', shared: true }] });
    return ok({ link: {} });
  };
  const reply = await handleSub4meMessage({ type: 's4m:create-ticket', requestId: 'r1', customer: 'hanse', title: 'T', product: 'P', priority: 'High', mode: 'follow', targetId: 'TKT-48107' }, call);
  assert.equal(reply.type, 's4m:ticket-created');
  assert.equal(reply.ticket.followsId, 'TKT-48107');
  assert.ok(!JSON.stringify(reply).includes('Secret title'));
  assert.deepEqual(calls.map((c) => c[0]), ['link_ticket', 'list_tickets']);
  assert.ok(!calls.some((c) => c[0] === 'create_ticket'));
});

test('bridge: related creates the ticket and links it; bad modes and ids are rejected', async () => {
  const calls = [];
  const call = async (tool, args) => (calls.push([tool, args]), ok(tool === 'create_ticket' ? { ticket: { id: 'TKT-9' } } : {}));
  const reply = await handleSub4meMessage({ type: 's4m:create-ticket', requestId: 'r2', customer: 'muster', title: 'T', product: 'P', priority: 'Low', mode: 'related', targetId: 'TKT-48107' }, call);
  assert.equal(reply.ticket.relatedTo, 'TKT-48107');
  assert.deepEqual(calls.map((c) => c[0]), ['create_ticket', 'link_ticket']);
  assert.deepEqual(calls[1][1], { ticket: 'TKT-48107', kind: 'related', newTicket: 'TKT-9', customer: 'muster' });
  const n = calls.length;
  for (const extra of [{ mode: 'merge' }, { mode: 'follow' }, { mode: 'related', targetId: '../x' }]) {
    const bad = await handleSub4meMessage({ type: 's4m:create-ticket', requestId: 'r3', title: 'T', product: 'P', priority: 'Low', ...extra }, call);
    assert.equal(bad.type, 's4m:error');
  }
  assert.equal(calls.length, n);
});
