import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NotionError, TOOL_DEFINITIONS, blockText, createNotionHandlers, idOf, propText, propertyValue, textToBlocks, titleOf } from '../connectors/notion/server/notion.mjs';

const env = { NOTION_TOKEN: 'secret_abc123' };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const make = (answer, calls = []) => createNotionHandlers({ env, fetchImpl: async (url, init) => { calls.push({ url, init }); return typeof answer === 'function' ? answer(url, init) : answer; } });
const rt = (text) => [{ plain_text: text }];
const ID = '0123456789abcdef0123456789abcdef';
const DASHED = '01234567-89ab-cdef-0123-456789abcdef';

test('ids are taken from plain ids, dashed ids and notion links', () => {
  assert.equal(idOf(ID), DASHED);
  assert.equal(idOf(DASHED.toUpperCase()), DASHED);
  assert.equal(idOf(`https://www.notion.so/team/Anforderungen-${ID}?pvs=4`), DASHED);
  assert.throws(() => idOf(''), NotionError);
  assert.throws(() => idOf('Anforderungen'), /not a Notion id/);
});

test('titles, properties and blocks become short text', () => {
  assert.equal(titleOf({ object: 'page', properties: { Name: { type: 'title', title: rt('Rechnung prüfen') } } }), 'Rechnung prüfen');
  assert.equal(titleOf({ object: 'database', title: rt('Backlog') }), 'Backlog');
  assert.equal(propText({ type: 'multi_select', multi_select: [{ name: 'A' }, { name: 'B' }] }), 'A, B');
  assert.equal(propText({ type: 'date', date: { start: '2026-11-01', end: null } }), '2026-11-01');
  assert.equal(propText({ type: 'formula' }), '');
  assert.equal(blockText({ type: 'to_do', to_do: { rich_text: rt('Prüfen'), checked: true } }), '- [x] Prüfen');
  assert.equal(blockText({ type: 'heading_2', heading_2: { rich_text: rt('Ziel') } }), '## Ziel');
  assert.equal(blockText({ type: 'image', image: {} }), null);
});

test('search sends the token and version only to api.notion.com and filters by type', async () => {
  const calls = [];
  const h = make(json({ results: [{ object: 'page', id: DASHED, url: 'https://notion.so/x', last_edited_time: '2026-11-01T10:00:00Z', properties: { T: { type: 'title', title: rt('Seite') } } }], has_more: false }), calls);
  const r = await h.notion_search({ query: 'Anforderungen', type: 'page', limit: 5 });
  assert.deepEqual(r.results[0], { id: DASHED, type: 'page', title: 'Seite', url: 'https://notion.so/x', edited: '2026-11-01T10:00:00Z' });
  assert.equal(calls[0].url, 'https://api.notion.com/v1/search');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret_abc123');
  assert.equal(calls[0].init.headers['Notion-Version'], '2022-06-28');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.query, 'Anforderungen'); assert.equal(body.page_size, 5); assert.deepEqual(body.filter, { property: 'object', value: 'page' });
});

test('read page returns properties and block text, and follows the next page of blocks once', async () => {
  const calls = [];
  const h = make((url) => {
    if (url.endsWith(`/pages/${DASHED}`)) return json({ object: 'page', id: DASHED, properties: { Name: { type: 'title', title: rt('Seite') }, Status: { type: 'status', status: { name: 'Open' } } } });
    if (url.includes('start_cursor=c2')) return json({ results: [{ type: 'paragraph', paragraph: { rich_text: rt('Zweiter Teil') } }], has_more: false });
    return json({ results: [{ type: 'heading_1', heading_1: { rich_text: rt('Ziel') } }, { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('Schnell') } }], has_more: true, next_cursor: 'c2' });
  }, calls);
  const r = await h.notion_read_page({ id: `https://notion.so/Seite-${ID}` });
  assert.equal(r.title, 'Seite'); assert.deepEqual(r.properties, { Status: 'Open' });
  assert.equal(r.text, '# Ziel\n- Schnell\nZweiter Teil'); assert.equal(r.truncated, false);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.init.method === 'GET' || c.init.method === 'POST'));
});

test('query database returns rows with their properties', async () => {
  const calls = [];
  const h = make(json({ results: [{ object: 'page', id: DASHED, properties: { Titel: { type: 'title', title: rt('Mahnung') }, Prio: { type: 'select', select: { name: 'Hoch' } } } }], has_more: true }), calls);
  const r = await h.notion_query_database({ id: ID, limit: 10 });
  assert.equal(r.rows[0].title, 'Mahnung'); assert.deepEqual(r.rows[0].properties, { Prio: 'Hoch' }); assert.equal(r.more, true);
  assert.equal(calls[0].url, `https://api.notion.com/v1/databases/${DASHED}/query`);
  assert.equal(JSON.parse(calls[0].init.body).page_size, 10);
});

test('errors are readable and never contain the token', async () => {
  await assert.rejects(make(json({}, 401)).notion_check_connection(), /does not accept the token/);
  await assert.rejects(make(json({}, 404)).notion_read_page({ id: ID }), /shared with the integration/);
  await assert.rejects(make(json({}, 429)).notion_search({}), /rate limit/);
  const failing = createNotionHandlers({ env, fetchImpl: async () => { throw new Error('boom secret_abc123'); } });
  await assert.rejects(failing.notion_check_connection(), (e) => e instanceof NotionError && !e.message.includes('secret_abc123'));
  await assert.rejects(createNotionHandlers({ env: {} }).notion_search({}), /NOTION_TOKEN/);
});

test('read tools use only GET, or POST on search and query', async () => {
  const calls = [];
  const h = make(json({ results: [], has_more: false, properties: {} }), calls);
  await h.notion_search({}); await h.notion_query_database({ id: ID }); await h.notion_read_page({ id: ID });
  assert.ok(calls.every((c) => ['GET', 'POST'].includes(c.init.method)));
  assert.ok(calls.filter((c) => c.init.method === 'POST').every((c) => /\/search$|\/query$/.test(c.url)));
});

test('query passes filter, sorts and cursor and returns the next cursor', async () => {
  const calls = [];
  const h = make(json({ results: [], has_more: true, next_cursor: 'n1' }), calls);
  const filter = { property: 'Status', status: { equals: 'Open' } };
  const r = await h.notion_query_database({ id: ID, filter, sorts: [{ property: 'Prio', direction: 'ascending' }], start_cursor: 'c0' });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.filter, filter); assert.equal(body.start_cursor, 'c0'); assert.equal(body.sorts.length, 1);
  assert.equal(r.next_cursor, 'n1');
  await assert.rejects(h.notion_query_database({ id: ID, filter: 'x' }), /filter must be/);
  await assert.rejects(h.notion_query_database({ id: ID, sorts: {} }), /sorts must be/);
});

test('text becomes blocks and back', () => {
  const blocks = textToBlocks('# Ziel\n\nEin Absatz\n- Punkt\n1. Eins\n- [x] Fertig\n> Zitat');
  assert.deepEqual(blocks.map((b) => b.type), ['heading_1', 'paragraph', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote']);
  assert.equal(blocks[4].to_do.checked, true);
  assert.equal(blockText({ type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Ziel' }] } }), '# Ziel');
  assert.deepEqual(textToBlocks(''), []);
  assert.throws(() => textToBlocks(Array(101).fill('x').join('\n')), /Too many lines/);
  assert.equal(textToBlocks('x'.repeat(5000))[0].paragraph.rich_text[0].text.content.length, 2000);
});

test('property values follow the property type and refuse the rest', () => {
  assert.deepEqual(propertyValue('S', 'status', 'Open'), { status: { name: 'Open' } });
  assert.deepEqual(propertyValue('S', 'select', 'Hoch'), { select: { name: 'Hoch' } });
  assert.deepEqual(propertyValue('S', 'multi_select', ['A', 'B']), { multi_select: [{ name: 'A' }, { name: 'B' }] });
  assert.deepEqual(propertyValue('N', 'number', '3'), { number: 3 });
  assert.deepEqual(propertyValue('C', 'checkbox', true), { checkbox: true });
  assert.deepEqual(propertyValue('D', 'date', '2026-11-30'), { date: { start: '2026-11-30' } });
  assert.throws(() => propertyValue('D', 'date', 'morgen'), /date such as/);
  assert.throws(() => propertyValue('N', 'number', 'viel'), /a number/);
  assert.throws(() => propertyValue('C', 'checkbox', 'yes'), /true or false/);
  assert.throws(() => propertyValue('F', 'formula', 1), /does not write/);
  assert.throws(() => propertyValue('R', 'relation', 1), /does not write/);
});

test('create page below a page sends parent, title and blocks, and returns id and link', async () => {
  const calls = [];
  const h = make(json({ id: DASHED, url: 'https://notion.so/neu' }), calls);
  const r = await h.notion_create_page({ parent_id: ID, parent_type: 'page', title: 'Neue Seite', content: '# Ziel\nText' });
  assert.deepEqual(r, { created: true, id: DASHED, url: 'https://notion.so/neu' });
  assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].url, 'https://api.notion.com/v1/pages');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.parent, { page_id: DASHED });
  assert.equal(body.properties.title.title[0].text.content, 'Neue Seite');
  assert.equal(body.children.length, 2);
  assert.ok(!calls[0].init.body.includes('secret_abc123'));
});

test('create page in a database builds the properties from its schema', async () => {
  const calls = [];
  const schema = { Titel: { type: 'title' }, Status: { type: 'status' }, Prio: { type: 'select' }, Summe: { type: 'formula' } };
  const h = make((url) => (url.includes('/databases/') ? json({ properties: schema }) : json({ id: DASHED, url: null })), calls);
  await h.notion_create_page({ parent_id: ID, parent_type: 'database', title: 'Mahnung', properties: { Status: 'Open', Prio: 'Hoch' } });
  assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].url, `https://api.notion.com/v1/databases/${DASHED}`);
  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(body.parent, { database_id: DASHED });
  assert.equal(body.properties.Titel.title[0].text.content, 'Mahnung');
  assert.deepEqual(body.properties.Status, { status: { name: 'Open' } });
  assert.equal(body.children, undefined);
  await assert.rejects(h.notion_create_page({ parent_id: ID, parent_type: 'database', title: 'x', properties: { Gibt: 'es nicht' } }), /There is no property "Gibt"/);
  await assert.rejects(h.notion_create_page({ parent_id: ID, parent_type: 'database', title: 'x', properties: { Summe: 1 } }), /does not write/);
  await assert.rejects(h.notion_create_page({ parent_id: ID, parent_type: 'database', title: 'x', properties: { Titel: 'y' } }), /not in properties/);
  assert.equal(calls.filter((c) => c.init.method === 'POST').length, 1);
});

test('create page checks its input before any request', async () => {
  const calls = [];
  const h = make(json({}), calls);
  await assert.rejects(h.notion_create_page({ parent_id: ID, parent_type: 'workspace', title: 'x' }), /parent_type/);
  await assert.rejects(h.notion_create_page({ parent_id: ID, parent_type: 'page', title: '  ' }), /title is required/);
  await assert.rejects(h.notion_create_page({ parent_id: 'kein id', parent_type: 'page', title: 'x' }), /not a Notion id/);
  await assert.rejects(h.notion_create_page({ parent_id: ID, parent_type: 'page', title: 'x', properties: { A: 1 } }), /only for pages in a database/);
  assert.equal(calls.length, 0);
});

test('update page changes properties by the page schema and appends text', async () => {
  const calls = [];
  const h = make((url, init) => (init.method === 'GET' ? json({ properties: { Status: { type: 'status' }, Name: { type: 'title' } } }) : json({})), calls);
  const r = await h.notion_update_page({ id: ID, properties: { Status: 'Done' }, append_text: '- Neu' });
  assert.deepEqual(r, { updated: true, id: DASHED, properties: ['Status'], appended_blocks: 1 });
  assert.deepEqual(calls.map((c) => c.init.method), ['GET', 'PATCH', 'PATCH']);
  assert.equal(calls[1].url, `https://api.notion.com/v1/pages/${DASHED}`);
  assert.deepEqual(JSON.parse(calls[1].init.body), { properties: { Status: { status: { name: 'Done' } } } });
  assert.equal(calls[2].url, `https://api.notion.com/v1/blocks/${DASHED}/children`);
  assert.equal(JSON.parse(calls[2].init.body).children[0].type, 'bulleted_list_item');
});

test('update page with only text does not read the page; unknown property writes nothing', async () => {
  const calls = [];
  const h = make((url, init) => (init.method === 'GET' ? json({ properties: { Status: { type: 'status' } } }) : json({})), calls);
  await h.notion_update_page({ id: ID, append_text: 'Nachtrag' });
  assert.deepEqual(calls.map((c) => c.init.method), ['PATCH']);
  calls.length = 0;
  await assert.rejects(h.notion_update_page({ id: ID, properties: { Nope: 'x' }, append_text: 'y' }), /There is no property "Nope"/);
  assert.ok(calls.every((c) => c.init.method === 'GET'));
  await assert.rejects(h.notion_update_page({ id: ID }), /Nothing to do/);
});

test('nothing is archived or deleted: no DELETE, no archived or in_trash', async () => {
  const calls = [];
  const h = make(json({ properties: { Status: { type: 'status' } } }), calls);
  await assert.rejects(h.notion_update_page({ id: ID, archived: true }), /does not archive or delete/);
  await assert.rejects(h.notion_update_page({ id: ID, properties: { Status: 'x' }, in_trash: true }), /does not archive or delete/);
  assert.equal(calls.length, 0);
  await h.notion_update_page({ id: ID, properties: { Status: 'x' }, append_text: 'y' });
  assert.ok(calls.every((c) => ['GET', 'PATCH'].includes(c.init.method)));
  assert.ok(calls.every((c) => !/archived|in_trash/.test(c.init.body ?? '')));
  assert.ok(TOOL_DEFINITIONS.every((t) => !/delete_|archive_/.test(t.name)));
});

test('write errors from Notion are readable', async () => {
  await assert.rejects(make(json({}, 403)).notion_create_page({ parent_id: ID, parent_type: 'page', title: 'x' }), /may not do that/);
  await assert.rejects(make(json({ message: 'body failed validation' }, 400)).notion_create_page({ parent_id: ID, parent_type: 'page', title: 'x' }), /HTTP 400: body failed validation/);
});

test('manifest lists every tool in order and marks the secret', () => {
  const manifest = JSON.parse(readFileSync(new URL('../connectors/notion/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.tools.map((t) => t.name), TOOL_DEFINITIONS.map((t) => t.name));
  assert.equal(manifest.user_config.notion_token.sensitive, true);
  assert.equal(manifest.server.mcp_config.env.NOTION_TOKEN, '${user_config.notion_token}');
});

test('the stdio server speaks MCP', async () => {
  const child = spawn('node', ['connectors/notion/server/index.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  child.stdout.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  for (let i = 0; i < 50 && lines.length < 2; i += 1) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  const [init, list] = lines.map((l) => JSON.parse(l));
  assert.equal(init.result.serverInfo.name, 'notion');
  assert.equal(list.result.tools.length, TOOL_DEFINITIONS.length);
  assert.ok(list.result.tools.some((t) => t.name === 'notion_create_page') && list.result.tools.some((t) => t.name === 'notion_update_page'));
});
