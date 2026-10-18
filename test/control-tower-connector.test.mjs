import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildControlTowerBundle } from '../scripts/build-control-tower-mcpb.mjs';
import { normalizeSupabaseUrl } from '../connectors/control-tower/server/supabase-url.mjs';
import { SKILL_TOOL_DEFINITIONS } from '../connectors/control-tower/server/skills.mjs';
import { TICKET_TOOL_DEFINITIONS } from '../connectors/control-tower/server/tickets.mjs';
import { TOOL_DEFINITIONS as DASHBOARD_TOOLS } from '../connectors/control-tower/server/tools.mjs';

const TOOL_DEFINITIONS = [...DASHBOARD_TOOLS, ...TICKET_TOOL_DEFINITIONS, ...SKILL_TOOL_DEFINITIONS];

const ROOT = join(import.meta.dirname, '..');
const SERVER = join(ROOT, 'connectors/control-tower/server/index.mjs');
const manifest = JSON.parse(readFileSync(join(ROOT, 'connectors/control-tower/manifest.json'), 'utf8'));
const data = JSON.parse(readFileSync(join(ROOT, 'examples/control-tower/data.json'), 'utf8'));

/** Minimal stdio MCP client: one request per line, responses matched by id. */
function startServer(scriptPath = SERVER, env = {}) {
  const child = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiting = new Map();
  const anonymous = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const message = JSON.parse(line); // stdout must contain protocol JSON only
      if (message.id !== null && message.id !== undefined && waiting.has(message.id)) {
        waiting.get(message.id)(message);
        waiting.delete(message.id);
      } else {
        anonymous.push(message);
      }
    }
  });
  let nextId = 1;
  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 5000);
        waiting.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify: (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`),
    raw: (text) => child.stdin.write(`${text}\n`),
    async call(name, args) {
      const response = await this.request('tools/call', { name, arguments: args });
      return response.result;
    },
    anonymous,
    stop: () => child.kill(),
  };
}

const parse = (result) => JSON.parse(result.content[0].text);

test('initialize negotiates the protocol version and advertises tools', async () => {
  const server = startServer();
  try {
    const known = await server.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(known.result.protocolVersion, '2025-03-26');
    assert.ok(known.result.capabilities.tools);
    assert.equal(known.result.serverInfo.name, 'ai-control-tower');

    const unknown = await server.request('initialize', { protocolVersion: '1999-01-01' });
    assert.equal(unknown.result.protocolVersion, '2025-06-18');
  } finally {
    server.stop();
  }
});

test('tools/list matches the manifest and every tool has a schema', async () => {
  const server = startServer();
  try {
    const { result } = await server.request('tools/list');
    const names = result.tools.map((tool) => tool.name);
    assert.deepEqual(names, manifest.tools.map((tool) => tool.name));
    assert.deepEqual(names, TOOL_DEFINITIONS.map((tool) => tool.name));
    for (const tool of result.tools) {
      assert.equal(tool.inputSchema.type, 'object', tool.name);
      assert.ok(tool.description.length > 20, tool.name);
    }
  } finally {
    server.stop();
  }
});

test('get_risks answers "which risks are below 40% mitigated?" from data.json', async () => {
  const server = startServer();
  try {
    const result = parse(await server.call('get_risks', { max_progress_pct: 39 }));
    assert.deepEqual(result.risks.map((risk) => risk.id), ['R1', 'R3', 'R2']); // 20%, 26%, 35% — lowest first
    assert.ok(result.risks.every((risk) => risk.belowThreshold));
    assert.deepEqual(result.view, { space: 'ai-control-tower', tab: 'risk' });

    const high = parse(await server.call('get_risks', { severity: 'HIGH' }));
    assert.equal(high.count, data.risks.filter((risk) => risk.severity === 'high').length);

    const owner = parse(await server.call('get_risks', { owner: 'ciso' }));
    assert.deepEqual(owner.risks.map((risk) => risk.id).sort(), ['R2', 'R5']);
  } finally {
    server.stop();
  }
});

test('invalid tool arguments are reported as tool errors, not crashes', async () => {
  const server = startServer();
  try {
    for (const args of [{ severity: 'critical' }, { max_progress_pct: 150 }, { max_progress_pct: '40' }, { owner: '' }]) {
      const result = await server.call('get_risks', args);
      assert.equal(result.isError, true, JSON.stringify(args));
    }
    const missing = await server.call('get_risk', {});
    assert.equal(missing.isError, true);
    const unknownId = await server.call('get_risk', { id: 'R99' });
    assert.equal(unknownId.isError, true);
    assert.match(unknownId.content[0].text, /R1, R2/);
    const notObject = await server.call('get_budget', 'oops');
    assert.equal(notObject.isError, true);

    const found = parse(await server.call('get_risk', { id: 'r2' }));
    assert.equal(found.risk.id, 'R2');
  } finally {
    server.stop();
  }
});

test('agent tools agree with the registry in data.json', async () => {
  const server = startServer();
  try {
    const overview = parse(await server.call('get_agent_overview', {}));
    assert.equal(overview.totalAgents, 186);
    assert.equal(overview.productionAgents, 125);
    assert.equal(overview.productionSharePct, 67);
    assert.deepEqual(overview.accessTiers.map((tier) => tier.count), [74, 41, 10]);

    const assets = parse(await server.call('get_unregistered_assets', {}));
    assert.equal(assets.listed.length + assets.notListed, assets.totalUnregistered);
    assert.equal(assets.notListed, 43);

    const overprivileged = parse(await server.call('get_overprivileged_agents', {}));
    assert.equal(overprivileged.notListed, 21);
  } finally {
    server.stop();
  }
});

test('get_budget flags overspend and reports that team rows add up to the stated totals', async () => {
  const server = startServer();
  try {
    const budget = parse(await server.call('get_budget', {}));
    const status = Object.fromEntries(budget.groups.map((group) => [group.name, group.status]));
    assert.equal(status.Engineering, 'over budget');
    assert.equal(status.Finance, 'over budget');
    assert.equal(status['Sales & Presales'], 'near limit');
    assert.equal(status['HR / L&D'], 'within budget');
    assert.equal(budget.headroomM, 0.86);
    assert.equal(budget.reconciliation.sumOfTeamBudgetsK, 3600);
    assert.equal(budget.reconciliation.sumOfTeamActualsK, 2740);
    assert.equal(budget.reconciliation.ceilingMinusTeamBudgetsK, 0);
    assert.equal(budget.reconciliation.statedActualMinusTeamActualsK, 0);
    assert.equal(budget.reconciliation.reconciles, true);
  } finally {
    server.stop();
  }
});

test('protocol edge cases: notifications, unknown methods and tools, malformed input', async () => {
  const server = startServer();
  try {
    server.notify('notifications/initialized'); // must not be answered
    assert.deepEqual(await server.request('ping'), { jsonrpc: '2.0', id: 1, result: {} });

    assert.equal((await server.request('resources/list')).error.code, -32601);
    assert.equal((await server.request('tools/call', { name: 'delete_everything', arguments: {} })).error.code, -32602);

    server.raw('this is not json');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(server.anonymous.length, 1);
    assert.equal(server.anonymous[0].error.code, -32700);
  } finally {
    server.stop();
  }
});

test('data edits show up without restarting the server', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-live-'));
  const file = join(dir, 'data.json');
  const write = (patch) => execFileSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(file)}, JSON.stringify(${JSON.stringify({ ...data, ...patch })}))`]);
  write({});
  const server = startServer(SERVER, { CONTROL_TOWER_DATA: file });
  try {
    assert.equal(parse(await server.call('get_agent_overview', {})).totalAgents, 186);
    write({ agents: { ...data.agents, total: 200 } });
    assert.equal(parse(await server.call('get_agent_overview', {})).totalAgents, 200);
  } finally {
    server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the built .mcpb is what Werkbank expects and runs as installed', async (t) => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
  } catch {
    return t.skip('zip/unzip not available');
  }
  const dir = mkdtempSync(join(tmpdir(), 'ct-bundle-'));
  try {
    const bundle = buildControlTowerBundle(join(dir, 'ai-control-tower.mcpb'));

    // Same safety checks as electron/main.mjs: no absolute or parent paths.
    const entries = execFileSync('unzip', ['-Z1', bundle], { encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const entry of entries) {
      assert.ok(!entry.startsWith('/') && !entry.split('/').includes('..'), entry);
    }
    for (const required of ['manifest.json', 'server/index.mjs', 'server/tools.mjs', 'data/data.json']) {
      assert.ok(entries.includes(required), `${required} missing from bundle`);
    }

    // Read the manifest from the zip, as Werkbank does.
    const bundled = JSON.parse(execFileSync('unzip', ['-p', bundle, 'manifest.json'], { encoding: 'utf8' }));
    assert.equal(bundled.server.mcp_config.command, 'node'); // in Werkbank's ALLOWED_COMMANDS
    assert.deepEqual(JSON.parse(execFileSync('unzip', ['-p', bundle, 'data/data.json'], { encoding: 'utf8' })), data);

    // Extract and run with ${__dirname} substituted, exactly like unpackBundle().
    const target = join(dir, 'installed');
    execFileSync('unzip', ['-o', '-q', bundle, '-d', target]);
    const sub = (value) => value.replaceAll('${__dirname}', target);
    const { args, env } = bundled.server.mcp_config;
    const server = startServer(sub(args[0]), Object.fromEntries(Object.entries(env).map(([k, v]) => [k, sub(v)])));
    try {
      const overview = parse(await server.call('get_agent_overview', {}));
      assert.equal(overview.totalAgents, 186);
    } finally {
      server.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a risk exactly at the threshold is not "below" it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-edge-'));
  const file = join(dir, 'data.json');
  const edge = { ...data, risks: data.risks.map((risk) => (risk.id === 'R1' ? { ...risk, progressPct: 40 } : risk)) };
  writeFileSync(file, JSON.stringify(edge));
  const server = startServer(SERVER, { CONTROL_TOWER_DATA: file });
  try {
    const result = parse(await server.call('get_risk', { id: 'R1' }));
    assert.equal(result.risk.progressPct, 40);
    assert.equal(result.risk.belowThreshold, false);
    const listed = parse(await server.call('get_risks', {}));
    assert.equal(listed.risks.find((risk) => risk.id === 'R1').belowThreshold, false);
  } finally {
    server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Stand-in for Supabase's /rest/v1/rpc/control_tower_snapshot endpoint. */
async function withFakeSupabase(handler, run) {
  const { createServer } = await import('node:http');
  const seen = [];
  const http = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, apikey: request.headers.apikey, auth: request.headers.authorization });
    handler(request, response);
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${http.address().port}`, seen);
  } finally {
    http.close();
  }
}

test('reads from Supabase when configured, using the secret key, and reports the source', async () => {
  const remote = { ...data, agents: { ...data.agents, total: 999 } };
  await withFakeSupabase(
    (request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(remote));
    },
    async (url, seen) => {
      const server = startServer(SERVER, { SUPABASE_URL: url, SUPABASE_SECRET_KEY: 'sb_secret_test' });
      try {
        const overview = parse(await server.call('get_agent_overview', {}));
        assert.equal(overview.totalAgents, 999);
        assert.equal(overview.dataSource, 'supabase');
        assert.deepEqual(seen[0], {
          method: 'POST',
          url: '/rest/v1/rpc/control_tower_snapshot',
          apikey: 'sb_secret_test',
          auth: 'Bearer sb_secret_test',
        });
      } finally {
        server.stop();
      }
    }
  );
});

test('falls back to data.json when Supabase fails, says so, and never leaks the key', async () => {
  for (const handler of [
    (request, response) => { response.statusCode = 500; response.end('boom sb_secret_test'); },
    (request, response) => { response.end('{"unexpected":true}'); },
    (request, response) => { response.end('not json'); },
  ]) {
    await withFakeSupabase(handler, async (url) => {
      const server = startServer(SERVER, { SUPABASE_URL: url, SUPABASE_SECRET_KEY: 'sb_secret_test' });
      try {
        const result = await server.call('get_agent_overview', {});
        assert.notEqual(result.isError, true);
        const overview = parse(result);
        assert.equal(overview.totalAgents, 186); // bundled sample data
        assert.match(overview.dataSource, /^data\.json \(Supabase unavailable: /);
        assert.ok(!result.content[0].text.includes('sb_secret_test'));
      } finally {
        server.stop();
      }
    });
  }
});

test('without Supabase settings the file is used and labelled', async () => {
  const server = startServer(SERVER, { SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' });
  try {
    assert.equal(parse(await server.call('get_budget', {})).dataSource, 'data.json (Supabase not configured)');
  } finally {
    server.stop();
  }
});

test('a non-https Supabase URL (other than localhost) is refused and falls back', async () => {
  const server = startServer(SERVER, { SUPABASE_URL: 'http://example.com', SUPABASE_SECRET_KEY: 'k' });
  try {
    const overview = parse(await server.call('get_agent_overview', {}));
    assert.match(overview.dataSource, /must be https/);
    assert.equal(overview.totalAgents, 186);
  } finally {
    server.stop();
  }
});

test('manifest declares the Supabase key as a sensitive, optional field', () => {
  const key = manifest.user_config.supabase_secret_key;
  assert.equal(key.sensitive, true);
  assert.notEqual(key.required, true);
  assert.equal(manifest.user_config.supabase_url.sensitive, undefined);
  assert.equal(manifest.server.mcp_config.env.SUPABASE_SECRET_KEY, '${user_config.supabase_secret_key}');
});

test('a mismatch in the budget source data is still reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-budget-'));
  const file = join(dir, 'data.json');
  const groups = data.budget.groups.filter((group) => group.name !== 'Legal & Compliance');
  writeFileSync(file, JSON.stringify({ ...data, budget: { ...data.budget, groups } }));
  const server = startServer(SERVER, { CONTROL_TOWER_DATA: file });
  try {
    const { reconciliation } = parse(await server.call('get_budget', {}));
    assert.equal(reconciliation.reconciles, false);
    assert.equal(reconciliation.ceilingMinusTeamBudgetsK, 98);
    assert.match(reconciliation.note, /do not add up/);
  } finally {
    server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list_agents filters the registry, sorts by runs and validates arguments', async () => {
  const server = startServer();
  try {
    const top = parse(await server.call('list_agents', { lifecycle: 'production', limit: 12 }));
    assert.equal(top.registrySize, 186);
    assert.equal(top.matched, 125);
    assert.equal(top.returned, 12);
    assert.deepEqual(top.agents.map((a) => a.runsPerDay), [...top.agents.map((a) => a.runsPerDay)].sort((a, b) => b - a));
    assert.deepEqual(top.view, { space: 'ai-control-tower', tab: 'repo' });

    const over = parse(await server.call('list_agents', { overprivileged: true, limit: 200 }));
    assert.equal(over.matched, 31);
    assert.equal(parse(await server.call('list_agents', {})).returned, 15);
    assert.equal(parse(await server.call('list_agents', { lifecycle: 'retired', limit: 200 })).matched, 33);

    const bad = await server.call('list_agents', { lifecycle: 'paused' });
    assert.equal(bad.isError, true);
    assert.equal((await server.call('list_agents', { limit: 0 })).isError, true);
  } finally {
    server.stop();
  }
});

test('electron main imports ALLOWED_COMMANDS (it is used by the connector install paths)', () => {
  const main = readFileSync(join(import.meta.dirname, '..', 'electron/main.mjs'), 'utf8');
  assert.match(main, /import \{[^}]*\bALLOWED_COMMANDS\b[^}]*\} from '\.\/install-deep-link\.mjs'/);
});

test('ticket tools call the Sub4Me RPC functions with validated arguments', async () => {
  const bodies = [];
  await withFakeSupabase(
    (request, response) => {
      let raw = '';
      request.on('data', (c) => (raw += c));
      request.on('end', () => {
        const body = JSON.parse(raw || '{}');
        bodies.push({ url: request.url, body });
        response.setHeader('content-type', 'application/json');
        if (request.url.endsWith('sub4me_tickets')) {
          return response.end(JSON.stringify([
            { id: 'TKT-2', status: 'New', title: 'b' }, { id: 'TKT-1', status: 'Closed', title: 'a' },
          ]));
        }
        response.end(JSON.stringify({ id: 'TKT-48214', status: 'New', ...body }));
      });
    },
    async (url) => {
      const server = startServer(SERVER, { SUPABASE_URL: url, SUPABASE_SECRET_KEY: 'sb_secret_test' });
      try {
        assert.equal(parse(await server.call('list_tickets', {})).count, 2);
        assert.equal(parse(await server.call('list_tickets', { status: 'Closed' })).tickets[0].id, 'TKT-1');
        const created = parse(await server.call('create_ticket', { title: '  Login broken ', product: 'BTP AI Core', priority: 'High' }));
        assert.equal(created.ticket.id, 'TKT-48214');
        assert.deepEqual(bodies.at(-1), {
          url: '/rest/v1/rpc/sub4me_create_ticket',
          body: { p_title: 'Login broken', p_product: 'BTP AI Core', p_priority: 'High', p_description: '' },
        });
        for (const args of [
          { product: 'x', priority: 'High' },
          { title: 'x', product: 'y', priority: 'Urgent' },
          { title: 'x'.repeat(121), product: 'y', priority: 'Low' },
          { title: 'x', product: 'y', priority: 'Low', description: 'd'.repeat(2001) },
        ]) assert.equal((await server.call('create_ticket', args)).isError, true);
        assert.equal((await server.call('list_tickets', { status: 'Nope' })).isError, true);
        assert.equal(bodies.filter((b) => b.url.endsWith('sub4me_create_ticket')).length, 1); // rejected calls never reached Supabase
      } finally {
        server.stop();
      }
    }
  );
});

test('ticket tools explain that Supabase is needed when it is not configured', async () => {
  const server = startServer(SERVER, { SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' });
  try {
    const result = await server.call('create_ticket', { title: 'x', product: 'y', priority: 'Low' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Supabase/);
  } finally {
    server.stop();
  }
});

test('skill tools query the registry functions and never return skill text', async () => {
  const bodies = [];
  await withFakeSupabase(
    (request, response) => {
      let raw = '';
      request.on('data', (c) => (raw += c));
      request.on('end', () => {
        const body = JSON.parse(raw || '{}');
        bodies.push({ url: request.url, body });
        response.setHeader('content-type', 'application/json');
        if (request.url.endsWith('skills_search')) {
          return response.end(JSON.stringify([{ slug: 'expense-check', score: 0.9, tools: ['list_tickets'] }]));
        }
        if (request.url.endsWith('skills_get')) {
          return response.end(JSON.stringify(body.p_slug === 'expense-check'
            ? { slug: 'expense-check', version: 2, body: 'SECRET BODY', meta: { domain: 'Finanzen' } }
            : null));
        }
        response.end('{}');
      });
    },
    async (url) => {
      const server = startServer(SERVER, { SUPABASE_URL: url, SUPABASE_SECRET_KEY: 'sb_secret_test' });
      try {
        const found = parse(await server.call('search_skills', { query: '  Reisekosten prüfen ' }));
        assert.equal(found.count, 1);
        assert.deepEqual(bodies.at(-1), { url: '/rest/v1/rpc/skills_search', body: { p_query: 'Reisekosten prüfen', p_limit: 8 } });
        const info = await server.call('get_skill_info', { name: 'expense-check' });
        assert.doesNotMatch(info.content[0].text, /SECRET BODY/);
        assert.equal(parse(info).skill.version, 2);
        assert.equal((await server.call('get_skill_info', { name: 'missing-one' })).isError, true);
        for (const args of [{}, { query: '' }, { query: 'x'.repeat(201) }, { query: 'ok', limit: 0 }, { query: 'ok', limit: 26 }]) {
          assert.equal((await server.call('search_skills', args)).isError, true);
        }
        assert.equal((await server.call('get_skill_info', { name: '../etc' })).isError, true);
        assert.ok(bodies.every((b) => /skills_(search|get)$/.test(b.url)), 'only the two read functions are ever called');
      } finally {
        server.stop();
      }
    }
  );
});

test('skill tools explain that Supabase is needed when it is not configured', async () => {
  const server = startServer(SERVER, { SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' });
  try {
    const result = await server.call('search_skills', { query: 'Reisekosten' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Supabase/);
  } finally {
    server.stop();
  }
});

test('the Supabase URL from the connector dialog is forgiven: missing scheme, trailing slash, pasted API path', async () => {
  assert.equal(normalizeSupabaseUrl('abcdefgh.supabase.co'), 'https://abcdefgh.supabase.co');
  assert.equal(normalizeSupabaseUrl('  https://abcdefgh.supabase.co/ '), 'https://abcdefgh.supabase.co');
  assert.equal(normalizeSupabaseUrl('https://abcdefgh.supabase.co/rest/v1'), 'https://abcdefgh.supabase.co');
  assert.equal(normalizeSupabaseUrl('127.0.0.1:54321'), 'http://127.0.0.1:54321');
  for (const bad of ['', '   ', 'nur-ein-wort', 'https://']) assert.throws(() => normalizeSupabaseUrl(bad), /Supabase project URL/);

  await withFakeSupabase(
    (request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(request.url.endsWith('sub4me_tickets') ? '[]' : '{}');
    },
    async (url) => {
      const sloppy = `${url.replace('http://', '')}/rest/v1/`; // no scheme, with API path and trailing slash
      const server = startServer(SERVER, { SUPABASE_URL: sloppy, SUPABASE_SECRET_KEY: 'sb_secret_test' });
      try {
        assert.equal(parse(await server.call('list_tickets', {})).count, 0);
      } finally {
        server.stop();
      }
    }
  );
});
