import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TOOL_DEFINITIONS, TeamsError, createTeamsHandlers, linkOf, messageRow, textOf } from '../connectors/teams/server/teams.mjs';
import { fetchPrompt, parseRequirements, SOURCES } from '../src/requirements.ts';

const TEAM = '01234567-89ab-cdef-0123-456789abcdef';
const CH = '19:abc123def@thread.tacv2';
const app = { TEAMS_TENANT_ID: TEAM, TEAMS_CLIENT_ID: 'cid', TEAMS_CLIENT_SECRET: 'sekret-value-1' };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const make = (env, answer, calls = []) => createTeamsHandlers({ env, fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return typeof answer === 'function' ? answer(String(url), init) : answer; } });
const graphAnswer = (graphBody) => (url) => (url.includes('login.microsoftonline.com') ? json({ access_token: 'tok-from-login', expires_in: 3600 }) : json(graphBody));

test('message text is taken from the html and keeps its words', () => {
  assert.equal(textOf('<p>Need <at id="0">Ann</at> to review &amp; sign</p><p>by Friday</p>'), 'Need Ann to review & sign\nby Friday');
  assert.equal(textOf('<attachment id="x"></attachment>Hello<br>World'), 'Hello\nWorld');
  assert.equal(messageRow({ id: '1', body: { contentType: 'text', content: 'a <b> c' } }).text, 'a <b> c');
});

test('a Teams message link gives team, channel and message; anything else gives null', () => {
  const link = `https://teams.microsoft.com/l/message/${encodeURIComponent(CH)}/1730640000123?tenantId=x&groupId=${TEAM}&parentMessageId=1730640000123`;
  assert.deepEqual(linkOf(link), { team_id: TEAM, channel_id: CH, message_id: '1730640000123' });
  assert.equal(linkOf('https://evil.example/l/message/x/1'), null);
  assert.equal(linkOf('Requirements'), null);
});

test('app sign-in: the secret goes only to the login host, the token only to Graph, and the token is reused', async () => {
  const calls = [];
  const h = make(app, graphAnswer({ value: [{ id: TEAM, displayName: 'Sales', description: 'd' }] }), calls);
  const r = await h.teams_list_teams({});
  assert.deepEqual(r.teams, [{ id: TEAM, name: 'Sales', description: 'd' }]);
  await h.teams_list_teams({});
  const login = calls.filter((c) => c.url.includes('login.microsoftonline.com'));
  assert.equal(login.length, 1, 'one sign-in for two calls');
  assert.match(String(login[0].init.body), /client_secret=sekret-value-1/);
  const graphCalls = calls.filter((c) => c.url.startsWith('https://graph.microsoft.com/'));
  assert.ok(graphCalls.length === 2 && graphCalls.every((c) => c.init.headers.Authorization === 'Bearer tok-from-login'));
  assert.ok(graphCalls.every((c) => !String(c.init.body ?? '').includes('sekret')));
  assert.match(graphCalls[0].url, /\/groups\?\$filter=/);
});

test('an access token wins, lists the joined teams and never calls the login host', async () => {
  const calls = [];
  const h = make({ ...app, TEAMS_ACCESS_TOKEN: 'delegated-token-xyz' }, json({ value: [] }), calls);
  await h.teams_list_teams({});
  assert.ok(calls.every((c) => c.url.startsWith('https://graph.microsoft.com/v1.0/me/joinedTeams')));
  assert.equal(calls[0].init.headers.Authorization, 'Bearer delegated-token-xyz');
});

test('an unreplaced placeholder counts as empty', async () => {
  const h = make({ TEAMS_ACCESS_TOKEN: '${user_config.access_token}', TEAMS_TENANT_ID: '${user_config.tenant_id}' }, json({}));
  await assert.rejects(() => h.teams_list_teams({}), /Sign-in is missing/);
});

test('read channel: system and deleted messages are left out, contains filters, reply text is clean', async () => {
  const calls = [];
  const body = { value: [
    { id: '1', messageType: 'message', createdDateTime: '2026-11-05T10:00:00Z', from: { user: { displayName: 'Ann' } }, body: { contentType: 'html', content: '<p>We need a renewal reminder</p>' }, webUrl: 'https://teams.microsoft.com/l/message/x' },
    { id: '2', messageType: 'systemEventMessage', body: { contentType: 'html', content: 'joined' } },
    { id: '3', messageType: 'message', deletedDateTime: '2026-11-05T11:00:00Z', body: { contentType: 'html', content: 'gone' } },
    { id: '4', messageType: 'message', from: { user: { displayName: 'Bo' } }, body: { contentType: 'html', content: 'Lunch?' } },
  ], '@odata.nextLink': 'https://graph.microsoft.com/next' };
  const h = make(app, graphAnswer(body), calls);
  const all = await h.teams_read_channel({ team_id: TEAM, channel_id: CH, limit: 10 });
  assert.deepEqual(all.messages.map((m) => m.id), ['1', '4']);
  assert.equal(all.messages[0].from, 'Ann');
  assert.equal(all.messages[0].text, 'We need a renewal reminder');
  assert.equal(all.more, true);
  const some = await h.teams_read_channel({ team_id: TEAM, channel_id: CH, contains: 'RENEWAL' });
  assert.deepEqual(some.messages.map((m) => m.id), ['1']);
  const url = calls.find((c) => c.url.includes('/messages')).url;
  assert.ok(url.includes(`/teams/${TEAM}/channels/${encodeURIComponent(CH)}/messages?$top=10`));
});

test('read thread takes a message link and reads the message and its replies', async () => {
  const calls = [];
  const h = make(app, (url) => (url.includes('login.') ? json({ access_token: 't', expires_in: 3600 }) : url.includes('/replies') ? json({ value: [{ id: '2', messageType: 'message', body: { contentType: 'text', content: 'agreed' } }] }) : json({ id: '1', messageType: 'message', body: { contentType: 'text', content: 'root' } })), calls);
  const link = `https://teams.microsoft.com/l/message/${encodeURIComponent(CH)}/1730640000123?groupId=${TEAM}`;
  const r = await h.teams_read_thread({ link });
  assert.equal(r.message.text, 'root');
  assert.deepEqual(r.replies.map((m) => m.text), ['agreed']);
  assert.ok(calls.some((c) => c.url.includes('/messages/1730640000123/replies')));
});

test('ids are checked before anything is sent', async () => {
  const calls = [];
  const h = make(app, graphAnswer({}), calls);
  await assert.rejects(() => h.teams_list_channels({ team_id: '../x' }), /team_id/);
  await assert.rejects(() => h.teams_read_channel({ team_id: TEAM, channel_id: 'general' }), /channel_id/);
  await assert.rejects(() => h.teams_read_thread({ team_id: TEAM, channel_id: CH, message_id: '12/../3' }), /message_id/);
  await assert.rejects(() => h.teams_read_channel({ link: 'https://example.com' }), /not a Teams message link/);
  assert.equal(calls.length, 0);
});

test('errors are readable and never contain the secret or the token', async () => {
  const h1 = make(app, (url) => (url.includes('login.') ? json({ error_description: 'AADSTS7000215: Invalid client secret sekret-value-1\nTrace' }, 401) : json({})));
  await assert.rejects(() => h1.teams_list_teams({}), (e) => e instanceof TeamsError && /HTTP 401/.test(e.message) && !e.message.includes('sekret-value-1'));
  const h2 = make({ TEAMS_ACCESS_TOKEN: 'delegated-token-xyz' }, json({}, 403));
  await assert.rejects(() => h2.teams_list_teams({}), /ChannelMessage\.Read\.All/);
  const h3 = createTeamsHandlers({ env: { TEAMS_ACCESS_TOKEN: 'delegated-token-xyz' }, fetchImpl: async () => { throw new Error('boom delegated-token-xyz'); } });
  await assert.rejects(() => h3.teams_list_teams({}), (e) => !e.message.includes('delegated-token-xyz') && /Could not reach/.test(e.message));
});

test('every call is a GET: nothing is ever written to Teams', async () => {
  const calls = [];
  const h = make(app, graphAnswer({ value: [] }), calls);
  await h.teams_list_teams({}); await h.teams_list_channels({ team_id: TEAM }); await h.teams_read_channel({ team_id: TEAM, channel_id: CH });
  assert.ok(calls.filter((c) => c.url.startsWith('https://graph.')).every((c) => c.init.method === 'GET'));
  assert.ok(!TOOL_DEFINITIONS.some((t) => /post|send|create|delete|update/.test(t.name)));
});

test('manifest lists every tool in order and keeps secrets sensitive', () => {
  const m = JSON.parse(readFileSync(new URL('../connectors/teams/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.tools.map((t) => t.name), TOOL_DEFINITIONS.map((t) => t.name));
  assert.equal(m.user_config.client_secret.sensitive, true);
  assert.equal(m.user_config.access_token.sensitive, true);
  assert.ok(Object.values(m.user_config).every((f) => f.required === false));
  assert.deepEqual(Object.keys(m.server.mcp_config.env), ['TEAMS_TENANT_ID', 'TEAMS_CLIENT_ID', 'TEAMS_CLIENT_SECRET', 'TEAMS_ACCESS_TOKEN']);
});

test('the stdio server speaks MCP', async () => {
  const child = spawn('node', ['connectors/teams/server/index.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'inherit'] });
  const out = [];
  child.stdout.on('data', (d) => out.push(...String(d).split('\n').filter(Boolean).map((l) => JSON.parse(l))));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  await new Promise((r) => setTimeout(r, 700));
  child.kill();
  assert.equal(out.find((m) => m.id === 1).result.serverInfo.name, 'teams');
  assert.equal(out.find((m) => m.id === 2).result.tools.length, 5);
});

test('Teams is a source in the requirements flow: prompt, signals and tolerant reading', () => {
  assert.ok(SOURCES.some((s) => s.id === 'teams'));
  const p = fetchPrompt('teams', 'Sales / Requirements');
  for (const w of [/teams_read_channel/, /teams_read_thread/, /teams_list_channels/, /"mentions"/, /never estimate/, /Copy link to message|message link/, /"error"/]) assert.match(p, w);
  const text = '```json\n' + JSON.stringify({ items: [{ key: 'Requirements 1730640000123', title: 'Renewal reminder', text: 'x', mentions: 3, quotes: ['we miss dates (Ann)'] }] }) + '\n```';
  const r = parseRequirements(text, 'teams');
  assert.equal(r.items[0].id, 'teams:Requirements 1730640000123');
  assert.equal(r.items[0].mentions, 3);
});
