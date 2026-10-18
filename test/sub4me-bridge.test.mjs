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
