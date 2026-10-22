#!/usr/bin/env node
/**
 * Loads the demo SQL into a Databricks workspace through the SQL Statement Execution API, one statement at a time.
 * Stops at the first failure and says which statement it was. No dependencies.
 *
 *   DATABRICKS_HOST=https://adb-123.4.azuredatabricks.net DATABRICKS_TOKEN=... DATABRICKS_WAREHOUSE_ID=abc123 \
 *     node scripts/databricks-demo-load.mjs [--file sql/all-in-one.sql] [--catalog my_catalog] [--dry-run]
 *
 * Authentication is a bearer token (DATABRICKS_TOKEN) or an OAuth service principal
 * (DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET). Credentials come from the environment only.
 * --catalog replaces the demo catalog name everywhere, for metastores where you may not create a catalog.
 * Governance (08) and grants (09) are not part of the default file; load them yourself once your groups exist.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessToken, readHost } from '../connectors/databricks-bridge/server/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_SQL = join(ROOT, 'examples/databricks-demo');
const DEMO_CATALOG = 'werkbank_demo';

/** Split SQL at semicolons that are outside quotes, backticks and comments. Comments are dropped. */
export function splitStatements(text) {
  const statements = [];
  let current = '';
  let quote = null; // ' or `
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      current += char;
      if (char === quote) {
        if (quote === "'" && text[index + 1] === "'") {
          current += text[++index]; // doubled quote inside a string
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === '-' && text[index + 1] === '-') {
      while (index < text.length && text[index] !== '\n') index++;
      current += '\n';
      continue;
    }
    if (char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (quote) throw new Error('unterminated quote in SQL');
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export function withCatalog(sql, catalog) {
  if (catalog === DEMO_CATALOG) return sql;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(catalog)) throw new Error('--catalog must be a plain identifier');
  return sql.replace(/\bwerkbank_demo\b/g, catalog);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(host, path, init) {
  const response = await fetch(new URL(path, host), {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken(host)}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} from Databricks${text ? `: ${text.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`);
  return JSON.parse(text);
}

/** Run one statement and wait until it is done. Throws with the workspace's error message on failure. */
export async function runStatement(host, warehouseId, statement, { pollMs = 2000, maxWaitMs = 600_000 } = {}) {
  let answer = await call(host, '/api/2.0/sql/statements', {
    method: 'POST',
    body: JSON.stringify({ warehouse_id: warehouseId, statement, wait_timeout: '30s', on_wait_timeout: 'CONTINUE' }),
  });
  const started = Date.now();
  while (['PENDING', 'RUNNING'].includes(answer.status?.state)) {
    if (Date.now() - started > maxWaitMs) throw new Error('statement did not finish in time');
    await sleep(pollMs);
    answer = await call(host, `/api/2.0/sql/statements/${encodeURIComponent(answer.statement_id)}`, { method: 'GET' });
  }
  if (answer.status?.state !== 'SUCCEEDED') {
    throw new Error(answer.status?.error?.message ?? `statement ended as ${answer.status?.state}`);
  }
}

export async function load({ host, warehouseId, sql, onProgress = () => {}, pollMs }) {
  const statements = splitStatements(sql);
  for (const [index, statement] of statements.entries()) {
    const label = statement.replace(/\s+/g, ' ').slice(0, 70);
    try {
      await runStatement(host, warehouseId, statement, { pollMs });
    } catch (error) {
      const failure = new Error(`statement ${index + 1} of ${statements.length} failed (${label}): ${error.message}`);
      failure.statementNumber = index + 1;
      throw failure;
    }
    onProgress(index + 1, statements.length, label);
  }
  return statements.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };
  try {
    const catalog = option('--catalog', DEMO_CATALOG);
    const file = resolve(DEMO_SQL, option('--file', 'sql/all-in-one.sql'));
    const sql = withCatalog(readFileSync(file, 'utf8'), catalog);
    if (args.includes('--dry-run')) {
      const statements = splitStatements(sql);
      console.log(`${statements.length} statements from ${file}, catalog ${catalog}. Nothing was sent.`);
      process.exit(0);
    }
    const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID?.trim();
    if (!warehouseId || !/^[0-9a-f]{8,32}$/i.test(warehouseId)) throw new Error('set DATABRICKS_WAREHOUSE_ID to the id of a SQL warehouse');
    const host = readHost();
    console.log(`Loading ${file} into catalog ${catalog} on ${host.origin} ...`);
    const count = await load({
      host,
      warehouseId,
      sql,
      onProgress: (done, total, label) => console.log(`[${done}/${total}] ${label}`),
    });
    console.log(`Done: ${count} statements.`);
  } catch (error) {
    console.error(`load failed: ${error.message}`);
    process.exit(1);
  }
}
