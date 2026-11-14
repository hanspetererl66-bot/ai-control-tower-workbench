/**
 * Notion tools for the Notion connector over the REST API (internal integration token): read, create and update.
 * Nothing is deleted or archived.
 * No dependencies. fetch and the environment are injected so tests never touch a network.
 * The token is sent only to api.notion.com and never appears in results or errors.
 * A page or database is visible only after it was shared with the integration (page menu, Connections).
 */
export class NotionError extends Error {}

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const clip = (v, max = 400) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max - 1)}…` : v);

/** A page or database id from an id (with or without dashes) or a notion.so link. */
export function idOf(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new NotionError('id is required (a page id or a notion.so link).');
  // The id is the end of the last path segment ("Title-<32 hex>"); a title slug may itself end in hex letters, so match from the end.
  const segment = raw.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop() ?? '';
  const dashed = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(segment);
  const hex = dashed ? dashed.slice(1).join('') : /(?:^|-)([0-9a-f]{32})$/i.exec(segment)?.[1];
  if (!hex) throw new NotionError('That is not a Notion id or link. Use the 32-character id or copy the page link.');
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const plain = (rich) => (Array.isArray(rich) ? rich.map((t) => t?.plain_text ?? '').join('') : '');

export function titleOf(item) {
  if (item?.object === 'database') return plain(item.title) || '(untitled database)';
  for (const p of Object.values(item?.properties ?? {})) if (p?.type === 'title') return plain(p.title) || '(untitled)';
  return '(untitled)';
}

/** One property as short text; types without a useful text are left out. */
export function propText(p) {
  switch (p?.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'select': return p.select?.name ?? '';
    case 'status': return p.status?.name ?? '';
    case 'multi_select': return (p.multi_select ?? []).map((o) => o.name).join(', ');
    case 'number': return p.number == null ? '' : String(p.number);
    case 'checkbox': return p.checkbox ? 'yes' : 'no';
    case 'date': return p.date?.start ? (p.date.end ? `${p.date.start} to ${p.date.end}` : p.date.start) : '';
    case 'url': case 'email': case 'phone_number': return p[p.type] ?? '';
    case 'people': return (p.people ?? []).map((u) => u.name ?? '').filter(Boolean).join(', ');
    default: return '';
  }
}

/** The text of a block, with a small marker for its kind. null = nothing to show. */
export function blockText(b) {
  const t = b?.type;
  const body = b?.[t];
  if (!t || !body) return null;
  const text = plain(body.rich_text);
  switch (t) {
    case 'heading_1': return text && `# ${text}`;
    case 'heading_2': return text && `## ${text}`;
    case 'heading_3': return text && `### ${text}`;
    case 'bulleted_list_item': return text && `- ${text}`;
    case 'numbered_list_item': return text && `1. ${text}`;
    case 'to_do': return text && `- [${body.checked ? 'x' : ' '}] ${text}`;
    case 'quote': case 'callout': return text && `> ${text}`;
    case 'code': return text && `\`\`\`\n${text}\n\`\`\``;
    case 'paragraph': case 'toggle': return text || null;
    case 'child_page': return body.title ? `(sub page: ${body.title})` : null;
    case 'child_database': return body.title ? `(database: ${body.title})` : null;
    default: return null;
  }
}

const richText = (text) => [{ type: 'text', text: { content: String(text).slice(0, 2000) } }];
const MAX_TEXT = 8000;
const MAX_BLOCKS = 100;

/** Plain text to Notion blocks: "# ", "## ", "### ", "- ", "1. ", "- [ ] ", "- [x] ", "> " and paragraphs (the reverse of blockText). */
export function textToBlocks(text) {
  const src = String(text ?? '').slice(0, MAX_TEXT);
  const blocks = [];
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let m;
    if ((m = /^(#{1,3}) (.+)$/.exec(line))) { const t = `heading_${m[1].length}`; blocks.push({ object: 'block', type: t, [t]: { rich_text: richText(m[2]) } }); }
    else if ((m = /^- \[( |x)\] (.*)$/i.exec(line))) blocks.push({ object: 'block', type: 'to_do', to_do: { rich_text: richText(m[2]), checked: m[1].toLowerCase() === 'x' } });
    else if ((m = /^[-*] (.+)$/.exec(line))) blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(m[1]) } });
    else if ((m = /^\d+\. (.+)$/.exec(line))) blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(m[1]) } });
    else if ((m = /^> (.+)$/.exec(line))) blocks.push({ object: 'block', type: 'quote', quote: { rich_text: richText(m[1]) } });
    else blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(line) } });
  }
  if (blocks.length > MAX_BLOCKS) throw new NotionError(`Too many lines (at most ${MAX_BLOCKS} blocks at once).`);
  return blocks;
}

/** One value for a Notion property of the given type. Types that cannot be written safely are refused. */
export function propertyValue(name, type, value) {
  const bad = (what) => new NotionError(`Property "${String(name).slice(0, 60)}" (${type}) needs ${what}.`);
  const text = () => { if (typeof value !== 'string' && typeof value !== 'number') throw bad('a text'); return String(value); };
  switch (type) {
    case 'title': return { title: richText(text()) };
    case 'rich_text': return { rich_text: richText(text()) };
    case 'select': return { select: value === null || value === '' ? null : { name: text().slice(0, 100) } };
    case 'status': return { status: { name: text().slice(0, 100) } };
    case 'multi_select': {
      const list = Array.isArray(value) ? value : [value];
      if (list.length > 20 || list.some((v) => typeof v !== 'string' || !v.trim())) throw bad('a list of option names (at most 20)');
      return { multi_select: list.map((n) => ({ name: n.slice(0, 100) })) };
    }
    case 'number': { const n = typeof value === 'string' && value.trim() ? Number(value) : value; if (typeof n !== 'number' || !Number.isFinite(n)) throw bad('a number'); return { number: n }; }
    case 'checkbox': if (typeof value !== 'boolean') throw bad('true or false'); return { checkbox: value };
    case 'date': {
      const day = /^\d{4}-\d{2}-\d{2}(T[\d:.+Z-]+)?$/;
      const d = typeof value === 'string' ? { start: value } : value;
      if (!d || typeof d.start !== 'string' || !day.test(d.start) || (d.end != null && (typeof d.end !== 'string' || !day.test(d.end)))) throw bad('a date such as 2026-11-30 (or {"start","end"})');
      return { date: d.end ? { start: d.start, end: d.end } : { start: d.start } };
    }
    case 'url': case 'email': case 'phone_number': return { [type]: text().slice(0, 300) };
    default: throw new NotionError(`Property "${String(name).slice(0, 60)}" has the type ${type}, which this connector does not write (supported: title, rich_text, select, status, multi_select, number, checkbox, date, url, email, phone_number).`);
  }
}

/** Values by property name, checked against the schema ({ name: { type } }). Unknown names are refused. */
function buildProperties(schema, values) {
  if (values == null) return {};
  if (typeof values !== 'object' || Array.isArray(values)) throw new NotionError('properties must be an object such as {"Status": "Open"}.');
  const out = {};
  for (const [name, value] of Object.entries(values)) {
    const def = schema[name];
    if (!def) throw new NotionError(`There is no property "${name.slice(0, 60)}". Available: ${Object.keys(schema).slice(0, 30).join(', ') || 'none'}.`);
    out[name] = propertyValue(name, def.type, value);
  }
  return out;
}

export function createNotionHandlers({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = () => {
    const t = String(env.NOTION_TOKEN ?? '').trim();
    if (!t) throw new NotionError('NOTION_TOKEN is missing (the secret of an internal Notion integration, from notion.so/profile/integrations).');
    return t;
  };

  async function api(method, path, body) {
    const t = token();
    let response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${t}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new NotionError(`Could not reach Notion: ${String(error.message).split(t).join('***')}`);
    }
    if (response.status === 401) throw new NotionError('Notion does not accept the token (HTTP 401). Check NOTION_TOKEN.');
    if (response.status === 403) throw new NotionError('The integration may not do that (HTTP 403). Check its capabilities (read, insert, update content) in the integration settings.');
    if (response.status === 404) throw new NotionError('Notion did not find that (HTTP 404), or it is not shared with the integration. Open the page in Notion, use the "..." menu, Connections, and add the integration.');
    if (response.status === 429) throw new NotionError('Notion asks to slow down (rate limit). Try again in a minute.');
    if (!response.ok) {
      let detail = '';
      try { detail = String((await response.json()).message ?? ''); } catch { /* no body */ }
      throw new NotionError(`Notion answered HTTP ${response.status}${detail ? `: ${detail.slice(0, 250)}` : ''}`);
    }
    return response.json();
  }

  const limitOf = (args, def = 20, max = 50) => Math.min(max, Math.max(1, Number.isInteger(args.limit) ? args.limit : def));
  const itemRow = (i) => ({ id: i.id, type: i.object, title: clip(titleOf(i), 160), url: i.url ?? null, edited: i.last_edited_time ?? null });

  return {
    async notion_check_connection() {
      const me = await api('GET', '/users/me');
      return { ok: true, name: me.name ?? me.bot?.workspace_name ?? 'integration', workspace: me.bot?.workspace_name ?? null };
    },
    async notion_search(args) {
      const query = String(args.query ?? '').trim();
      if (query.length > 300) throw new NotionError('query is too long.');
      const body = { page_size: limitOf(args), sort: { direction: 'descending', timestamp: 'last_edited_time' } };
      if (query) body.query = query;
      if (args.type === 'page' || args.type === 'database') body.filter = { property: 'object', value: args.type };
      const res = await api('POST', '/search', body);
      return { count: (res.results ?? []).length, results: (res.results ?? []).map(itemRow), more: res.has_more === true };
    },
    async notion_read_page(args) {
      const id = idOf(args.id);
      const page = await api('GET', `/pages/${id}`);
      const lines = [];
      let cursor;
      let more = false;
      for (let round = 0; round < 3; round++) {
        const res = await api('GET', `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
        for (const b of res.results ?? []) { const line = blockText(b); if (line) lines.push(line); }
        more = res.has_more === true;
        cursor = res.next_cursor;
        if (!more || !cursor) { more = false; break; }
      }
      const properties = {};
      for (const [name, p] of Object.entries(page.properties ?? {})) { const v = propText(p); if (v && p.type !== 'title') properties[name.slice(0, 60)] = clip(v, 300); }
      return { ...itemRow(page), properties, text: clip(lines.join('\n'), 6000), truncated: more || lines.join('\n').length > 6000 };
    },
    async notion_query_database(args) {
      const id = idOf(args.id);
      const body = { page_size: limitOf(args, 25, 50) };
      if (args.filter != null) { if (typeof args.filter !== 'object' || Array.isArray(args.filter)) throw new NotionError('filter must be a Notion filter object.'); body.filter = args.filter; }
      if (args.sorts != null) { if (!Array.isArray(args.sorts) || args.sorts.length > 5) throw new NotionError('sorts must be a list of at most 5 Notion sorts.'); body.sorts = args.sorts; }
      if (args.start_cursor != null) body.start_cursor = String(args.start_cursor).slice(0, 200);
      const res = await api('POST', `/databases/${id}/query`, body);
      const rows = (res.results ?? []).map((r) => {
        const properties = {};
        for (const [name, p] of Object.entries(r.properties ?? {})) { const v = propText(p); if (v && p.type !== 'title') properties[name.slice(0, 60)] = clip(v, 300); }
        return { ...itemRow(r), properties };
      });
      return { count: rows.length, rows, more: res.has_more === true, next_cursor: res.next_cursor ?? null };
    },
    async notion_create_page(args) {
      const parentType = args.parent_type;
      if (parentType !== 'page' && parentType !== 'database') throw new NotionError('parent_type must be "page" or "database".');
      const parentId = idOf(args.parent_id);
      const title = String(args.title ?? '').trim();
      if (!title || title.length > 200) throw new NotionError('title is required (at most 200 characters).');
      const children = textToBlocks(args.content);
      let properties;
      if (parentType === 'database') {
        const db = await api('GET', `/databases/${parentId}`);
        const schema = db.properties ?? {};
        const titleName = Object.keys(schema).find((n) => schema[n]?.type === 'title');
        if (!titleName) throw new NotionError('That database has no title property.');
        if (args.properties && Object.hasOwn(args.properties, titleName)) throw new NotionError(`Set the title with "title", not in properties ("${titleName}").`);
        properties = { [titleName]: propertyValue(titleName, 'title', title), ...buildProperties(schema, args.properties) };
      } else {
        if (args.properties != null) throw new NotionError('properties are only for pages in a database; a page below a page has just a title.');
        properties = { title: propertyValue('title', 'title', title) };
      }
      const body = { parent: parentType === 'database' ? { database_id: parentId } : { page_id: parentId }, properties };
      if (children.length) body.children = children;
      const page = await api('POST', '/pages', body);
      return { created: true, id: page.id, url: page.url ?? null };
    },
    async notion_update_page(args) {
      if (args.archived !== undefined || args.in_trash !== undefined) throw new NotionError('This connector does not archive or delete pages.');
      const id = idOf(args.id);
      const hasProps = args.properties != null && Object.keys(args.properties).length > 0;
      const blocks = textToBlocks(args.append_text);
      if (!hasProps && !blocks.length) throw new NotionError('Nothing to do: give properties and/or append_text.');
      let updated = [];
      if (hasProps) {
        const page = await api('GET', `/pages/${id}`);
        const properties = buildProperties(page.properties ?? {}, args.properties);
        await api('PATCH', `/pages/${id}`, { properties });
        updated = Object.keys(properties);
      }
      if (blocks.length) await api('PATCH', `/blocks/${id}/children`, { children: blocks });
      return { updated: true, id, properties: updated, appended_blocks: blocks.length };
    },
  };
}

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const TOOL_DEFINITIONS = [
  { name: 'notion_check_connection', description: 'Check the Notion connection (token) and show the integration and workspace.', inputSchema: obj({}) },
  { name: 'notion_search', description: 'Search the pages and databases that are shared with the integration, newest edit first. Returns id, type, title, link. Read only.', inputSchema: obj({ query: { type: 'string', description: 'Search words; empty = the most recently edited.' }, type: { type: 'string', enum: ['page', 'database'], description: 'Only pages or only databases.' }, limit: { type: 'integer', description: '1 to 50 (default 20).' } }) },
  { name: 'notion_read_page', description: 'Read one page: title, properties and the text of its blocks (headings, paragraphs, lists, to-dos, quotes). Read only.', inputSchema: obj({ id: { type: 'string', description: 'Page id or notion.so link.' } }, ['id']) },
  { name: 'notion_query_database', description: 'Read the rows of a database with their properties, optionally filtered and sorted. Read only.', inputSchema: obj({ id: { type: 'string', description: 'Database id or notion.so link.' }, limit: { type: 'integer', description: '1 to 50 (default 25).' }, filter: { type: 'object', description: 'Notion filter object, for example {"property":"Status","status":{"equals":"Open"}}.' }, sorts: { type: 'array', items: { type: 'object' }, description: 'Notion sorts, at most 5, for example [{"property":"Prio","direction":"ascending"}].' }, start_cursor: { type: 'string', description: 'next_cursor of the previous answer, for the next rows.' } }, ['id']) },
  { name: 'notion_create_page', description: 'Create a page below a page or as a row in a database (this changes Notion). Ask the person before using it.', inputSchema: obj({ parent_id: { type: 'string', description: 'Id or notion.so link of the parent page or database.' }, parent_type: { type: 'string', enum: ['page', 'database'] }, title: { type: 'string' }, content: { type: 'string', description: 'Text for the page. Lines may start with "# ", "## ", "### ", "- ", "1. ", "- [ ] " or "> ". At most 100 lines.' }, properties: { type: 'object', description: 'Database pages only: values by property name, for example {"Status":"Open","Prio":"Hoch"}. Not the title.' } }, ['parent_id', 'parent_type', 'title']) },
  { name: 'notion_update_page', description: 'Change properties of a page and/or add text at its end; existing text stays, nothing is deleted or archived (this changes Notion). Ask the person before using it.', inputSchema: obj({ id: { type: 'string', description: 'Page id or notion.so link.' }, properties: { type: 'object', description: 'New values by property name, for example {"Status":"Done"}.' }, append_text: { type: 'string', description: 'Text added at the end of the page (same line markers as notion_create_page).' } }, ['id']) },
];
