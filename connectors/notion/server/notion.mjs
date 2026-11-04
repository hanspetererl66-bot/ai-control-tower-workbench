/**
 * Notion tools for the Notion connector over the REST API (internal integration token), read only.
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
    if (response.status === 403) throw new NotionError('The integration may not do that (HTTP 403). Check its capabilities (read content) in the integration settings.');
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
      const res = await api('POST', `/databases/${id}/query`, { page_size: limitOf(args, 25, 50) });
      const rows = (res.results ?? []).map((r) => {
        const properties = {};
        for (const [name, p] of Object.entries(r.properties ?? {})) { const v = propText(p); if (v && p.type !== 'title') properties[name.slice(0, 60)] = clip(v, 300); }
        return { ...itemRow(r), properties };
      });
      return { count: rows.length, rows, more: res.has_more === true };
    },
  };
}

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const TOOL_DEFINITIONS = [
  { name: 'notion_check_connection', description: 'Check the Notion connection (token) and show the integration and workspace.', inputSchema: obj({}) },
  { name: 'notion_search', description: 'Search the pages and databases that are shared with the integration, newest edit first. Returns id, type, title, link. Read only.', inputSchema: obj({ query: { type: 'string', description: 'Search words; empty = the most recently edited.' }, type: { type: 'string', enum: ['page', 'database'], description: 'Only pages or only databases.' }, limit: { type: 'integer', description: '1 to 50 (default 20).' } }) },
  { name: 'notion_read_page', description: 'Read one page: title, properties and the text of its blocks (headings, paragraphs, lists, to-dos, quotes). Read only.', inputSchema: obj({ id: { type: 'string', description: 'Page id or notion.so link.' } }, ['id']) },
  { name: 'notion_query_database', description: 'Read the rows of a database with their properties (first rows, no filter). Read only.', inputSchema: obj({ id: { type: 'string', description: 'Database id or notion.so link.' }, limit: { type: 'integer', description: '1 to 50 (default 25).' } }, ['id']) },
];
