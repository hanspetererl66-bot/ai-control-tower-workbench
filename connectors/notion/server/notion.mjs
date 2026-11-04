/**
 * Notion tools for the Notion connector over the REST API (an internal integration token). Read only.
 * No dependencies. fetch and the environment are injected so tests never touch a network.
 * The token is sent only to api.notion.com and never appears in results or errors.
 * Notion shows an integration only the pages that were shared with it ("Connections" menu of a page).
 */
export class NotionError extends Error {}

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const CELL_MAX = 400;
export const clip = (v, max = CELL_MAX) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max - 1)}…` : v);
const ID = /^[0-9a-f]{32}$/;

/** A page id from a bare id, an id with dashes, or a notion.so link. Returns the 32 hex characters. */
export function pageIdOf(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new NotionError('id is required (a page id or a notion.so link).');
  const compact = raw.replace(/[?#].*$/, '').replace(/-/g, '');
  const m = compact.match(/[0-9a-f]{32}(?![0-9a-f])/i);
  const id = m ? m[0].toLowerCase() : '';
  if (!ID.test(id)) throw new NotionError('That is not a page id. Use the id or the link of the page.');
  return id;
}

const plain = (rich) => (Array.isArray(rich) ? rich.map((t) => t.plain_text ?? '').join('') : '');
export const titleOf = (page) => {
  const props = page?.properties ?? {};
  for (const p of Object.values(props)) if (p?.type === 'title') return plain(p.title);
  return plain(page?.title) || '';
};

/** One block as a line of plain text. Unknown blocks give an empty line. */
export function blockText(b) {
  const t = b?.type;
  const d = b?.[t];
  const text = plain(d?.rich_text);
  switch (t) {
    case 'heading_1': return `# ${text}`;
    case 'heading_2': return `## ${text}`;
    case 'heading_3': return `### ${text}`;
    case 'bulleted_list_item': return `- ${text}`;
    case 'numbered_list_item': return `1. ${text}`;
    case 'to_do': return `- [${d?.checked ? 'x' : ' '}] ${text}`;
    case 'quote': case 'callout': return `> ${text}`;
    case 'code': return `\`\`\`\n${text}\n\`\`\``;
    case 'child_page': return `[page] ${d?.title ?? ''}`;
    case 'paragraph': case 'toggle': return text;
    default: return text;
  }
}

export function createNotionHandlers({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = () => {
    const t = String(env.NOTION_API_TOKEN ?? '').trim();
    if (!t) throw new NotionError('NOTION_API_TOKEN is missing (an internal integration token from notion.so/profile/integrations).');
    return t;
  };

  async function api(method, path, body) {
    const secret = token();
    let response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${secret}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new NotionError(`Could not reach Notion: ${String(error.message).replace(secret, '***')}`);
    }
    if (response.status === 401) throw new NotionError('Notion refused the token (HTTP 401). Check the integration token.');
    if (response.status === 403) throw new NotionError('The integration may not do that (HTTP 403). Check its capabilities (read content).');
    if (response.status === 404) throw new NotionError('Notion did not find that (HTTP 404). Share the page with the integration: page menu, Connections, add the integration.');
    if (response.status === 429) throw new NotionError('Notion asks to slow down (HTTP 429). Try again in a moment.');
    if (!response.ok) {
      let detail = '';
      try { detail = String((await response.json()).message ?? ''); } catch { /* no body */ }
      throw new NotionError(`Notion answered HTTP ${response.status}${detail ? `: ${detail.slice(0, 250)}` : ''}`);
    }
    return response.json();
  }

  return {
    async notion_check_connection() {
      const me = await api('GET', '/users/me');
      return { ok: true, name: me.name ?? me.bot?.workspace_name ?? 'integration', workspace: me.bot?.workspace_name ?? null };
    },
    async notion_search(args) {
      const query = String(args.query ?? '').trim().slice(0, 200);
      const size = Math.min(25, Math.max(1, Number.isInteger(args.max_results) ? args.max_results : 10));
      const body = { query, page_size: size, sort: { direction: 'descending', timestamp: 'last_edited_time' } };
      if (args.only === 'page' || args.only === 'database') body.filter = { property: 'object', value: args.only };
      const res = await api('POST', '/search', body);
      return {
        count: (res.results ?? []).length,
        more: Boolean(res.has_more),
        results: (res.results ?? []).map((r) => ({ id: String(r.id ?? '').replace(/-/g, ''), type: r.object, title: clip(titleOf(r)), url: r.url ?? null, edited: r.last_edited_time ?? null })),
      };
    },
    async notion_get_page(args) {
      const id = pageIdOf(args.id);
      const page = await api('GET', `/pages/${id}`);
      const lines = [];
      let cursor;
      for (let i = 0; i < 4; i++) {
        const res = await api('GET', `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
        for (const b of res.results ?? []) lines.push(blockText(b));
        if (!res.has_more || !res.next_cursor) { cursor = undefined; break; }
        cursor = res.next_cursor;
      }
      const text = lines.join('\n').trim();
      return { id, title: clip(titleOf(page)), url: page.url ?? null, edited: page.last_edited_time ?? null, text: clip(text, 12_000), truncated: Boolean(cursor) || text.length > 12_000 };
    },
  };
}

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const TOOL_DEFINITIONS = [
  { name: 'notion_check_connection', description: 'Check the Notion connection (integration token) and show which workspace it belongs to.', inputSchema: obj({}) },
  { name: 'notion_search', description: 'Search the pages and databases that were shared with the integration. Returns id, type, title, link and last edit, newest first (read only).', inputSchema: obj({ query: { type: 'string', description: 'Words in the title. Empty lists the latest.' }, only: { type: 'string', enum: ['page', 'database'] }, max_results: { type: 'integer', description: '1 to 25 (default 10).' } }) },
  { name: 'notion_get_page', description: 'Read one page as plain text (headings, paragraphs, lists, to-dos, quotes; the first 400 blocks). Read only.', inputSchema: obj({ id: { type: 'string', description: 'Page id or notion.so link.' } }, ['id']) },
];
