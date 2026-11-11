import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FigmaError, TOOL_DEFINITIONS, collectText, createFigmaHandlers, fileOf, nodeIdOf } from '../connectors/figma/server/figma.mjs';
import { fetchPrompt, parseRequirements, SOURCES } from '../src/requirements.ts';

const TOKEN = 'figd_SECRETTOKEN123';
const KEY = 'AbCdEf1234567890xyz';
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const make = (answer, env = { FIGMA_TOKEN: TOKEN }, calls = []) => createFigmaHandlers({ env, fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return typeof answer === 'function' ? answer(calls.at(-1)) : answer; } });

test('a file is named by key or by a figma.com link; a node-id in the link becomes 1:2', () => {
  assert.deepEqual(fileOf(KEY), { key: KEY, node: null });
  assert.deepEqual(fileOf(`https://www.figma.com/design/${KEY}/My-file?node-id=12-34&t=x`), { key: KEY, node: '12:34' });
  assert.deepEqual(fileOf(`https://figma.com/file/${KEY}/x`), { key: KEY, node: null });
  for (const bad of ['', 'short', `https://evil.example/design/${KEY}/x`, `http://www.figma.com/design/${KEY}/x`, 'https://www.figma.com/community/plugin/1', `${KEY}/../x`]) assert.throws(() => fileOf(bad), FigmaError, bad);
  assert.equal(nodeIdOf('12-34'), '12:34');
  assert.throws(() => nodeIdOf('12:34; x'), FigmaError);
});

test('every call is a GET to api.figma.com, the token only in the header', async () => {
  const calls = [];
  const h = make(json({ handle: 'Ann', email: 'ann@example.com' }), undefined, calls);
  assert.deepEqual(await h.figma_check_connection({}), { ok: true, user: 'Ann' });
  assert.equal(calls[0].url, 'https://api.figma.com/v1/me');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers['X-Figma-Token'], TOKEN);
  assert.ok(!calls[0].url.includes('SECRET'));
});

test('no tool can change Figma: only GET, no write verbs in the source', () => {
  const src = readFileSync(new URL('../connectors/figma/server/figma.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.equal([...src.matchAll(/method:\s*'(\w+)'/g)].map((m) => m[1]).join(), 'GET');
  for (const t of TOOL_DEFINITIONS) assert.match(t.description, /Read only/);
});

test('the outline lists pages and top-level frames', async () => {
  const calls = [];
  const h = make(json({ name: 'Renewals', version: '9', lastModified: '2026-11-01', document: { children: [{ id: '0:1', name: 'Flow', children: [{ id: '1:2', name: 'Start', type: 'FRAME' }, { id: '1:3', name: 'note', type: 'TEXT' }] }] } }), undefined, calls);
  const r = await h.figma_get_file_outline({ file: KEY });
  assert.equal(r.pages[0].frames.length, 1);
  assert.deepEqual(r.pages[0].frames[0], { id: '1:2', name: 'Start', type: 'FRAME' });
  assert.match(calls[0].url, /depth=2/);
});

test('frame text comes grouped by frame in reading order, and is cut at the limits', async () => {
  const tree = { id: '1:2', name: 'Start', type: 'FRAME', children: [
    { type: 'TEXT', characters: 'Second', absoluteBoundingBox: { x: 0, y: 50 } },
    { type: 'TEXT', characters: 'First', absoluteBoundingBox: { x: 0, y: 10 } },
    { type: 'TEXT', characters: '   ' },
    { type: 'FRAME', name: 'Inner', children: [{ type: 'TEXT', characters: 'Inside', absoluteBoundingBox: { x: 0, y: 5 } }] },
  ] };
  const calls = [];
  const h = make(json({ name: 'File', nodes: { '1:2': { document: tree }, } }), undefined, calls);
  const r = await h.figma_read_frame_text({ file: `https://www.figma.com/design/${KEY}/x?node-id=1-2` });
  assert.deepEqual(r.frames[0].texts.map((t) => t.text), ['First', 'Second', 'Inside']);
  assert.equal(r.frames[0].texts[2].frame, 'Inner');
  assert.match(calls[0].url, /ids=1%3A2/);
  assert.equal(collectText({ type: 'FRAME', children: Array.from({ length: 200 }, (_, i) => ({ type: 'TEXT', characters: `t${i}` })) }).truncated, true);
  await assert.rejects(h.figma_read_frame_text({ file: KEY }), /node_id is required/);
  await assert.rejects(h.figma_read_frame_text({ file: KEY, node_id: Array.from({ length: 11 }, (_, i) => `1:${i}`).join(',') }), /At most 10/);
});

test('comments: open threads by default, replies attached, resolved ones on request', async () => {
  const all = [
    { id: 'c1', message: 'Reminder 30 days before renewal', user: { handle: 'Ann' }, created_at: '2026-11-02', client_meta: { node_id: '1:2' } },
    { id: 'c2', message: 'Agreed', parent_id: 'c1', user: { handle: 'Bob' }, created_at: '2026-11-03' },
    { id: 'c3', message: 'Old', user: { handle: 'Bob' }, resolved_at: '2026-10-01' },
  ];
  const h = make(json({ comments: all }));
  const open = await h.figma_list_comments({ file: KEY });
  assert.equal(open.count, 1);
  assert.equal(open.comments[0].replies[0].text, 'Agreed');
  assert.equal(open.comments[0].node, '1:2');
  assert.equal((await h.figma_list_comments({ file: KEY, status: 'resolved' })).comments[0].id, 'c3');
  assert.equal((await h.figma_list_comments({ file: KEY, status: 'all' })).count, 2);
  await assert.rejects(h.figma_list_comments({ file: KEY, status: 'x' }), /status must be/);
});

test('errors are readable and never contain the token', async () => {
  await assert.rejects(make(json({}, 401)).figma_check_connection({}), /does not accept the token/);
  await assert.rejects(make(json({}, 403)).figma_list_comments({ file: KEY }), /may not read/);
  await assert.rejects(make(json({}, 404)).figma_get_file_outline({ file: KEY }), /did not find/);
  await assert.rejects(make(json({}, 429)).figma_check_connection({}), /slow down/);
  await assert.rejects(make(json({ err: `bad ${TOKEN}` }, 500)).figma_check_connection({}), (e) => e instanceof FigmaError && !e.message.includes(TOKEN));
  await assert.rejects(make(() => { throw new Error(`boom ${TOKEN}`); }).figma_check_connection({}), (e) => !e.message.includes(TOKEN));
  await assert.rejects(make(json({}), {}).figma_check_connection({}), /FIGMA_TOKEN is missing/);
});

test('the MCP server answers initialize, lists the five tools and calls one', async () => {
  const child = spawn('node', [new URL('../connectors/figma/server/index.mjs', import.meta.url).pathname], { env: { ...process.env, FIGMA_TOKEN: '' } });
  const lines = [];
  child.stdout.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean).map((l) => JSON.parse(l))));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'figma_check_connection' } })}\n`);
  await new Promise((r) => setTimeout(r, 600));
  child.kill();
  assert.equal(lines.find((l) => l.id === 2).result.tools.length, 5);
  assert.equal(lines.find((l) => l.id === 3).result.isError, true);
});

test('Figma is a source of requirements: prompt names the tools, answers are parsed with mentions', () => {
  assert.ok(SOURCES.some((s) => s.id === 'figma'));
  const p = fetchPrompt('figma', `https://www.figma.com/design/${KEY}/x?node-id=1-2`);
  for (const t of ['figma_list_comments', 'figma_get_file_outline', 'figma_read_frame_text']) assert.match(p, new RegExp(t));
  assert.match(p, /never create, change, comment/);
  assert.match(p, /"mentions"/);
  const r = parseRequirements('```json\n{"items":[{"key":"c1","title":"Reminder","text":"30 days before","mentions":3}]}\n```', 'figma');
  assert.equal(r.items[0].id, 'figma:c1');
  assert.equal(r.items[0].mentions, 3);
});
