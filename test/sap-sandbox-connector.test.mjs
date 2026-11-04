import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { API_CATALOG, DEFAULT_BASE, SapSandboxError, TOOL_DEFINITIONS, baseOf, cleanEntity, createSandboxHandlers, fixDate, keyPart } from '../connectors/sap-sandbox/server/sandbox.mjs';

const env = { SAP_API_KEY: 'key-abc123' };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const make = (answer, calls = [], e = env) => createSandboxHandlers({ env: e, fetchImpl: async (url, init) => { calls.push({ url, init }); return typeof answer === 'function' ? answer(url, init) : answer; } });
const ROOT = 'https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap';

test('the base URL can only be the https sandbox host', () => {
  assert.equal(baseOf(''), DEFAULT_BASE);
  assert.equal(baseOf('https://sandbox.api.sap.com/s4hanacloud/'), DEFAULT_BASE);
  assert.throws(() => baseOf('https://evil.example.com/s4hanacloud'), SapSandboxError);
  assert.throws(() => baseOf('http://sandbox.api.sap.com/s4hanacloud'), SapSandboxError);
  assert.throws(() => baseOf('https://sandbox.api.sap.com:8443/x'), SapSandboxError);
  assert.throws(() => baseOf('https://sandbox.api.sap.com.evil.com/x'), SapSandboxError);
});

test('OData dates and metadata are cleaned', () => {
  assert.equal(fixDate('/Date(1700000000000)/'), '2023-11-14T22:13:20.000Z');
  assert.equal(fixDate('/Date(1700000000000+0000)/'), '2023-11-14T22:13:20.000Z');
  assert.equal(fixDate('plain'), 'plain');
  const row = cleanEntity({ __metadata: { uri: 'x' }, SalesOrder: '1', CreationDate: '/Date(0)/', to_Item: { __deferred: { uri: 'y' } }, to_Partner: { results: [{ __metadata: {}, Role: 'AG' }] } });
  assert.deepEqual(row, { SalesOrder: '1', CreationDate: '1970-01-01T00:00:00.000Z', to_Partner: [{ Role: 'AG' }] });
});

test('keys are quoted and composite keys are named', () => {
  assert.equal(keyPart('1000'), "('1000')");
  assert.equal(keyPart("O'Neil"), "('O''Neil')");
  assert.equal(keyPart({ SalesOrder: '1', SalesOrderItem: '10' }), "(SalesOrder='1',SalesOrderItem='10')");
  assert.throws(() => keyPart(''), SapSandboxError);
  assert.throws(() => keyPart({}), SapSandboxError);
  assert.throws(() => keyPart({ 'a b': '1' }), SapSandboxError);
  assert.throws(() => keyPart(undefined), SapSandboxError);
});

test('query sends the key only to the sandbox, encodes options and cleans the rows', async () => {
  const calls = [];
  const h = make(json({ d: { __count: '42', results: [{ __metadata: {}, SalesOrder: '1', TotalNetAmount: '99.50' }] } }), calls);
  const r = await h.sap_sandbox_query({ service: 'API_SALES_ORDER_SRV', entity_set: 'A_SalesOrder', filter: "SoldToParty eq '10100001'", select: 'SalesOrder,TotalNetAmount', top: 5, count: true });
  assert.deepEqual(r, { service: 'API_SALES_ORDER_SRV', entity_set: 'A_SalesOrder', count: 1, total: 42, truncated: undefined, rows: [{ SalesOrder: '1', TotalNetAmount: '99.50' }] });
  assert.ok(calls[0].url.startsWith(`${ROOT}/API_SALES_ORDER_SRV/A_SalesOrder?`));
  assert.ok(calls[0].url.includes('$top=5') && calls[0].url.includes('$inlinecount=allpages') && calls[0].url.includes('$format=json'));
  assert.ok(calls[0].url.includes(`$filter=${encodeURIComponent("SoldToParty eq '10100001'")}`));
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.APIKey, 'key-abc123');
  assert.ok(!calls[0].url.includes('key-abc123'));
});

test('top is limited to 100 and a very large answer is cut with a flag', async () => {
  const calls = [];
  const rows = Array.from({ length: 100 }, (_, i) => ({ Id: String(i), ...Object.fromEntries(Array.from({ length: 8 }, (__, f) => [`Text${f}`, 'x'.repeat(290)])) }));
  const h = make(json({ d: { results: rows } }), calls);
  const r = await h.sap_sandbox_query({ service: 'API_BUSINESS_PARTNER', entity_set: 'A_BusinessPartner', top: 5000 });
  assert.ok(calls[0].url.includes('$top=100'));
  assert.equal(r.truncated, true);
  assert.ok(JSON.stringify(r.rows).length <= 60_000 && r.count === r.rows.length && r.count < 100);
});

test('get reads one entity and list_entity_sets reads the service document', async () => {
  const calls = [];
  const h = make((url) => (url.includes('/A_SalesOrder(') ? json({ d: { SalesOrder: '1', __metadata: {} } }) : json({ d: { EntitySets: ['A_SalesOrder', 'A_SalesOrderItem'] } })), calls);
  const g = await h.sap_sandbox_get({ service: 'API_SALES_ORDER_SRV', entity_set: 'A_SalesOrder', key: '1', expand: 'to_Item' });
  assert.deepEqual(g.entity, { SalesOrder: '1' });
  assert.ok(calls[0].url.startsWith(`${ROOT}/API_SALES_ORDER_SRV/A_SalesOrder('1')?`) && calls[0].url.includes('$expand=to_Item'));
  const l = await h.sap_sandbox_list_entity_sets({ service: 'API_SALES_ORDER_SRV' });
  assert.deepEqual(l.entity_sets, ['A_SalesOrder', 'A_SalesOrderItem']);
  assert.ok(calls[1].url.startsWith(`${ROOT}/API_SALES_ORDER_SRV/?`));
});

test('service and entity names are checked before any request', async () => {
  const calls = [];
  const h = make(json({ d: { results: [] } }), calls);
  await assert.rejects(h.sap_sandbox_query({ service: 'sales/../x', entity_set: 'A_SalesOrder' }), /SAP API name/);
  await assert.rejects(h.sap_sandbox_query({ service: 'API_SALES_ORDER_SRV', entity_set: 'A_SalesOrder/../x' }), /entity set/);
  await assert.rejects(h.sap_sandbox_query({ service: 'API_SALES_ORDER_SRV', entity_set: 'A_SalesOrder', filter: 'x'.repeat(600) }), /too long/);
  assert.equal(calls.length, 0);
});

test('check connection uses one small business partner request; the catalog needs none', async () => {
  const calls = [];
  const h = make(json({ d: { results: [{ BusinessPartner: '1' }] } }), calls);
  const r = await h.sap_sandbox_check_connection();
  assert.equal(r.ok, true); assert.equal(r.sample_rows, 1);
  assert.ok(calls[0].url.includes('API_BUSINESS_PARTNER/A_BusinessPartner') && calls[0].url.includes('$top=1'));
  const l = await h.sap_sandbox_list_apis();
  assert.equal(l.count, API_CATALOG.length);
  assert.equal(calls.length, 1);
});

test('errors are readable and never contain the key', async () => {
  await assert.rejects(make(json({}, 401)).sap_sandbox_check_connection(), /does not accept the API key/);
  await assert.rejects(make(json({}, 404)).sap_sandbox_query({ service: 'API_X_SRV', entity_set: 'A_X' }), /did not find that/);
  await assert.rejects(make(json({}, 429)).sap_sandbox_check_connection(), /rate limit/);
  await assert.rejects(make(json({ error: { message: { value: 'Property XY not found' } } }, 400)).sap_sandbox_query({ service: 'API_X_SRV', entity_set: 'A_X' }), /Property XY not found/);
  const failing = createSandboxHandlers({ env, fetchImpl: async () => { throw new Error('boom key-abc123'); } });
  await assert.rejects(failing.sap_sandbox_check_connection(), (e) => e instanceof SapSandboxError && !e.message.includes('key-abc123'));
  await assert.rejects(createSandboxHandlers({ env: {} }).sap_sandbox_check_connection(), /SAP_API_KEY/);
  await assert.rejects(make(json({}), [], { ...env, SAP_SANDBOX_BASE: 'https://evil.example.com/x' }).sap_sandbox_check_connection(), /only sent there/);
});

test('every tool reads only: GET is the only method ever used', async () => {
  const calls = [];
  const h = make(json({ d: { results: [], EntitySets: [] } }), calls);
  await h.sap_sandbox_check_connection(); await h.sap_sandbox_list_entity_sets({ service: 'API_X_SRV' });
  await h.sap_sandbox_query({ service: 'API_X_SRV', entity_set: 'A_X' }); await h.sap_sandbox_get({ service: 'API_X_SRV', entity_set: 'A_X', key: '1' });
  assert.ok(calls.length === 4 && calls.every((c) => c.init.method === 'GET'));
});

test('manifest lists every tool in order and marks the key as secret', () => {
  const manifest = JSON.parse(readFileSync(new URL('../connectors/sap-sandbox/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.tools.map((t) => t.name), TOOL_DEFINITIONS.map((t) => t.name));
  assert.equal(manifest.user_config.sap_api_key.sensitive, true);
  assert.equal(manifest.server.mcp_config.env.SAP_API_KEY, '${user_config.sap_api_key}');
});

test('the stdio server speaks MCP', async () => {
  const child = spawn('node', ['connectors/sap-sandbox/server/index.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  child.stdout.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  for (let i = 0; i < 50 && lines.length < 2; i += 1) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  const [init, list] = lines.map((l) => JSON.parse(l));
  assert.equal(init.result.serverInfo.name, 'sap-sandbox');
  assert.equal(list.result.tools.length, TOOL_DEFINITIONS.length);
});
