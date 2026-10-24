/**
 * Jira Cloud tools for the Jira connector over the REST API v3 (site address, e-mail and API token).
 * No dependencies. fetch and the environment are injected so tests never touch a network.
 * The token is sent only to the configured site and never appears in results or errors.
 */
export class JiraError extends Error {}

const CELL_MAX = 400;
export const clip = (v, max = CELL_MAX) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max - 1)}…` : v);

export function normalizeSite(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new JiraError('JIRA_SITE is missing (the Jira address, for example https://firma.atlassian.net).');
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new JiraError('JIRA_SITE is not a valid address.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new JiraError('JIRA_SITE must be an https address without credentials.');
  return url.origin;
}

/** Atlassian Document Format (descriptions and comments) as plain text. */
export function adfToText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  const kids = (node.content ?? []).map(adfToText);
  switch (node.type) {
    case 'text': return node.text ?? '';
    case 'hardBreak': return '\n';
    case 'mention': return node.attrs?.text ?? '@user';
    case 'listItem': return `- ${kids.join('').trim()}\n`;
    case 'paragraph': case 'heading': case 'blockquote': case 'codeBlock': return `${kids.join('')}\n`;
    default: return kids.join('');
  }
}

/** Plain text as ADF: one paragraph per line block. */
export function textToAdf(text) {
  const blocks = String(text ?? '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return { type: 'doc', version: 1, content: (blocks.length ? blocks : ['']).map((b) => ({ type: 'paragraph', content: b ? [{ type: 'text', text: b }] : [] })) };
}

const KEY = /^[A-Z][A-Z0-9_]{1,19}-\d{1,8}$/;
const PROJECT = /^[A-Z][A-Z0-9_]{1,19}$/;

export function createJiraHandlers({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = () => {
    const site = normalizeSite(env.JIRA_SITE);
    const email = String(env.JIRA_EMAIL ?? '').trim();
    const token = String(env.JIRA_API_TOKEN ?? '').trim();
    if (!email || !token) throw new JiraError('JIRA_EMAIL and JIRA_API_TOKEN are missing (the account e-mail and an API token from id.atlassian.com).');
    return { site, auth: Buffer.from(`${email}:${token}`).toString('base64'), token };
  };

  async function api(method, path, body) {
    const { site, auth, token } = config();
    let response;
    try {
      response = await fetchImpl(`${site}${path}`, {
        method,
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new JiraError(`Could not reach Jira: ${String(error.message).replace(token, '***')}`);
    }
    if (response.status === 401 || response.status === 403) throw new JiraError(`Jira refused the login (HTTP ${response.status}). Check the e-mail, the API token and the permissions of the account.`);
    if (response.status === 404) throw new JiraError('Jira did not find that (HTTP 404). Check the key or the site address.');
    if (!response.ok) {
      let detail = '';
      try { const j = await response.json(); detail = (j.errorMessages ?? []).join(' ') || Object.values(j.errors ?? {}).join(' '); } catch { /* no body */ }
      throw new JiraError(`Jira answered HTTP ${response.status}${detail ? `: ${detail.slice(0, 250)}` : ''}`);
    }
    return response.status === 204 ? {} : response.json();
  }

  const issueRow = (i) => ({
    key: i.key,
    summary: clip(i.fields?.summary ?? ''),
    status: i.fields?.status?.name ?? null,
    type: i.fields?.issuetype?.name ?? null,
    priority: i.fields?.priority?.name ?? null,
    assignee: i.fields?.assignee?.displayName ?? null,
    updated: i.fields?.updated ?? null,
  });
  const keyOf = (args) => {
    const key = String(args.key ?? '').trim().toUpperCase();
    if (!KEY.test(key)) throw new JiraError('key must look like ABC-123.');
    return key;
  };

  return {
    async jira_check_connection() {
      const me = await api('GET', '/rest/api/3/myself');
      return { ok: true, user: me.displayName ?? me.emailAddress ?? 'unknown', site: config().site };
    },
    async jira_list_projects() {
      const res = await api('GET', '/rest/api/3/project/search?maxResults=50&orderBy=key');
      return { projects: (res.values ?? []).map((p) => ({ key: p.key, name: p.name, type: p.projectTypeKey })) };
    },
    async jira_search_issues(args) {
      const jql = String(args.jql ?? '').trim();
      if (!jql) throw new JiraError('jql is required, for example: project = ABC AND statusCategory != Done ORDER BY updated DESC');
      if (jql.length > 1500) throw new JiraError('jql is too long.');
      const max = Math.min(50, Math.max(1, Number.isInteger(args.max_results) ? args.max_results : 20));
      const res = await api('POST', '/rest/api/3/search/jql', { jql, maxResults: max, fields: ['summary', 'status', 'issuetype', 'priority', 'assignee', 'updated'] });
      return { count: (res.issues ?? []).length, issues: (res.issues ?? []).map(issueRow), more: res.isLast === false };
    },
    async jira_get_issue(args) {
      const key = keyOf(args);
      const i = await api('GET', `/rest/api/3/issue/${key}?fields=summary,status,issuetype,priority,assignee,reporter,description,created,updated,labels,comment`);
      const comments = (i.fields?.comment?.comments ?? []).slice(-10).map((c) => ({ author: c.author?.displayName ?? null, created: c.created, text: clip(adfToText(c.body).trim(), 800) }));
      return { ...issueRow(i), reporter: i.fields?.reporter?.displayName ?? null, created: i.fields?.created ?? null, labels: i.fields?.labels ?? [], description: clip(adfToText(i.fields?.description).trim(), 3000), comments };
    },
    async jira_create_issue(args) {
      const project = String(args.project ?? '').trim().toUpperCase();
      if (!PROJECT.test(project)) throw new JiraError('project must be a project key such as ABC.');
      const summary = String(args.summary ?? '').trim();
      if (!summary || summary.length > 255) throw new JiraError('summary is required (at most 255 characters).');
      const fields = { project: { key: project }, summary, issuetype: { name: String(args.issue_type ?? 'Task').slice(0, 40) } };
      if (args.description) fields.description = textToAdf(String(args.description).slice(0, 8000));
      if (args.priority) fields.priority = { name: String(args.priority).slice(0, 20) };
      const res = await api('POST', '/rest/api/3/issue', { fields });
      return { created: true, key: res.key, url: `${config().site}/browse/${res.key}` };
    },
    async jira_add_comment(args) {
      const key = keyOf(args);
      const comment = String(args.comment ?? '').trim();
      if (!comment) throw new JiraError('comment is required.');
      await api('POST', `/rest/api/3/issue/${key}/comment`, { body: textToAdf(comment.slice(0, 8000)) });
      return { commented: true, key };
    },
    async jira_set_status(args) {
      const key = keyOf(args);
      const wanted = String(args.status ?? '').trim().toLowerCase();
      if (!wanted) throw new JiraError('status is required, for example "In Progress" or "Done".');
      const res = await api('GET', `/rest/api/3/issue/${key}/transitions`);
      const options = res.transitions ?? [];
      const hit = options.find((t) => t.name?.toLowerCase() === wanted || t.to?.name?.toLowerCase() === wanted);
      if (!hit) throw new JiraError(`No transition to "${args.status}" is possible from here. Possible: ${options.map((t) => t.to?.name ?? t.name).join(', ') || 'none'}.`);
      await api('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: hit.id } });
      return { moved: true, key, status: hit.to?.name ?? hit.name };
    },
  };
}

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const TOOL_DEFINITIONS = [
  { name: 'jira_check_connection', description: 'Check the Jira connection (site, e-mail, API token) and show who the token belongs to.', inputSchema: obj({}) },
  { name: 'jira_list_projects', description: 'List the Jira projects (key, name) the account can see.', inputSchema: obj({}) },
  { name: 'jira_search_issues', description: 'Search issues with JQL, for example: project = ABC AND statusCategory != Done ORDER BY updated DESC. Returns key, summary, status, type, priority, assignee.', inputSchema: obj({ jql: { type: 'string' }, max_results: { type: 'integer', description: '1 to 50 (default 20).' } }, ['jql']) },
  { name: 'jira_get_issue', description: 'Read one issue: description, labels and the last comments.', inputSchema: obj({ key: { type: 'string', description: 'Issue key such as ABC-123.' } }, ['key']) },
  { name: 'jira_create_issue', description: 'Create an issue (this changes Jira). Ask the person before using it.', inputSchema: obj({ project: { type: 'string', description: 'Project key such as ABC.' }, summary: { type: 'string' }, description: { type: 'string' }, issue_type: { type: 'string', description: 'Task, Bug, Story … (default Task).' }, priority: { type: 'string' } }, ['project', 'summary']) },
  { name: 'jira_add_comment', description: 'Add a comment to an issue (this changes Jira). Ask the person before using it.', inputSchema: obj({ key: { type: 'string' }, comment: { type: 'string' } }, ['key', 'comment']) },
  { name: 'jira_set_status', description: 'Move an issue to another status, for example "In Progress" or "Done" (this changes Jira). Ask the person before using it.', inputSchema: obj({ key: { type: 'string' }, status: { type: 'string' } }, ['key', 'status']) },
];
