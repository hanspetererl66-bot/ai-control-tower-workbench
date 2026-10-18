import assert from 'node:assert/strict';
import test from 'node:test';
import { skillIconKey } from '../src/skill-icons.ts';

test('each bundled skill gets a fitting icon and unknown names a neutral one', () => {
  assert.equal(skillIconKey('board-briefing'), 'chart');
  assert.equal(skillIconKey('ticket-writer'), 'ticket');
  assert.equal(skillIconKey('skill-finder'), 'search');
  assert.equal(skillIconKey('ship-branch'), 'rocket');
  assert.equal(skillIconKey('space-change'), 'layout');
  assert.equal(skillIconKey('something-else'), 'spark');
  assert.equal(skillIconKey(''), 'spark');
});
