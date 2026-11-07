import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JOB_RUN_TOOL_DEFINITIONS, MAX_BATCH, checkRuns, createJobRunHandlers, recordJobRuns } from '../connectors/_lib/server/job-runs.mjs';
import { createWorkStore } from '../electron/work-store.mjs';

const ok = { id: 'run-1', jobId: 'job-1', jobName: 'Pre-close check', targetType: 'agent', targetLabel: 'Pre-close agent', at: '2026-11-05T08:00:00Z', ms: 1500, status: 'ok', trigger: 'schedule', note: '' };
const fake = () => { const calls = []; return { calls, rpc: async (fn, body) => { calls.push({ fn, body }); return fn === 'job_runs_list' ? [{ id: 'r1', status: 'error' }, { id: 'r2', status: 'ok' }] : { received: 1, stored: 1 }; } }; };

test('the agent gets exactly one tool and it only reads: the writer is not a tool', () => {
  assert.deepEqual(JOB_RUN_TOOL_DEFINITIONS.map((t) => t.name), ['list_job_runs']);
  assert.match(JOB_RUN_TOOL_DEFINITIONS[0].description, /^Read:/);
  assert.equal(createJobRunHandlers(null).job_runs_record, undefined);
  assert.equal(createJobRunHandlers(null).record_job_runs, undefined);
});

test('list_job_runs: arguments become database filters, the actor is the e-mail, the answer counts failures', async () => {
  const f = fake();
  const out = await createJobRunHandlers(f.rpc).list_job_runs({ actor: 'Anna@Example.com', days: 7, job: '  pre-close ', status: 'error', trigger: 'manual', only_mine: true, limit: 20 });
  assert.deepEqual([out.count, out.failed], [2, 1]);
  const b = f.calls[0].body;
  assert.equal(f.calls[0].fn, 'job_runs_list');
  assert.equal(b.p_actor, 'anna@example.com');
  assert.equal(b.p_job, 'pre-close'); assert.equal(b.p_status, 'error'); assert.equal(b.p_trigger, 'manual'); assert.equal(b.p_mine, true); assert.equal(b.p_limit, 20);
  assert.ok(Math.abs(Date.now() - 7 * 86400000 - Date.parse(b.p_since)) < 5000);
  await createJobRunHandlers(f.rpc).list_job_runs({ actor: 'a@b.co' });
  assert.deepEqual([f.calls[1].body.p_since, f.calls[1].body.p_job, f.calls[1].body.p_limit, f.calls[1].body.p_mine], [null, null, 100, false]);
});

test('list_job_runs refuses bad arguments and a missing database with a reason', async () => {
  const h = createJobRunHandlers(fake().rpc);
  for (const [args, re] of [[{ days: 0 }, /days/], [{ days: 1.5 }, /days/], [{ status: 'weird' }, /status/], [{ trigger: 'x' }, /trigger/], [{ limit: 501 }, /limit/], [{ job: 5 }, /job/], [{ only_mine: 'yes' }, /only_mine/]]) {
    await assert.rejects(h.list_job_runs({ actor: 'a@b.co', ...args }), re);
  }
  await assert.rejects(createJobRunHandlers(null).list_job_runs({ actor: 'a@b.co' }), /not set up/);
});

test('checkRuns: shape, limits and clean text; a credential in a note is replaced', () => {
  const [r] = checkRuns([{ ...ok, jobName: '  ', note: 'token: abcdefgh12345678', ms: -5, at: '2026-11-05T08:00:00+01:00', trigger: undefined }]);
  assert.equal(r.jobName, '(unnamed)'); assert.match(r.note, /removed/); assert.equal(r.ms, 0); assert.equal(r.at, '2026-11-05T07:00:00.000Z'); assert.equal(r.trigger, 'schedule');
  for (const [bad, re] of [[{ id: 'a b' }, /id/], [{ jobId: '' }, /jobId/], [{ targetType: 'x' }, /targetType/], [{ status: 'x' }, /status/], [{ trigger: 'x' }, /trigger/], [{ at: 'never' }, /date/]]) {
    assert.throws(() => checkRuns([{ ...ok, ...bad }]), re);
  }
  assert.throws(() => checkRuns([]), /at least one/);
  assert.throws(() => checkRuns(Array.from({ length: MAX_BATCH + 1 }, () => ok)), /at most/);
  assert.equal(checkRuns([{ ...ok, note: 'x'.repeat(900) }])[0].note.length, 300);
});

test('recordJobRuns sends the checked runs under the given e-mail', async () => {
  const f = fake();
  await recordJobRuns(f.rpc, 'anna@example.com', [ok]);
  assert.equal(f.calls[0].fn, 'job_runs_record'); assert.equal(f.calls[0].body.p_actor, 'anna@example.com'); assert.equal(f.calls[0].body.p_runs[0].id, 'run-1');
});

function database(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => { const parsed = JSON.parse(body || '{}'); seen.push({ url: req.url, key: req.headers.apikey, body: parsed }); const out = handler(req.url, parsed); res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out.json ?? [])); });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ seen, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

test('work store: the window can record and list, always as the stored e-mail and only with the known filters', async () => {
  const db = await database((url) => ({ json: url.endsWith('job_runs_list') ? [{ id: 'r1', status: 'ok' }] : { received: 1, stored: 1 } }));
  try {
    const store = createWorkStore({ file: join(mkdtempSync(join(tmpdir(), 'job-runs-')), 'w.json'), readConnector: () => ({ url: db.url, key: 'secret-key-9' }) });
    await assert.rejects(store.recordRuns([ok]), /e-mail/);
    store.setEmail('anna@example.com');
    assert.deepEqual(await store.recordRuns([ok]), { received: 1, stored: 1 });
    assert.equal(db.seen[0].body.p_actor, 'anna@example.com'); assert.equal(db.seen[0].key, 'secret-key-9');
    const listed = await store.listRuns({ actor: 'someone.else@example.com', status: 'error', limit: 5, p_mine: true, evil: 1 });
    assert.equal(listed.count, 1);
    const b = db.seen[1].body;
    assert.equal(b.p_actor, 'anna@example.com', 'the page cannot name another person');
    assert.equal(b.p_status, 'error'); assert.equal(b.p_limit, 5); assert.equal(b.p_mine, false, 'unknown arguments are dropped');
    await assert.rejects(store.recordRuns([{ ...ok, status: 'x' }]), /status/);
    assert.equal(db.seen.length, 2, 'a refused entry never reaches the database');
    await assert.rejects(store.call('list_job_runs', {}), /not allowed/, 'the generic work call does not reach the run log');
  } finally { db.close(); }
  const none = createWorkStore({ file: join(mkdtempSync(join(tmpdir(), 'job-runs-')), 'w.json'), readConnector: () => null });
  none.setEmail('a@b.co');
  await assert.rejects(none.listRuns({}), /not set up/);
});
