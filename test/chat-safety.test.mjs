import test from 'node:test';
import assert from 'node:assert/strict';
import { safetyLine, safetyNotable } from '../src/chat-safety.ts';

test('the shield stays away for the standard profile and the usual approval modes', () => {
  assert.equal(safetyNotable('standard', 'auto'), false);
  assert.equal(safetyNotable('standard', 'smart_approve'), false);
  assert.equal(safetyNotable('', 'auto'), false, 'no profile chosen counts as standard');
  assert.equal(safetyNotable('standard', ''), false, 'mode not known yet: nothing to warn about');
});

test('the shield shows for another profile or an unusual approval mode', () => {
  assert.equal(safetyNotable('read-only', 'auto'), true);
  assert.equal(safetyNotable('group:finance', 'smart_approve'), true);
  assert.equal(safetyNotable('standard', 'chat'), true);
  assert.equal(safetyNotable('standard', 'approve'), true);
});

test('the shield line names what is in force', () => {
  assert.equal(safetyLine({ profileId: 'read-only', profileName: 'Review (read only)', modeId: 'approve', modeName: 'approve' }), 'Working profile: Review (read only) · Approval mode: approve');
  assert.equal(safetyLine({ profileId: '', profileName: '', modeId: '', modeName: '' }), 'Working profile: Standard · Approval mode: unknown');
});
