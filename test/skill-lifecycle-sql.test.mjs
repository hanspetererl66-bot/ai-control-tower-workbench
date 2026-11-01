/**
 * Runs the migrations against a real Postgres and walks the skill lifecycle (migrations 019 and 020) and the work items (021).
 * Skipped unless SKILL_SQL_TEST_DSN names a THROW-AWAY database whose name ends in _test, for example
 *   createdb skills_test && SKILL_SQL_TEST_DSN="postgresql:///skills_test" npm test
 * The test drops the schemas control_tower, sub4me, skills and werkbank and rebuilds them from supabase/migrations.
 * It needs the psql client and a role that may create roles and extensions (a local superuser). Never point it at Supabase.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const dsn = process.env.SKILL_SQL_TEST_DSN?.trim();
const database = (() => { try { return new URL(dsn).pathname.slice(1); } catch { return ''; } })();
const skip = !dsn ? 'set SKILL_SQL_TEST_DSN to a throw-away database (name ending in _test) to run the SQL tests'
  : /^[a-z0-9_]*_test$/.test(database) ? false : `refusing to run: the database "${database}" is not named *_test`;

const run = (args) => execFileSync('psql', [dsn, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const q = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const arr = (list) => `array[${list.map(q).join(',')}]::text[]`;
const sql = (statement) => run(['-c', statement]);
const json = (statement) => JSON.parse(sql(statement));
/** The message of a database rule ("raise exception"), or null when the statement worked. */
const rule = (statement) => {
  try { sql(statement); return null; } catch (error) { return /ERROR:\s+(.*)/.exec(String(error.stderr))?.[1]?.trim() ?? String(error.stderr); }
};

const FINANCE = '00000000-0000-0000-0000-0000000000f1';
const BOARD = '00000000-0000-0000-0000-0000000000b1';
const POLICY = 'Checks travel expense reports against the policy and flags missing receipts';
const BODY = '# Expense check\nRead the report, compare each line with the policy.';
const meta = (extra = {}) => JSON.stringify({ domain: 'Finanzen', team: 'Finance team', contact: 'anna@x.com', tools: ['get_invoices', 'get_policy'], ...extra });
const publish = (slug, description, owner, body, extra) => json(`select public.skills_publish(${q(slug)}, ${q(description)}, ${q(owner)}, ${q(body)}, ${q(meta(extra))}::jsonb)`);
const card = (actor, slug, text = 'When needed.') => json(`select public.skills_card_set(${q(actor)}, ${q(slug)}, ${q(text)}, '', 'Report', 'Findings', 'Prüfe das.')`);
const state = (actor, slug) => json(`select public.skills_lifecycle_state(${q(actor)}, ${q(slug)})`);
const request = (actor, slug, to) => json(`select public.skills_promotion_request(${q(actor)}, ${q(slug)}, ${q(to)}, ${to === 'team' ? q(FINANCE) : 'null'}, '')`);
const decide = (actor, slug, approve, reason = '') => json(`select public.skills_promotion_decide(${q(actor)}, (select id from skills.promotion where slug = ${q(slug)} and status = 'review'), ${approve}, ${q(reason)})`);
const withdraw = (actor, slug) => json(`select public.skills_promotion_withdraw(${q(actor)}, (select id from skills.promotion where slug = ${q(slug)} and status in ('review', 'blocked')))`);
const change = (actor, slug, action, reason, sunset = null, replacement = null) => `select public.skills_lifecycle_change(${q(actor)}, ${q(slug)}, ${q(action)}, ${q(reason)}, ${q(sunset)}, ${q(replacement)})`;
const check = (actor, slug, id) => state(actor, slug).openRequest.checks.find((c) => c.id === id);
const synced = (actor) => json(`select public.skills_visible(${q(actor)})`).map((s) => s.slug);
const events = (slug) => state('board@x.com', slug).events.map((e) => e.event);
const day = (offset) => json(`select to_json((current_date + ${offset})::text)`);

test('set up: the migrations install cleanly, twice', { skip }, () => {
  sql('drop schema if exists control_tower, sub4me, skills, werkbank cascade');
  sql(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  end $$; create extension if not exists pgcrypto`);
  const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.includes('20261031_020_skill_lifecycle.sql') && files.includes('20261031_021_work_items.sql'));
  for (const file of files) run(['-f', join(ROOT, 'supabase/migrations', file)]);
  run(['-f', join(ROOT, 'supabase/migrations/20261031_020_skill_lifecycle.sql')]); // re-running changes nothing and does not fail
  run(['-f', join(ROOT, 'supabase/migrations/20261031_021_work_items.sql')]);
  sql(`insert into werkbank.groups (id, name, created_by) values (${q(BOARD)}, 'Governance board', 'board@x.com'), (${q(FINANCE)}, 'Finance team', 'lead@x.com');
    insert into werkbank.group_members (group_id, email, role) values
      (${q(BOARD)}, 'board@x.com', 'admin'), (${q(FINANCE)}, 'lead@x.com', 'admin'), (${q(FINANCE)}, 'anna@x.com', 'member'), (${q(FINANCE)}, 'ben@x.com', 'member')`);
});

test('the API roles cannot reach the lifecycle', { skip }, () => {
  for (const role of ['anon', 'authenticated']) {
    assert.equal(sql(`select has_function_privilege(${q(role)}, 'public.skills_lifecycle_change(text,text,text,text,date,text)', 'execute')`), 'f', role);
    assert.equal(sql(`select has_function_privilege(${q(role)}, 'public.skills_check_duplicates(text,text,text,text,text[],text)', 'execute')`), 'f', role);
    assert.equal(sql(`select has_function_privilege(${q(role)}, 'public.skills_promotion_request(text,text,text,uuid,text)', 'execute')`), 'f', role);
    assert.equal(sql(`select has_table_privilege(${q(role)}, 'skills.lifecycle_event', 'select')`), 'f', role);
    assert.equal(sql(`select has_table_privilege(${q(role)}, 'skills.skill_card', 'select')`), 'f', role);
  }
  assert.equal(sql("select has_function_privilege('service_role', 'public.skills_lifecycle_state(text,text)', 'execute')"), 't');
});

test('a skill without a marketplace card is blocked, with the missing parts named', { skip }, () => {
  assert.equal(publish('expense-check', POLICY, 'anna@x.com', BODY).status, 'draft');
  const fresh = state('anna@x.com', 'expense-check');
  assert.equal(fresh.state, 'draft');
  assert.deepEqual(fresh.cardMissing, ['when to use it', 'inputs', 'outputs', 'example prompt']);
  assert.equal(rule(`select public.skills_lifecycle_state('zed@x.com', 'expense-check')`), 'unknown skill', 'a stranger cannot even see that it exists');

  assert.equal(request('anna@x.com', 'expense-check', 'team').status, 'blocked');
  assert.match(check('anna@x.com', 'expense-check', 'description').detail, /Missing: when to use it, inputs, outputs, example prompt/);
  assert.equal(state('anna@x.com', 'expense-check').state, 'blocked');
  assert.equal(rule(`select public.skills_promotion_request('anna@x.com', 'expense-check', 'team', ${q(FINANCE)}, '')`), 'there is already an open request for this skill');

  assert.equal(rule(`select public.skills_card_set('ben@x.com', 'expense-check', 'x', '', 'x', 'x', 'x')`), 'unknown skill', 'only people who see the skill can change its card');
  withdraw('anna@x.com', 'expense-check');
  assert.equal(card('anna@x.com', 'expense-check', 'When a report arrives before payout.').complete, true);
});

test('approval: nobody decides their own request, the department admin decides for the department', { skip }, () => {
  assert.equal(request('anna@x.com', 'expense-check', 'team').status, 'review');
  assert.equal(check('anna@x.com', 'expense-check', 'description').status, 'pass');
  assert.equal(check('anna@x.com', 'expense-check', 'duplicate').status, 'pass');
  assert.equal(state('anna@x.com', 'expense-check').state, 'in_review');
  const id = () => sql("select id from skills.promotion where slug = 'expense-check' and status = 'review'");
  assert.equal(rule(`select public.skills_promotion_decide('anna@x.com', ${q(id())}::uuid, true, '')`), 'the requester cannot decide their own request');
  assert.equal(rule(`select public.skills_promotion_decide('ben@x.com', ${q(id())}::uuid, true, '')`), 'only an admin of the department may decide');
  assert.equal(rule(`select public.skills_promotion_decide('lead@x.com', ${q(id())}::uuid, false, '')`), 'a reason is needed to reject');
  assert.equal(decide('lead@x.com', 'expense-check', true).status, 'approved');
  assert.equal(state('anna@x.com', 'expense-check').state, 'department');
  assert.deepEqual([synced('ben@x.com').includes('expense-check'), synced('zed@x.com').includes('expense-check')], [true, false]);
});

test('duplicates: an identical copy is blocked, a similar skill is a warning, a declared variant is fine', { skip }, () => {
  const ask = (description, domain, tools, text = null, slug = null) =>
    json(`select public.skills_check_duplicates('ben@x.com', ${q(slug)}, ${q(description)}, ${q(domain)}, ${arr(tools)}, ${q(text)})`);
  assert.equal(ask('Plans a company picnic', 'Sonstiges', []).verdict, 'none');
  assert.equal(ask('Prüft Reisekosten gegen die Richtlinie', 'Finanzen', ['get_policy', 'get_invoices']).verdict, 'similar');
  const same = ask('Checks expense reports', 'Finanzen', ['get_invoices'], BODY);
  assert.equal(same.verdict, 'identical');
  assert.equal(same.matches[0].slug, 'expense-check');
  assert.throws(() => ask('', 'Finanzen', []), /a description is needed/);

  publish('expense-check-copy', POLICY, 'ben@x.com', BODY, { contact: 'ben@x.com' });
  card('ben@x.com', 'expense-check-copy');
  assert.equal(request('ben@x.com', 'expense-check-copy', 'team').status, 'blocked');
  assert.match(check('ben@x.com', 'expense-check-copy', 'duplicate').detail, /Same text as the skill expense-check \(anna@x.com\)/);

  const eu = 'Checks travel expense reports of EU trips against the policy and flags missing receipts';
  publish('expense-check-eu', eu, 'ben@x.com', '# EU\nOther per-diem rules.', { contact: 'ben@x.com' });
  card('ben@x.com', 'expense-check-eu');
  assert.equal(request('ben@x.com', 'expense-check-eu', 'team').status, 'review', 'a warning does not block');
  const warning = check('ben@x.com', 'expense-check-eu', 'duplicate');
  assert.equal(warning.status, 'warn');
  assert.match(warning.detail, /Similar to expense-check/);
  withdraw('ben@x.com', 'expense-check-eu');
  publish('expense-check-eu', eu, 'ben@x.com', '# EU\nOther per-diem rules.', { contact: 'ben@x.com', variant_of: 'expense-check', variant_reason: 'EU trips follow other per-diem rules' });
  request('ben@x.com', 'expense-check-eu', 'team');
  assert.doesNotMatch(check('ben@x.com', 'expense-check-eu', 'duplicate').detail, /expense-check \(Finance team\), /, 'the declared variant is not reported as a twin of its parent');
  assert.equal(ask(eu, 'Finanzen', ['get_invoices', 'get_policy'], null, 'expense-check-eu').matches.find((m) => m.slug === 'expense-check').declaredVariant, true);
  withdraw('ben@x.com', 'expense-check-eu');
});

test('organization level needs a contact and a domain, and the Governance board decides', { skip }, () => {
  publish('mail-triage', 'Sorts incoming customer mails by urgency and drafts a short answer for each', 'anna@x.com', '# Mail triage\nSort and draft.', { domain: 'Sonstiges', contact: '', tools: ['search_mail'] });
  card('anna@x.com', 'mail-triage');
  request('anna@x.com', 'mail-triage', 'team');
  decide('lead@x.com', 'mail-triage', true);
  assert.deepEqual(json("select public.skills_card_get('anna@x.com', 'mail-triage', 'company')->'missing'"), ['contact for questions', 'domain']);
  assert.equal(request('anna@x.com', 'mail-triage', 'company').status, 'blocked');
  withdraw('anna@x.com', 'mail-triage');

  // A new version starts at Individual again (it needs a new approval), but the card stays.
  publish('mail-triage', 'Sorts incoming customer mails by urgency and drafts a short answer for each', 'anna@x.com', '# Mail triage\nSort and draft.', { domain: 'Service & Support', tools: ['search_mail'] });
  assert.equal(state('anna@x.com', 'mail-triage').state, 'draft');
  assert.equal(json("select public.skills_card_get('anna@x.com', 'mail-triage', 'team')->'complete'"), true);
  request('anna@x.com', 'mail-triage', 'team');
  decide('lead@x.com', 'mail-triage', true);
  assert.equal(request('anna@x.com', 'mail-triage', 'company').status, 'review');
  const open = sql("select id from skills.promotion where slug = 'mail-triage' and status = 'review'");
  assert.equal(rule(`select public.skills_promotion_decide('lead@x.com', ${q(open)}::uuid, true, '')`), 'only the Governance board may decide');
  assert.equal(decide('board@x.com', 'mail-triage', true).status, 'approved');
  assert.equal(state('zed@x.com', 'mail-triage').state, 'published');
  assert.ok(synced('zed@x.com').includes('mail-triage'));
});

test('deprecate, retire and restore follow the rules of the level', { skip }, () => {
  const bad = (statement) => rule(statement);
  assert.equal(bad(change('zed@x.com', 'mail-triage', 'deprecate', 'x', day(10))), 'only the owner, an admin of the department or the Governance board may change the lifecycle');
  assert.equal(bad(change('ben@x.com', 'expense-check-eu', 'deprecate', 'x', day(10))), 'only shared skills are deprecated. Retire an individual skill instead');
  assert.equal(bad(change('anna@x.com', 'mail-triage', 'deprecate', 'x', day(-1))), 'the sunset date must be today or later, within two years');
  assert.equal(bad(change('anna@x.com', 'mail-triage', 'deprecate', 'x', day(800))), 'the sunset date must be today or later, within two years');
  assert.equal(bad(change('anna@x.com', 'mail-triage', 'deprecate', '  ', day(10))), 'a reason of 1 to 400 characters is needed');
  assert.equal(bad(change('anna@x.com', 'mail-triage', 'deprecate', 'x', day(10), 'mail-triage')), 'the replacement must be another skill that is not retired');
  assert.equal(bad(change('anna@x.com', 'mail-triage', 'explode', 'x')), 'invalid action');
  assert.equal(bad(change('anna@x.com', 'mail-triage', 'restore', 'x')), 'nothing to restore');

  // Everyone sees the sunset in their sync; the skill stays usable.
  assert.equal(json(change('anna@x.com', 'mail-triage', 'deprecate', 'Replaced by the new triage', day(30), 'expense-check')).state, 'deprecated');
  const entry = json("select public.skills_visible('zed@x.com')").find((s) => s.slug === 'mail-triage');
  assert.deepEqual([entry.sunsetAt, entry.replacedBy], [day(30), 'expense-check']);

  // A skill published for everyone: its owner waits for the sunset date, the board does not.
  const early = 'a skill published for everyone is deprecated first. Its owner may retire it after the sunset date, the Governance board at any time';
  assert.equal(bad(change('anna@x.com', 'mail-triage', 'retire', 'done')), early);
  assert.equal(bad(change('lead@x.com', 'mail-triage', 'retire', 'done')), early, 'a department admin may not retire what everyone uses');
  sql("update skills.skill set sunset_at = current_date - 3 where slug = 'mail-triage'");
  assert.deepEqual(json("select public.skills_lifecycle_overview('anna@x.com')->'attention'"), [{ slug: 'mail-triage', reason: 'Sunset date has passed: retire it or move the date' }]);
  assert.equal(json(change('anna@x.com', 'mail-triage', 'retire', 'Sunset passed')).state, 'retired');
  assert.equal(synced('anna@x.com').includes('mail-triage'), false, 'retired skills are not synced, not even to their owner');
  assert.equal(synced('zed@x.com').includes('mail-triage'), false);
  assert.equal(bad(`select public.skills_promotion_request('anna@x.com', 'mail-triage', 'team', ${q(FINANCE)}, '')`), 'a retired skill cannot be promoted. Restore it first');
  assert.equal(bad(change('anna@x.com', 'mail-triage', 'retire', 'again')), 'the skill is already retired');

  // Restore: back to Individual, a new approval is needed, the old notice is gone.
  const restored = json(change('anna@x.com', 'mail-triage', 'restore', 'Needed again'));
  assert.deepEqual([restored.state, restored.scope, restored.sunsetAt, restored.replacedBy], ['draft', 'individual', null, null]);
  assert.equal(synced('zed@x.com').includes('mail-triage'), false);
  assert.ok(synced('anna@x.com').includes('mail-triage'));
});

test('a skill with active variants cannot be retired; leaving a notice is undone with restore', { skip }, () => {
  assert.equal(rule(change('board@x.com', 'expense-check', 'retire', 'done')), 'active variants depend on this skill: expense-check-eu');
  assert.equal(json(change('anna@x.com', 'expense-check', 'deprecate', 'Rules change', day(20))).state, 'deprecated');
  assert.equal(json(change('anna@x.com', 'expense-check', 'restore', 'Keep it')).state, 'department');
  // Retiring a leaf withdraws its open request and removes it from the sync.
  request('ben@x.com', 'expense-check-eu', 'team');
  assert.equal(json(change('ben@x.com', 'expense-check-eu', 'retire', 'Not needed')).state, 'retired');
  assert.equal(sql("select status from skills.promotion where slug = 'expense-check-eu' order by created_at desc limit 1"), 'withdrawn');
  assert.equal(json(change('board@x.com', 'expense-check', 'retire', 'Cleaning up')).state, 'retired', 'the board may retire a department skill; its variant is already retired');
});

test('every step is in the history, with the person who did it', { skip }, () => {
  const mail = state('board@x.com', 'mail-triage').events;
  assert.deepEqual(mail.map((e) => e.event).reverse(), [
    'created', 'submitted', 'approved', 'submitted', 'blocked', 'withdrawn', 'version', 'submitted', 'approved',
    'submitted', 'approved', 'published', 'deprecated', 'retired', 'restored',
  ]);
  const find = (event) => mail.find((e) => e.event === event);
  assert.equal(find('created').actor, 'anna@x.com');
  assert.equal(find('blocked').actor, 'system');
  assert.equal(find('published').actor, 'board@x.com', 'publishing by approval names the approver, not "system"');
  assert.match(find('published').detail, /whole organization/);
  assert.match(find('deprecated').detail, /Replaced by the new triage/);
  assert.deepEqual([find('retired').actor, find('retired').detail], ['anna@x.com', 'Sunset passed']);
  assert.deepEqual([find('restored').actor, find('restored').detail], ['anna@x.com', 'Needed again']);
  // Editing a skill that is published for everyone sends it back to Individual: nothing stays approved after a change.
  publish('mail-triage', 'Sorts incoming customer mails by urgency and drafts a short answer for each', 'anna@x.com', '# Mail triage\nSort and draft, v3.', { domain: 'Service & Support', tools: ['search_mail'] });
  assert.equal(state('anna@x.com', 'mail-triage').version, 3);
  const expense = state('board@x.com', 'expense-check').events.map((e) => e.event).reverse();
  assert.deepEqual(expense.slice(0, 3), ['created', 'submitted', 'blocked']);
  assert.ok(expense.indexOf('deprecated') < expense.indexOf('undeprecated') && expense.indexOf('undeprecated') < expense.indexOf('retired'));
  assert.equal(Number(sql("select count(*) from skills.lifecycle_event where event = 'retired'")), 3);
});

// ---------- migration 021: work items and skill files ----------
const files = (...list) => JSON.stringify(list.map(([path, content, language = '']) => ({ path, content, language })));
const save = (actor, { id = null, kind = 'workflow', name = 'Renewal watch', visibility = 'private', team = null, expected = null, list = files(['workflow.json', '{"nodes":[]}', 'json']), note = '' } = {}) =>
  `select public.work_save(${q(actor)}, ${q(id)}, ${q(kind)}, ${q(name)}, ${q(visibility)}, ${team ? q(team) + '::uuid' : 'null'}, 'build', '{"goal":"x"}'::jsonb, array['intent']::text[], ${q(list)}::jsonb, ${q(note)}, ${expected === null ? 'null' : expected})`;
const itemOf = (actor, id, rev = 'null') => json(`select public.work_get(${q(actor)}, ${q(id)}::uuid, ${rev})`);
let ITEM;

test('work items: the API roles cannot reach them, only the service role can call the functions', { skip }, () => {
  for (const table of ['werkbank.work_item', 'werkbank.work_item_file', 'skills.skill_file']) {
    assert.ok(rule(`set role authenticated; select * from ${table}`), `${table} must be closed to authenticated`);
  }
  assert.ok(rule("set role anon; select public.work_list('a@x.com')"), 'anon must not call work_list');
  assert.equal(rule("set role service_role; select public.work_list('anna@x.com')"), null);
  assert.ok(rule("set role authenticated; select public.skills_files('a@x.com', 'x')"));
});

test('work items: every save is a new revision, the earlier ones stay readable', { skip }, () => {
  const first = json(save('anna@x.com', { note: 'first draft' }));
  ITEM = first.id;
  assert.deepEqual([first.rev, first.files], [1, 1]);
  const second = json(save('anna@x.com', { id: ITEM, expected: 1, name: 'Renewal watch v2', note: 'added the python helper',
    list: files(['workflow.json', '{"nodes":[1]}', 'json'], ['src/helper.py', 'def f():\n    return 1\n', 'python'], ['README.md', '# Renewal watch']) }));
  assert.deepEqual([second.rev, second.files], [2, 3]);
  const now = itemOf('anna@x.com', ITEM);
  assert.deepEqual([now.name, now.current_rev, now.files.length, now.can_write], ['Renewal watch v2', 2, 3, true]);
  assert.equal(now.files.find((f) => f.path === 'src/helper.py').content, 'def f():\n    return 1\n');
  assert.equal(itemOf('anna@x.com', ITEM, 1).files.length, 1, 'revision 1 is unchanged');
  assert.equal(itemOf('anna@x.com', ITEM, 1).files[0].content, '{"nodes":[]}');
  const history = json(`select public.work_history('anna@x.com', ${q(ITEM)}::uuid)`);
  assert.deepEqual(history.map((r) => [r.rev, r.author, r.note]), [[2, 'anna@x.com', 'added the python helper'], [1, 'anna@x.com', 'first draft']]);
  const light = json(`select public.work_get('anna@x.com', ${q(ITEM)}::uuid, null, false)`);
  assert.ok(light.files.every((f) => f.content === undefined && f.sha256.length === 64));
});

test('work items: a stale save is refused instead of overwriting', { skip }, () => {
  assert.match(rule(save('anna@x.com', { id: ITEM, expected: 1 })), /changed meanwhile \(now revision 2\)/);
  assert.match(rule(save('anna@x.com', { id: ITEM, kind: 'agent', expected: 2 })), /kind of an item cannot change/);
  assert.equal(itemOf('anna@x.com', ITEM).current_rev, 2);
});

test('work items: private, team and company visibility', { skip }, () => {
  assert.match(rule(`select public.work_get('ben@x.com', ${q(ITEM)}::uuid)`), /not visible/);
  assert.deepEqual(json("select public.work_list('ben@x.com')"), []);
  assert.match(rule(save('anna@x.com', { id: ITEM, expected: 2, visibility: 'team', team: BOARD })), /must be a member of that team/);
  json(save('anna@x.com', { id: ITEM, expected: 2, visibility: 'team', team: FINANCE, note: 'shared with Finance' }));
  assert.equal(itemOf('ben@x.com', ITEM).can_write, false, 'a team member reads but does not write');
  assert.match(rule(save('ben@x.com', { id: ITEM, expected: 3 })), /Only the owner, a team admin/);
  assert.equal(itemOf('lead@x.com', ITEM).can_write, true, 'the team admin may write');
  json(save('lead@x.com', { id: ITEM, expected: 3, visibility: 'team', team: FINANCE, note: 'fixed by the team admin' }));
  assert.equal(json("select public.work_list('lead@x.com')").length, 1);
  assert.match(rule(`select public.work_get('outsider@x.com', ${q(ITEM)}::uuid)`), /not visible/);
  assert.equal(itemOf('board@x.com', ITEM).current_rev, 4, 'the Governance board sees everything');
  json(save('anna@x.com', { id: ITEM, expected: 4, visibility: 'company' }));
  assert.equal(itemOf('outsider@x.com', ITEM).can_write, false, 'company-wide is read only for others');
});

test('work items: code with a credential is refused with the file name, bad paths too', { skip }, () => {
  const bad = (list) => rule(save('anna@x.com', { kind: 'code', name: 'Script', list }));
  assert.match(bad(files(['run.py', 'API_KEY = "abcd1234efgh5678"'])), /run\.py looks like it contains a credential/);
  assert.match(bad(files(['k.pem', '-----BEGIN PRIVATE KEY-----'])), /credential/);
  assert.match(bad(files(['../x.py', '1'])), /invalid file path/);
  assert.match(bad(files(['a.py', '1'], ['a.py', '2'])), /twice/);
  assert.match(bad('[]'), /non-empty/);
  assert.match(bad(files(['ä.md', '1'])), /invalid file path/, 'paths are ASCII, the text may contain anything');
  assert.match(rule(save('anna@x.com', { kind: 'macro' })), /kind must be/);
  assert.equal(json(save('anna@x.com', { kind: 'code', name: 'Script', list: files(['run.py', 'print("token")'], ['umlaut.md', 'Größe ä']) })).files, 2);
});

test('work items: archive hides an item from the list, the revisions stay', { skip }, () => {
  assert.match(rule(`select public.work_archive('ben@x.com', ${q(ITEM)}::uuid, true)`), /Only the owner/);
  json(`select public.work_archive('anna@x.com', ${q(ITEM)}::uuid, true)`);
  assert.ok(!json("select public.work_list('anna@x.com')").some((i) => i.id === ITEM));
  assert.ok(json("select public.work_list('anna@x.com', null, true)").some((i) => i.id === ITEM && i.archived));
  assert.equal(itemOf('anna@x.com', ITEM, 1).files.length, 1);
  assert.deepEqual(json("select public.work_list('anna@x.com', 'code')").map((i) => i.kind), ['code']);
});

test('skill files: the owner adds scripts, others read what they may see, SKILL.md is not a file', { skip }, () => {
  publish('file-skill', 'Checks travel expense reports with a script and flags missing receipts for the finance team', 'anna@x.com', '# File skill\nRun the script.', { domain: 'Finanzen' });
  const set = (actor, path, content, language = 'python') => `select public.skills_file_set(${q(actor)}, 'file-skill', ${q(path)}, ${q(language)}, ${q(content)})`;
  assert.equal(json(set('anna@x.com', 'scripts/check.py', 'print(1)')).chars, 8);
  json(set('anna@x.com', 'scripts/check.py', 'print(2)'));
  json(set('anna@x.com', 'templates/report.md', '# Report', 'markdown'));
  assert.match(rule(set('anna@x.com', 'SKILL.md', 'x')), /SKILL\.md is the skill text/);
  assert.match(rule(set('ben@x.com', 'a.py', 'x')), /Only the owner/);
  assert.match(rule(set('anna@x.com', 'a.py', 'password = "hunter2hunter2"')), /credential/);
  assert.deepEqual(json("select public.skills_files('anna@x.com', 'file-skill')").map((f) => f.path), ['scripts/check.py', 'templates/report.md']);
  assert.equal(json("select public.skills_files('anna@x.com', 'file-skill', 'scripts/check.py')").content, 'print(2)');
  assert.match(rule("select public.skills_files('outsider@x.com', 'file-skill')"), /not visible/);
  json("select public.skills_file_delete('anna@x.com', 'file-skill', 'templates/report.md')");
  assert.match(rule("select public.skills_file_delete('anna@x.com', 'file-skill', 'templates/report.md')"), /no file/);
  assert.equal(json("select public.skills_files('anna@x.com', 'file-skill')").length, 1);
});
