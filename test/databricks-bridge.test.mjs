import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { parsePaths, parseSse } from '../connectors/databricks-bridge/server/index.mjs';
import { startStdioServer } from './helpers/stdio-mcp.mjs';

const ROOT = join(import.meta.dirname, '..');
const SERVER = join(ROOT, 'connectors/databricks-bridge/server/index.mjs');
const manifest = JSON.parse(readFileSync(join(ROOT, 'connectors/databricks-bridge/manifest.json'), 'utf8'));

/**
 * A fake Databricks workspace: an OAuth token endpoint plus two MCP endpoints.
 * /api/2.0/mcp/sql answers in JSON, /api/2.0/mcp/functions/... answers as an event stream.
 */
async function fakeWorkspace({ rejectFirstMcpCall = false, status } = {}) {
  const log = { tokens: 0, tokenScopes: [], mcp: [] };
  let rejected = false;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();

    if (request.url === '/oidc/v1/token') {
      const basic = Buffer.from(String(request.headers.authorization).replace('Basic ', ''), 'base64').toString();
      if (basic !== 'sp-id:sp-secret') {
        response.writeHead(401).end('bad client');
        return;
      }
      log.tokens += 1;
      log.tokenScopes.push(new URLSearchParams(raw).get('scope'));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ access_token: `tok-${log.tokens}`, expires_in: 3600 }));
      return;
    }

    if (status) {
      response.writeHead(status, { 'Content-Type': 'application/json' }).end('{"message":"denied by test"}');
      return;
    }
    if (rejectFirstMcpCall && !rejected) {
      rejected = true;
      response.writeHead(401).end('expired');
      return;
    }
    const message = JSON.parse(raw);
    log.mcp.push({ url: request.url, method: message.method, auth: request.headers.authorization, session: request.headers['mcp-session-id'], params: message.params });
    const functionEndpoint = request.url.startsWith('/api/2.0/mcp/functions/');

    if (message.method === 'notifications/initialized') {
      response.writeHead(202).end();
      return;
    }
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } };
    else if (message.method === 'tools/list') {
      result = functionEndpoint
        ? { tools: [{ name: 'get_delay_risk_pos', description: 'risk', inputSchema: { type: 'object' } }, { name: 'execute_sql', description: 'shadow', inputSchema: { type: 'object' } }] }
        : { tools: [{ name: 'execute_sql', description: 'run sql', inputSchema: { type: 'object' } }] };
    } else if (message.method === 'tools/call') {
      result = { content: [{ type: 'text', text: JSON.stringify({ endpoint: request.url, tool: message.params.name, args: message.params.arguments }) }] };
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'nope' } }));
      return;
    }
    const body = { jsonrpc: '2.0', id: message.id, result };
    const headers = { 'Mcp-Session-Id': 'session-1' };
    if (functionEndpoint) {
      response.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream' });
      response.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: {} })}\n\nevent: message\ndata: ${JSON.stringify(body)}\n\n`);
    } else {
      response.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { host: `http://127.0.0.1:${server.address().port}`, log, close: () => server.close() };
}

const env = (host, extra = {}) => ({
  DATABRICKS_HOST: host,
  DATABRICKS_CLIENT_ID: 'sp-id',
  DATABRICKS_CLIENT_SECRET: 'sp-secret',
  DATABRICKS_MCP_PATHS: 'sql=/api/2.0/mcp/sql,\nfn=/api/2.0/mcp/functions/werkbank_demo/scm/get_delay_risk_pos',
  ...extra,
});

test('endpoint paths are parsed and validated', () => {
  assert.deepEqual(parsePaths('sql=/api/2.0/mcp/sql, /api/2.0/mcp/functions/c/s/f'), [
    { alias: 'sql', path: '/api/2.0/mcp/sql' },
    { alias: 't2', path: '/api/2.0/mcp/functions/c/s/f' },
  ]);
  for (const bad of ['', 'https://evil.example/mcp', '//evil.example/mcp', 'a=/x/../y', 'a=/x?y=1', 'a=/x#y', 'a=/x y', 'a=/b,a=/c']) {
    assert.throws(() => parsePaths(bad), /DATABRICKS_MCP_PATHS/, bad);
  }
});

test('an event stream yields the response with the wanted id', () => {
  const text = 'data: {"jsonrpc":"2.0","method":"notifications/message"}\n\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n';
  assert.deepEqual(parseSse(text, 7).result, { ok: true });
  assert.equal(parseSse('', 1), null);
});

test('the manifest asks for secrets as secrets and its default paths parse', () => {
  const config = manifest.user_config;
  assert.equal(config.client_secret.sensitive, true);
  assert.equal(config.access_token.sensitive, true);
  assert.equal(config.databricks_host.required, true);
  const paths = parsePaths(config.mcp_paths.default);
  assert.ok(paths.some((entry) => entry.path === '/api/2.0/mcp/sql'));
  assert.ok(paths.every((entry) => entry.path.startsWith('/api/2.0/mcp/')));
  assert.equal(manifest.server.mcp_config.env.DATABRICKS_CLIENT_SECRET, '${user_config.client_secret}');
});

test('tools of all endpoints are merged and a shared name is prefixed instead of dropped', async () => {
  const workspace = await fakeWorkspace();
  const bridge = startStdioServer(SERVER, env(workspace.host));
  try {
    await bridge.request('initialize', { protocolVersion: '2025-06-18' });
    const { result } = await bridge.request('tools/list');
    assert.deepEqual(result.tools.map((tool) => tool.name).sort(), ['execute_sql', 'fn__execute_sql', 'get_delay_risk_pos']);
    assert.equal(workspace.log.tokens, 1, 'one token for both endpoints');
    assert.equal(workspace.log.tokenScopes[0], 'all-apis');
  } finally {
    bridge.close();
    workspace.close();
  }
});

test('calls go to the right endpoint with the original tool name, a bearer token and the session', async () => {
  const workspace = await fakeWorkspace();
  const bridge = startStdioServer(SERVER, env(workspace.host, { DATABRICKS_OAUTH_SCOPE: 'sql unity-catalog' }));
  try {
    await bridge.request('tools/list');
    const viaFunctions = await bridge.tool('fn__execute_sql', { statement: 'select 1' });
    assert.equal(viaFunctions.json.endpoint, '/api/2.0/mcp/functions/werkbank_demo/scm/get_delay_risk_pos');
    assert.equal(viaFunctions.json.tool, 'execute_sql', 'the prefix is local to the bridge');
    const viaSql = await bridge.tool('execute_sql', { statement: 'select 2' });
    assert.equal(viaSql.json.endpoint, '/api/2.0/mcp/sql');
    assert.deepEqual(viaSql.json.args, { statement: 'select 2' });

    const calls = workspace.log.mcp.filter((entry) => entry.method === 'tools/call');
    assert.ok(calls.every((entry) => entry.auth === 'Bearer tok-1'));
    assert.ok(calls.every((entry) => entry.session === 'session-1'));
    assert.equal(workspace.log.tokenScopes[0], 'sql unity-catalog');
    assert.equal(workspace.log.mcp.filter((entry) => entry.method === 'initialize').length, 2, 'each endpoint is initialised once');
  } finally {
    bridge.close();
    workspace.close();
  }
});

test('an expired token is refreshed once and the call still succeeds', async () => {
  const workspace = await fakeWorkspace({ rejectFirstMcpCall: true });
  const bridge = startStdioServer(SERVER, env(workspace.host, { DATABRICKS_MCP_PATHS: 'sql=/api/2.0/mcp/sql' }));
  try {
    const { result } = await bridge.request('tools/list');
    assert.equal(result.tools.length, 1);
    assert.equal(workspace.log.tokens, 2);
    assert.equal(workspace.log.mcp.at(-1).auth, 'Bearer tok-2');
  } finally {
    bridge.close();
    workspace.close();
  }
});

test('a fixed access token is used as it is and never exchanged', async () => {
  const workspace = await fakeWorkspace();
  const bridge = startStdioServer(SERVER, {
    DATABRICKS_HOST: workspace.host,
    DATABRICKS_TOKEN: 'dapi-fixed',
    DATABRICKS_MCP_PATHS: '/api/2.0/mcp/sql',
  });
  try {
    await bridge.request('tools/list');
    assert.equal(workspace.log.tokens, 0);
    assert.ok(workspace.log.mcp.every((entry) => entry.auth === 'Bearer dapi-fixed'));
  } finally {
    bridge.close();
    workspace.close();
  }
});

test('errors are explained and never leak credentials', async () => {
  const workspace = await fakeWorkspace({ status: 403 });
  const bridge = startStdioServer(SERVER, env(workspace.host, { DATABRICKS_TOKEN: 'dapi-very-secret' }));
  try {
    const call = await bridge.tool('execute_sql', { statement: 'select 1' });
    assert.equal(call.isError || call.rpcError !== undefined, true);
    const text = call.text || JSON.stringify(call.rpcError);
    assert.doesNotMatch(text, /dapi-very-secret|sp-secret/);
    assert.doesNotMatch(bridge.stderr(), /dapi-very-secret|sp-secret/);
  } finally {
    bridge.close();
    workspace.close();
  }

  const missing = startStdioServer(SERVER, { DATABRICKS_HOST: '', DATABRICKS_MCP_PATHS: '' });
  try {
    assert.deepEqual((await missing.request('tools/list')).result.tools, [], 'a misconfigured bridge lists no tools instead of breaking the app');
    const call = await missing.tool('anything', {});
    assert.ok(call.rpcError?.code === -32602 || call.isError, 'and says what is wrong when called');
  } finally {
    missing.close();
  }
});

test('a plain-http workspace address is refused unless it is local', async () => {
  const bridge = startStdioServer(SERVER, { DATABRICKS_HOST: 'http://example.com', DATABRICKS_TOKEN: 'x', DATABRICKS_MCP_PATHS: '/api/2.0/mcp/sql' });
  try {
    assert.deepEqual((await bridge.request('tools/list')).result.tools, []);
    assert.match(bridge.stderr(), /must use https/);
  } finally {
    bridge.close();
  }
});
