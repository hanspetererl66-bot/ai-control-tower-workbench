import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JiraError, TOOL_DEFINITIONS, adfToText, createJiraHandlers, normalizeSite, textToAdf } from '../connectors/jira/server/jira.mjs';

const env = { JIRA_SITE: 'firma.atlassian.net/', JIRA_EMAIL: 'a@firma.de', JIRA_API_TOKEN: 'secret-token-123' };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const make = (answer, calls = []) => createJiraHandlers({ env, fetchImpl: async (url, init) => { calls.push({ url, init }); return typeof answer === 'function' ? answer(url, init) : answer; } });

test('site is normalised and must be https', () => {
  assert.equal(normalizeSite('firma.atlassian.net/'), 'https://firma.atlassian.net');
  assert.throws(() => normalizeSite(''), JiraError);
  assert.throws(() => normalizeSite('http://x.example'), JiraError);
  assert.throws(() => normalizeSite('https://u:p@x.example'), JiraError);
});

test('ADF round trip for plain text', () => {
  const adf = textToAdf('Erste Zeile\n\nZweiter Absatz');
  assert.equal(adf.content.length, 2);
  assert.equal(adfToText(adf).trim(), 'Erste Zeile\nZweiter Absatz');
});

test('search uses JQL with basic auth and returns compact rows', async () => {
  const calls = [];
  const h = make(json({ issues: [{ key: 'ABC-1', fields: { summary: 'Fix', status: { name: 'Open' }, issuetype: { name: 'Bug' }, assignee: { displayName: 'Mara' } } }], isLast: true }), calls);
  const r = await h.jira_search_issues({ jql: 'project = ABC' });
  assert.deepEqual(r.issues[0], { key: 'ABC-1', summary: 'Fix', status: 'Open', type: 'Bug', priority: null, assignee: 'Mara', updated: null });
  assert.equal(calls[0].url, 'https://firma.atlassian.net/rest/api/3/search/jql');
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from('a@firma.de:secret-token-123').toString('base64')}`);
  await assert.rejects(h.jira_search_issues({ jql: ' ' }), JiraError);
});

test('create issue validates input and returns a link', async () => {
  const calls = [];
  const h = make(json({ key: 'ABC-7' }, 201), calls);
  const r = await h.jira_create_issue({ project: 'abc', summary: 'Neu', description: 'Text' });
  assert.deepEqual(r, { created: true, key: 'ABC-7', url: 'https://firma.atlassian.net/browse/ABC-7' });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.fields.project.key, 'ABC');
  assert.equal(body.fields.issuetype.name, 'Task');
  await assert.rejects(h.jira_create_issue({ project: 'x y', summary: 'a' }), JiraError);
  await assert.rejects(h.jira_create_issue({ project: 'ABC', summary: '' }), JiraError);
});

test('status change finds the transition by name and explains when none fits', async () => {
  const calls = [];
  const h = make((url, init) => (init.method === 'GET' ? json({ transitions: [{ id: '31', name: 'Start', to: { name: 'In Progress' } }] }) : json({}, 204)), calls);
  assert.deepEqual(await h.jira_set_status({ key: 'abc-1', status: 'in progress' }), { moved: true, key: 'ABC-1', status: 'In Progress' });
  assert.equal(JSON.parse(calls[1].init.body).transition.id, '31');
  await assert.rejects(h.jira_set_status({ key: 'ABC-1', status: 'Done' }), /Possible: In Progress/);
});

test('adding labels keeps the existing ones and validates every label', async () => {
  const calls = [];
  const h = make(json({}, 204), calls);
  assert.deepEqual(await h.jira_add_labels({ key: 'abc-1', labels: ['werkbank', 'werkbank', 'joule:agent'] }), { labelled: true, key: 'ABC-1', labels: ['werkbank', 'joule:agent'] });
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].url, 'https://firma.atlassian.net/rest/api/3/issue/ABC-1');
  assert.deepEqual(JSON.parse(calls[0].init.body), { update: { labels: [{ add: 'werkbank' }, { add: 'joule:agent' }] } });
  await assert.rejects(h.jira_add_labels({ key: 'ABC-1', labels: ['two words'] }), /not a valid label/);
  await assert.rejects(h.jira_add_labels({ key: 'ABC-1', labels: [] }), /labels is required/);
  await assert.rejects(h.jira_add_labels({ key: 'ABC-1', labels: Array.from({ length: 11 }, (_, i) => `l${i}`) }), /At most 10/);
  assert.equal(calls.length, 1);
});

test('errors are readable and never contain the token', async () => {
  await assert.rejects(make(json({}, 401)).jira_check_connection(), /refused the login/);
  await assert.rejects(make(json({}, 404)).jira_get_issue({ key: 'ABC-1' }), /HTTP 404/);
  await assert.rejects(make(json({}, 404)).jira_get_issue({ key: 'bad key' }), /ABC-123/);
  const failing = createJiraHandlers({ env, fetchImpl: async () => { throw new Error('boom secret-token-123'); } });
  await assert.rejects(failing.jira_check_connection(), (e) => e instanceof JiraError && !e.message.includes('secret-token-123'));
  await assert.rejects(createJiraHandlers({ env: { JIRA_SITE: 'x.atlassian.net' } }).jira_check_connection(), /JIRA_EMAIL/);
});

test('manifest lists every tool in order and marks the token secret', () => {
  const manifest = JSON.parse(readFileSync(new URL('../connectors/jira/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.tools.map((t) => t.name), TOOL_DEFINITIONS.map((t) => t.name));
  assert.equal(manifest.user_config.jira_api_token.sensitive, true);
});

test('the stdio server speaks MCP', async () => {
  const child = spawn('node', ['connectors/jira/server/index.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  child.stdout.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  for (let i = 0; i < 50 && lines.length < 2; i += 1) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  const [init, list] = lines.map((l) => JSON.parse(l));
  assert.equal(init.result.serverInfo.name, 'jira');
  assert.equal(list.result.tools.length, TOOL_DEFINITIONS.length);
});

test('read_backlog returns parent epic, labels and description text for a project (read only)', async () => {
  const calls = [];
  const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'As a seller I want X.' }] }] };
  const h = make(json({ isLast: true, issues: [{ key: 'ABC-2', fields: { summary: 'Story', issuetype: { name: 'Story' }, status: { name: 'To Do' }, priority: { name: 'High' }, labels: ['a'], description: adf, parent: { key: 'ABC-1', fields: { summary: 'Epic' } } } }] }), calls);
  const r = await h.jira_read_backlog({ project: 'abc' });
  assert.equal(r.issues[0].parentKey, 'ABC-1'); assert.equal(r.issues[0].parentSummary, 'Epic'); assert.match(r.issues[0].description, /As a seller/);
  const body = JSON.parse(calls[0].init.body);
  assert.match(body.jql, /^project = ABC /); assert.equal(calls[0].init.method, 'POST');
  await assert.rejects(h.jira_read_backlog({ project: 'x; DROP' }), JiraError);
});

test('a default project fills in a missing project and an explicit one wins', async () => {
  const calls = [];
  const withDefault = (answer) => createJiraHandlers({ env: { ...env, JIRA_DEFAULT_PROJECT: ' scrum ' }, fetchImpl: async (url, init) => { calls.push({ url, init }); return answer; } });
  const created = await withDefault(json({ key: 'SCRUM-3' }, 201)).jira_create_issue({ summary: 'Ohne Projekt' });
  assert.deepEqual(created, { created: true, key: 'SCRUM-3', url: 'https://firma.atlassian.net/browse/SCRUM-3' });
  assert.equal(JSON.parse(calls[0].init.body).fields.project.key, 'SCRUM');
  await withDefault(json({ isLast: true, issues: [] })).jira_read_backlog({});
  assert.match(JSON.parse(calls[1].init.body).jql, /^project = SCRUM /);
  await withDefault(json({ key: 'ABC-9' }, 201)).jira_create_issue({ project: 'abc', summary: 'Anderes Projekt' });
  assert.equal(JSON.parse(calls[2].init.body).fields.project.key, 'ABC');
  assert.equal(calls.length, 3);
});

test('without a default project the project stays required; an invalid default is explained', async () => {
  const h = make(json({ key: 'X-1' }, 201));
  await assert.rejects(h.jira_create_issue({ summary: 'a' }), /no default project is set/);
  await assert.rejects(h.jira_read_backlog({}), /no default project is set/);
  const bad = createJiraHandlers({ env: { ...env, JIRA_DEFAULT_PROJECT: 'MyjouleX Board' }, fetchImpl: async () => json({}) });
  await assert.rejects(bad.jira_create_issue({ summary: 'a' }), /default project is not a valid project key/);
  await assert.rejects(bad.jira_read_backlog({ project: 'x; DROP' }), /project must be a project key/);
});

test('check_connection reports a valid default project and the setting is optional in the manifest', async () => {
  const h = createJiraHandlers({ env: { ...env, JIRA_DEFAULT_PROJECT: 'scrum' }, fetchImpl: async () => json({ displayName: 'Service' }) });
  assert.deepEqual(await h.jira_check_connection(), { ok: true, user: 'Service', site: 'https://firma.atlassian.net', default_project: 'SCRUM' });
  const manifest = JSON.parse(readFileSync(new URL('../connectors/jira/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.user_config.jira_default_project.required, false);
  assert.equal(manifest.server.mcp_config.env.JIRA_DEFAULT_PROJECT, '${user_config.jira_default_project}');
  const required = (name) => TOOL_DEFINITIONS.find((t) => t.name === name).inputSchema.required;
  assert.deepEqual(required('jira_create_issue'), ['summary']);
  assert.deepEqual(required('jira_read_backlog'), []);
});
