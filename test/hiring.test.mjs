import assert from 'node:assert/strict';
import test from 'node:test';
import { countByStatus, criterionError, decisionError, groupByRequisition, parseNeedles, readMyRequisitions, readProposals, validateCriterion } from '../src/hiring.ts';

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

const draft = (o = {}) => ({ label: 'Payroll experience', kind: 'text', minYears: '3', needles: 'payroll, Lohn', partial: '', ...o });

test('parseNeedles trims, drops empty and repeated terms and keeps ten', () => {
  assert.deepEqual(parseNeedles(' payroll, Lohn;\nPayroll ,, '), ['payroll', 'Lohn']);
  assert.equal(parseNeedles(Array.from({ length: 15 }, (_, i) => `t${i}`).join(',')).length, 10);
});

test('validateCriterion says no early, the database stays the authority', () => {
  assert.equal(validateCriterion(draft(), 2), '');
  assert.match(validateCriterion(draft({ label: ' ' }), 0), /Describe/);
  assert.match(validateCriterion(draft({ needles: ' , ' }), 0), /at least one word/);
  assert.match(validateCriterion(draft({ kind: 'years', minYears: '0' }), 0), /whole number/);
  assert.equal(validateCriterion(draft({ kind: 'years', minYears: '5', needles: '' }), 0), '');
  assert.match(validateCriterion(draft(), 12), /at most 12/);
  assert.match(validateCriterion(draft({ label: 'Younger than 35' }), 0), /must not refer/);
  assert.match(validateCriterion(draft({ needles: 'Geschlecht' }), 0), /must not refer/);
  assert.equal(validateCriterion(draft({ label: 'Storage and manager skills', needles: 'storage' }), 0), '', 'whole words only');
});

test('readMyRequisitions drops malformed rows and criteria', () => {
  const out = readMyRequisitions([
    { id: 'REQ-1', title: 'T', dept: 'D', criteria: [{ id: 'M1', must: true, text: 'x', kind: 'text', min: null, needles: ['a'], partial: [] }, { id: 'M2', must: 'yes' }] },
    { id: 7 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].criteria.length, 1);
  assert.equal(readMyRequisitions(null).length, 0);
});

test('criterionError explains the database messages', () => {
  assert.match(criterionError('only the hiring manager of an open requisition can set its criteria'), /Only the hiring manager/);
  assert.match(criterionError('a criterion cannot change between must-have and nice-to-have'), /Delete it/);
});
