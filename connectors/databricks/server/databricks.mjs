/**
 * Databricks tools for the Databricks connector: Genie questions and read-only SQL over the public REST APIs.
 * No dependencies. fetch and the environment are injected so tests never touch a network.
 * The token is sent only to the configured workspace host and never appears in results or errors.
 */
export class DatabricksError extends Error {}

const MAX_ROWS = 200;
const DEFAULT_ROWS = 50;
const CELL_MAX = 300;
const POLL_MS = 1500;
const MAX_WAIT_MS = 120_000;

export function normalizeHost(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new DatabricksError('DATABRICKS_HOST is missing (the workspace address, for example https://adb-123.4.azuredatabricks.net).');
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new DatabricksError('DATABRICKS_HOST is not a valid address.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new DatabricksError('DATABRICKS_HOST must be an https address without credentials.');
  return url.origin;
}

const READ_START = /^(select|with|show|describe|desc|explain)\b/i;
const WRITE_WORDS = /\b(insert|update|delete|drop|create|alter|merge|truncate|grant|revoke|copy|optimize|vacuum|call|set|use|refresh|replace|comment|msck|repair)\b/i;

/** Read-only guard: one statement, starting with SELECT, WITH, SHOW, DESCRIBE or EXPLAIN, without write keywords. */
export function assertReadOnly(sql) {
  const text = String(sql ?? '').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;\s*$/, '');
  if (!text) throw new DatabricksError('The statement is empty.');
  if (text.includes(';')) throw new DatabricksError('Only one statement per call.');
  if (!READ_START.test(text)) throw new DatabricksError('Only read statements are allowed (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN).');
  const stripped = text.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`[^`]*`/g, '``');
  const hit = WRITE_WORDS.exec(stripped);
  if (hit) throw new DatabricksError(`The statement contains "${hit[1].toUpperCase()}": this connector is read-only.`);
  return text;
}

const clip = (v) => (typeof v === 'string' && v.length > CELL_MAX ? `${v.slice(0, CELL_MAX - 1)}…` : v);

function tableOf(manifest, result, limit) {
  const columns = (manifest?.schema?.columns ?? []).map((c) => c.name);
  const all = result?.data_array ?? [];
  const rows = all.slice(0, limit).map((r) => Object.fromEntries(columns.map((c, i) => [c, clip(r[i])])));
  return { columns, rows, rowCount: all.length, truncated: all.length > limit || manifest?.truncated === true };
}

export function createDatabricksHandlers({ env = process.env, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const config = () => {
    const host = normalizeHost(env.DATABRICKS_HOST);
    const token = String(env.DATABRICKS_TOKEN ?? '').trim();
    if (!token) throw new DatabricksError('DATABRICKS_TOKEN is missing (a personal access token of the workspace).');
    return { host, token };
  };

  async function api(method, path, body) {
    const { host, token } = config();
    let response;
    try {
      response = await fetchImpl(`${host}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new DatabricksError(`Could not reach the workspace: ${String(error.message).replace(token, '***')}`);
    }
    if (response.status === 401 || response.status === 403) throw new DatabricksError(`Databricks refused the token (HTTP ${response.status}). Check that it is valid and may use this API.`);
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.message ?? ''; } catch { /* no body */ }
      throw new DatabricksError(`Databricks answered HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`);
    }
    return response.json();
  }

  const spaceOf = (args) => {
    const id = String(args.space_id ?? env.DATABRICKS_GENIE_SPACE_ID ?? '').trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new DatabricksError('Give a Genie space id (space_id) or set it in the connector settings. "databricks_list_genie_spaces" lists the spaces.');
    return id;
  };
  const rowsOf = (args) => Math.min(MAX_ROWS, Math.max(1, Number.isInteger(args.row_limit) ? args.row_limit : DEFAULT_ROWS));

  async function runSql(statement, warehouse, limit) {
    const wh = String(warehouse ?? env.DATABRICKS_WAREHOUSE_ID ?? '').trim();
    if (!/^[A-Za-z0-9]{6,40}$/.test(wh)) throw new DatabricksError('Give a SQL warehouse id (warehouse_id) or set it in the connector settings.');
    let res = await api('POST', '/api/2.0/sql/statements', { warehouse_id: wh, statement, wait_timeout: '30s', on_wait_timeout: 'CONTINUE', row_limit: limit });
    const started = now();
    while (['PENDING', 'RUNNING'].includes(res.status?.state)) {
      if (now() - started > MAX_WAIT_MS) throw new DatabricksError('The query is still running after two minutes; stopped waiting.');
      await sleep(POLL_MS);
      res = await api('GET', `/api/2.0/sql/statements/${encodeURIComponent(res.statement_id)}`);
    }
    if (res.status?.state !== 'SUCCEEDED') throw new DatabricksError(`The query ${String(res.status?.state ?? 'failed').toLowerCase()}: ${String(res.status?.error?.message ?? 'no details').slice(0, 300)}`);
    return { statement_id: res.statement_id, ...tableOf(res.manifest, res.result, limit) };
  }

  return {
    async databricks_check_connection() {
      const me = await api('GET', '/api/2.0/preview/scim/v2/Me');
      return { ok: true, user: me.userName ?? me.displayName ?? 'unknown', host: config().host, warehouse: env.DATABRICKS_WAREHOUSE_ID ? 'set' : 'not set', genie_space: env.DATABRICKS_GENIE_SPACE_ID ? 'set' : 'not set' };
    },
    async databricks_list_genie_spaces() {
      const res = await api('GET', '/api/2.0/genie/spaces');
      return { spaces: (res.spaces ?? []).slice(0, 100).map((s) => ({ space_id: s.space_id, title: s.title, description: clip(s.description ?? '') })) };
    },
    async databricks_ask_genie(args) {
      const question = String(args.question ?? '').trim();
      if (!question) throw new DatabricksError('question is required.');
      if (question.length > 2000) throw new DatabricksError('question is too long (2000 characters).');
      const space = spaceOf(args), limit = rowsOf(args);
      const start = await api('POST', `/api/2.0/genie/spaces/${space}/start-conversation`, { content: question });
      const base = `/api/2.0/genie/spaces/${space}/conversations/${encodeURIComponent(start.conversation_id)}/messages/${encodeURIComponent(start.message_id)}`;
      const started = now();
      let msg = await api('GET', base);
      while (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(msg.status)) {
        if (now() - started > MAX_WAIT_MS) throw new DatabricksError('Genie is still working after two minutes; stopped waiting.');
        await sleep(POLL_MS);
        msg = await api('GET', base);
      }
      if (msg.status !== 'COMPLETED') throw new DatabricksError(`Genie ${msg.status.toLowerCase()}: ${String(msg.error?.error ?? 'no details').slice(0, 300)}`);
      const out = { space_id: space, conversation_id: start.conversation_id, answer: '', sql: null, table: null };
      for (const a of msg.attachments ?? []) {
        if (a.text?.content) out.answer = `${out.answer}${out.answer ? '\n' : ''}${a.text.content}`;
        if (a.query?.query) {
          out.sql = a.query.query;
          out.sql_description = a.query.description ?? undefined;
          const q = await api('GET', `${base}/attachments/${encodeURIComponent(a.attachment_id)}/query-result`);
          out.table = tableOf(q.statement_response?.manifest, q.statement_response?.result, limit);
        }
      }
      return out;
    },
    async databricks_run_sql(args) {
      const statement = assertReadOnly(args.statement);
      return runSql(statement, args.warehouse_id, rowsOf(args));
    },
    async databricks_describe_table(args) {
      const table = String(args.table ?? '').trim();
      if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,2}$/.test(table)) throw new DatabricksError('table must look like catalog.schema.table.');
      return runSql(`DESCRIBE TABLE ${table}`, args.warehouse_id, MAX_ROWS);
    },
  };
}

export const TOOL_DEFINITIONS = [
  { name: 'databricks_check_connection', description: 'Check the Databricks connection (host and token) and show who the token belongs to.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'databricks_list_genie_spaces', description: 'List the Genie spaces of the workspace (id, title) so a question can go to the right one.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'databricks_ask_genie', description: 'Ask a business question in natural language to a Databricks Genie space. Returns the answer text, the SQL Genie used and a result table.', inputSchema: { type: 'object', properties: { question: { type: 'string', description: 'The question, in plain language.' }, space_id: { type: 'string', description: 'Genie space id. Optional when a default is set in the connector settings.' }, row_limit: { type: 'integer', description: 'Rows to return, 1 to 200 (default 50).' } }, required: ['question'], additionalProperties: false } },
  { name: 'databricks_run_sql', description: 'Run ONE read-only SQL statement (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN) on a SQL warehouse. Writes are refused.', inputSchema: { type: 'object', properties: { statement: { type: 'string' }, warehouse_id: { type: 'string', description: 'Optional when a default is set in the connector settings.' }, row_limit: { type: 'integer', description: 'Rows to return, 1 to 200 (default 50).' } }, required: ['statement'], additionalProperties: false } },
  { name: 'databricks_describe_table', description: 'Show the columns of a table (catalog.schema.table).', inputSchema: { type: 'object', properties: { table: { type: 'string' }, warehouse_id: { type: 'string' } }, required: ['table'], additionalProperties: false } },
];
