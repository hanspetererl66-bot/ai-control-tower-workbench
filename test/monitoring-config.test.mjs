import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { agentSecrets, createMonitoringConfig, MAIN_ONLY_ENV, takeMainOnlyEnv } from '../shared/monitoring-config.mjs';
import { createHttpJsonAdapter, createMonitoringRead, MonitoringError } from '../shared/monitoring-read.mjs';
import { TAB_HELP } from '../src/settings-help.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const TOKEN = 'read-only-token-12345';

function setup(env = {}) {
  const data = {};
  const calls = [];
  const store = { read: (n) => ({ ...(data[n] || {}) }), write: (n, v) => { data[n] = { ...(data[n] || {}), ...v }; calls.push(['write', n]); }, forget: (n) => { delete data[n]; calls.push(['forget', n]); } };
  const fetchImpl = async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify({ alerts: [{ id: 'A', host: 'gw-01', severity: 'high', at: '2026-11-12T08:55:00Z', text: 'x' }] }) });
  const monitoring = createMonitoringRead({ adapter: () => { const s = data.monitoring; return s ? createHttpJsonAdapter({ baseUrl: s.MONITORING_BASE_URL, token: s.MONITORING_READ_TOKEN, fetchImpl }) : null; }, mapFile: '/nonexistent.json' });
  return { data, calls, config: createMonitoringConfig({ store, env, monitoring }) };
}

test('nothing configured; saving needs an https address and a token; the token is never given back', () => {
  const { config, data } = setup();
  assert.deepEqual(config.get(), { configured: false, source: 'none', baseUrl: '', tokenSet: false, adapter: 'http-json' });
  assert.throws(() => config.set({ baseUrl: 'https://mon.example/api' }), /A token is needed/);
  assert.throws(() => config.set({ baseUrl: 'http://mon.example', token: TOKEN }), /https/);
  assert.throws(() => config.set({ baseUrl: 'https://u:p@mon.example', token: TOKEN }), /login/);
  assert.throws(() => config.set({ baseUrl: 'https://mon.example', token: 'short' }), /token looks wrong/);
  assert.throws(() => config.set({ baseUrl: 'https://mon.example', token: 'has a space in it' }), /token looks wrong/);
  assert.throws(() => config.set({ baseUrl: 'https://mon.example', token: 'x'.repeat(2001) }), MonitoringError);
  const v = config.set({ baseUrl: 'https://mon.example/api/', token: ` ${TOKEN} ` });
  assert.deepEqual(v, { configured: true, source: 'app', baseUrl: 'https://mon.example/api', tokenSet: true, adapter: 'http-json' });
  assert.equal(data.monitoring.MONITORING_READ_TOKEN, TOKEN, 'stored trimmed');
  assert.ok(!JSON.stringify(v).includes(TOKEN) && !JSON.stringify(config.get()).includes(TOKEN), 'the token is never in what the dialog sees');
});

test('a new address without a token keeps the saved token; a new token replaces it; Remove forgets both', () => {
  const { config, data } = setup();
  config.set({ baseUrl: 'https://mon.example', token: TOKEN });
  config.set({ baseUrl: 'https://other.example/v2', token: '' });
  assert.deepEqual([data.monitoring.MONITORING_BASE_URL, data.monitoring.MONITORING_READ_TOKEN], ['https://other.example/v2', TOKEN]);
  config.set({ baseUrl: 'https://other.example/v2', token: 'second-token-6789' });
  assert.equal(data.monitoring.MONITORING_READ_TOKEN, 'second-token-6789');
  const gone = config.clear();
  assert.deepEqual(gone, { configured: false, source: 'none', baseUrl: '', tokenSet: false, adapter: 'http-json' });
  assert.equal(data.monitoring, undefined);
});

test('settings from the environment count as configured but are not shown or changed', () => {
  const { config } = setup({ MONITORING_BASE_URL: 'https://env.example', MONITORING_READ_TOKEN: TOKEN });
  assert.deepEqual(config.get(), { configured: true, source: 'environment', baseUrl: '', tokenSet: false, adapter: 'http-json' });
});

test('the test of the connection reports only the adapter and a count, and a failure never contains the token', async () => {
  const { config } = setup();
  config.set({ baseUrl: 'https://mon.example', token: TOKEN });
  assert.deepEqual(await config.test(), { adapter: 'http-json', count: 1 });
  const { config: bad } = setup();
  await assert.rejects(bad.test(), /No monitoring is connected/);
  const failing = createMonitoringConfig({ store: { read: () => ({ MONITORING_BASE_URL: 'https://m.example', MONITORING_READ_TOKEN: TOKEN }), write() {}, forget() {} }, monitoring: createMonitoringRead({ adapter: () => createHttpJsonAdapter({ baseUrl: 'https://m.example', token: TOKEN, fetchImpl: async () => { throw new Error(`boom ${TOKEN}`); } }), mapFile: '/x.json' }) });
  await assert.rejects(failing.test(), (e) => !e.message.includes(TOKEN));
});

test('the monitoring login never reaches the agent runtime: not through the saved secrets, not through the environment', () => {
  const store = { gmail: { GOOGLE_CLIENT_ID: 'id' }, monitoring: { MONITORING_READ_TOKEN: TOKEN, MONITORING_BASE_URL: 'https://m.example' }, other: { X: '1' } };
  assert.deepEqual(agentSecrets(store), { GOOGLE_CLIENT_ID: 'id', X: '1' });
  const env = { PATH: '/bin', MONITORING_READ_TOKEN: TOKEN, MONITORING_BASE_URL: 'https://m.example', MONITORING_ADAPTER: 'http-json' };
  const taken = takeMainOnlyEnv(env);
  assert.deepEqual(taken, { MONITORING_READ_TOKEN: TOKEN, MONITORING_BASE_URL: 'https://m.example', MONITORING_ADAPTER: 'http-json' });
  assert.deepEqual(env, { PATH: '/bin' }, 'removed, so no child process inherits it');
  assert.deepEqual(takeMainOnlyEnv({}), {});
  assert.deepEqual(MAIN_ONLY_ENV, ['MONITORING_BASE_URL', 'MONITORING_READ_TOKEN', 'MONITORING_ADAPTER']);
});

test('the main process wires it that way: environment taken at load, secrets filtered for the agent, the access reads its own store', () => {
  const main = read('electron/main.mjs');
  assert.match(main, /const MONITORING_ENV = takeMainOnlyEnv\(process\.env\);/);
  assert.match(main, /function loadSecrets\(\) \{\s*return agentSecrets\(loadSecretStore\(\)\);/);
  assert.match(main, /adapter: \(\) => \{ const s = secretsFor\('monitoring'\);/);
  assert.ok(main.indexOf('takeMainOnlyEnv(process.env)') < main.indexOf('function startGoosed'), 'taken before the agent runtime starts');
  assert.doesNotMatch(main, /MONITORING_[A-Z_]+: process\.env/, 'no read of the monitoring login from process.env after load');
  const preload = read('electron/preload.cjs');
  for (const f of ['monitoringConfigGet', 'monitoringConfigSet', 'monitoringConfigClear', 'monitoringConfigTest']) assert.match(preload, new RegExp(f));
  assert.doesNotMatch(preload, /monitoring-config-get'[^)]*token/i);
});

test('the Settings tab: it exists, it is explained, the token field is a password field and the token is never shown back', () => {
  const dialog = read('src/ui/SettingsDialog.tsx'), panel = read('src/ui/MonitoringPanel.tsx');
  assert.match(dialog, /\{ id: 'monitoring', title: 'Monitoring' \}/);
  assert.match(dialog, /tab === 'monitoring' && <MonitoringPanel \/>/);
  assert.ok(TAB_HELP.monitoring.what && TAB_HELP.monitoring.where && TAB_HELP.monitoring.effect);
  assert.match(TAB_HELP.monitoring.effect, /never shown again/);
  assert.match(panel, /type="password"/);
  assert.match(panel, /autoComplete="off"/);
  assert.match(panel, /may only read/);
  assert.equal((panel.match(/\{token\}/g) || []).length, 1, 'the token appears once: as the value of its own input');
  assert.match(panel, /type="password" value=\{token\}/);
  assert.doesNotMatch(panel, /\.(token|MONITORING_READ_TOKEN)\b(?!Set)/, 'nothing reads a token out of an answer');
  assert.match(panel, /setToken\(''\)/, 'forgotten after saving');
});
