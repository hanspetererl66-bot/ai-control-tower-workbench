import assert from 'node:assert/strict';
import test from 'node:test';
import { handleHotlineMailMessage, pickFields } from '../src/hotline-mail-bridge.ts';

const fields = { id: 'CHG-1', customer: 'C', task: 'T', target: 'x', start: '2026-10-28T22:00', end: '2026-10-29T00:00', to: 'evil@example.com', extra: 1 };
function host() {
  const calls = [];
  return { calls,
    preview: async (f) => { calls.push(['preview', f]); return { ok: true, data: { to: 'a@b.c', subject: 's', body: 'b', secret: 'x' } }; },
    send: async (f) => { calls.push(['send', f]); return { ok: true, data: { sent: true, at: 'now', to: 'a@b.c', token: 'x' } }; } };
}

test('only the two fixed requests are answered', async () => {
  assert.equal(await handleHotlineMailMessage({ type: 'x' }, host()), null);
  assert.equal(await handleHotlineMailMessage({ type: 'hm:send-request', requestId: 'bad id!' }, host()), null);
  assert.equal((await handleHotlineMailMessage({ type: 'hm:send-request', requestId: 'r' }, undefined)).type, 'ct:error');
});

test('only the six plain fields reach the host: a recipient or other field from the Space is dropped', async () => {
  const h = host();
  await handleHotlineMailMessage({ type: 'hm:send-request', requestId: 'r', fields }, h);
  assert.deepEqual(Object.keys(h.calls[0][1]), ['id', 'customer', 'task', 'target', 'start', 'end']);
  assert.deepEqual(pickFields(null), { id: '', customer: '', task: '', target: '', start: '', end: '' });
});

test('answers are cut down to the rendered fields', async () => {
  const p = await handleHotlineMailMessage({ type: 'hm:preview-request', requestId: 'r', fields }, host());
  assert.deepEqual(p, { type: 'hm:preview', requestId: 'r', mail: { to: 'a@b.c', subject: 's', body: 'b' } });
  const s = await handleHotlineMailMessage({ type: 'hm:send-request', requestId: 'r', fields }, host());
  assert.deepEqual(s, { type: 'hm:sent', requestId: 'r', result: { sent: true, reason: '', at: 'now', to: 'a@b.c' } });
});

test('errors of the host come back as ct:error', async () => {
  const h = { preview: async () => ({ ok: false, error: 'No test recipient is set.' }) };
  assert.deepEqual(await handleHotlineMailMessage({ type: 'hm:preview-request', requestId: 'r', fields }, h), { type: 'ct:error', requestId: 'r', message: 'No test recipient is set.' });
  const t = { preview: async () => { throw new Error('boom'); } };
  assert.equal((await handleHotlineMailMessage({ type: 'hm:preview-request', requestId: 'r', fields }, t)).message, 'boom');
});
