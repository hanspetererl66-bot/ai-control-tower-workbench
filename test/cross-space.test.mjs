import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCrossSpaceHandlers, enrichTicket } from '../connectors/_lib/server/cross-space.mjs';
import { createSub4MeHandlers, loadSub4MeData } from '../connectors/_lib/server/sub4me.mjs';

const tower = JSON.parse(readFileSync(new URL('../examples/control-tower/data.json', import.meta.url), 'utf8'));
const sub4me = createSub4MeHandlers(undefined, null);
const handlers = createCrossSpaceHandlers({ sub4me, loadTower: async () => ({ data: tower, source: 'test' }) });

test('enriches a Joule ticket with Control Tower context', async () => {
  const out = await handlers.enrich_ticket({ ticket_id: 'tkt-48213' });
  assert.equal(out.ticket.id, 'TKT-48213');
  assert.deepEqual(out.controlTower.linkedPlatforms, ['SAP AI Core', 'SAP BTP']);
  assert.ok(out.controlTower.agents.inScope > 0);
  assert.ok(out.controlTower.risks.some((r) => r.id === 'R4'), 'hallucination risk is linked');
  assert.deepEqual(out.controlTower.teamsOverBudget.map((t) => t.name), ['Engineering', 'Finance']);
  assert.ok(out.assessment.length >= 2);
  assert.match(out.note, /heuristic/);
  assert.deepEqual(out.views, [{ space: 'sub4me', tab: 'tickets' }, { space: 'ai-control-tower', tab: 'risk' }]);
});

test('never invents a link for an unknown product', () => {
  const ticket = { id: 'TKT-1', title: 't', product: 'Something Else', priority: 'Low', status: 'New' };
  const out = enrichTicket(ticket, null, tower);
  assert.deepEqual(out.controlTower.linkedPlatforms, []);
  assert.equal(out.controlTower.agents.inScope, 0);
  assert.match(out.note, /No Control Tower link/);
});

test('rejects missing and unknown ticket ids with the known ids', async () => {
  await assert.rejects(handlers.enrich_ticket({}), /ticket_id is required/);
  const known = loadSub4MeData().tickets.map((t) => t.id);
  await assert.rejects(handlers.enrich_ticket({ ticket_id: 'TKT-0' }), (error) => known.every((id) => error.message.includes(id)));
});

test('is read-only: the tool takes only a ticket id', async () => {
  const { CROSS_SPACE_TOOL_DEFINITIONS } = await import('../connectors/_lib/server/cross-space.mjs');
  assert.deepEqual(Object.keys(CROSS_SPACE_TOOL_DEFINITIONS[0].inputSchema.properties), ['ticket_id']);
});
