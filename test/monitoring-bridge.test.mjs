import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMonitoringMessage, pickAlerts, pickTopology } from '../src/monitoring-bridge.ts';

const alert = (o = {}) => ({ id: 'A1', customer: 'C', host: 'gw-01', service: 'S', severity: 'high', impact: 'high', customerFacing: true, repeat24h: 2, text: 'Down', at: '2026-11-12T08:55', ...o });
const host = (data) => { const calls = []; return { calls, alerts: async (h) => { calls.push(h); return { ok: true, data }; } }; };

test('only the one fixed request is answered', async () => {
  assert.equal(await handleMonitoringMessage({ type: 'x' }, host({})), null);
  assert.equal(await handleMonitoringMessage({ type: 'mon:alerts-request', requestId: 'bad id!' }, host({})), null);
  assert.equal((await handleMonitoringMessage({ type: 'mon:alerts-request', requestId: 'r' }, undefined)).type, 'ct:error');
});

test('the hours are clamped and passed on; the answer is cut down to the shown fields', async () => {
  const h = host({ adapter: 'http-json', fetchedAt: '2026-11-12T10:00', alerts: [alert({ secret: 'x', token: 'y' })], topology: { 'gw-01': ['gw-02'] }, secret: 'z' });
  const r = await handleMonitoringMessage({ type: 'mon:alerts-request', requestId: 'r', sinceHours: 9999, login: 'x' }, h);
  assert.deepEqual(h.calls, [168]);
  assert.deepEqual(r, { type: 'mon:alerts', requestId: 'r', source: 'live', adapter: 'http-json', fetchedAt: '2026-11-12T10:00', sinceHours: 168, alerts: [alert()], topology: { 'gw-01': ['gw-02'] } });
  await handleMonitoringMessage({ type: 'mon:alerts-request', requestId: 'r' }, h);
  assert.equal(h.calls[1], 24);
});

test('pickAlerts drops invalid alerts and plain-texts the rest; pickTopology keeps valid hosts only', () => {
  const list = pickAlerts([alert(), alert({ id: 'bad id' }), alert({ host: 'bad host' }), alert({ at: 'now' }), alert({ severity: 'weird' }), alert({ text: '  ' }), 'x', null, alert({ id: 'B', text: '<b>x</b>\nsecond', repeat24h: 99, impact: 'odd' })]);
  assert.deepEqual(list.map((a) => a.id), ['A1', 'B']);
  assert.equal(list[1].text, ' b x /b  second'.trim());
  assert.deepEqual([list[1].repeat24h, list[1].impact], [9, 'medium']);
  assert.deepEqual(pickAlerts('nope'), []);
  assert.deepEqual(pickTopology({ 'gw-01': ['gw-02', 'bad host'], 'bad host': ['x'], 'gw-03': 'no' }), { 'gw-01': ['gw-02'] });
  assert.deepEqual(pickTopology(null), {});
});

test('a failing or throwing host becomes an error message, nothing else', async () => {
  const fail = { alerts: async () => ({ ok: false, error: 'No monitoring is connected.' }) };
  assert.deepEqual(await handleMonitoringMessage({ type: 'mon:alerts-request', requestId: 'r' }, fail), { type: 'ct:error', requestId: 'r', message: 'No monitoring is connected.' });
  const boom = { alerts: async () => { throw new Error('boom'); } };
  assert.equal((await handleMonitoringMessage({ type: 'mon:alerts-request', requestId: 'r' }, boom)).message, 'boom');
});
