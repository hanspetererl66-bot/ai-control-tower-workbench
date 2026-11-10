import assert from 'node:assert/strict';
import test from 'node:test';
import { asDbRequests, decideAgentRequest, loadAgentRequests, requestAgentLevel, targetFor } from '../src/agent-promotion-db.ts';
import { defaultGov, levelOf, requestPromotion } from '../src/skill-governance.ts';

const ITEM = '00000000-0000-4000-8000-000000000001';
const REQ = '11111111-2222-4333-8444-555555555555';
function fakeApi(handlers) {
  const calls = [];
  return { calls, async call(tool, args) { calls.push({ tool, args }); if (!handlers[tool]) throw new Error(`unexpected ${tool}`); return handlers[tool](args); } };
}

test('the next target: department from level 0, organization from level 1, none from the top', () => {
  assert.deepEqual([targetFor(0), targetFor(1), targetFor(2)], ['team', 'company', null]);
});

test('a request for the department sends the group; the id comes back with the warnings', async () => {
  const api = fakeApi({
    request_agent_promotion: () => ({ request: { id: REQ, status: 'review' } }),
    list_agent_requests: () => ({ requests: [{ id: REQ, item_id: ITEM, to: 'team', status: 'review', checks: [{ id: 'permissions', status: 'warn', detail: 'Can change data: write_access.' }, { id: 'secrets', status: 'pass', detail: '' }] }] }),
  });
  const r = await requestAgentLevel(api, { itemId: ITEM, level: 0, groupId: 'g-1', note: 'please' });
  assert.equal(r.id, REQ);
  assert.deepEqual(r.warnings, ['Can change data: write_access.']);
  assert.deepEqual(api.calls[0].args, { id: ITEM, to: 'team', group: 'g-1', note: 'please' });
});

test('a request the checks block is withdrawn at once and the failed checks are named', async () => {
  const api = fakeApi({
    request_agent_promotion: () => ({ request: { id: REQ, status: 'blocked' } }),
    list_agent_requests: () => ({ requests: [{ id: REQ, item_id: ITEM, to: 'team', status: 'blocked', checks: [{ id: 'harness', status: 'fail', detail: 'Tries to bypass the safety rules.' }] }] }),
    withdraw_agent_request: () => ({ withdrawn: { status: 'withdrawn' } }),
  });
  const r = await requestAgentLevel(api, { itemId: ITEM, level: 0, groupId: 'g-1' });
  assert.equal(r.id, undefined);
  assert.match(r.error, /Tries to bypass the safety rules/);
  assert.ok(api.calls.some((c) => c.tool === 'withdraw_agent_request' && c.args.id === REQ));
});

test('the organization step needs no group, the department step does, the top level has no next step', async () => {
  const api = fakeApi({ request_agent_promotion: () => ({ request: { id: REQ, status: 'review' } }), list_agent_requests: () => ({ requests: [] }) });
  assert.equal((await requestAgentLevel(api, { itemId: ITEM, level: 1 })).id, REQ);
  assert.deepEqual(api.calls[0].args, { id: ITEM, to: 'company', note: '' });
  assert.match((await requestAgentLevel(api, { itemId: ITEM, level: 0 })).error, /department/);
  assert.match((await requestAgentLevel(api, { itemId: ITEM, level: 2 })).error, /top level/);
});

test('the database decides: an approved request moves the local level, a refused decision is reported', async () => {
  const base = requestPromotion(defaultGov(), 'a-1', 'x', 1000, undefined, REQ);
  assert.equal(levelOf(base, 'a-1'), 0);
  const approved = fakeApi({ list_agent_requests: () => ({ requests: [{ id: REQ, item_id: ITEM, to: 'team', status: 'approved', reason: '', decided_at: '2026-11-10T10:00:00Z', can_decide: false }] }) });
  const r = await loadAgentRequests(approved, base);
  assert.equal(levelOf(r.gov, 'a-1'), 1);
  assert.deepEqual(r.canDecide, { [REQ]: false });
  const open = fakeApi({ list_agent_requests: () => ({ requests: [{ id: REQ, item_id: ITEM, to: 'team', status: 'review', can_decide: true }] }) });
  const o = await loadAgentRequests(open, base);
  assert.equal(levelOf(o.gov, 'a-1'), 0);
  assert.equal(o.canDecide[REQ], true);
  const refuse = fakeApi({ decide_agent_request: () => { throw new Error('the requester cannot decide their own request'); } });
  assert.deepEqual(await decideAgentRequest(refuse, REQ, true, ''), { ok: false, error: 'the requester cannot decide their own request' });
  const fine = fakeApi({ decide_agent_request: () => ({ decision: { status: 'approved' } }) });
  assert.deepEqual(await decideAgentRequest(fine, REQ, false, 'x'.repeat(500)), { ok: true });
  assert.equal(fine.calls[0].args.reason.length, 400);
  assert.equal(asDbRequests([{ id: REQ, item_id: ITEM, to: 'company', status: 'review' }])[0].slug, ITEM);
});
