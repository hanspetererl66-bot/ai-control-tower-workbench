import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { handleSub4meMessage, parseToolResult } from '../src/sub4me-bridge.ts';

const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });

test('lists tickets through the fixed list_tickets tool', async () => {
  const calls = [];
  const reply = await handleSub4meMessage({ type: 's4m:tickets-request' }, async (tool, args) => (calls.push([tool, args]), ok({ tickets: [{ id: 'TKT-1' }] })));
  assert.deepEqual(reply, { type: 's4m:tickets', tickets: [{ id: 'TKT-1' }] });
  assert.deepEqual(calls, [['list_tickets', {}]]);
});

test('creates a ticket with only the four known fields', async () => {
  const calls = [];
  const reply = await handleSub4meMessage(
    { type: 's4m:create-ticket', requestId: 'r1-1', title: 'T', product: 'P', priority: 'High', description: 'D', extra: 'ignored', tool: 'get_budget' },
    async (tool, args) => (calls.push([tool, args]), ok({ ticket: { id: 'TKT-9' } }))
  );
  assert.deepEqual(reply, { type: 's4m:ticket-created', requestId: 'r1-1', ticket: { id: 'TKT-9' } });
  assert.deepEqual(calls, [['create_ticket', { title: 'T', product: 'P', priority: 'High', description: 'D' }]]);
});

test('ignores unrelated or malformed messages and never calls a tool for them', async () => {
  let called = 0;
  const call = async () => (called++, ok({}));
  for (const data of [null, 'x', { type: 'ct:open-tab' }, { type: 's4m:unknown' }, { type: 's4m:create-ticket', requestId: '../x', title: 'T', product: 'P', priority: 'Low' }, { type: 's4m:call', tool: 'get_budget' }]) {
    assert.equal(await handleSub4meMessage(data, call), null);
  }
  const bad = await handleSub4meMessage({ type: 's4m:create-ticket', requestId: 'r2', title: 1, product: 'P', priority: 'Low' }, call);
  assert.equal(bad.type, 's4m:error');
  const prio = await handleSub4meMessage({ type: 's4m:create-ticket', requestId: 'r3', title: 'T', product: 'P', priority: 'Urgent' }, call);
  assert.equal(prio.message, 'invalid priority');
  assert.equal(called, 0);
});

test('reports connector errors and a missing agent back to the page', async () => {
  const err = await handleSub4meMessage({ type: 's4m:tickets-request' }, async () => ({ isError: true, content: [{ type: 'text', text: 'Supabase missing' }] }));
  assert.deepEqual(err, { type: 's4m:error', message: 'Supabase missing' });
  const none = await handleSub4meMessage({ type: 's4m:create-ticket', requestId: 'r4', title: 'T', product: 'P', priority: 'Low' }, undefined);
  assert.equal(none.requestId, 'r4');
  assert.throws(() => parseToolResult({ content: [{ type: 'text', text: 'not json' }] }), /unexpected/);
});

test('the Space only talks to its parent and the app only wires the bridge for sub4me', () => {
  const html = readFileSync(join(import.meta.dirname, '..', 'examples/sub4me/index.html'), 'utf8');
  assert.match(html, /e\.source !== window\.parent/);
  const app = readFileSync(join(import.meta.dirname, '..', 'src/App.tsx'), 'utf8');
  assert.match(app, /bridgeEnabled=\{space\.slug === SUB4ME_SPACE\}/);
  const viewer = readFileSync(join(import.meta.dirname, '..', 'src/ui/SpaceViewer.tsx'), 'utf8');
  assert.match(viewer, /event\.source !== frame\.current\.contentWindow/);
});

test('enrich requests call only enrich_ticket and pass on the fields the Space renders', async () => {
  const calls = [];
  const call = async (tool, args) => {
    calls.push([tool, args]);
    return { content: [{ type: 'text', text: JSON.stringify({ ticket: { id: 'TKT-48213', product: 'Joule copilots', secret: 'x' }, assessment: ['a', 5, 'b'], nextSteps: ['n'], controlTower: { risks: [{ id: 'R4', title: 'T', owner: 'CFO Office', progressPct: 58, hidden: 1 }] }, note: 'heuristic', dataSource: 'internal' }) }] };
  };
  const reply = await handleSub4meMessage({ type: 's4m:enrich-request', requestId: 'e1', ticketId: 'TKT-48213' }, call);
  assert.deepEqual(calls, [['enrich_ticket', { ticket_id: 'TKT-48213' }]]);
  assert.equal(reply.type, 's4m:enrichment');
  assert.equal(reply.requestId, 'e1');
  assert.deepEqual(reply.enrichment.assessment, ['a', 'b']);
  assert.deepEqual(reply.enrichment.risks, [{ id: 'R4', title: 'T', owner: 'CFO Office', progressPct: 58 }]);
  assert.equal(JSON.stringify(reply).includes('secret'), false);
  assert.equal(JSON.stringify(reply).includes('internal'), false);
});

test('enrich requests reject bad ids, missing request ids and a missing agent', async () => {
  const call = async () => assert.fail('must not be called');
  assert.equal((await handleSub4meMessage({ type: 's4m:enrich-request', requestId: 'e1', ticketId: '../x' }, call)).type, 's4m:error');
  assert.equal(await handleSub4meMessage({ type: 's4m:enrich-request', ticketId: 'TKT-1' }, call), null);
  assert.match((await handleSub4meMessage({ type: 's4m:enrich-request', requestId: 'e1', ticketId: 'TKT-1' }, undefined)).message, /not connected/);
});
