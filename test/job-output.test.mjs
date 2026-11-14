import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { newJob, outputLabel, outputProblems, sanitizeJobs, sanitizeOutput } from '../src/jobs.ts';
import { connectorFor, deliverJobResult, resultFileName } from '../src/job-output.ts';
import { createDatabricksHandlers } from '../connectors/databricks/server/databricks.mjs';

const agent = { type: 'agent', id: 'a-1', label: 'Pre-close check' };
const cadence = { kind: 'daily', time: '07:30' };
const NOW = new Date('2026-11-14T08:15:00Z');
const job = (output) => newJob({ name: 'Weekly close', target: agent, cadence, output }, NOW);
const recorder = (failWith) => {
  const calls = [], files = [];
  return {
    calls, files,
    deps: {
      extensions: ['gmail-drafts', 'slack', 'notion', 'databricks', 'databricks-bridge'],
      callTool: async (name, args) => { calls.push([name, args]); return failWith ? { isError: true, content: [{ text: failWith }] } : { content: [{ text: 'ok' }] }; },
      writeFile: async (r) => { files.push(r); return failWith ? { ok: false, detail: failWith } : { ok: true, path: '/x' }; },
    },
  };
};

test('destinations: valid ones are kept, bad ones are dropped', () => {
  assert.equal(sanitizeOutput({ kind: 'email', to: 'a@b.com' })?.kind, 'email');
  assert.equal(sanitizeOutput({ kind: 'email', to: 'not an address' }), undefined);
  assert.equal(sanitizeOutput({ kind: 'email', to: 'a@b.com, c@d.com' }), undefined, 'one address only');
  assert.equal(sanitizeOutput({ kind: 'file', path: '../../etc', format: 'md' }), undefined);
  assert.equal(sanitizeOutput({ kind: 'file', path: '/abs/path', format: 'md' })?.path, 'abs/path', 'leading slash is stripped, still below job-results');
  assert.equal(sanitizeOutput({ kind: 'file', path: 'a/../b', format: 'md' }), undefined);
  assert.deepEqual(sanitizeOutput({ kind: 'file', path: '', format: 'txt' }), { kind: 'file', path: '', format: 'txt' });
  assert.equal(sanitizeOutput({ kind: 'slack', channel: '#finance-ops' })?.kind, 'slack');
  assert.equal(sanitizeOutput({ kind: 'slack', channel: '' }), undefined);
  assert.equal(sanitizeOutput({ kind: 'notion', parent: 'https://www.notion.so/Team-0123456789abcdef0123456789abcdef', parentType: 'database' })?.parentType, 'database');
  assert.equal(sanitizeOutput({ kind: 'notion', parent: 'https://evil.example/x', parentType: 'page' }), undefined);
  assert.equal(sanitizeOutput({ kind: 'databricks', table: 'main.ops.job_results' })?.kind, 'databricks');
  assert.equal(sanitizeOutput({ kind: 'databricks', table: 'main.ops' }), undefined);
  assert.equal(sanitizeOutput({ kind: 'databricks', table: 'main.ops.t; DROP TABLE x' }), undefined);
  assert.equal(sanitizeOutput({ kind: 'chat' }), undefined, 'chat is the default and is not stored');
  assert.ok(outputProblems({ kind: 'email', to: '' }).length > 0);
});

test('a job keeps its destination through storage; old jobs without one still load', () => {
  const j = job({ kind: 'slack', channel: '#ops' });
  assert.deepEqual(sanitizeJobs(JSON.parse(JSON.stringify([j])))[0].output, { kind: 'slack', channel: '#ops' });
  const { output, ...old } = job(undefined);
  assert.equal(sanitizeJobs([old]).length, 1);
  assert.equal(sanitizeJobs([old])[0].output, undefined);
  assert.equal(outputLabel(undefined), 'Chat only');
  assert.equal(outputLabel({ kind: 'slack', channel: 'ops' }), 'Slack #ops');
});

test('chat only: nothing is called', async () => {
  const r = recorder();
  assert.equal((await deliverJobResult(job(undefined), 'Answer', r.deps, NOW)).status, 'ok');
  assert.equal(r.calls.length + r.files.length, 0);
});

test('a failed or empty answer is not written anywhere', async () => {
  const r = recorder();
  const res = await deliverJobResult(job({ kind: 'slack', channel: '#ops' }), '⚠️ The run failed', r.deps, NOW);
  assert.equal(res.status, 'error');
  assert.equal(r.calls.length, 0);
});

test('email: draft only, through the Gmail connector', async () => {
  const r = recorder();
  const res = await deliverJobResult(job({ kind: 'email', to: 'cfo@example.com' }), 'All good.', r.deps, NOW);
  assert.equal(res.status, 'ok');
  assert.equal(r.calls[0][0], 'gmail-drafts__create_draft');
  assert.equal(r.calls[0][1].to, 'cfo@example.com');
  assert.match(r.calls[0][1].body, /All good\./);
  assert.match(res.note, /not sent/);
});

test('slack, notion and databricks go to their connector with the saved settings', async () => {
  const r = recorder();
  await deliverJobResult(job({ kind: 'slack', channel: '#ops' }), 'Hello', r.deps, NOW);
  await deliverJobResult(job({ kind: 'notion', parent: 'abc'.padEnd(32, '0'), parentType: 'database' }), Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n'), r.deps, NOW);
  await deliverJobResult(job({ kind: 'databricks', table: 'main.ops.job_results' }), 'Numbers', r.deps, NOW);
  assert.deepEqual(r.calls.map((c) => c[0]), ['slack__slack_post_message', 'notion__notion_create_page', 'databricks__databricks_append_result']);
  assert.equal(r.calls[0][1].channel, '#ops');
  assert.equal(r.calls[1][1].parent_type, 'database');
  assert.equal(r.calls[1][1].content.split('\n').length, 100, 'Notion takes at most 100 lines');
  assert.equal(r.calls[2][1].table, 'main.ops.job_results');
  assert.equal(r.calls[2][1].run_at, NOW.toISOString());
});

test('databricks prefers the real connector over the bridge', () => {
  assert.equal(connectorFor('databricks', ['databricks-bridge', 'databricks']), 'databricks');
  assert.equal(connectorFor('databricks', ['databricks-bridge']), '', 'the bridge has no write tool');
});

test('file: name, folder and content are handed to the host', async () => {
  const r = recorder();
  const res = await deliverJobResult(job({ kind: 'file', path: 'finance/weekly', format: 'md' }), 'Body', r.deps, NOW);
  assert.equal(res.status, 'ok');
  assert.equal(r.files[0].folder, 'finance/weekly');
  assert.equal(r.files[0].fileName, 'weekly-close-2026-11-14-08-15.md');
  assert.match(r.files[0].content, /^# Weekly close/);
  assert.equal(resultFileName({ name: 'Ünï / ../x' }, 'txt', NOW), 'uni-x-2026-11-14-08-15.txt');
});

test('failures say why, never throw, and mark the run as failed', async () => {
  const bad = recorder('channel_not_found');
  const res = await deliverJobResult(job({ kind: 'slack', channel: '#nope' }), 'Hi', bad.deps, NOW);
  assert.equal(res.status, 'error');
  assert.match(res.note, /channel_not_found/);
  const none = recorder();
  none.deps.extensions = [];
  assert.match((await deliverJobResult(job({ kind: 'notion', parent: 'abc'.padEnd(32, '0'), parentType: 'page' }), 'Hi', none.deps, NOW)).note, /not connected/);
  const throws = { ...none.deps, extensions: ['slack'], callTool: async () => { throw new Error('boom'); } };
  assert.match((await deliverJobResult(job({ kind: 'slack', channel: '#ops' }), 'Hi', throws, NOW)).note, /boom/);
  assert.equal((await deliverJobResult(job({ kind: 'file', path: '', format: 'md' }), 'Hi', bad.deps, NOW)).status, 'error');
});

test('databricks_append_result: fixed statement, bound values, table checked', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, body });
    return { ok: true, status: 200, json: async () => ({ statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [] } }, result: { data_array: [] } }) };
  };
  const h = createDatabricksHandlers({ env: { DATABRICKS_HOST: 'https://x.cloud.databricks.com', DATABRICKS_TOKEN: 't', DATABRICKS_WAREHOUSE_ID: 'abcdef123456' }, fetchImpl });
  const out = await h.databricks_append_result({ table: 'main.ops.job_results', job_id: 'job-1', job_name: "O'Brien'); DROP TABLE x;--", run_at: NOW.toISOString(), result: "x'; DELETE FROM y" });
  assert.equal(out.ok, true);
  const sql = requests[0].body.statement;
  assert.equal(sql, 'INSERT INTO main.ops.job_results (job_id, job_name, run_at, result) VALUES (:job_id, :job_name, :run_at, :result)');
  assert.equal(requests[0].body.parameters.find((p) => p.name === 'result').value, "x'; DELETE FROM y");
  await assert.rejects(h.databricks_append_result({ table: 'main.ops', job_id: 'j', job_name: 'n', run_at: NOW.toISOString(), result: 'r' }), /catalog\.schema\.table/);
  await assert.rejects(h.databricks_append_result({ table: 'a.b.c; DROP TABLE d', job_id: 'j', job_name: 'n', run_at: NOW.toISOString(), result: 'r' }), /catalog\.schema\.table/);
  await assert.rejects(h.databricks_append_result({ table: 'a.b.c', job_id: 'j', job_name: 'n', run_at: 'yesterday', result: 'r' }), /run_at/);
  await assert.rejects(h.databricks_append_result({ table: 'a.b.c', job_id: 'j', job_name: 'n', run_at: NOW.toISOString(), result: '  ' }), /empty/);
  assert.equal(requests.length, 1, 'bad input never reaches the API');
});

test('the host handler keeps files below job-results and never overwrites', () => {
  const main = readFileSync(join(import.meta.dirname, '..', 'electron/main.mjs'), 'utf8');
  const block = main.slice(main.indexOf("ipcMain.handle('write-job-result'"), main.indexOf("ipcMain.handle('render-briefing-pdf'"));
  assert.match(block, /join\(WORKSPACE, 'job-results'\)/);
  assert.match(block, /flag: 'wx'/);
  assert.match(block, /\\\.\\\.\?/, 'rejects .. segments');
});
