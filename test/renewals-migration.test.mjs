/** Static checks of migration 050 (Renewals cases): needs no database. The behaviour is tested in test/skill-lifecycle-sql.test.mjs (with SKILL_SQL_TEST_DSN). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const sql = readFileSync(join(import.meta.dirname, '../supabase/migrations/20261113_050_renewals_cases.sql'), 'utf8');

test('050: row level security is on for every table and the API roles have no access', () => {
  for (const t of ['owner_email', 'manager', 'cases', 'case_events']) assert.match(sql, new RegExp(`alter table renewals\\.${t} enable row level security`), t);
  assert.match(sql, /revoke all on renewals\.owner_email, renewals\.manager, renewals\.cases, renewals\.case_events from public, anon, authenticated/);
});

test('050: the public functions are granted to service_role only', () => {
  const grants = [...sql.matchAll(/grant execute on function ([\s\S]*?) to (\w+);/g)];
  assert.ok(grants.length >= 1);
  for (const g of grants) assert.equal(g[2], 'service_role');
  assert.doesNotMatch(sql, /grant [^;]*to (anon|authenticated|public)/i);
  for (const f of ['renewals_cases_list', 'renewals_case_save', 'renewals_case_reset']) assert.match(sql, new RegExp(`function public\\.${f}`), f);
});

test('050: the log is append only and the managers only read', () => {
  assert.match(sql, /before update or delete on renewals\.case_events/);
  const change = /function renewals\.can_change[\s\S]*?\$\$;/.exec(sql)[0];
  assert.doesNotMatch(change, /renewals\.manager/, 'a manager may not change');
  const see = /function renewals\.can_see[\s\S]*?\$\$;/.exec(sql)[0];
  assert.match(see, /renewals\.manager/);
});

test('050: the seed addresses are on the reserved domain renewals.example', () => {
  const inserts = sql.slice(sql.indexOf('insert into renewals.owner_email'));
  const mails = inserts.match(/[\w.]+@[\w.]+/g);
  assert.ok(mails.length >= 5);
  for (const m of mails) assert.match(m, /@renewals\.example$/, m);
});

test('050: every function that is not a plain helper fixes the search path', () => {
  const fns = sql.match(/create or replace function[\s\S]*?(?:\$\$ begin|\$\$;|as \$\$)/g);
  for (const f of fns) assert.match(f, /set search_path = ''/, f.slice(0, 60));
});
