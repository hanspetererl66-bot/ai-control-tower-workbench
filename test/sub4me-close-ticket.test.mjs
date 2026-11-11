import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createTicketHandlers, TICKET_TOOL_DEFINITIONS } from '../connectors/_lib/server/tickets.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SQL = read('supabase/migrations/20261111_048_sub4me_close_ticket.sql');

test('close_ticket is a tool with a ticket id (required) and an optional note', () => {
  const def = TICKET_TOOL_DEFINITIONS.find((t) => t.name === 'close_ticket');
  assert.ok(def, 'tool definition');
  assert.deepEqual(def.inputSchema.required, ['ticket']);
  assert.deepEqual(Object.keys(def.inputSchema.properties).sort(), ['note', 'ticket']);
  assert.equal(def.inputSchema.additionalProperties, false);
  const manifest = JSON.parse(read('connectors/sub4me/manifest.json'));
  assert.ok(manifest.tools.some((t) => t.name === 'close_ticket'), 'the manifest lists it');
  const market = JSON.parse(read('examples/mcp-marketplace/servers.json'));
  const tools = JSON.stringify(market).match(/"name":"close_ticket","class":"write"/);
  assert.ok(tools, 'the marketplace classes it as a write');
});

test('close_ticket validates the arguments and calls the close function with the note', async () => {
  const seen = [];
  const h = createTicketHandlers(async (name, body) => (seen.push([name, body]), { id: 'TKT-48214', status: 'Closed', closingNote: body.p_note }));
  const r = await h.close_ticket({ ticket: ' TKT-48214 ', note: 'Certificate renewed, VM checked again.' });
  assert.deepEqual(seen, [['sub4me_close_ticket', { p_ticket: 'TKT-48214', p_note: 'Certificate renewed, VM checked again.' }]]);
  assert.equal(r.ticket.status, 'Closed');
  assert.match(r.status, /closed/);
  await h.close_ticket({ ticket: 'TKT-1' });
  assert.equal(seen[1][1].p_note, '', 'the note is optional');
  for (const bad of [{}, { ticket: '' }, { ticket: 'OP-2101' }, { ticket: 'TKT-1; drop table' }, { ticket: 'tkt-1' }]) await assert.rejects(h.close_ticket(bad), /ticket/, JSON.stringify(bad));
  await assert.rejects(h.close_ticket({ ticket: 'TKT-1', note: 'x'.repeat(1001) }), /note/);
  assert.equal(seen.length, 2, 'invalid calls never reach the database');
});

test('close_ticket without Supabase says what is missing, and database rules come back as the tool error', async () => {
  await assert.rejects(createTicketHandlers(null).close_ticket({ ticket: 'TKT-1' }), /Supabase/);
  const h = createTicketHandlers(async () => { throw new Error('Ticket TKT-9 is already closed'); });
  await assert.rejects(h.close_ticket({ ticket: 'TKT-9' }), /already closed/);
});

test('migration 048: one function, service role only, closes but never reopens or deletes', () => {
  assert.match(SQL, /grant execute on function public\.sub4me_close_ticket\(text, text\) to service_role/);
  assert.match(SQL, /revoke all on function public\.sub4me_close_ticket\(text, text\) from public, anon, authenticated/);
  assert.doesNotMatch(SQL, /grant [^;]* to (anon|authenticated)/i);
  assert.match(SQL, /security definer/);
  assert.match(SQL, /set search_path = ''/);
  assert.doesNotMatch(SQL, /delete from|drop table|truncate/i);
  assert.match(SQL, /already closed/);
  assert.match(SQL, /not found/);
  assert.match(SQL, /add column if not exists closed_on/);
  assert.match(SQL, /add column if not exists closing_note/);
});
