/**
 * Runs migration 049 (the shadow protocol of the Orchestrator) against a real Postgres. Skipped unless SKILL_SQL_TEST_DSN names a
 * THROW-AWAY database whose name ends in _test, for example
 *   createdb shadow_test && SKILL_SQL_TEST_DSN="postgresql:///shadow_test" npm test
 * The test drops the schema autonomy and rebuilds it from the migration (the migration needs no other schema).
 * Roles: the migration revokes from anon/authenticated and grants service_role, so the test database needs those roles.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const dsn = process.env.SKILL_SQL_TEST_DSN?.trim();
const database = (() => { try { return new URL(dsn).pathname.slice(1); } catch { return ''; } })();
const skip = !dsn ? 'set SKILL_SQL_TEST_DSN to a throw-away database (name ending in _test) to run the SQL tests'
  : /^[a-z0-9_]*_test$/.test(database) ? false : `refusing to run: the database "${database}" is not named *_test`;
const FILE = join(ROOT, 'supabase/migrations/20261113_049_shadow_protocol.sql');

const run = (args) => execFileSync('psql', [dsn, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sql = (statement) => run(['-c', statement]);
const json = (statement) => JSON.parse(sql(statement));
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const rule = (statement) => { try { sql(statement); return null; } catch (e) { return /ERROR:\s+(.*)/.exec(String(e.stderr))?.[1]?.trim() ?? String(e.stderr); } };

const ME = 'hp@example.com';
const RUN = { adapter: 'zabbix', fetchedAt: '2026-11-13T08:30', alerts: 7, findings: 2, skipped: 3, withheld: 1 };
const D = (o = {}) => ({ findingId: 'L-1', host: 'gw-01', kind: 'cert-expiry', template: 'renew-certificate', env: 'PRD', customer: 'mi', deadlineDays: 14, mode: 'auto', customerNeeded: false, floors: [], windowStart: '2026-11-17T21:00', windowEnd: '2026-11-17T22:00', why: 'ok', ...o });
const start = (decisions, run = RUN, actor = ME) => json(`select public.autonomy_shadow_start(${q(actor)}, ${q(JSON.stringify(run))}::jsonb, ${q(JSON.stringify(decisions))}::jsonb)`);
const verdict = (id, v, reason = null, note = '', actor = ME) => `select public.autonomy_shadow_verdict(${q(actor)}, ${id}, ${q(v)}, ${q(reason)}, ${q(note)})`;
const summary = () => json(`select public.autonomy_shadow_summary(${q(ME)})`);

test('set up: the migration installs cleanly, twice', { skip }, () => {
  sql('drop schema if exists autonomy cascade');
  for (let i = 0; i < 2; i++) run(['-f', FILE]);
  assert.equal(sql("select count(*) from information_schema.tables where table_schema = 'autonomy'"), '3');
});

test('a run writes its decisions and returns the id of each; one decision per finding and run', { skip }, () => {
  const r = start([D(), D({ findingId: 'L-2', mode: 'approval', floors: ['prod'], customerNeeded: true })]);
  assert.ok(r.runId > 0);
  assert.deepEqual(Object.keys(r.decisions).sort(), ['L-1', 'L-2']);
  assert.match(rule(`select public.autonomy_shadow_start(${q(ME)}, ${q(JSON.stringify(RUN))}::jsonb, ${q(JSON.stringify([D(), D()]))}::jsonb)`), /duplicate key|unique/);
  assert.equal(sql(`select floors::text from autonomy.shadow_decision where id = ${r.decisions['L-2']}`), '{prod}');
});

test('the database refuses unknown kinds, tasks, environments and modes, a bad actor, a bad time, too many decisions', { skip }, () => {
  const bad = (d) => rule(`select public.autonomy_shadow_start(${q(ME)}, ${q(JSON.stringify(RUN))}::jsonb, ${q(JSON.stringify([d]))}::jsonb)`);
  for (const d of [D({ kind: 'weird' }), D({ template: 'drop-all' }), D({ env: 'LIVE' }), D({ mode: 'maybe' }), D({ deadlineDays: 0 }), D({ windowStart: 'soon' }), D({ findingId: 'bad id' }), D({ host: 'bad host' })]) assert.ok(bad(d), JSON.stringify(d));
  assert.match(rule(`select public.autonomy_shadow_start('nobody', ${q(JSON.stringify(RUN))}::jsonb, '[]'::jsonb)`), /actor must be an e-mail/);
  assert.match(rule(`select public.autonomy_shadow_start(${q(ME)}, ${q(JSON.stringify(RUN))}::jsonb, ${q(JSON.stringify(Array.from({ length: 101 }, (_, i) => D({ findingId: 'L-' + i }))))}::jsonb)`), /at most 100/);
});

test('verdicts: agree has no reason, a disagreement needs one, floor-missed fits only a decision to run by itself, over-cautious only one to wait', { skip }, () => {
  const r = start([D({ findingId: 'A' }), D({ findingId: 'B', mode: 'approval' })]);
  const a = r.decisions.A, b = r.decisions.B;
  assert.match(rule(verdict(a, 'agree', 'other')), /agreement has no reason/);
  assert.match(rule(verdict(a, 'disagree')), /needs a known reason/);
  assert.match(rule(verdict(a, 'disagree', 'because')), /needs a known reason/);
  assert.match(rule(verdict(b, 'disagree', 'floor-missed')), /only to a decision to run by itself/);
  assert.match(rule(verdict(a, 'disagree', 'over-cautious')), /only to a decision to wait for a person/);
  assert.match(rule(verdict(999999, 'agree')), /unknown decision/);
  assert.match(rule(verdict(a, 'maybe')), /agree or disagree/);
  assert.equal(json(verdict(a, 'agree')).verdict, 'agree');
  assert.equal(json(verdict(b, 'disagree', 'over-cautious', 'could run alone')).reason, 'over-cautious');
});

test('append only: no row of the protocol can be changed or removed', { skip }, () => {
  for (const t of ['shadow_run', 'shadow_decision', 'shadow_verdict']) {
    assert.match(rule(`update autonomy.${t} set id = id`), /append only/, `${t} update`);
    assert.match(rule(`delete from autonomy.${t}`), /append only/, `${t} delete`);
  }
});

test('the summary counts the latest verdict per decision, and floorMissed is the number that stops the shadow phase', { skip }, () => {
  const before = summary();
  const r = start([D({ findingId: 'S1' }), D({ findingId: 'S2' }), D({ findingId: 'S3', mode: 'approval' })]);
  json(verdict(r.decisions.S1, 'agree'));
  json(verdict(r.decisions.S2, 'disagree', 'floor-missed'));
  json(verdict(r.decisions.S3, 'disagree', 'wrong-window'));
  let s = summary();
  assert.equal(s.decisions - before.decisions, 3);
  assert.equal(s.floorMissed - before.floorMissed, 1);
  assert.equal(s.byReason['floor-missed'] - (before.byReason['floor-missed'] ?? 0), 1);
  json(verdict(r.decisions.S2, 'agree'));
  s = summary();
  assert.equal(s.floorMissed - before.floorMissed, 0, 'a changed mind: the latest verdict counts');
  assert.ok(s.lastRun.id >= r.runId);
});

test('nobody but service_role can use it: the tables and functions are closed to anon and authenticated', { skip }, () => {
  for (const role of ['anon', 'authenticated']) {
    assert.equal(sql(`select has_function_privilege('${role}', 'public.autonomy_shadow_summary(text)', 'execute')`), 'f', role);
    assert.equal(sql(`select has_table_privilege('${role}', 'autonomy.shadow_verdict', 'select')`), 'f', role);
  }
  assert.equal(sql("select has_function_privilege('service_role', 'public.autonomy_shadow_start(text, jsonb, jsonb)', 'execute')"), 't');
});

test('the migration file is a single, additive, idempotent script (no drop, no data change)', () => {
  const sqlText = readFileSync(FILE, 'utf8');
  assert.doesNotMatch(sqlText.replace(/--.*$/gm, ''), /\bdrop (table|schema|function)\b|\btruncate\b|\bdelete from\b/i);
  assert.match(sqlText, /create table if not exists autonomy\.shadow_run/);
  assert.equal((sqlText.match(/security definer set search_path = ''/g) || []).length, 3, 'every function has a fixed search path');
  assert.match(sqlText, /grant execute on function[^;]*to service_role;/);
});
