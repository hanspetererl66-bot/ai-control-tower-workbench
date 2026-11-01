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
  assert.match(app, /bridgeEnabled=\{space\.slug === SUB4ME_SPACE \|\| space\.slug === PRD_SPACE\}/);
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

test('payment-risk requests call only predict_late_payments and pass on the rendered fields', async () => {
  const calls = [];
  const forecast = { asOf: '2026-10-18', engine: 'baseline', engineNote: 'n', trainedOn: '600 synthetic invoices', disclaimer: 'Demo', hidden: 1, customerHabit: { avgDelayDays: 3, lateShare: 0.2, paidInvoicesSeen: 8, x: 1 }, items: [{ id: 'INV-1', contractId: 'C-1', grossEur: 5, due: '2026-10-31', daysToDue: 13, lateProbability: 0.7, risk: 'high', drivers: [{ label: 'Invoice amount', value: 11.5, effectPct: 20, extra: 1 }], secret: 'x' }] };
  const reply = await handleSub4meMessage({ type: 's4m:payment-risk-request', requestId: 'p1', customer: 'hanse', tool: 'get_budget' }, async (tool, args) => (calls.push([tool, args]), ok(forecast)));
  assert.deepEqual(calls, [['predict_late_payments', { customer: 'hanse' }]]);
  assert.equal(reply.type, 's4m:payment-risk');
  assert.equal(reply.requestId, 'p1');
  assert.equal(reply.forecast.hidden, undefined);
  assert.equal(reply.forecast.items[0].secret, undefined);
  assert.deepEqual(reply.forecast.items[0].drivers, [{ label: 'Invoice amount', value: 11.5, effectPct: 20 }]);
  const none = await handleSub4meMessage({ type: 's4m:payment-risk-request', requestId: 'p2' }, undefined);
  assert.deepEqual(none, { type: 's4m:error', requestId: 'p2', message: 'The agent is not connected yet.' });
  const err = await handleSub4meMessage({ type: 's4m:payment-risk-request', requestId: 'p3' }, async () => ({ isError: true, content: [{ type: 'text', text: 'service not configured' }] }));
  assert.equal(err.message, 'service not configured');
  assert.equal(await handleSub4meMessage({ type: 's4m:payment-risk-request', requestId: '../x' }, async () => ok({})), null);
});
