import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { COMPANY_CODES, GRIR_ITEMS, VENDORS, classifyGrir } from '../connectors/sap-mock/server/data.mjs';
import { DISCOUNT_POLICY_PCT, IC_ITEMS, dealRows, marginRows, marginSummary } from '../examples/databricks-demo/seed/data.mjs';
import { installDatabricksDemo } from '../scripts/install-databricks-demo.mjs';
import { buildConnectorBundle } from '../scripts/build-connector-mcpb.mjs';
import { load, splitStatements, withCatalog } from '../scripts/databricks-demo-load.mjs';
import { recipeNames, renderAll } from '../scripts/gen-databricks-demo.mjs';

const ROOT = join(import.meta.dirname, '..');
const DEMO = join(ROOT, 'examples/databricks-demo');
const read = (path) => readFileSync(join(DEMO, path), 'utf8');
const SAP_TOOLS = JSON.parse(readFileSync(join(ROOT, 'connectors/sap-mock/manifest.json'), 'utf8')).tools.map((tool) => tool.name);

test('generated files on disk are in step with the seed module and the recipes', () => {
  for (const [path, content] of Object.entries(renderAll())) {
    assert.equal(read(path), content, `${path} is stale: run npm run sync:databricks-demo`);
  }
});

/** Count top-level comma separated values in one VALUES row, ignoring commas in strings and parentheses. */
function countValues(row) {
  let depth = 0;
  let quoted = false;
  let count = 1;
  for (let index = 0; index < row.length; index++) {
    const char = row[index];
    if (quoted) {
      if (char === "'" && row[index + 1] === "'") index++;
      else if (char === "'") quoted = false;
    } else if (char === "'") quoted = true;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) count++;
  }
  return count;
}

test('every generated INSERT has as many values per row as its table has columns', () => {
  const ddl = read('sql/01_tables.sql');
  const columns = new Map();
  for (const match of ddl.matchAll(/CREATE OR REPLACE TABLE (\S+) \(\n([\s\S]*?)\n\)\n/g)) {
    columns.set(match[1], match[2].split('\n').filter((line) => /^ {2}\w+ /.test(line)).length);
  }
  let checked = 0;
  for (const file of ['02_seed_finance.sql', '03_seed_ops.sql', '04_seed_scm.sql']) {
    for (const match of read(`sql/${file}`).matchAll(/INSERT OVERWRITE TABLE (\S+) VALUES\n([\s\S]*?);/g)) {
      assert.ok(columns.has(match[1]), `${match[1]} has no CREATE TABLE`);
      const rows = match[2].split('\n').map((line) => line.trim().replace(/,$/, '').replace(/^\(|\)$/g, ''));
      for (const row of rows) assert.equal(countValues(row), columns.get(match[1]), `${match[1]}: ${row.slice(0, 60)}`);
      checked++;
    }
  }
  assert.equal(checked, 12);
});

test('the story is in the data: DACH misses plan in Q3 and nothing else does', () => {
  const rows = marginRows();
  const quarter = (row) => Math.floor((Number(row.month.slice(5, 7)) - 1) / 3) + 1;
  const dachQ3 = marginSummary(rows.filter((row) => row.region === 'DACH' && quarter(row) === 3));
  assert.ok(dachQ3.deltaPp < -2.5 && dachQ3.deltaPp > -3.5, `DACH Q3 delta ${dachQ3.deltaPp}`);
  for (const region of new Set(rows.map((row) => row.region))) {
    for (const q of [1, 2, 3]) {
      if (region === 'DACH' && q === 3) continue;
      const { deltaPp } = marginSummary(rows.filter((row) => row.region === region && quarter(row) === q));
      assert.ok(Math.abs(deltaPp) < 0.5, `${region} Q${q} delta ${deltaPp}`);
    }
  }
  const leaks = dealRows().filter((deal) => deal.region === 'DACH' && deal.productLine === 'Industrial Sensors' && deal.discountPct > DISCOUNT_POLICY_PCT);
  assert.ok(leaks.length >= 12, `only ${leaks.length} deals above policy`);
});

test('recipes are valid Goose recipes and refer only to things that exist', () => {
  const functions = read('sql/07_functions.sql');
  const tables = read('sql/01_tables.sql');
  assert.deepEqual(recipeNames().sort(), ['finance-pre-close', 'margin-analyst', 'pipeline-oncall', 'po-expedite']);
  for (const name of recipeNames()) {
    const recipe = parse(read(`recipes/${name}.yaml`));
    for (const key of ['version', 'title', 'description', 'instructions', 'prompt']) assert.ok(recipe[key], `${name}: ${key}`);
    assert.equal('extensions' in recipe, false, `${name}: extensions are left to the session`);
    const declared = new Set((recipe.parameters ?? []).map((parameter) => parameter.key));
    for (const parameter of recipe.parameters ?? []) {
      assert.ok(['string', 'number', 'boolean', 'date', 'select'].includes(parameter.input_type), `${name}.${parameter.key} type`);
      if (parameter.default !== undefined) assert.equal(typeof parameter.default, 'string', `${name}.${parameter.key} default must be a string`);
    }
    const text = `${recipe.instructions}\n${recipe.prompt}`;
    for (const match of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) assert.ok(declared.has(match[1]), `${name}: {{ ${match[1]} }} has no parameter`);
    for (const tool of text.match(/\b(?:draft_expedite_request|draft_supplier_inquiry|draft_accrual_posting|get_open_grir_items|submit_draft|get_audit_log|list_alternative_suppliers|list_purchase_orders|get_purchase_order)\b/g) ?? []) {
      assert.ok(SAP_TOOLS.includes(tool), `${name}: unknown SAP tool ${tool}`);
    }
    for (const fn of text.match(/\b(?:get_delay_risk_pos|get_po_detail|get_failed_runs|get_run_diagnosis|get_downstream_impact|get_grir_accrual_candidates|get_intercompany_differences)\b/g) ?? []) {
      assert.match(functions, new RegExp(`FUNCTION werkbank_demo\\.\\w+\\.${fn}\\(`), `${name}: no SQL function ${fn}`);
    }
  }
  const oncall = read('recipes/pipeline-oncall.yaml');
  const target = oncall.match(/INSERT INTO (werkbank_demo\.\w+\.\w+)/)?.[1];
  assert.ok(target, 'pipeline-oncall states its only write');
  assert.match(tables, new RegExp(`CREATE OR REPLACE TABLE ${target.replace(/\./g, '\\.')} \\(`));
});

test('the bridge manifest default paths match the functions in 07_functions.sql', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'connectors/databricks-bridge/manifest.json'), 'utf8'));
  const defaults = manifest.user_config.mcp_paths.default;
  assert.equal(defaults.includes('\n'), false);
  const functions = read('sql/07_functions.sql');
  const paths = defaults.split(',').map((entry) => entry.split('=').pop());
  const functionPaths = paths.filter((path) => path.includes('/mcp/functions/'));
  assert.equal(functionPaths.length, 7);
  for (const path of functionPaths) {
    const [, schema, fn] = path.match(/functions\/werkbank_demo\/(\w+)\/(\w+)$/);
    assert.match(functions, new RegExp(`FUNCTION werkbank_demo\\.${schema}\\.${fn}\\(`), path);
  }
  const snippet = parse(read('goose/extensions.yaml')).extensions;
  assert.equal(snippet.databricks.envs.DATABRICKS_MCP_PATHS.split(',').length, paths.length);
});

test('extension snippet parses, points at real servers and carries no secret', () => {
  const snippet = parse(read('goose/extensions.yaml')).extensions;
  assert.deepEqual(Object.keys(snippet).sort(), ['databricks', 'sap-mock']);
  for (const entry of Object.values(snippet)) {
    assert.equal(entry.type, 'stdio');
    assert.ok(existsSync(join(ROOT, entry.args[0].replace('<REPO>/', ''))), entry.args[0]);
    for (const key of Object.keys(entry.envs ?? {})) assert.doesNotMatch(key, /SECRET|TOKEN|PASSWORD|KEY/i, `${key} must not be in the file`);
  }
});

test('skills carry the name of their folder and are generated from the recipes', () => {
  for (const name of recipeNames()) {
    const skill = read(`skills/${name}/SKILL.md`);
    assert.match(skill, new RegExp(`^---\\nname: ${name}\\n`));
    assert.doesNotMatch(skill, /\{\{/, 'template markers must be resolved');
  }
});

test('no credential-looking string is checked in with the demo', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(DEMO);
  walk(join(ROOT, 'connectors/databricks-bridge'));
  walk(join(ROOT, 'connectors/sap-mock'));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\bdapi[0-9a-f]{20,}\b/, file);
    assert.doesNotMatch(text, /Bearer [A-Za-z0-9._-]{20,}/, file);
    assert.doesNotMatch(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, file);
  }
});

test('splitStatements respects quotes and comments', () => {
  const sql = "-- a; comment\nCREATE TABLE a (x STRING COMMENT 'one; two');\nINSERT INTO a VALUES ('it''s;');\n\n-- trailing\n";
  assert.deepEqual(splitStatements(sql), ["CREATE TABLE a (x STRING COMMENT 'one; two')", "INSERT INTO a VALUES ('it''s;')"]);
  assert.throws(() => splitStatements("SELECT 'open"), /unterminated/);
  assert.equal(splitStatements(read('sql/all-in-one.sql')).length > 20, true);
});

test('withCatalog renames the catalog everywhere and rejects odd names', () => {
  assert.equal(withCatalog('USE CATALOG werkbank_demo; werkbank_demo.fin.x', 'mine'), 'USE CATALOG mine; mine.fin.x');
  assert.throws(() => withCatalog('x', 'a; DROP'), /plain identifier/);
});

test('the loader runs statements in order, waits for slow ones and stops at the first failure', async () => {
  const seen = [];
  const polls = new Map();
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      assert.equal(request.headers.authorization, 'Bearer test-token');
      const reply = (payload) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(payload));
      };
      if (request.method === 'POST') {
        const { statement, warehouse_id: warehouse } = JSON.parse(body);
        assert.equal(warehouse, 'abc123');
        seen.push(statement);
        if (statement.includes('SLOW')) return reply({ statement_id: 's1', status: { state: 'RUNNING' } });
        if (statement.includes('BROKEN')) return reply({ statement_id: 's2', status: { state: 'FAILED', error: { message: 'TABLE_OR_VIEW_NOT_FOUND' } } });
        return reply({ statement_id: 'ok', status: { state: 'SUCCEEDED' } });
      }
      const count = (polls.get(request.url) ?? 0) + 1;
      polls.set(request.url, count);
      reply({ statement_id: 's1', status: { state: count < 2 ? 'RUNNING' : 'SUCCEEDED' } });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previous = { ...process.env };
  process.env.DATABRICKS_HOST = `http://127.0.0.1:${server.address().port}`;
  process.env.DATABRICKS_TOKEN = 'test-token';
  try {
    const { readHost } = await import('../connectors/databricks-bridge/server/index.mjs');
    const host = readHost();
    assert.equal(await load({ host, warehouseId: 'abc123', sql: 'SELECT 1; SELECT SLOW; SELECT 3', pollMs: 5 }), 3);
    assert.deepEqual(seen, ['SELECT 1', 'SELECT SLOW', 'SELECT 3']);
    seen.length = 0;
    await assert.rejects(load({ host, warehouseId: 'abc123', sql: 'SELECT 1; SELECT BROKEN; SELECT 3', pollMs: 5 }), /statement 2 of 3 failed.*TABLE_OR_VIEW_NOT_FOUND/);
    assert.equal(seen.length, 2, 'statement 3 must not run');
  } finally {
    server.close();
    for (const key of ['DATABRICKS_HOST', 'DATABRICKS_TOKEN']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

function fakeCheckout() {
  const root = mkdtempSync(join(tmpdir(), 'dbx-install-'));
  mkdirSync(join(root, 'examples'), { recursive: true });
  // Reuse the real demo folder through a copy of the files the installer reads.
  const demo = join(root, 'examples/databricks-demo');
  mkdirSync(join(demo, 'goose'), { recursive: true });
  writeFileSync(join(demo, 'goose/extensions.yaml'), read('goose/extensions.yaml'));
  for (const name of recipeNames()) {
    mkdirSync(join(demo, 'skills', name), { recursive: true });
    writeFileSync(join(demo, 'skills', name, 'SKILL.md'), read(`skills/${name}/SKILL.md`));
  }
  mkdirSync(join(root, 'goose-home/.config/goose'), { recursive: true });
  writeFileSync(join(root, 'goose-home/.config/goose/config.yaml'), 'GOOSE_MODE: auto\nextensions:\n  developer:\n    type: builtin\n    name: developer\n    enabled: true\n');
  return root;
}

test('install copies skills, merges both extensions with absolute paths, and never clobbers', () => {
  const root = fakeCheckout();
  try {
    const first = installDatabricksDemo({ root, host: 'https://adb-1.2.azuredatabricks.net/some/path' });
    assert.deepEqual(first.extensions.sort(), ['databricks', 'sap-mock']);
    assert.equal(first.skills.length, 4);
    const configPath = join(root, 'goose-home/.config/goose/config.yaml');
    const config = parse(readFileSync(configPath, 'utf8'));
    assert.equal(config.GOOSE_MODE, 'auto');
    assert.equal(config.extensions.developer.type, 'builtin');
    assert.equal(config.extensions.databricks.envs.DATABRICKS_HOST, 'https://adb-1.2.azuredatabricks.net');
    assert.equal(config.extensions.databricks.args[0], `${root}/connectors/databricks-bridge/server/index.mjs`);
    assert.doesNotMatch(readFileSync(configPath, 'utf8'), /<REPO>|SECRET|TOKEN/);
    assert.ok(existsSync(join(root, 'goose-home/.agents/skills/po-expedite/SKILL.md')));

    config.extensions.databricks.envs.DATABRICKS_HOST = 'https://mine.example.com';
    writeFileSync(configPath, JSON.stringify(config));
    const second = installDatabricksDemo({ root });
    assert.deepEqual(second.skipped.sort(), ['databricks', 'sap-mock']);
    assert.equal(parse(readFileSync(configPath, 'utf8')).extensions.databricks.envs.DATABRICKS_HOST, 'https://mine.example.com');
    installDatabricksDemo({ root, force: true });
    assert.notEqual(parse(readFileSync(configPath, 'utf8')).extensions.databricks.envs.DATABRICKS_HOST, 'https://mine.example.com');
    assert.throws(() => installDatabricksDemo({ root, host: 'http://insecure.example.com', force: true }), /https/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('connector bundles contain a manifest and the server and nothing else', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'dbx-mcpb-')), 'bridge.mcpb');
  try {
    const path = buildConnectorBundle('databricks-bridge', out);
    const entries = readFileSync(path).toString('latin1');
    assert.match(entries, /manifest\.json/);
    assert.match(entries, /server\/index\.mjs/);
    assert.throws(() => buildConnectorBundle('../etc', out), /unknown connector/);
  } finally {
    rmSync(join(out, '..'), { recursive: true, force: true });
  }
});

test('pre-close story: what must be accrued, reviewed and clarified', () => {
  const classes = {};
  for (const item of GRIR_ITEMS) {
    const bucket = (classes[classifyGrir(item)] ??= { count: 0, open: 0 });
    bucket.count += 1;
    bucket.open = Math.round((bucket.open + item.grValueEur - item.invoicedValueEur) * 100) / 100;
  }
  assert.deepEqual(classes, {
    ACCRUE: { count: 8, open: 245775 },
    INVOICE_BEFORE_GOODS: { count: 1, open: -16065 },
    STALE_REVIEW: { count: 3, open: 17765 },
  });
  // Every GR/IR vendor exists, and the three company codes are the ones the plants belong to.
  for (const item of GRIR_ITEMS) assert.ok(VENDORS.some((vendor) => vendor.id === item.vendor), item.vendor);
  assert.deepEqual([...new Set(GRIR_ITEMS.map((item) => item.companyCode))].sort(), COMPANY_CODES.map((code) => code.id).sort());

  const differences = IC_ITEMS.filter((item) => item.sellerAmountEur !== (item.buyerAmountEur ?? 0));
  assert.deepEqual(differences.map((item) => item.id), ['IC-0005', 'IC-0006', 'IC-0007']);
  assert.equal(differences.find((item) => item.id === 'IC-0005').buyerAmountEur, null);
});

test('pre-close SQL objects and the margin flash exist', () => {
  const all = read('sql/all-in-one.sql');
  for (const name of ['fin.grir_items', 'fin.intercompany_items']) assert.match(all, new RegExp(`CREATE OR REPLACE TABLE werkbank_demo\\.${name.replace('.', '\\.')} \\(`));
  for (const name of ['fin.v_grir_open', 'fin.v_ic_differences']) assert.match(all, new RegExp(`CREATE OR REPLACE VIEW werkbank_demo\\.${name.replace('.', '\\.')} \\(`));
  const recipe = read('recipes/finance-pre-close.yaml');
  assert.match(recipe, /never post anything without a clear yes/i);
  assert.match(recipe, /v_margin_vs_plan/);
});
