import test from 'node:test';
import assert from 'node:assert/strict';
import * as a from '../src/skill-approval.ts';

test('a pending request waits at the review step', () => {
  const s = a.approvalSteps(1, { status: 'pending' });
  assert.deepEqual(s.map((x) => x.state), ['done', 'done', 'active', 'todo']);
  assert.match(s[2].who, /Department lead/);
});
test('approved is complete, rejected stops at the review', () => {
  assert.ok(a.approvalSteps(2, { status: 'approved' }).every((x) => x.state === 'done'));
  assert.deepEqual(a.approvalSteps(2, { status: 'rejected' }).map((x) => x.state), ['done', 'done', 'rejected', 'todo']);
});
test('without a request every step is open and the organisation level needs the board', () => {
  const s = a.approvalSteps(2);
  assert.ok(s.every((x) => x.state === 'todo'));
  assert.match(s[2].who, /Governance board/);
});
test('a preview can show the automatic review as blocked', () => {
  const s = a.approvalSteps(1, null, 'rejected');
  assert.deepEqual(s.map((x) => x.state), ['done', 'rejected', 'todo', 'todo']);
});
