/**
 * Figma tools for the Figma connector over the REST API (personal access token). READ ONLY: every call is a GET.
 * No dependencies. fetch and the environment are injected so tests never touch a network.
 * The token is sent only to api.figma.com and never appears in results or errors.
 */
export class FigmaError extends Error {}

const API = 'https://api.figma.com';
const clip = (v, max = 400) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max - 1)}…` : v);
const FILE_KEY = /^[A-Za-z0-9]{10,40}$/;
const NODE_ID = /^\d{1,10}[:-]\d{1,10}(?:;\d{1,10}[:-]\d{1,10})*$/;
const FILE_PATH = /^\/(?:design|file|proto|board|make|slides)\/([A-Za-z0-9]{10,40})(?:\/|$)/;

/** A file key and an optional node id from a file key or a figma.com link ("?node-id=1-2" becomes "1:2"). */
export function fileOf(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new FigmaError('file is required (a figma.com file link or the file key).');
  if (FILE_KEY.test(raw)) return { key: raw, node: null };
  let url;
  try { url = new URL(raw); } catch { url = null; }
  if (url && url.protocol === 'https:' && (url.hostname === 'www.figma.com' || url.hostname === 'figma.com')) {
    const m = FILE_PATH.exec(url.pathname);
    if (m) {
      const n = url.searchParams.get('node-id');
      return { key: m[1], node: n && NODE_ID.test(n) ? n.replaceAll('-', ':') : null };
    }
  }
  throw new FigmaError('That is not a Figma file. Use the file key or copy the link from figma.com (Share, Copy link).');
}

export const nodeIdOf = (value) => {
  const s = String(value ?? '').trim();
  if (!NODE_ID.test(s)) throw new FigmaError(`"${clip(s, 40)}" is not a node id (like 12:34, or 12-34 from a link).`);
  return s.replaceAll('-', ':');
};

/** The text of a node tree: every TEXT node in reading order (top to bottom, then left to right), with the frame it sits in. */
export function collectText(root, { maxItems = 150, maxChars = 6000 } = {}) {
  const out = [];
  let chars = 0;
  let truncated = false;
  const walk = (node, frame) => {
    if (truncated || !node || typeof node !== 'object') return;
    const here = node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'SECTION' ? (node.name ?? frame) : frame;
    if (node.type === 'TEXT' && typeof node.characters === 'string' && node.characters.trim()) {
      const t = clip(node.characters.replace(/\s+/g, ' ').trim(), 300);
      if (out.length >= maxItems || chars + t.length > maxChars) { truncated = true; return; }
      chars += t.length;
      out.push({ frame: clip(here ?? '', 80), text: t, y: node.absoluteBoundingBox?.y ?? 0, x: node.absoluteBoundingBox?.x ?? 0 });
      return;
    }
    const kids = Array.isArray(node.children) ? node.children : [];
    for (const k of kids) walk(k, here);
  };
  walk(root, null);
  const order = new Map();
  out.forEach((o) => { if (!order.has(o.frame)) order.set(o.frame, order.size); });
  out.sort((a, b) => order.get(a.frame) - order.get(b.frame) || a.y - b.y || a.x - b.x);
  return { texts: out.map(({ frame, text }) => ({ frame, text })), truncated };
}

export function createFigmaHandlers({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = () => {
    const t = String(env.FIGMA_TOKEN ?? '').trim();
    if (!t) throw new FigmaError('FIGMA_TOKEN is missing (a personal access token from Figma: Settings, Security, Personal access tokens).');
    return t;
  };

  async function get(path, params = {}) {
    const t = token();
    const mask = (s) => String(s).split(t).join('***');
    const url = new URL(path, API);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    let response;
    try {
      response = await fetchImpl(url.toString(), { method: 'GET', headers: { 'X-Figma-Token': t, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      throw new FigmaError(`Could not reach Figma: ${mask(error.message)}`);
    }
    if (response.status === 401) throw new FigmaError('Figma does not accept the token (HTTP 401). Check FIGMA_TOKEN.');
    if (response.status === 403) throw new FigmaError('The token may not read that (HTTP 403). The file must be visible to the token\'s owner; check the scopes (file_content:read, file_comments:read, projects:read).');
    if (response.status === 404) throw new FigmaError('Figma did not find that file, frame or project (HTTP 404).');
    if (response.status === 429) throw new FigmaError('Figma asks to slow down (rate limit). Try again in a minute.');
    let body = null;
    try { body = await response.json(); } catch { /* no body */ }
    if (!response.ok) throw new FigmaError(`Figma answered HTTP ${response.status}${body?.err || body?.message ? `: ${clip(mask(body.err ?? body.message), 200)}` : ''}.`);
    if (!body || typeof body !== 'object') throw new FigmaError('Figma sent no data.');
    return body;
  }

  return {
    async figma_check_connection() {
      const me = await get('/v1/me');
      return { ok: true, user: me.handle ?? me.id ?? null };
    },
    async figma_list_project_files(args) {
      const id = String(args.project_id ?? '').trim();
      if (!/^\d{1,20}$/.test(id)) throw new FigmaError('project_id is required (the number at the end of a figma.com project link).');
      const d = await get(`/v1/projects/${id}/files`);
      const files = (d.files ?? []).slice(0, 100).map((f) => ({ key: f.key, name: clip(f.name ?? '', 160), modified: f.last_modified ?? null }));
      return { project: clip(d.name ?? '', 120) || null, count: files.length, files };
    },
    async figma_get_file_outline(args) {
      const { key } = fileOf(args.file);
      const d = await get(`/v1/files/${key}`, { depth: 2 });
      const pages = (d.document?.children ?? []).slice(0, 40).map((p) => ({
        id: p.id,
        name: clip(p.name ?? '', 120),
        frames: (p.children ?? []).filter((c) => ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET'].includes(c.type)).slice(0, 60).map((c) => ({ id: c.id, name: clip(c.name ?? '', 120), type: c.type })),
      }));
      return { key, name: clip(d.name ?? '', 160), modified: d.lastModified ?? null, version: d.version ?? null, pages };
    },
    async figma_read_frame_text(args) {
      const { key, node } = fileOf(args.file);
      const ids = (args.node_id ? String(args.node_id).split(',').map((s) => nodeIdOf(s)) : node ? [node] : []);
      if (!ids.length) throw new FigmaError('node_id is required (a frame id from figma_get_file_outline, or a link with ?node-id=).');
      if (ids.length > 10) throw new FigmaError('At most 10 frames at a time.');
      const d = await get(`/v1/files/${key}/nodes`, { ids: ids.join(',') });
      const frames = [];
      for (const id of ids) {
        const n = d.nodes?.[id]?.document;
        if (!n) { frames.push({ id, error: 'not found' }); continue; }
        const { texts, truncated } = collectText(n);
        frames.push({ id, name: clip(n.name ?? '', 120), type: n.type, count: texts.length, truncated, texts });
      }
      return { key, file: clip(d.name ?? '', 160), frames };
    },
    async figma_list_comments(args) {
      const { key } = fileOf(args.file);
      const status = args.status === undefined ? 'open' : args.status;
      if (!['open', 'resolved', 'all'].includes(status)) throw new FigmaError('status must be open, resolved or all.');
      const d = await get(`/v1/files/${key}/comments`);
      const all = Array.isArray(d.comments) ? d.comments : [];
      const threads = all.filter((c) => !c.parent_id);
      const wanted = threads.filter((c) => (status === 'all' ? true : status === 'open' ? !c.resolved_at : !!c.resolved_at));
      const n = Math.min(100, Math.max(1, Number.isInteger(args.limit) ? args.limit : 40));
      const rows = wanted.slice(0, n).map((c) => ({
        id: c.id,
        author: c.user?.handle ?? null,
        at: c.created_at ?? null,
        resolved: !!c.resolved_at,
        node: c.client_meta?.node_id ?? null,
        text: clip(c.message ?? '', 600),
        replies: all.filter((r) => r.parent_id === c.id).slice(0, 10).map((r) => ({ author: r.user?.handle ?? null, at: r.created_at ?? null, text: clip(r.message ?? '', 400) })),
        url: `https://www.figma.com/design/${key}?node-id=${(c.client_meta?.node_id ?? '').replaceAll(':', '-')}#${c.id}`.replace('?node-id=#', '#'),
      }));
      return { key, status, count: rows.length, total: wanted.length, comments: rows };
    },
  };
}

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const FILE = { type: 'string', description: 'A figma.com file link (Share, Copy link) or the file key.' };
export const TOOL_DEFINITIONS = [
  { name: 'figma_check_connection', description: 'Check the Figma connection (access token) and show who the token belongs to. Read only.', inputSchema: obj({}) },
  { name: 'figma_list_project_files', description: 'List the files of a Figma project (key, name, last change). Read only.', inputSchema: obj({ project_id: { type: 'string', description: 'The number at the end of a figma.com project link.' } }, ['project_id']) },
  { name: 'figma_get_file_outline', description: 'Show the pages of a file and the top-level frames on each (id, name), to pick what to read. Read only.', inputSchema: obj({ file: FILE }, ['file']) },
  { name: 'figma_read_frame_text', description: 'Read the text in up to 10 frames (labels, headings, notes, annotations), grouped by frame, so screens can be turned into requirements. Read only.', inputSchema: obj({ file: FILE, node_id: { type: 'string', description: 'Frame id like 12:34 from figma_get_file_outline; several separated by commas. Optional if the link has ?node-id=.' } }, ['file']) },
  { name: 'figma_list_comments', description: 'List the comment threads of a file (open by default) with replies and the frame each one sits on. Read only.', inputSchema: obj({ file: FILE, status: { type: 'string', enum: ['open', 'resolved', 'all'], description: 'Default open.' }, limit: { type: 'integer', description: '1 to 100 (default 40).' } }, ['file']) },
];
