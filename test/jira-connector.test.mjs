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
