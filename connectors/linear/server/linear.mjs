/**
 * Linear tools for the Linear connector over the GraphQL API (personal API key). Read, plus one write: a comment on an issue.
 * No dependencies. fetch and the environment are injected so tests never touch a network.
 * The key is sent only to api.linear.app and never appears in results or errors.
 */
export class LinearError extends Error {}

const API = 'https://api.linear.app/graphql';
const clip = (v, max = 400) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max - 1)}…` : v);
const ISSUE_ID = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,7}$/;
const TEAM_KEY = /^[A-Za-z0-9]{1,10}$/;
export const MAX_COMMENT = 4000;

/** An issue identifier (ENG-123) from the identifier itself or a linear.app issue link. */
export function idOf(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new LinearError('id is required (an issue identifier such as ENG-123, or a linear.app issue link).');
  if (ISSUE_ID.test(raw)) return raw.toUpperCase();
  let url;
  try { url = new URL(raw); } catch { url = null; }
  if (url && url.protocol === 'https:' && url.hostname === 'linear.app') {
    const m = /^\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]{0,9}-\d{1,7})(?:\/|$)/.exec(url.pathname);
    if (m) return m[1].toUpperCase();
  }
  throw new LinearError('That is not a Linear issue. Use an identifier such as ENG-123 or copy the issue link from linear.app.');
}

const teamOf = (args) => {
  if (args.team === undefined || args.team === null || args.team === '') return null;
  const t = String(args.team).trim();
  if (!TEAM_KEY.test(t)) throw new LinearError('team must be a team key such as ENG (letters and digits, up to 10).');
  return t.toUpperCase();
};

const FIELDS = 'identifier title priorityLabel updatedAt url state { name type } assignee { name } team { key } project { name } labels { nodes { name } }';
export const issueRow = (i) => ({
  id: i.identifier,
  title: clip(i.title ?? '', 200),
  state: i.state?.name ?? null,
  state_type: i.state?.type ?? null,
  priority: i.priorityLabel ?? null,
  assignee: i.assignee?.name ?? null,
  team: i.team?.key ?? null,
  project: i.project?.name ?? null,
  labels: (i.labels?.nodes ?? []).map((l) => l.name).slice(0, 10),
  updated: i.updatedAt ?? null,
  url: i.url ?? null,
});

export function createLinearHandlers({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const key = () => {
    const k = String(env.LINEAR_API_KEY ?? '').trim();
    if (!k) throw new LinearError('LINEAR_API_KEY is missing (a personal API key from Linear: Settings, Account, Security & access, Personal API keys).');
    return k;
  };
  const authHeader = (k) => (/^lin_oauth_/.test(k) ? `Bearer ${k}` : k.replace(/^bearer\s+/i, ''));

  async function gql(query, variables) {
    const k = key();
    const mask = (s) => String(s).split(k).join('***');
    let response;
    try {
      response = await fetchImpl(API, {
        method: 'POST',
        headers: { Authorization: authHeader(k), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new LinearError(`Could not reach Linear: ${mask(error.message)}`);
    }
    if (response.status === 401) throw new LinearError('Linear does not accept the key (HTTP 401). Check LINEAR_API_KEY.');
    if (response.status === 403) throw new LinearError('The key may not do that (HTTP 403). Check the permissions of the key (Read, and Create comments for linear_add_comment).');
    if (response.status === 429) throw new LinearError('Linear asks to slow down (rate limit). Try again in a minute.');
    let body = null;
    try { body = await response.json(); } catch { /* no body */ }
    if (body?.errors?.length) {
      const first = body.errors[0];
      const code = first?.extensions?.code;
      if (code === 'RATELIMITED') throw new LinearError('Linear asks to slow down (rate limit). Try again in a minute.');
      if (code === 'AUTHENTICATION_ERROR') throw new LinearError('Linear does not accept the key. Check LINEAR_API_KEY.');
      if (code === 'FORBIDDEN') throw new LinearError('The key may not do that. Check its permissions in Linear.');
      throw new LinearError(`Linear answered: ${clip(mask(first?.message ?? 'an error'), 250)}`);
    }
    if (!response.ok) throw new LinearError(`Linear answered HTTP ${response.status}.`);
    if (!body?.data) throw new LinearError('Linear sent no data.');
    return body.data;
  }

  const limitOf = (args, def = 20, max = 50) => Math.min(max, Math.max(1, Number.isInteger(args.limit) ? args.limit : def));

  return {
    async linear_check_connection() {
      const d = await gql('query { viewer { name } organization { name urlKey } }', {});
      return { ok: true, name: d.viewer?.name ?? null, workspace: d.organization?.name ?? null, workspace_key: d.organization?.urlKey ?? null };
    },
    async linear_list_teams() {
      const d = await gql('query { teams(first: 50) { nodes { key name description } } }', {});
      const teams = (d.teams?.nodes ?? []).map((t) => ({ key: t.key, name: t.name, description: clip(t.description ?? '', 200) }));
      return { count: teams.length, teams };
    },
    async linear_list_projects(args) {
      const team = teamOf(args);
      const n = limitOf(args, 30, 50);
      if (team) {
        const d = await gql('query($team: String!, $n: Int!) { teams(filter: { key: { eq: $team } }) { nodes { projects(first: $n) { nodes { name state progress targetDate lead { name } url } } } } }', { team, n });
        const nodes = d.teams?.nodes?.[0]?.projects?.nodes ?? [];
        return { count: nodes.length, projects: nodes.map(projectRow) };
      }
      const d = await gql('query($n: Int!) { projects(first: $n) { nodes { name state progress targetDate lead { name } url } } }', { n });
      const nodes = d.projects?.nodes ?? [];
      return { count: nodes.length, projects: nodes.map(projectRow) };
    },
    async linear_search_issues(args) {
      const query = String(args.query ?? '').trim();
      if (query.length > 300) throw new LinearError('query is too long.');
      const team = teamOf(args);
      const status = args.status === undefined ? 'open' : args.status;
      if (!['open', 'done', 'all'].includes(status)) throw new LinearError('status must be open, done or all.');
      const filter = {};
      if (team) filter.team = { key: { eq: team } };
      if (status === 'open') filter.state = { type: { nin: ['completed', 'canceled'] } };
      if (status === 'done') filter.state = { type: { in: ['completed', 'canceled'] } };
      if (query) filter.or = [{ title: { containsIgnoreCase: query } }, { description: { containsIgnoreCase: query } }];
      const d = await gql(`query($n: Int!, $filter: IssueFilter) { issues(first: $n, filter: $filter, orderBy: updatedAt) { nodes { ${FIELDS} } } }`, { n: limitOf(args), filter });
      const rows = (d.issues?.nodes ?? []).map(issueRow);
      return { count: rows.length, issues: rows };
    },
    async linear_read_backlog(args) {
      const team = teamOf(args);
      if (!team) throw new LinearError('team is required (a team key such as ENG).');
      const d = await gql(`query($n: Int!, $filter: IssueFilter) { issues(first: $n, filter: $filter, orderBy: updatedAt) { nodes { ${FIELDS} description parent { identifier } estimate } } }`, {
        n: limitOf(args, 60, 100),
        filter: { team: { key: { eq: team } }, state: { type: { nin: ['completed', 'canceled'] } } },
      });
      const rows = (d.issues?.nodes ?? []).map((i) => ({ ...issueRow(i), parent: i.parent?.identifier ?? null, estimate: i.estimate ?? null, description: clip(i.description ?? '', 600) }));
      return { count: rows.length, issues: rows };
    },
    async linear_get_issue(args) {
      const id = idOf(args.id);
      const d = await gql(`query($id: String!) { issue(id: $id) { ${FIELDS} description createdAt parent { identifier } cycle { number name } comments(first: 10) { nodes { body createdAt user { name } } } } }`, { id });
      const i = d.issue;
      if (!i) throw new LinearError(`Linear did not find ${id}.`);
      return {
        ...issueRow(i),
        created: i.createdAt ?? null,
        parent: i.parent?.identifier ?? null,
        cycle: i.cycle ? `${i.cycle.name ?? 'Cycle'} ${i.cycle.number}`.trim() : null,
        description: clip(i.description ?? '', 4000),
        comments: (i.comments?.nodes ?? []).map((c) => ({ author: c.user?.name ?? null, at: c.createdAt ?? null, text: clip(c.body ?? '', 800) })),
      };
    },
    async linear_add_comment(args) {
      const id = idOf(args.id);
      const text = String(args.comment ?? '').trim();
      if (!text) throw new LinearError('comment is empty.');
      if (text.length > MAX_COMMENT) throw new LinearError(`comment is too long (at most ${MAX_COMMENT} characters).`);
      const found = await gql('query($id: String!) { issue(id: $id) { id identifier title url } }', { id });
      if (!found.issue) throw new LinearError(`Linear did not find ${id}.`);
      const res = await gql('mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }', { input: { issueId: found.issue.id, body: text } });
      if (!res.commentCreate?.success) throw new LinearError('Linear did not accept the comment.');
      return { ok: true, issue: found.issue.identifier, title: clip(found.issue.title ?? '', 160), comment_url: res.commentCreate.comment?.url ?? found.issue.url ?? null };
    },
  };
}

const projectRow = (p) => ({ name: p.name, state: p.state ?? null, progress: typeof p.progress === 'number' ? Math.round(p.progress * 100) : null, target: p.targetDate ?? null, lead: p.lead?.name ?? null, url: p.url ?? null });

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const TOOL_DEFINITIONS = [
  { name: 'linear_check_connection', description: 'Check the Linear connection (API key) and show who the key belongs to and the workspace.', inputSchema: obj({}) },
  { name: 'linear_list_teams', description: 'List the Linear teams (key, name) the key can see. Read only.', inputSchema: obj({}) },
  { name: 'linear_list_projects', description: 'List projects with state, progress and target date, optionally of one team. Read only.', inputSchema: obj({ team: { type: 'string', description: 'Team key such as ENG (optional).' }, limit: { type: 'integer', description: '1 to 50 (default 30).' } }) },
  { name: 'linear_search_issues', description: 'Search issues by words in the title or description, newest change first. Returns identifier, title, state, priority, assignee, team, project, labels, link. Read only.', inputSchema: obj({ query: { type: 'string', description: 'Words to look for (optional).' }, team: { type: 'string', description: 'Team key such as ENG (optional).' }, status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Default open (not completed or canceled).' }, limit: { type: 'integer', description: '1 to 50 (default 20).' } }) },
  { name: 'linear_read_backlog', description: 'Read the open issues of a team for a requirements document: with parent, priority, labels, project, estimate and description. Read only.', inputSchema: obj({ team: { type: 'string', description: 'Team key such as ENG.' }, limit: { type: 'integer', description: 'At most 100 (default 60).' } }, ['team']) },
  { name: 'linear_get_issue', description: 'Read one issue: description, state, labels, cycle and the last comments. Read only.', inputSchema: obj({ id: { type: 'string', description: 'Identifier such as ENG-123, or the issue link from linear.app.' } }, ['id']) },
  { name: 'linear_add_comment', description: 'Add a comment to an issue (this changes Linear). Ask the person before using it. It is the only change this connector can make.', inputSchema: obj({ id: { type: 'string', description: 'Identifier such as ENG-123, or the issue link.' }, comment: { type: 'string', description: `The comment (Markdown), at most ${MAX_COMMENT} characters.` } }, ['id', 'comment']) },
];
