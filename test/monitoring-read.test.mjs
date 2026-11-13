import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { adapterFromEnv, assertReadOnly, createHttpJsonAdapter, createMonitoringRead, createZabbixAdapter, MonitoringError, normalizeAlert, normalizeAll, readMap, toMinute } from '../shared/monitoring-read.mjs';

const dir = mkdtempSync(join(tmpdir(), 'mon-'));
const mapFile = join(dir, 'monitoring-map.json');
writeFileSync(mapFile, JSON.stringify({ hosts: {
  'gw-01': { customer: 'Muster Industrie AG', service: 'Gateway', impact: 'high', customerFacing: true, dependsOn: ['gw-02', 'bad host!'] },
  'gw-02': { customer: 'Muster Industrie AG', impact: 'high', customerFacing: true },
  'x y': { customer: 'ignored' },
} }));
const raw = (o = {}) => ({ id: 'A1', host: 'gw-01', service: 'Gateway', severity: 'critical', at: '2026-11-12T08:55:00Z', text: 'Error rate 38 %', ...o });
const TOKEN = 'secret-token-123';

test('toMinute: UTC to the minute, anything that is not a time becomes empty', () => {
  assert.equal(toMinute('2026-11-12T10:55:30+02:00'), '2026-11-12T08:55');
  assert.equal(toMinute(Date.parse('2026-11-12T08:55:59Z')), '2026-11-12T08:55');
  for (const bad of ['', 'yesterday', null, undefined, {}, '1970-01-01T00:00:00Z', '3000-01-01T00:00:00Z']) assert.equal(toMinute(bad), '');
});

test('normalizeAlert takes only the listed fields; the customer comes from the local map, not from the monitoring', () => {
  const hosts = readMap(mapFile).hosts;
  const a = normalizeAlert(raw({ customer: 'Evil Corp', password: 'x', token: 'y', extra: { deep: 1 } }), hosts);
  assert.deepEqual(a, { id: 'A1', customer: 'Muster Industrie AG', host: 'gw-01', service: 'Gateway', severity: 'critical', impact: 'high', customerFacing: true, repeat24h: 0, text: 'Error rate 38 %', at: '2026-11-12T08:55' });
  const unknown = normalizeAlert(raw({ host: 'other-01' }), hosts);
  assert.deepEqual([unknown.customer, unknown.impact, unknown.customerFacing, unknown.service], ['', 'medium', false, 'Gateway']);
});

test('normalizeAlert refuses what is not valid and maps the severity words of common systems', () => {
  for (const bad of [null, 'x', raw({ id: 'bad id' }), raw({ id: '' }), raw({ host: 'bad host' }), raw({ severity: 'weird' }), raw({ at: 'nope' }), raw({ text: '   ' }), raw({ host: undefined })]) assert.equal(normalizeAlert(bad), null);
  for (const [w, s] of [['Disaster', 'critical'], ['major', 'high'], ['Warning', 'medium'], ['average', 'medium'], ['info', 'low'], ['LOW', 'low']]) assert.equal(normalizeAlert(raw({ severity: w })).severity, s);
  assert.equal(normalizeAlert(raw({ id: 42 })).id, '42');
});

test('text is plain, short and on one line: no markup, no control characters', () => {
  const a = normalizeAlert(raw({ text: '<b>Down</b>\r\n\u0007line two   ' + 'x'.repeat(500) }));
  assert.ok(!/[<>\n\r\u0007]/.test(a.text));
  assert.ok(a.text.length <= 300);
  assert.match(a.text, /^b Down \/b line two/);
});

test('normalizeAll: each id once, oldest first, repeats of the same text on a host counted, at most 200', () => {
  const list = [raw({ id: 'B', at: '2026-11-12T09:00:00Z' }), raw({ id: 'A', at: '2026-11-12T08:55:00Z' }), raw({ id: 'A', at: '2026-11-12T08:56:00Z' }), raw({ id: 'C', at: '2026-11-13T08:55:00Z' }), raw({ id: 'D', host: 'gw-02', at: '2026-11-12T09:01:00Z' }), { broken: true }];
  const out = normalizeAll(list);
  assert.deepEqual(out.map((a) => a.id), ['A', 'B', 'D', 'C']);
  assert.equal(out.find((a) => a.id === 'A').repeat24h, 2, 'B is the same text on the same host within a day; C is 24 h after A');
  assert.equal(out.find((a) => a.id === 'D').repeat24h, 0, 'another host');
  const many = normalizeAll(Array.from({ length: 500 }, (_, i) => raw({ id: 'M' + i, text: 'T' + i })));
  assert.equal(many.length, 200);
  assert.deepEqual(normalizeAll('nope'), []);
});

test('an adapter may only read: a name and listAlerts, nothing else', () => {
  assert.doesNotThrow(() => assertReadOnly({ name: 'x', listAlerts: async () => [] }));
  for (const bad of [null, {}, { name: 'x' }, { name: 'x', listAlerts: async () => [], acknowledge: () => {} }, { name: 'x', listAlerts: async () => [], delete() {} }, { listAlerts: 'no' }]) assert.throws(() => assertReadOnly(bad), MonitoringError);
});

function fakeFetch(calls, answer = { alerts: [raw()] }, status = 200) {
  return async (url, init) => { calls.push({ url: String(url), init }); return { ok: status < 400, status, text: async () => (typeof answer === 'string' ? answer : JSON.stringify(answer)) }; };
}

test('the http-json adapter sends one GET with the bearer token in the header, no redirects, and reads the alerts', async () => {
  const calls = [];
  const a = createHttpJsonAdapter({ baseUrl: 'https://mon.example/api/', token: TOKEN, fetchImpl: fakeFetch(calls) });
  assert.ok(Object.isFrozen(a));
  assert.deepEqual(Object.keys(a).sort(), ['listAlerts', 'name']);
  const list = await a.listAlerts({ since: '2026-11-11T08:00:00.000Z', limit: 200 });
  assert.equal(list.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://mon.example/api/alerts?since=2026-11-11T08%3A00%3A00.000Z&limit=200');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(!calls[0].url.includes(TOKEN), 'the token is never in the address');
  assert.equal(calls[0].init.body, undefined);
});

test('the adapter accepts a plain array too, and refuses http, logins in the address, a missing token, big or broken answers; errors never contain the token', async () => {
  assert.deepEqual(await createHttpJsonAdapter({ baseUrl: 'https://m.example', token: TOKEN, fetchImpl: fakeFetch([], [raw()]) }).listAlerts({ since: 's', limit: 1 }), [raw()]);
  assert.doesNotThrow(() => createHttpJsonAdapter({ baseUrl: 'http://localhost:8080', token: TOKEN, fetchImpl: fakeFetch([]) }));
  assert.throws(() => createHttpJsonAdapter({ baseUrl: 'http://mon.example', token: TOKEN }), /https/);
  assert.throws(() => createHttpJsonAdapter({ baseUrl: 'https://user:pw@mon.example', token: TOKEN }), /login/);
  assert.throws(() => createHttpJsonAdapter({ baseUrl: 'not a url', token: TOKEN }), /not a valid URL/);
  assert.throws(() => createHttpJsonAdapter({ baseUrl: 'https://mon.example', token: ' ' }), /token is missing/);
  const run = (f) => createHttpJsonAdapter({ baseUrl: 'https://mon.example', token: TOKEN, fetchImpl: f }).listAlerts({ since: 's', limit: 1 });
  await assert.rejects(run(fakeFetch([], {}, 401)), /HTTP 401/);
  await assert.rejects(run(fakeFetch([], 'not json')), /not JSON/);
  await assert.rejects(run(fakeFetch([], 'x'.repeat(1_000_001))), /too large/);
  const failing = async () => { throw new Error(`boom ${TOKEN}`); };
  await assert.rejects(run(failing), (e) => e instanceof MonitoringError && !e.message.includes(TOKEN));
});

test('adapterFromEnv: nothing configured gives null; http-json and zabbix exist, anything else is refused', () => {
  assert.equal(adapterFromEnv({}), null);
  assert.equal(adapterFromEnv({ MONITORING_BASE_URL: 'https://m.example' }), null);
  assert.equal(adapterFromEnv({ MONITORING_BASE_URL: 'https://m.example', MONITORING_READ_TOKEN: TOKEN }, fakeFetch([])).name, 'http-json');
  assert.equal(adapterFromEnv({ MONITORING_BASE_URL: 'https://m.example', MONITORING_READ_TOKEN: TOKEN, MONITORING_ADAPTER: 'zabbix' }, fakeFetch([])).name, 'zabbix');
  assert.throws(() => adapterFromEnv({ MONITORING_BASE_URL: 'https://m.example', MONITORING_READ_TOKEN: TOKEN, MONITORING_ADAPTER: 'prometheus' }), /Unknown monitoring adapter[\s\S]*Known: http-json, zabbix/);
});

test('readMap: valid hosts only, dependencies as a topology, a missing file is an empty map', () => {
  const m = readMap(mapFile);
  assert.deepEqual(Object.keys(m.hosts).sort(), ['gw-01', 'gw-02']);
  assert.deepEqual(m.topology, { 'gw-01': ['gw-02'] });
  assert.deepEqual(readMap(join(dir, 'missing.json')), { hosts: {}, topology: {} });
});

test('createMonitoringRead: not configured says how to configure it; configured returns live alerts, the topology of the hosts seen, and logs only counts', async () => {
  const none = createMonitoringRead({ adapter: () => null, mapFile });
  assert.deepEqual(none.status(), { configured: false, adapter: '' });
  await assert.rejects(none.alerts(), /No monitoring is connected\. Set MONITORING_BASE_URL and MONITORING_READ_TOKEN/);
  const calls = [], logs = [];
  const mon = createMonitoringRead({ adapter: createHttpJsonAdapter({ baseUrl: 'https://mon.example', token: TOKEN, fetchImpl: fakeFetch(calls, { alerts: [raw(), raw({ id: 'B', host: 'gw-02', text: 'Quota 96 %', at: '2026-11-12T08:41:00Z' })] }) }), mapFile, now: () => new Date('2026-11-12T10:00:00Z'), log: (e) => logs.push(e) });
  assert.deepEqual(mon.status(), { configured: true, adapter: 'http-json' });
  const r = await mon.alerts({ sinceHours: 9999 });
  assert.equal(r.sinceHours, 168, 'clamped');
  assert.deepEqual([r.source, r.adapter, r.fetchedAt], ['live', 'http-json', '2026-11-12T10:00']);
  assert.deepEqual(r.alerts.map((a) => a.id), ['B', 'A1']);
  assert.deepEqual(r.topology, { 'gw-01': ['gw-02'] });
  assert.match(calls[0].url, /since=2026-11-05T10%3A00%3A00\.000Z/);
  assert.deepEqual(logs, [{ at: '2026-11-12T10:00:00.000Z', adapter: 'http-json', hours: 168, alerts: 2 }]);
  assert.ok(!JSON.stringify(logs).includes(TOKEN) && !JSON.stringify(logs).includes('Error rate'));
  assert.equal((await createMonitoringRead({ adapter: createHttpJsonAdapter({ baseUrl: 'https://mon.example', token: TOKEN, fetchImpl: fakeFetch([], { alerts: [] }) }), mapFile }).alerts({ sinceHours: 0 })).sinceHours, 24, 'default');
});

test('an adapter with a write method is refused even when it is passed in', async () => {
  const bad = { name: 'bad', listAlerts: async () => [], silence: () => {} };
  await assert.rejects(createMonitoringRead({ adapter: bad, mapFile }).alerts(), /may only read/);
  assert.deepEqual(createMonitoringRead({ adapter: bad, mapFile }).status(), { configured: false, adapter: '' });
});

/* ---- Zabbix: answers as the Zabbix API gives them (numbers are strings) ---- */
const sec = (iso) => String(Date.parse(iso) / 1000);
const PROBLEMS = [
  { eventid: '9003', objectid: '501', name: 'Error rate above 30 % on /v1/chat', severity: '5', clock: sec('2026-11-12T08:55:00Z') },
  { eventid: '9002', objectid: '502', name: 'Deployment quota above 95 %', severity: '4', clock: sec('2026-11-12T08:41:00Z') },
  { eventid: '9001', objectid: '503', name: 'Backup older than 24 h', severity: '2', clock: sec('2026-11-12T03:20:00Z') },
  { eventid: '9000', objectid: '504', name: 'Trigger without a host', severity: '9', clock: sec('2026-11-12T03:21:00Z') },
];
const TRIGGERS = [
  { triggerid: '501', hosts: [{ hostid: '10', host: 'gw-01' }] }, { triggerid: '502', hosts: [{ hostid: '11', host: 'gw-02' }] },
  { triggerid: '503', hosts: [{ hostid: '12', host: 'backup-02' }] }, { triggerid: '504', hosts: [] },
];
function zabbixFetch(calls, { problems = PROBLEMS, triggers = TRIGGERS, error = null, status = 200, raw = null } = {}) {
  return async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url: String(url), init, body });
    const result = body.method === 'problem.get' ? problems : triggers;
    const text = raw ?? JSON.stringify(error ? { jsonrpc: '2.0', error, id: body.id } : { jsonrpc: '2.0', result, id: body.id });
    return { ok: status < 400, status, text: async () => text };
  };
}
const zab = (calls, opts) => createZabbixAdapter({ baseUrl: 'https://zabbix.example/zabbix/', token: TOKEN, fetchImpl: zabbixFetch(calls, opts) });

test('Zabbix: two reads, problem.get then trigger.get, each a POST with the token as Bearer header, no redirects, only the fields it needs', async () => {
  const calls = [];
  const a = zab(calls);
  assert.ok(Object.isFrozen(a));
  assert.deepEqual(Object.keys(a).sort(), ['listAlerts', 'name']);
  const list = await a.listAlerts({ since: '2026-11-12T08:00:00.000Z', limit: 200 });
  assert.deepEqual(calls.map((c) => c.body.method), ['problem.get', 'trigger.get']);
  for (const c of calls) {
    assert.equal(c.url, 'https://zabbix.example/zabbix/api_jsonrpc.php');
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.redirect, 'error');
    assert.equal(c.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(c.init.headers['Content-Type'], 'application/json-rpc');
    assert.equal(c.body.jsonrpc, '2.0');
    assert.ok(!c.url.includes(TOKEN) && !('auth' in c.body), 'the token is only in the header, never in the address or the deprecated auth field');
  }
  assert.deepEqual(calls[0].body.params, { output: ['eventid', 'objectid', 'name', 'severity', 'clock'], source: 0, object: 0, recent: false, time_from: Math.floor(Date.parse('2026-11-12T08:00:00Z') / 1000), sortfield: ['eventid'], sortorder: 'DESC', limit: 200 });
  assert.deepEqual(calls[1].body.params, { triggerids: ['501', '502', '503', '504'], output: ['triggerid'], selectHosts: ['host'] });
  assert.equal(list.length, 4);
  assert.deepEqual(list[0], { id: '9003', host: 'gw-01', severity: 'disaster', at: Date.parse('2026-11-12T08:55:00Z'), text: 'Error rate above 30 % on /v1/chat' });
});

test('Zabbix: only the two read methods can be sent, nothing in the source names another method, no problems means no second call', async () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'shared/monitoring-read.mjs'), 'utf8');
  const zabbixPart = src.slice(src.indexOf('export function createZabbixAdapter'), src.indexOf('export const ADAPTERS'));
  const named = [...zabbixPart.matchAll(/call\('([A-Za-z.]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(named, ['problem.get', 'trigger.get']);
  assert.match(src, /const ZABBIX_READ_METHODS = Object\.freeze\(\['problem\.get', 'trigger\.get'\]\)/);
  assert.doesNotMatch(zabbixPart, /\.(update|create|delete|acknowledge|massadd|massupdate|execute)\b|user\.login|event\.acknowledge/, 'no write or login method anywhere');
  const calls = [];
  assert.deepEqual(await zab(calls, { problems: [] }).listAlerts({ since: '2026-11-12T08:00:00Z', limit: 10 }), []);
  assert.equal(calls.length, 1);
});

test('Zabbix: severity numbers become words, a trigger without a host and an unknown severity are handled, everything runs through the normal cut-down', async () => {
  const mon = createMonitoringRead({ adapter: zab([]), mapFile, now: () => new Date('2026-11-12T10:00:00Z') });
  const r = await mon.alerts({ sinceHours: 24 });
  assert.deepEqual(r.alerts.map((a) => [a.id, a.host, a.severity, a.at]), [['9001', 'backup-02', 'medium', '2026-11-12T03:20'], ['9002', 'gw-02', 'high', '2026-11-12T08:41'], ['9003', 'gw-01', 'critical', '2026-11-12T08:55']]);
  assert.ok(!r.alerts.some((a) => a.id === '9000'), 'a problem whose trigger has no host is dropped');
  assert.equal(r.alerts.find((a) => a.id === '9003').customer, 'Muster Industrie AG', 'the customer comes from the local map');
  assert.deepEqual(r.topology, { 'gw-01': ['gw-02'] });
  assert.equal(r.adapter, 'zabbix');
});

test('Zabbix: errors say what is wrong and never contain the token; an unauthorised token is reported as that', async () => {
  const run = (opts) => zab([], opts).listAlerts({ since: '2026-11-12T08:00:00Z', limit: 10 });
  await assert.rejects(run({ error: { code: -32602, message: 'Not authorized.', data: `Session terminated, re-login, ${TOKEN}` } }), (e) => e instanceof MonitoringError && /Zabbix refused the request: Not authorized/.test(e.message) && !e.message.includes(TOKEN));
  await assert.rejects(run({ status: 412 }), /HTTP 412/);
  await assert.rejects(run({ raw: '<html>login</html>' }), /not JSON/);
  await assert.rejects(run({ raw: 'x'.repeat(1_000_001) }), /too large/);
  const failing = createZabbixAdapter({ baseUrl: 'https://z.example', token: TOKEN, fetchImpl: async () => { throw new Error(`boom ${TOKEN}`); } });
  await assert.rejects(failing.listAlerts({ since: '2026-11-12T08:00:00Z', limit: 1 }), (e) => !e.message.includes(TOKEN));
});

test('Zabbix: the same address rules as the other adapter, and an address that already ends with api_jsonrpc.php works', async () => {
  assert.throws(() => createZabbixAdapter({ baseUrl: 'http://zabbix.example', token: TOKEN }), /https/);
  assert.throws(() => createZabbixAdapter({ baseUrl: 'https://u:p@zabbix.example', token: TOKEN }), /login/);
  assert.throws(() => createZabbixAdapter({ baseUrl: 'https://zabbix.example', token: '' }), /token is missing/);
  const calls = [];
  await createZabbixAdapter({ baseUrl: 'https://zabbix.example/api_jsonrpc.php', token: TOKEN, fetchImpl: zabbixFetch(calls) }).listAlerts({ since: '2026-11-12T08:00:00Z', limit: 1 });
  assert.equal(calls[0].url, 'https://zabbix.example/api_jsonrpc.php');
});
