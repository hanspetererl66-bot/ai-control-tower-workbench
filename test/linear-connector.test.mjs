import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LinearError, MAX_COMMENT, TOOL_DEFINITIONS, createLinearHandlers, idOf, issueRow } from '../connectors/linear/server/linear.mjs';
import { fetchPrompt, linearHint, parseRequirements, SOURCES } from '../src/requirements.ts';

const KEY = 'lin_api_SECRETKEY123';
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const make = (answer, env = { LINEAR_API_KEY: KEY }, calls = []) => createLinearHandlers({ env, fetchImpl: async (url, init) => { calls.push({ url: String(url), init, body: JSON.parse(init.body) }); return typeof answer === 'function' ? answer(calls.at(-1)) : answer; } });
const ISSUE = { identifier: 'ENG-12', title: 'Renewal reminder', priorityLabel: 'High', updatedAt: '2026-11-08T10:00:00Z', url: 'https://linear.app/acme/issue/ENG-12/x', state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Ann' }, team: { key: 'ENG' }, project: { name: 'Renewals' }, labels: { nodes: [{ name: 'customer' }] } };

test('an issue is named by identifier or by a linear.app link; anything else is refused', () => {
  assert.equal(idOf('eng-12'), 'ENG-12');
  assert.equal(idOf('https://linear.app/acme/issue/ENG-12/renewal-reminder'), 'ENG-12');
  assert.equal(idOf('https://linear.app/acme/issue/ENG-12'), 'ENG-12');
  for (const bad of ['', 'ENG', '12', 'https://evil.example/acme/issue/ENG-12/x', 'http://linear.app/acme/issue/ENG-12', 'https://linear.app/acme/project/x', 'ENG-12; drop']) assert.throws(() => idOf(bad), LinearError, bad);
  assert.deepEqual(issueRow(ISSUE), { id: 'ENG-12', title: 'Renewal reminder', state: 'In Progress', state_type: 'started', priority: 'High', assignee: 'Ann', team: 'ENG', project: 'Renewals', labels: ['customer'], updated: '2026-11-08T10:00:00Z', url: ISSUE.url });
});

test('the key goes only to api.linear.app, as the Authorization header, and never into the body', async () => {
  const calls = [];
  const h = make(json({ data: { viewer: { name: 'Ann' }, organization: { name: 'Acme', urlKey: 'acme' } } }), undefined, calls);
  const r = await h.linear_check_connection({});
  assert.deepEqual(r, { ok: true, name: 'Ann', workspace: 'Acme', workspace_key: 'acme' });
  assert.equal(calls[0].url, 'https://api.linear.app/graphql');
  assert.equal(calls[0].init.headers.Authorization, KEY);
  assert.ok(!calls[0].init.body.includes('SECRETKEY'));
  const oauth = make(json({ data: { viewer: {}, organization: {} } }), { LINEAR_API_KEY: 'lin_oauth_abc' }, calls);
  await oauth.linear_check_connection({});
  assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer lin_oauth_abc');
});

test('search builds the filter: open by default, team, words in title or description', async () => {
  const calls = [];
  const h = make(json({ data: { issues: { nodes: [ISSUE] } } }), undefined, calls);
  const r = await h.linear_search_issues({ query: 'renewal', team: 'eng' });
  assert.equal(r.count, 1);
  assert.equal(r.issues[0].id, 'ENG-12');
  assert.deepEqual(calls[0].body.variables.filter, {
    team: { key: { eq: 'ENG' } },
    state: { type: { nin: ['completed', 'canceled'] } },
    or: [{ title: { containsIgnoreCase: 'renewal' } }, { description: { containsIgnoreCase: 'renewal' } }],
  });
  await h.linear_search_issues({ status: 'done' });
  assert.deepEqual(calls[1].body.variables.filter, { state: { type: { in: ['completed', 'canceled'] } } });
  await h.linear_search_issues({ status: 'all', limit: 500 });
  assert.deepEqual(calls[2].body.variables.filter, {});
  assert.equal(calls[2].body.variables.n, 50);
  await assert.rejects(() => h.linear_search_issues({ status: 'deleted' }), /status/);
  await assert.rejects(() => h.linear_search_issues({ team: 'ENG; x' }), /team key/);
  await assert.rejects(() => h.linear_search_issues({ query: 'x'.repeat(301) }), /too long/);
});

test('backlog needs a team, reads open issues and cuts long descriptions', async () => {
  const calls = [];
  const h = make(json({ data: { issues: { nodes: [{ ...ISSUE, description: 'd'.repeat(2000), parent: { identifier: 'ENG-1' }, estimate: 3 }] } } }), undefined, calls);
  await assert.rejects(() => h.linear_read_backlog({}), /team is required/);
  const r = await h.linear_read_backlog({ team: 'ENG', limit: 500 });
  assert.equal(r.issues[0].parent, 'ENG-1');
  assert.equal(r.issues[0].estimate, 3);
  assert.ok(r.issues[0].description.length <= 600);
  assert.equal(calls[0].body.variables.n, 100);
  assert.deepEqual(calls[0].body.variables.filter.state, { type: { nin: ['completed', 'canceled'] } });
});

test('one issue is read with its last comments; an unknown one is a readable error', async () => {
  const h = make(json({ data: { issue: { ...ISSUE, description: 'Body', createdAt: '2026-11-01', parent: null, cycle: { number: 4, name: 'Sprint' }, comments: { nodes: [{ body: 'Looks good', createdAt: '2026-11-02', user: { name: 'Bob' } }] } } } }));
  const r = await h.linear_get_issue({ id: 'https://linear.app/acme/issue/ENG-12/x' });
  assert.equal(r.id, 'ENG-12');
  assert.equal(r.cycle, 'Sprint 4');
  assert.deepEqual(r.comments, [{ author: 'Bob', at: '2026-11-02', text: 'Looks good' }]);
  await assert.rejects(() => make(json({ data: { issue: null } })).linear_get_issue({ id: 'ENG-99' }), /did not find ENG-99/);
});

test('a comment is the only write: two calls (find the issue, then create the comment), checked input, no secret in the body', async () => {
  const calls = [];
  const h = make((c) => (c.body.query.includes('commentCreate')
    ? json({ data: { commentCreate: { success: true, comment: { id: 'c1', url: 'https://linear.app/acme/issue/ENG-12#comment-c1' } } } })
    : json({ data: { issue: { id: 'uuid-12', identifier: 'ENG-12', title: 'Renewal reminder', url: ISSUE.url } } })), undefined, calls);
  const r = await h.linear_add_comment({ id: 'eng-12', comment: '  [Werkbank abc1234] Built and live.  ' });
  assert.deepEqual(r, { ok: true, issue: 'ENG-12', title: 'Renewal reminder', comment_url: 'https://linear.app/acme/issue/ENG-12#comment-c1' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.variables.input, { issueId: 'uuid-12', body: '[Werkbank abc1234] Built and live.' });
  const mutations = calls.filter((c) => /mutation/.test(c.body.query));
  assert.equal(mutations.length, 1);
  assert.ok(/commentCreate/.test(mutations[0].body.query) && !/issueUpdate|issueCreate|delete|archive/i.test(mutations[0].body.query));
  const none = [];
  const g = make(json({ data: {} }), undefined, none);
  await assert.rejects(() => g.linear_add_comment({ id: 'ENG-12', comment: '   ' }), /empty/);
  await assert.rejects(() => g.linear_add_comment({ id: 'ENG-12', comment: 'x'.repeat(MAX_COMMENT + 1) }), /too long/);
  await assert.rejects(() => g.linear_add_comment({ id: 'nonsense', comment: 'hi' }), /not a Linear issue/);
  assert.equal(none.length, 0, 'nothing is sent for refused input');
  await assert.rejects(() => make(json({ data: { commentCreate: { success: false } } }), undefined).linear_add_comment({ id: 'ENG-12', comment: 'hi' }), /did not find|did not accept/);
});

test('no tool can create, edit, move or delete an issue', () => {
  assert.ok(!TOOL_DEFINITIONS.some((t) => /create|update|delete|set_|assign|archive/.test(t.name)));
  const src = readFileSync(new URL('../connectors/linear/server/linear.mjs', import.meta.url), 'utf8');
  const mutations = [...src.matchAll(/mutation\(([^)]*)\)\s*\{\s*(\w+)/g)].map((m) => m[2]);
  assert.deepEqual(mutations, ['commentCreate']);
});

test('errors are readable and never contain the key', async () => {
  const unauth = make(json({}, 401));
  await assert.rejects(() => unauth.linear_list_teams({}), (e) => e instanceof LinearError && /HTTP 401/.test(e.message));
  await assert.rejects(() => make(json({}, 403)).linear_list_teams({}), /permissions/);
  await assert.rejects(() => make(json({}, 429)).linear_list_teams({}), /rate limit/);
  await assert.rejects(() => make(json({ errors: [{ message: 'x', extensions: { code: 'RATELIMITED' } }] })).linear_list_teams({}), /rate limit/);
  await assert.rejects(() => make(json({ errors: [{ message: 'Bad filter lin_api_SECRETKEY123 here' }] })).linear_list_teams({}), (e) => /Bad filter/.test(e.message) && !e.message.includes('SECRETKEY'));
  const down = createLinearHandlers({ env: { LINEAR_API_KEY: KEY }, fetchImpl: async () => { throw new Error(`boom ${KEY}`); } });
  await assert.rejects(() => down.linear_list_teams({}), (e) => /Could not reach/.test(e.message) && !e.message.includes('SECRETKEY'));
  await assert.rejects(() => createLinearHandlers({ env: {}, fetchImpl: async () => json({}) }).linear_list_teams({}), /LINEAR_API_KEY is missing/);
});

test('teams and projects come back as short rows', async () => {
  const t = await make(json({ data: { teams: { nodes: [{ key: 'ENG', name: 'Engineering', description: 'Builds it' }] } } })).linear_list_teams({});
  assert.deepEqual(t.teams, [{ key: 'ENG', name: 'Engineering', description: 'Builds it' }]);
  const calls = [];
  const p = await make(json({ data: { teams: { nodes: [{ projects: { nodes: [{ name: 'Renewals', state: 'started', progress: 0.42, targetDate: '2026-12-01', lead: { name: 'Ann' }, url: 'u' }] } }] } } }), undefined, calls).linear_list_projects({ team: 'eng' });
  assert.deepEqual(p.projects, [{ name: 'Renewals', state: 'started', progress: 42, target: '2026-12-01', lead: 'Ann', url: 'u' }]);
  assert.deepEqual(calls[0].body.variables.team, 'ENG');
});

test('manifest lists every tool in order and keeps the key sensitive and required', () => {
  const m = JSON.parse(readFileSync(new URL('../connectors/linear/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.tools.map((t) => t.name), TOOL_DEFINITIONS.map((t) => t.name));
  assert.equal(m.user_config.linear_api_key.sensitive, true);
  assert.equal(m.user_config.linear_api_key.required, true);
  assert.deepEqual(Object.keys(m.server.mcp_config.env), ['LINEAR_API_KEY']);
  assert.equal(m.name, 'linear');
});

test('the stdio server speaks MCP', async () => {
  const child = spawn('node', ['connectors/linear/server/index.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'inherit'] });
  const out = [];
  child.stdout.on('data', (d) => out.push(...String(d).split('\n').filter(Boolean).map((l) => JSON.parse(l))));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'linear_get_issue', arguments: { id: 'nope' } } }) + '\n');
  await new Promise((r) => setTimeout(r, 700));
  child.kill();
  assert.equal(out.find((m) => m.id === 1).result.serverInfo.name, 'linear');
  assert.match(out.find((m) => m.id === 1).result.instructions, /Linear/);
  assert.equal(out.find((m) => m.id === 2).result.tools.length, 7);
  const bad = out.find((m) => m.id === 3).result;
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /not a Linear issue/);
});

test('Linear is a source in the requirements flow: hint, prompt and tolerant reading', () => {
  assert.ok(SOURCES.some((s) => s.id === 'linear'));
  assert.equal(linearHint('eng'), 'team ENG');
  assert.equal(linearHint('ENG-12'), 'issue ENG-12');
  assert.equal(linearHint('https://linear.app/acme/issue/ENG-12/x'), 'issue https://linear.app/acme/issue/ENG-12/x');
  assert.equal(linearHint('renewal reminder'), 'search words: renewal reminder');
  const p = fetchPrompt('linear', 'ENG');
  for (const w of [/linear_read_backlog/, /linear_get_issue/, /linear_search_issues/, /Source: team ENG/, /"error"/]) assert.match(p, w);
  assert.doesNotMatch(p, /"mentions"/, 'one issue is one voice, like Jira');
  const text = '```json\n' + JSON.stringify({ items: [{ key: 'ENG-12', title: 'Renewal reminder', text: 'x', url: 'https://linear.app/acme/issue/ENG-12/x' }] }) + '\n```';
  const r = parseRequirements(text, 'linear');
  assert.equal(r.items[0].id, 'linear:ENG-12');
  assert.equal(r.items[0].source, 'linear');
});
