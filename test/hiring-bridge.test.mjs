import assert from 'node:assert/strict';
import test from 'node:test';
import { handleHiringMessage, pickHireRequests } from '../src/hiring-bridge.ts';

const row = { id: 3, requisition: 'REQ-2203', title: 'T', dept: 'D', candidate: 'C-4204', terms: { level: 'Senior', band: 'Band 5', start_on: '2027-01-15', contract: 'permanent', note: '', salary: 99999 }, evidence: 'e', status: 'pending', currentStep: 2, createdBy: 'm@x.com', at: 'a', decidedAt: null, mine: true, email: 'secret@x.com',
  steps: [{ ord: 1, role: 'hiring_manager', approver: 'm@x.com', status: 'approved', decidedAt: 'a', note: '' }], events: [{ event: 'created', role: 'hiring_manager', actor: 'm@x.com', at: 'a', note: '' }] };

function host() {
  const calls = [];
  return { calls, list: async (a) => { calls.push(['list', a]); return { ok: true, data: { requests: [row] } }; },
    decide: async (id, d, n) => { calls.push(['decide', id, d, n]); return { ok: true, data: { id, event: 'approved', step: 2, final: false, status: 'pending', extra: 1 } }; } };
}

test('only the three fixed requests are answered, others are ignored', async () => {
  assert.equal(await handleHiringMessage({ type: 'x' }, host()), null);
  assert.equal(await handleHiringMessage({ type: 'ha:list-request', requestId: 'bad id!' }, host()), null);
  assert.equal(await handleHiringMessage('ha:list-request', host()), null);
});

test('list: default status pending, answer cut down to the rendered fields', async () => {
  const h = host();
  const r = await handleHiringMessage({ type: 'ha:list-request', requestId: 'r1', status: 'drop table' }, h);
  assert.deepEqual(h.calls[0], ['list', { status: 'pending', limit: 200 }]);
  assert.equal(r.type, 'ha:list');
  assert.equal(r.requests[0].terms.salary, undefined);
  assert.equal(r.requests[0].email, undefined);
  assert.equal(r.requests[0].mine, true);
});

test('decide: approve needs no reason, return and decline do', async () => {
  const h = host();
  const ok = await handleHiringMessage({ type: 'ha:decide-request', requestId: 'r2', id: 3, decision: 'approve' }, h);
  assert.equal(ok.type, 'ha:decided');
  assert.equal(ok.result.extra, undefined);
  const no = await handleHiringMessage({ type: 'ha:decide-request', requestId: 'r3', id: 3, decision: 'return', note: '  ' }, h);
  assert.equal(no.type, 'ct:error');
  assert.equal(h.calls.length, 1);
  const bad = await handleHiringMessage({ type: 'ha:decide-request', requestId: 'r4', id: 3, decision: 'released' }, h);
  assert.equal(bad.type, 'ct:error');
});

test('no host (browser) gives a clear error; open-tools calls back without a reply', async () => {
  assert.match((await handleHiringMessage({ type: 'ha:list-request', requestId: 'r5' }, undefined)).message, /desktop app/);
  let opened = 0;
  assert.equal(await handleHiringMessage({ type: 'ha:open-tools' }, undefined, () => { opened += 1; }), null);
  assert.equal(opened, 1);
  assert.deepEqual(pickHireRequests('x'), []);
});

test('database errors are passed on as text', async () => {
  const h = { list: async () => ({ ok: false, error: 'it is not your turn' }), decide: async () => { throw new Error('boom'); } };
  assert.equal((await handleHiringMessage({ type: 'ha:list-request', requestId: 'r6' }, h)).message, 'it is not your turn');
  assert.equal((await handleHiringMessage({ type: 'ha:decide-request', requestId: 'r7', id: 1, decision: 'approve' }, h)).message, 'boom');
});

test('the contract reaches the page as a state only: no text, no document, unknown states are dropped', () => {
  const contract = { status: 'signed', template: 'employment-v1', bodySha256: 'a'.repeat(64), provider: 'MockSign', preparedAt: 'p', sentAt: 's', expiresAt: 'e', decidedAt: 'd', signedAt: 'g', signedSha256: 'b'.repeat(64), hasDocument: true, method: 'simulation',
    body: 'EMPLOYMENT CONTRACT ...', signedDocument: 'JVBERi0=', name: 'Jane Doe' };
  const [r] = pickHireRequests([{ ...row, contract }]);
  assert.deepEqual(Object.keys(r.contract).sort(), ['bodySha256', 'decidedAt', 'expiresAt', 'hasDocument', 'method', 'preparedAt', 'provider', 'sentAt', 'signedAt', 'signedSha256', 'status', 'template']);
  assert.ok(!JSON.stringify(r).includes('EMPLOYMENT') && !JSON.stringify(r).includes('JVBERi') && !JSON.stringify(r).includes('Jane'));
  assert.equal(pickHireRequests([{ ...row, contract: { status: 'weird' } }])[0].contract, null);
  assert.equal(pickHireRequests([row])[0].contract, null, 'no contract yet');
});
