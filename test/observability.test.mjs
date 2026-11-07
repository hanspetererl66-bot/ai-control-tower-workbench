/**
 * Agent observability: the read-only bridge, the argument checks of the main process, the Space page and (with a throw-away database)
 * the migrations 036 and 037. The SQL part runs only when SKILL_SQL_TEST_DSN names a database whose name ends in _test.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { VIEWS, clean, handleObservabilityMessage, pickParams } from '../src/observability-bridge.ts';
import { observeArgs, observeCall } from '../connectors/_lib/server/observability.mjs';

const ROOT = join(import.meta.dirname, '..');
const req = (o = {}) => ({ type: 'ob:get-request', requestId: 'r1', view: 'fleet', params: {}, ...o });

test('the bridge answers only the fixed views and nothing else', async () => {
  assert.equal(await handleObservabilityMessage({ type: 'ob:write' }, undefined), null);
  assert.equal(await handleObservabilityMessage(null, undefined), null);
  assert.equal(await handleObservabilityMessage(req({ requestId: 'bad id!' }), undefined), null);
  const calls = [];
  const host = { observe: async (view, params) => { calls.push([view, params]); return { ok: true, data: { x: 1 } }; } };
  assert.equal((await handleObservabilityMessage(req({ view: 'drop table' }), host)).message, 'Unknown view.');
  assert.equal(calls.length, 0);
  const ok = await handleObservabilityMessage(req({ view: 'cost', params: { days: 7 } }), host);
  assert.deepEqual(ok, { type: 'ob:data', requestId: 'r1', view: 'cost', data: { x: 1 } });
  assert.deepEqual(calls, [['cost', { days: 7 }]]);
});

test('without the desktop app the bridge says so, and errors come back as errors', async () => {
  assert.match((await handleObservabilityMessage(req(), undefined)).message, /desktop app/);
  const down = { observe: async () => ({ ok: false, error: 'database not reachable' }) };
  assert.equal((await handleObservabilityMessage(req(), down)).message, 'database not reachable');
  const boom = { observe: async () => { throw new Error('boom'); } };
  assert.equal((await handleObservabilityMessage(req(), boom)).type, 'ct:error');
});

test('parameters are cut down to what a view knows', () => {
  assert.deepEqual(pickParams('fleet', { days: 30, agent: 'x', evil: 1 }), { days: 30 });
  assert.deepEqual(pickParams('fleet', { days: 400 }), {});
  assert.deepEqual(pickParams('runs', { agent: 'renewal-watcher', status: 'error', limit: 60, minCost: 2, before: 9 }), { agent: 'renewal-watcher', status: 'error', limit: 60, minCost: 2, before: 9 });
  assert.deepEqual(pickParams('runs', { agent: "x'; drop", status: 'weird', limit: 9999 }), {});
  assert.deepEqual(pickParams('trace', { runId: 12 }), { runId: 12 });
  assert.deepEqual(pickParams('trace', { runId: '12' }), {});
  assert.deepEqual(pickParams('alerts', { status: 'open' }), { status: 'open' });
  assert.deepEqual(pickParams('quality', { days: 7 }), {});
  assert.equal(VIEWS.length, 7);
});

test('the answer is cut down: depth, list length and text length', () => {
  assert.equal(clean('x'.repeat(1000)).length, 300);
  assert.equal(clean(Array.from({ length: 5000 }, (_, i) => i)).length, 2000);
  assert.equal(clean({ a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } }).a.b.c.d.e.f.g, null);
  assert.equal(clean(Infinity), null);
  assert.deepEqual(clean({ n: 1, t: true, z: null }), { n: 1, t: true, z: null });
});

test('the main process passes only whitelisted arguments, always as the stored e-mail', async () => {
  assert.deepEqual(observeArgs('fleet', { days: 7, p_actor: 'evil@x.com', actor: 'evil@x.com' }, 'me@x.com'), { p_actor: 'me@x.com', p_days: 7 });
  assert.deepEqual(observeArgs('runs', { agent: 'o2c-trace', status: 'blocked', limit: 20, before: 100, minCost: 0.5 }, 'me@x.com'),
    { p_actor: 'me@x.com', p_agent: 'o2c-trace', p_status: 'blocked', p_limit: 20, p_before: 100, p_min_cost: 0.5 });
  assert.throws(() => observeArgs('runs', { status: 'resolved' }, 'me@x.com'), /bad status/);
  assert.throws(() => observeArgs('alerts', { status: 'ok' }, 'me@x.com'), /bad status/);
  assert.throws(() => observeArgs('fleet', { days: 0 }, 'me@x.com'), /days/);
  assert.throws(() => observeArgs('trace', {}, 'me@x.com'), /run is needed/);
  assert.throws(() => observeArgs('sql', {}, 'me@x.com'), /Unknown view/);
  const seen = [];
  const rpc = async (fn, args) => { seen.push([fn, args]); return {}; };
  await observeCall(rpc, 'me@x.com', 'quality', {});
  await observeCall(rpc, 'me@x.com', 'trace', { runId: 5 });
  assert.deepEqual(seen, [['obs_quality', { p_actor: 'me@x.com' }], ['obs_trace', { p_actor: 'me@x.com', p_run_id: 5 }]]);
});

test('the Space is a single page that reads only through the bridge and stores nothing', () => {
  const html = readFileSync(join(ROOT, 'examples/agent-observability/index.html'), 'utf8');
  assert.doesNotMatch(html, /localStorage|sessionStorage|fetch\(|XMLHttpRequest|WebSocket/);
  assert.match(html, /ob:get-request/);
  assert.match(html, /e\.source !== window\.parent/);
  for (const view of VIEWS) assert.match(html, new RegExp(`request\\('${view}'`), `the page asks for ${view}`);
  // no example numbers inside the page: the data comes from the database
  assert.doesNotMatch(html, /const\s+DATA\s*=|"agents"\s*:\s*\[/);
});

test('the migrations keep the history append only and the functions service-role only', () => {
  const schema = readFileSync(join(ROOT, 'supabase/migrations/20261107_036_agent_observability.sql'), 'utf8');
  assert.match(schema, /create trigger run_no_change before update or delete on observability\.run/);
  assert.match(schema, /create trigger span_no_change before update or delete on observability\.span/);
  for (const fn of ['obs_dashboard', 'obs_runs', 'obs_trace', 'obs_quality', 'obs_safety', 'obs_cost', 'obs_alerts']) {
    assert.match(schema, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
    assert.match(schema, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
  }
  assert.doesNotMatch(schema, /prompt text|answer text|content text/i);
});

// ---- real Postgres ----
const dsn = process.env.SKILL_SQL_TEST_DSN?.trim();
const database = (() => { try { return new URL(dsn).pathname.slice(1); } catch { return ''; } })();
const skip = !dsn ? 'set SKILL_SQL_TEST_DSN to a throw-away database (name ending in _test) to run the SQL tests'
  : /^[a-z0-9_]*_test$/.test(database) ? false : `refusing to run: the database "${database}" is not named *_test`;
const psql = (args, input) => execFileSync('psql', [dsn, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const json = (s) => JSON.parse(psql(['-c', s]));
const migration = (name) => readFileSync(join(ROOT, 'supabase/migrations', name), 'utf8');

test('SQL: schema and generated history, applied twice, give the planted picture', { skip }, () => {
  psql(['-c', "do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$; drop schema if exists observability cascade;"]);
  psql([], migration('20261107_036_agent_observability.sql'));
  psql([], migration('20261107_037_agent_observability_seed.sql'));
  const first = json("select json_build_object('runs', (select count(*) from observability.run), 'spans', (select count(*) from observability.span), 'agents', (select count(*) from observability.agent))");
  assert.ok(first.runs > 20000 && first.runs < 40000, `runs ${first.runs}`);
  assert.ok(first.spans > first.runs * 4);
  assert.equal(first.agents, 27);
  psql([], migration('20261107_037_agent_observability_seed.sql')); // the second application does nothing
  assert.equal(Number(psql(["-c", "select count(*) from observability.run"])), first.runs);

  const dash = json("select public.obs_dashboard('me@x.com', 30)");
  assert.equal(dash.daily.length, 30);
  assert.equal(dash.agents.length, 27);
  assert.ok(dash.kpis.greenButWrong > 50, 'runs that look green and missed the goal exist');
  assert.ok(dash.kpis.blocked > 0);
  const cost = json("select public.obs_cost('me@x.com', 30)");
  assert.ok(cost.spikes.length >= 1 && cost.spikes[0].times > 10, 'the runaway day stands out');
  assert.equal(cost.topRuns[0].agent, 'Supplier delay scout');
  const quality = json("select public.obs_quality('me@x.com')");
  const rw = quality.gap.find((g) => g.agent === 'renewal-watcher');
  assert.ok(rw && rw.gap > 15, 'Renewal watcher: green but wrong');
  const v14 = quality.versions.find((v) => v.agent === 'renewal-watcher' && v.version === '1.4');
  const v13 = quality.versions.find((v) => v.agent === 'renewal-watcher' && v.version === '1.3');
  assert.ok(v13.passK - v14.passK > 20, 'the nightly cases show the new version is worse');
  const safety = json("select public.obs_safety('me@x.com', 30)");
  assert.ok(safety.blocked.some((b) => b.agent === 'Payment proposal check'));
  assert.ok(safety.autonomy.some((a) => a.mode === 'autonomous' && a.unattended));
  const alerts = json("select public.obs_alerts('me@x.com')");
  assert.ok(alerts.counts.page >= 1 && alerts.alerts.length === 12);
  const run = json("select public.obs_runs('me@x.com', 'supplier-delay-scout', 'error', 30, 5, null, 2)");
  assert.ok(run.total > 20 && run.runs.length === 5);
  const trace = json(`select public.obs_trace('me@x.com', ${run.runs[0].id})`);
  assert.equal(trace.spans[0].kind, 'invoke_agent');
  assert.equal(trace.spans[0].parent, null);
  assert.ok(trace.spans.every((s) => s.offset + s.ms <= trace.spans[0].ms + 1), 'every step lies inside the run');
});

test('SQL: nothing can change the history and the reading functions refuse a bad actor', { skip }, () => {
  assert.throws(() => psql(['-c', "update observability.run set cost_eur = 0 where run_id = 1"]), /append only/);
  assert.throws(() => psql(['-c', 'delete from observability.span where run_id = 1']), /append only/);
  assert.throws(() => psql(['-c', "select public.obs_dashboard('not an email', 30)"]), /e-mail/);
  assert.equal(psql(['-c', "select has_function_privilege('anon', 'public.obs_dashboard(text, integer)', 'execute')"]), 'f');
  assert.equal(psql(['-c', "select has_function_privilege('service_role', 'public.obs_dashboard(text, integer)', 'execute')"]), 't');
  assert.equal(psql(['-c', "select has_table_privilege('authenticated', 'observability.run', 'select')"]), 'f');
});
