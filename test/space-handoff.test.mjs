import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as mod from '../src/space-handoff.ts';

test('a valid hand-over is parsed, a bad slug or oversized payload is dropped', () => {
  const ok = mod.parseHandoffMessage({ type: 'wb:handoff', to: 'infra-ops', payload: { type: 'ticket' }, notice: ' hi  there ' });
  assert.deepEqual(ok, { to: 'infra-ops', payload: { type: 'ticket' }, open: true, notice: 'hi there' });
  assert.equal(mod.parseHandoffMessage({ type: 'wb:handoff', to: '../x', payload: {} }), null);
  assert.equal(mod.parseHandoffMessage({ type: 'wb:handoff', to: 'a', payload: { x: 'y'.repeat(mod.MAX_HANDOFF_BYTES) } }), null);
  assert.equal(mod.parseHandoffMessage({ type: 'wb:handoff', to: 'a', payload: [] }), null);
  assert.equal(mod.parseHandoffMessage({ type: 'wb:handoff', to: 'a', payload: {}, open: false }).open, false);
});

test('state messages and the restore message', () => {
  assert.deepEqual(mod.parseStateMessage({ type: 'wb:state', state: { a: 1 } }), { a: 1 });
  assert.equal(mod.parseStateMessage({ type: 'wb:state', state: 'x' }), null);
  const r = mod.restoreMessage(undefined, [{ from: 'it-fleet', payload: { a: 1 }, nonce: 3 }]);
  assert.deepEqual(r, { type: 'wb:restore', state: null, handoffs: [{ from: 'it-fleet', payload: { a: 1 } }] });
});

test('the demo Spaces are wired for the change process', () => {
  const read = (n) => readFileSync(new URL(`../examples/${n}/index.html`, import.meta.url), 'utf8');
  assert.match(read('it-fleet'), /to: 'infra-ops'/);
  assert.match(read('it-fleet'), /ticket-closed/);
  assert.match(read('infra-ops'), /ticket-closed/);
  assert.match(read('infra-ops'), /change-checks/);
  assert.match(read('change-checks'), /check-result/);
});
