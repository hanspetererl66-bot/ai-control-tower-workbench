import assert from 'node:assert/strict';
import test from 'node:test';
import { countByStatus, decisionError, groupByRequisition, readProposals } from '../src/hiring.ts';

const row = (o = {}) => ({ id: 1, requisition: 'REQ-2201', candidate: 'C-4101', kind: 'move', tool: 'recruiting_create_proposal', text: 'Move C-4101.', basis: 'meets all', status: 'proposed', proposedBy: 'a@x.com', at: '2026-11-06T10:00:00Z', decidedBy: null, decidedAt: null, note: '', ...o });

test('readProposals keeps good rows and drops malformed ones', () => {
  const out = readProposals([row(), row({ id: 2, kind: 'reject' }), row({ id: 3, status: 'maybe' }), { id: 'x' }, null, row({ id: 4, text: 5 })]);
  assert.deepEqual(out.map((p) => p.id), [1]);
  assert.deepEqual(readProposals('nope'), []);
});

test('groups by requisition in id order, newest first', () => {
  const g = groupByRequisition(readProposals([row({ id: 1, requisition: 'REQ-2204', at: '2026-11-01T00:00:00Z' }), row({ id: 2, requisition: 'REQ-2201' }), row({ id: 3, requisition: 'REQ-2204', at: '2026-11-05T00:00:00Z' })]));
  assert.deepEqual(g.map((x) => x.requisition), ['REQ-2201', 'REQ-2204']);
  assert.deepEqual(g[1].items.map((p) => p.id), [3, 1]);
});

test('counts by status and explains the database rules in plain words', () => {
  assert.deepEqual(countByStatus(readProposals([row(), row({ id: 2, status: 'released', decidedBy: 'a@x.com', decidedAt: 'x' }), row({ id: 3, status: 'declined', decidedBy: 'a@x.com', decidedAt: 'x' })])), { proposed: 1, released: 1, declined: 1 });
  assert.match(decisionError('only the hiring manager of this requisition can release or decline a proposal'), /different e-mail/);
  assert.match(decisionError('the proposal is already decided'), /already decided/);
  assert.equal(decisionError('boom'), 'boom');
});
