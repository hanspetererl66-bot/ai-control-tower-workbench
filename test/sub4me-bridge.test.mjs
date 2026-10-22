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

test('check-request asks for solutions and duplicates and hides other customers', async () => {
  const calls = [];
  const answers = {
    find_similar_tickets: { notes: [{ id: 'SAMPLE-1', title: 'Quota', solution: 'Scale', score: 0.7, strength: 'strong', updated: '2026-10-01', product: 'BTP AI Core' }], tickets: [
      { id: 'TKT-1', title: 'Secret title', product: 'BTP AI Core', status: 'Open', created: '2026-10-08', customer: 'muster', customerName: 'Muster Industrie AG', sameCustomer: false, score: 0.8, strength: 'strong' },
      { id: 'TKT-2', title: 'My own', product: 'BTP AI Core', status: 'Open', created: '2026-10-09', sameCustomer: true, score: 0.4, strength: 'possible' },
    ], dataSource: 'supabase', recommendation: 'x' },
    search_sap_help: { results: [{ title: 'Help hit', url: 'https://help.sap.com/docs/a', excerpt: 'e', product: 'SAP AI Core' }] },
    search_sap_community: { results: [{ title: 'Post', url: 'https://community.sap.com/t5/x', excerpt: 'e', board: 'Q&A' }] },
  };
  const reply = await handleSub4meMessage({ type: 's4m:check-request', requestId: 'c1', customer: 'hanse', title: 'Quota exceeded', product: 'BTP AI Core', description: 'details', extra: 'x' }, async (tool, args) => (calls.push([tool, args]), ok(answers[tool])));
  assert.deepEqual(calls.map((c) => c[0]).sort(), ['find_similar_tickets', 'search_sap_community', 'search_sap_help']);
  assert.deepEqual(calls.find((c) => c[0] === 'search_sap_help')[1], { q: 'BTP AI Core Quota exceeded', limit: 3 });
  assert.deepEqual(calls.find((c) => c[0] === 'find_similar_tickets')[1], { title: 'Quota exceeded', product: 'BTP AI Core', description: 'details', customer: 'hanse' });
  assert.equal(reply.type, 's4m:check-result');
  assert.equal(reply.requestId, 'c1');
  assert.equal(reply.duplicates.tickets[0].title, 'Same issue reported by another customer');
  assert.ok(!JSON.stringify(reply).includes('Secret title') && !JSON.stringify(reply).includes('Muster Industrie'));
  assert.equal(reply.duplicates.tickets[1].title, 'My own');
  assert.equal(reply.duplicates.notes[0].strength, 'strong');
  assert.equal(reply.help.results[0].label, 'SAP AI Core');
  assert.equal(reply.community.results[0].label, 'Q&A');
});

test('check-request reports each failing source separately and validates input', async () => {
  const call = async (tool) => (tool === 'search_sap_help' ? { isError: true, content: [{ type: 'text', text: 'SAP Help Portal not reachable: offline' }] } : ok(tool === 'find_similar_tickets' ? { notes: [], tickets: [], dataSource: 'sample' } : { results: [] }));
  const r = await handleSub4meMessage({ type: 's4m:check-request', requestId: 'c2', title: 'T' }, call);
  assert.equal(r.help.ok, false);
  assert.match(r.help.error, /not reachable/);
  assert.equal(r.community.ok, true);
  assert.equal(r.duplicates.ok, true);
  assert.equal((await handleSub4meMessage({ type: 's4m:check-request', requestId: 'c3', title: '' }, call)).message, 'invalid ticket');
  assert.equal(await handleSub4meMessage({ type: 's4m:check-request', requestId: '../x', title: 'T' }, call), null);
  assert.equal((await handleSub4meMessage({ type: 's4m:check-request', requestId: 'c4', title: 'T' }, undefined)).type, 's4m:error');
});
