import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SlackError, TOOL_DEFINITIONS, createSlackHandlers } from '../connectors/slack/server/slack.mjs';

const env = { SLACK_BOT_TOKEN: 'xoxb-secret', SLACK_USER_TOKEN: 'xoxp-secret' };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const make = (answer, calls = [], e = env) => createSlackHandlers({ env: e, fetchImpl: async (url, init) => { calls.push({ url, init }); return typeof answer === 'function' ? answer(url, init) : answer; } });

test('check connection reports workspace and whether search is available', async () => {
  const r = await make(json({ ok: true, team: 'Firma', user: 'werkbank' })).slack_check_connection();
  assert.deepEqual(r, { ok: true, workspace: 'Firma', bot: 'werkbank', user_token_for_search: 'set' });
});

test('channels are listed with ids and filtered by name', async () => {
  const h = make(json({ ok: true, channels: [{ id: 'C0123456789', name: 'it-ops', is_member: true }, { id: 'C0123456780', name: 'sales' }] }));
  const r = await h.slack_list_channels({ query: 'IT' });
  assert.deepEqual(r.channels.map((c) => c.name), ['it-ops']);
});

test('reading needs a channel id and sends the bot token only to slack.com', async () => {
  const calls = [];
  const h = make(json({ ok: true, messages: [{ ts: '1700000000.000100', user: 'U1', text: 'Hallo', reply_count: 2 }] }), calls);
  const r = await h.slack_read_channel({ channel: 'C0123456789', limit: 5 });
  assert.equal(r.messages[0].replies, 2);
  assert.ok(calls[0].url.startsWith('https://slack.com/api/conversations.history?'));
  assert.equal(calls[0].init.headers.Authorization, 'Bearer xoxb-secret');
  await assert.rejects(h.slack_read_channel({ channel: '#general' }), /channel id/);
  await assert.rejects(h.slack_read_thread({ channel: 'C0123456789', thread_ts: 'x' }), SlackError);
});

test('search needs the user token and uses it', async () => {
  await assert.rejects(make(json({}), [], { SLACK_BOT_TOKEN: 'xoxb-secret' }).slack_search_messages({ query: 'a' }), /user token/);
  const calls = [];
  const r = await make(json({ ok: true, messages: { total: 1, matches: [{ channel: { id: 'C1', name: 'it' }, ts: '1.1', text: 'Treffer', permalink: 'https://x' }] } }), calls).slack_search_messages({ query: 'Treffer' });
  assert.equal(r.total, 1);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer xoxp-secret');
});

test('posting validates, posts JSON and can reply in a thread', async () => {
  const calls = [];
  const h = make(json({ ok: true, channel: 'C0123456789', ts: '1700000001.000200' }), calls);
  assert.deepEqual(await h.slack_post_message({ channel: 'C0123456789', text: 'Hi', thread_ts: '1700000000.000100' }), { posted: true, channel: 'C0123456789', ts: '1700000001.000200' });
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(JSON.parse(calls[0].init.body).thread_ts, '1700000000.000100');
  await assert.rejects(h.slack_post_message({ channel: 'C0123456789', text: ' ' }), SlackError);
});

test('Slack errors become readable messages without tokens', async () => {
  await assert.rejects(make(json({ ok: false, error: 'not_in_channel' })).slack_read_channel({ channel: 'C0123456789' }), /invite/i);
  await assert.rejects(make(json({ ok: false, error: 'missing_scope', needed: 'chat:write' })).slack_post_message({ channel: 'C0123456789', text: 'x' }), /scope/);
  await assert.rejects(make(json({}, 429)).slack_check_connection(), /rate limit/);
  const failing = createSlackHandlers({ env, fetchImpl: async () => { throw new Error('boom xoxb-secret'); } });
  await assert.rejects(failing.slack_check_connection(), (e) => !e.message.includes('xoxb-secret'));
  await assert.rejects(createSlackHandlers({ env: {} }).slack_check_connection(), /SLACK_BOT_TOKEN/);
});

test('manifest lists every tool in order and marks tokens secret', () => {
  const manifest = JSON.parse(readFileSync(new URL('../connectors/slack/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.tools.map((t) => t.name), TOOL_DEFINITIONS.map((t) => t.name));
  assert.equal(manifest.user_config.slack_bot_token.sensitive, true);
  assert.equal(manifest.user_config.slack_user_token.required, false);
});

test('the stdio server speaks MCP', async () => {
  const child = spawn('node', ['connectors/slack/server/index.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  child.stdout.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  for (let i = 0; i < 50 && lines.length < 2; i += 1) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  const [init, list] = lines.map((l) => JSON.parse(l));
  assert.equal(init.result.serverInfo.name, 'slack');
  assert.equal(list.result.tools.length, TOOL_DEFINITIONS.length);
});
