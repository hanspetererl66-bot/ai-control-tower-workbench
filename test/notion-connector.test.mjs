import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NotionError, TOOL_DEFINITIONS, blockText, createNotionHandlers, pageIdOf, titleOf } from '../connectors/notion/server/notion.mjs';

const env = { NOTION_API_TOKEN: 'secret_token_123' };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const make = (answer, calls = []) => createNotionHandlers({ env, fetchImpl: async (url, init) => { calls.push({ url, init }); return typeof answer === 'function' ? answer(url, init) : answer; } });
const ID = '0123456789abcdef0123456789abcdef';
const rt = (t) => [{ plain_text: t }];

test('page ids come from ids, dashed ids and links; anything else is refused', () => {
  assert.equal(pageIdOf(ID), ID);
  assert.equal(pageIdOf('01234567-89ab-cdef-0123-456789abcdef'), ID);
  assert.equal(pageIdOf(`https://www.notion.so/team/My-Page-${ID.toUpperCase()}?pvs=4`), ID);
  assert.throws(() => pageIdOf(''), NotionError);
  assert.throws(() => pageIdOf('not-an-id'), NotionError);
});

test('blocks become plain lines', () => {
  assert.equal(blockText({ type: 'heading_2', heading_2: { rich_text: rt('Goals') } }), '## Goals');
  assert.equal(blockText({ type: 'to_do', to_do: { rich_text: rt('Ship'), checked: true } }), '- [x] Ship');
  assert.equal(blockText({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('One') } }), '- One');
  assert.equal(blockText({ type: 'divider', divider: {} }), '');
  assert.equal(titleOf({ properties: { Name: { type: 'title', title: rt('Roadmap') } } }), 'Roadmap');
});

test('search sends a bearer token and version, returns compact rows, and never writes', async () => {
  const calls = [];
  const h = make(json({ results: [{ object: 'page', id: '01234567-89ab-cdef-0123-456789abcdef', url: 'https://notion.so/x', last_edited_time: '2026-11-01T00:00:00Z', properties: { Name: { type: 'title', title: rt('Roadmap') } } }], has_more: false }), calls);
  const r = await h.notion_search({ query: 'road', only: 'page' });
  assert.deepEqual(r.results[0], { id: ID, type: 'page', title: 'Roadmap', url: 'https://notion.so/x', edited: '2026-11-01T00:00:00Z' });
  assert.equal(calls[0].url, 'https://api.notion.com/v1/search');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret_token_123');
  assert.equal(calls[0].init.headers['Notion-Version'], '2022-06-28');
  assert.deepEqual(JSON.parse(calls[0].init.body).filter, { property: 'object', value: 'page' });
  assert.deepEqual(Object.keys(h).sort(), ['notion_check_connection', 'notion_get_page', 'notion_search']);
});

test('get page reads title and blocks, following the cursor', async () => {
  let n = 0;
  const h = make((url) => {
    if (url.endsWith(`/pages/${ID}`)) return json({ url: 'https://notion.so/p', last_edited_time: 't', properties: { Name: { type: 'title', title: rt('Spec') } } });
    n++;
    return n === 1
      ? json({ results: [{ type: 'heading_1', heading_1: { rich_text: rt('Spec') } }], has_more: true, next_cursor: 'c2' })
      : json({ results: [{ type: 'paragraph', paragraph: { rich_text: rt('Body') } }], has_more: false });
  });
  const r = await h.notion_get_page({ id: ID });
  assert.equal(r.title, 'Spec');
  assert.equal(r.text, '# Spec\nBody');
  assert.equal(r.truncated, false);
});

test('errors are explained and never contain the token', async () => {
  await assert.rejects(make(json({}, 404)).notion_get_page({ id: ID }), /Connections/);
  await assert.rejects(make(json({}, 401)).notion_check_connection(), /refused the token/);
  const boom = createNotionHandlers({ env, fetchImpl: async () => { throw new Error('connect failed for secret_token_123'); } });
  await assert.rejects(boom.notion_check_connection(), (e) => e instanceof NotionError && !e.message.includes('secret_token_123'));
  await assert.rejects(createNotionHandlers({ env: {}, fetchImpl: async () => json({}) }).notion_search({}), /NOTION_API_TOKEN is missing/);
});

test('manifest lists every tool in order and marks the token secret', () => {
  const manifest = JSON.parse(readFileSync(new URL('../connectors/notion/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.tools.map((t) => t.name), TOOL_DEFINITIONS.map((t) => t.name));
  assert.equal(manifest.user_config.notion_api_token.sensitive, true);
});

test('the server answers over stdio', async () => {
  const child = spawn('node', ['connectors/notion/server/index.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  child.stdout.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  await new Promise((r) => setTimeout(r, 500));
  child.stdin.end();
  const tools = JSON.parse(lines.find((l) => l.includes('"id":2'))).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['notion_check_connection', 'notion_search', 'notion_get_page']);
});
