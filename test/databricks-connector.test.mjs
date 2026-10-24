import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabricksError, TOOL_DEFINITIONS, assertReadOnly, createDatabricksHandlers, normalizeHost } from '../connectors/databricks/server/databricks.mjs';

const env = { DATABRICKS_HOST: 'adb-1.2.azuredatabricks.net', DATABRICKS_TOKEN: 'dapi-secret-token', DATABRICKS_WAREHOUSE_ID: 'abc123def456', DATABRICKS_GENIE_SPACE_ID: '01ef1234abcd5678' };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const fakeFetch = (routes, calls = []) => async (url, init) => {
  calls.push({ url, init });
  for (const [match, answer] of routes) if (url.includes(match) && (!match.method || init.method === match.method)) return typeof answer === 'function' ? answer(url, init) : answer;
  return json({ message: 'no route' }, 404);
};
const handlers = (routes, calls) => createDatabricksHandlers({ env, fetchImpl: fakeFetch(routes, calls), sleep: async () => {} });

test('host is normalised and must be https without credentials', () => {
  assert.equal(normalizeHost('adb-1.2.azuredatabricks.net/'), 'https://adb-1.2.azuredatabricks.net');
  assert.throws(() => normalizeHost(''), DatabricksError);
  assert.throws(() => normalizeHost('http://x.example'), DatabricksError);
  assert.throws(() => normalizeHost('https://user:pw@x.example'), DatabricksError);
});

test('SQL guard allows reads and refuses writes, several statements and hidden writes', () => {
  assert.equal(assertReadOnly('SELECT 1;'), 'SELECT 1');
  assert.ok(assertReadOnly('with a as (select 1) select * from a'));
  assert.ok(assertReadOnly("SELECT 'drop table x' AS note"), 'keywords inside string literals are fine');
  for (const bad of ['DROP TABLE x', 'SELECT 1; DELETE FROM t', 'INSERT INTO t VALUES (1)', 'SELECT * FROM t; --x\nDROP TABLE t', 'UPDATE t SET a=1', '', 'CREATE TABLE a AS SELECT 1', 'SELECT * FROM t WHERE 1=1 /* x */ ; GRANT ALL ON t TO u']) {
    assert.throws(() => assertReadOnly(bad), DatabricksError, bad);
  }
});

test('Genie: starts a conversation, waits, and returns text, SQL and a table', async () => {
  const calls = [];
  let polls = 0;
  const h = handlers([
    ['/start-conversation', json({ conversation_id: 'c1', message_id: 'm1' })],
    ['/attachments/a1/query-result', json({ statement_response: { manifest: { schema: { columns: [{ name: 'customer' }, { name: 'arr' }] } }, result: { data_array: [['Muster', '360000'], ['Hanse', '240000']] } } })],
    ['/messages/m1', () => (++polls < 3 ? json({ status: 'EXECUTING_QUERY' }) : json({ status: 'COMPLETED', attachments: [{ text: { content: 'ARR by customer.' } }, { attachment_id: 'a1', query: { query: 'SELECT customer, arr FROM t', description: 'ARR' } }] }))],
  ], calls);
  const r = await h.databricks_ask_genie({ question: 'ARR by customer?' });
  assert.equal(r.answer, 'ARR by customer.');
  assert.equal(r.sql, 'SELECT customer, arr FROM t');
  assert.deepEqual(r.table.rows, [{ customer: 'Muster', arr: '360000' }, { customer: 'Hanse', arr: '240000' }]);
  assert.ok(calls.every((c) => c.url.startsWith('https://adb-1.2.azuredatabricks.net/')), 'only the workspace is called');
  assert.ok(calls.every((c) => c.init.headers.Authorization === 'Bearer dapi-secret-token'));
  assert.doesNotMatch(JSON.stringify(r), /dapi-secret/);
});

test('SQL: runs, polls until done, limits rows and reports failures plainly', async () => {
  const big = Array.from({ length: 300 }, (_, i) => [String(i)]);
  const h = handlers([
    ['/api/2.0/sql/statements/s9', json({ statement_id: 's9', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'n' }] } }, result: { data_array: big } })],
    ['/api/2.0/sql/statements', json({ statement_id: 's9', status: { state: 'RUNNING' } })],
  ]);
  const r = await h.databricks_run_sql({ statement: 'SELECT n FROM t', row_limit: 10 });
  assert.equal(r.rows.length, 10);
  assert.equal(r.rowCount, 300);
  assert.equal(r.truncated, true);
  const failing = handlers([['/api/2.0/sql/statements', json({ statement_id: 's', status: { state: 'FAILED', error: { message: 'TABLE_OR_VIEW_NOT_FOUND' } } })]]);
  await assert.rejects(failing.databricks_run_sql({ statement: 'SELECT * FROM nope' }), /TABLE_OR_VIEW_NOT_FOUND/);
  await assert.rejects(handlers([]).databricks_run_sql({ statement: 'DROP TABLE t' }), /read/i);
});

test('auth errors and missing settings give clear messages without the token', async () => {
  const denied = handlers([['/scim/v2/Me', json({}, 403)]]);
  await assert.rejects(denied.databricks_check_connection(), (e) => /refused the token/.test(e.message) && !/dapi-secret/.test(e.message));
  const noToken = createDatabricksHandlers({ env: { DATABRICKS_HOST: 'x.example' }, fetchImpl: async () => json({}) });
  await assert.rejects(noToken.databricks_list_genie_spaces(), /DATABRICKS_TOKEN/);
  const ok = await handlers([['/scim/v2/Me', json({ userName: 'a@b.example' })]]).databricks_check_connection();
  assert.equal(ok.user, 'a@b.example');
  await assert.rejects(handlers([]).databricks_describe_table({ table: 'a; drop' }), /catalog.schema.table/);
});

test('manifest lists every tool of the server in the same order and marks the token secret', () => {
  const manifest = JSON.parse(readFileSync(new URL('../connectors/databricks/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.tools.map((t) => t.name), TOOL_DEFINITIONS.map((t) => t.name));
  assert.equal(manifest.user_config.databricks_token.sensitive, true);
  assert.equal(manifest.user_config.databricks_host.required, true);
});

test('the stdio server speaks MCP: initialize and tools/list', async () => {
  const child = spawn('node', ['connectors/databricks/server/index.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  child.stdout.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  for (let i = 0; i < 50 && lines.length < 2; i += 1) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  const [init, list] = lines.map((l) => JSON.parse(l));
  assert.equal(init.result.serverInfo.name, 'databricks');
  assert.equal(list.result.tools.length, TOOL_DEFINITIONS.length);
});
