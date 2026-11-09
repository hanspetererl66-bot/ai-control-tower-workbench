import assert from 'node:assert/strict';
import test from 'node:test';
import { handleOnboardingMessage, pickOnboarding } from '../src/onboarding-bridge.ts';
import { handleHiringMessage } from '../src/hiring-bridge.ts';
import { onboardingHandover, onboardingSet } from '../connectors/_lib/server/recruiting.mjs';
import { readFileSync } from 'node:fs';

const kase = { id: 3, requisition: 'REQ-2203', title: 'T', dept: 'D', candidate: 'C-1', start: '2027-01-11', handedOverAt: 'a', handedOverBy: 'hr@x.com', name: 'Secret', contract: { status: 'signed', signedAt: '2026-11-01', extra: 1 },
  steps: [{ id: 'it_accounts', status: 'blocked', note: 'licence', by: 'm@x.com', at: 'now' }, { id: 'x', status: 'weird', note: '', by: '', at: '' }] };
function host() {
  const calls = [];
  return { calls, list: async () => { calls.push(['list']); return { ok: true, data: { cases: [kase], ready: [{ id: 4, requisition: 'R', title: 't', dept: 'd', signedAt: 's', salary: 1 }] } }; },
    handover: async (id, start) => { calls.push(['handover', id, start]); return { ok: true, data: { created: true } }; },
    set: async (id, step, status, note) => { calls.push(['set', id, step, status, note]); return { ok: true, data: {} }; } };
}

test('only the three fixed requests are answered', async () => {
  assert.equal(await handleOnboardingMessage({ type: 'x' }, host()), null);
  assert.equal(await handleOnboardingMessage({ type: 'ob:list-request', requestId: 'bad id!' }, host()), null);
  assert.equal((await handleOnboardingMessage({ type: 'ob:list-request', requestId: 'r' }, undefined)).type, 'ct:error');
});

test('list: cut down to the rendered fields; unknown step status becomes open', async () => {
  const r = await handleOnboardingMessage({ type: 'ob:list-request', requestId: 'r1' }, host());
  assert.equal(r.type, 'ob:list');
  assert.equal(r.cases[0].name, undefined); assert.equal(r.cases[0].contract.extra, undefined); assert.equal(r.ready[0].salary, undefined);
  assert.deepEqual(r.cases[0].steps.map((s) => s.status), ['blocked', 'open']);
  assert.deepEqual(pickOnboarding(null), { cases: [], ready: [] });
});

test('set: blocked needs a reason, status and step are checked, the call reaches the host', async () => {
  const h = host();
  const ask = (m) => handleOnboardingMessage({ type: 'ob:set-request', requestId: 'r2', id: 3, step: 'it_accounts', status: 'done', ...m }, h);
  assert.match((await ask({ status: 'blocked' })).message, /reason/);
  assert.match((await ask({ status: 'finished' })).message, /Unknown step or status/);
  assert.match((await ask({ step: 'Bad Step!' })).message, /Unknown step or status/);
  assert.match((await ask({ id: 0 })).message, /Unknown hire/);
  assert.deepEqual(await ask({ status: 'blocked', note: ' licence ' }), { type: 'ob:set', requestId: 'r2', result: { id: 3, step: 'it_accounts', status: 'blocked' } });
  assert.deepEqual(h.calls, [['set', 3, 'it_accounts', 'blocked', 'licence']]);
});

test('handover: a start date is needed; Hiring Approvals can hand over too', async () => {
  const h = host();
  assert.match((await handleOnboardingMessage({ type: 'ob:handover-request', requestId: 'r3', id: 3, start: 'soon' }, h)).message, /start date/);
  assert.deepEqual(await handleOnboardingMessage({ type: 'ob:handover-request', requestId: 'r3', id: 3, start: '2027-01-11' }, h), { type: 'ob:handed', requestId: 'r3', result: { id: 3, created: true } });
  const hh = { list: async () => ({ ok: true, data: {} }), decide: async () => ({ ok: true, data: {} }), handover: h.handover };
  assert.deepEqual(await handleHiringMessage({ type: 'ha:handover-request', requestId: 'r4', id: 5, start: '2027-02-01' }, hh), { type: 'ha:handed', requestId: 'r4', result: { id: 5, created: true } });
  assert.match((await handleHiringMessage({ type: 'ha:handover-request', requestId: 'r4', id: 5, start: '' }, hh)).message, /start date/);
});

test('connector calls check their input and call the fixed functions; none of them is an agent tool', async () => {
  const calls = [], rpc = async (fn, args) => { calls.push([fn, args]); return {}; };
  await assert.rejects(() => onboardingHandover(rpc, 'hr@x.com', 3, 'soon'), /start must be a date/);
  await assert.rejects(() => onboardingSet(rpc, 'hr@x.com', 3, 'it_accounts', 'blocked', ' '), /reason/);
  await onboardingSet(rpc, 'hr@x.com', 3, 'it_accounts', 'done');
  assert.deepEqual(calls, [['recruiting_onboarding_set', { p_actor: 'hr@x.com', p_id: 3, p_step: 'it_accounts', p_status: 'done', p_note: '' }]]);
  const src = readFileSync(new URL('../connectors/_lib/server/recruiting.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /recruiting_onboarding_\w+['"]\s*:\s*(async|\()/, 'no tool handler for onboarding');
});

test('the Spaces carry the live layer and the migration holds the rules', () => {
  const ob = readFileSync(new URL('../examples/onboarding/index.html', import.meta.url), 'utf8');
  for (const n of ['ob:list-request', 'ob:set-request', 'ob:handover-request', 'Mark done', 'Blocked…']) assert.ok(ob.includes(n), n);
  const hi = readFileSync(new URL('../examples/hiring-approvals/index.html', import.meta.url), 'utf8');
  for (const n of ['ha:handover-request', 'Hand over to onboarding']) assert.ok(hi.includes(n), n);
  const sql = readFileSync(new URL('../supabase/migrations/20261108_039_onboarding.sql', import.meta.url), 'utf8');
  for (const n of ['only after the signature', 'only the HR approver', 'reason is needed', 'append only', 'to service_role']) assert.ok(sql.includes(n), n);
});
