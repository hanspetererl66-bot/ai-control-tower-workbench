import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { SKILL_LIFECYCLE_TOOL_DEFINITIONS, actorOf, createSkillLifecycleHandlers } from '../connectors/_lib/server/skill-lifecycle.mjs';
import { ticketRpc } from '../connectors/_lib/server/runtime.mjs';
import { ToolError } from '../connectors/_lib/server/tools.mjs';

const ROOT = join(import.meta.dirname, '..');
const GROUP = '00000000-0000-0000-0000-0000000000f1';
const REQUEST = '11111111-2222-3333-4444-555555555555';
const WRITES = ['set_skill_card', 'request_skill_promotion', 'decide_skill_request', 'withdraw_skill_request', 'deprecate_skill', 'retire_skill', 'restore_skill'];

/** Handlers with a recording fake of the Supabase call. */
function setup(answer = { ok: true }) {
  const calls = [];
  const rpc = async (fn, body) => { calls.push({ fn, body }); return typeof answer === 'function' ? answer(fn, body) : answer; };
  return { calls, h: createSkillLifecycleHandlers(rpc) };
}
const refuses = async (promise, pattern) => assert.rejects(promise, (error) => error instanceof ToolError && pattern.test(error.message));

test('every lifecycle tool names the actor, has a schema and is a handler', () => {
  const { h } = setup();
  assert.equal(SKILL_LIFECYCLE_TOOL_DEFINITIONS.length, 12);
  for (const tool of SKILL_LIFECYCLE_TOOL_DEFINITIONS) {
    assert.equal(typeof h[tool.name], 'function', tool.name);
    assert.ok(tool.inputSchema.required.includes('actor'), `${tool.name}: the actor is required`);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.ok(tool.description.length > 80, tool.name);
    for (const required of tool.inputSchema.required) assert.ok(tool.inputSchema.properties[required], `${tool.name}.${required}`);
    const writes = WRITES.includes(tool.name);
    assert.equal(/\bWrite:/.test(tool.description), writes, `${tool.name}: only write tools say "Write:" (ask first)`);
  }
});

test('the actor must be an e-mail address and is lower-cased', () => {
  assert.equal(actorOf({ actor: '  Anna@Example.COM ' }), 'anna@example.com');
  for (const actor of [undefined, '', 'anna', 'anna@', '@x.com', 'a b@x.com', `${'a'.repeat(120)}@x.com`, 42]) {
    assert.throws(() => actorOf({ actor }), (error) => error instanceof ToolError && /e-mail/.test(error.message), String(actor));
  }
});

test('without a Supabase connection every tool says what to add', async () => {
  const h = createSkillLifecycleHandlers(null);
  await refuses(h.get_skill_status({ actor: 'anna@x.com', name: 'expense-check' }), /Supabase URL and secret key/);
  await refuses(h.list_skill_lifecycle({ actor: 'anna@x.com' }), /Supabase URL and secret key/);
});

test('check_skill_duplicates passes the draft and explains the verdict', async () => {
  const { h, calls } = setup({ verdict: 'identical', matches: [{ slug: 'expense-check' }] });
  const result = await h.check_skill_duplicates({ actor: 'Ben@x.com', description: 'Prüft Reisekosten', name: 'expense-copy', domain: 'Finanzen', tools: ['get_policy'], text: '# Skill' });
  assert.deepEqual(calls[0], { fn: 'skills_check_duplicates', body: { p_actor: 'ben@x.com', p_slug: 'expense-copy', p_description: 'Prüft Reisekosten', p_domain: 'Finanzen', p_tools: ['get_policy'], p_body: '# Skill' } });
  assert.match(result.hint, /use or extend that skill/);
  assert.equal(result.dataSource, 'supabase');
  // Only the description is required; the rest becomes null or empty.
  await h.check_skill_duplicates({ actor: 'ben@x.com', description: 'Plant ein Picknick' });
  assert.deepEqual(calls[1].body, { p_actor: 'ben@x.com', p_slug: null, p_description: 'Plant ein Picknick', p_domain: null, p_tools: [], p_body: null });
  for (const [args, pattern] of [
    [{ description: '' }, /description/], [{ description: 'x'.repeat(241) }, /description/], [{ description: 'ok', name: 'Bad Name' }, /name/],
    [{ description: 'ok', tools: 'get_policy' }, /tools/], [{ description: 'ok', tools: ['Not-A-Tool'] }, /tools/], [{ description: 'ok', text: 'x'.repeat(20001) }, /text/],
  ]) await refuses(h.check_skill_duplicates({ actor: 'ben@x.com', ...args }), pattern);
  assert.equal(calls.length, 2, 'invalid input never reaches the database');
});

test('the card: read for a level, write all fields, no credentials in the text', async () => {
  const { h, calls } = setup({ complete: true });
  await h.get_skill_card({ actor: 'anna@x.com', name: 'expense-check' });
  await h.get_skill_card({ actor: 'anna@x.com', name: 'expense-check', level: 'company' });
  assert.deepEqual(calls.map((c) => c.body.p_to), ['team', 'company']);
  await refuses(h.get_skill_card({ actor: 'anna@x.com', name: 'expense-check', level: 'lob' }), /level/);

  const card = { actor: 'anna@x.com', name: 'expense-check', use_when: 'Before payout.', inputs: 'Report', outputs: 'Findings', example_prompt: 'Prüfe diese Abrechnung.' };
  await h.set_skill_card(card);
  assert.deepEqual(calls[2], { fn: 'skills_card_set', body: { p_actor: 'anna@x.com', p_slug: 'expense-check', p_use_when: 'Before payout.', p_not_for: '', p_inputs: 'Report', p_outputs: 'Findings', p_example: 'Prüfe diese Abrechnung.' } });
  for (const field of ['use_when', 'inputs', 'outputs', 'example_prompt']) await refuses(h.set_skill_card({ ...card, [field]: '  ' }), new RegExp(field));
  await refuses(h.set_skill_card({ ...card, not_for: 'x'.repeat(301) }), /not_for/);
  await refuses(h.set_skill_card({ ...card, inputs: 'Use api_key=abcdefgh12345678 for the call' }), /credential/);
  await refuses(h.set_skill_card({ ...card, use_when: 'password: hunter2hunter2' }), /credential/);
  await refuses(h.set_skill_card({ ...card, outputs: 'token sb_secret_abc123' }), /credential/);
  assert.equal(calls.length, 3);
});

test('reads: status, overview and requests go to their functions', async () => {
  const { h, calls } = setup((fn) => (fn === 'skills_promotion_list' ? [{ id: REQUEST }] : { state: 'draft', counts: {} }));
  assert.equal((await h.get_skill_status({ actor: 'anna@x.com', name: 'expense-check' })).status.state, 'draft');
  assert.deepEqual((await h.list_skill_lifecycle({ actor: 'anna@x.com' })).counts, {});
  const requests = await h.list_skill_requests({ actor: 'anna@x.com' });
  assert.equal(requests.count, 1);
  assert.deepEqual(calls.map((c) => c.fn), ['skills_lifecycle_state', 'skills_lifecycle_overview', 'skills_promotion_list']);
  await refuses(h.get_skill_status({ actor: 'anna@x.com', name: '../etc' }), /name/);
});

test('approval flow: request, decide, withdraw', async () => {
  const { h, calls } = setup({ id: REQUEST, status: 'review' });
  const base = { actor: 'Anna@x.com', name: 'expense-check' };
  await h.request_skill_promotion({ ...base, to: 'team', group: GROUP, note: 'ready' });
  await h.request_skill_promotion({ ...base, to: 'company' });
  assert.deepEqual(calls[0].body, { p_actor: 'anna@x.com', p_slug: 'expense-check', p_to_scope: 'team', p_group: GROUP, p_note: 'ready' });
  assert.deepEqual(calls[1].body, { p_actor: 'anna@x.com', p_slug: 'expense-check', p_to_scope: 'company', p_group: null, p_note: '' }, 'a company request never carries a group');
  await refuses(h.request_skill_promotion({ ...base, to: 'team' }), /group/);
  await refuses(h.request_skill_promotion({ ...base, to: 'team', group: 'finance' }), /group/);
  await refuses(h.request_skill_promotion({ ...base, to: 'lob' }), /"team" or "company"/);

  const blocked = await setup({ id: REQUEST, status: 'blocked' }).h.request_skill_promotion({ ...base, to: 'company' });
  assert.match(blocked.hint, /get_skill_status/);
  assert.match((await h.request_skill_promotion({ ...base, to: 'company' })).hint, /list_skill_requests/);

  await h.decide_skill_request({ actor: 'lead@x.com', id: REQUEST, approve: true });
  await h.decide_skill_request({ actor: 'lead@x.com', id: REQUEST, approve: false, reason: 'Needs a clearer purpose' });
  assert.deepEqual(calls.at(-2), { fn: 'skills_promotion_decide', body: { p_actor: 'lead@x.com', p_id: REQUEST, p_approve: true, p_reason: '' } });
  assert.equal(calls.at(-1).body.p_reason, 'Needs a clearer purpose');
  await refuses(h.decide_skill_request({ actor: 'lead@x.com', id: REQUEST, approve: false }), /reason/);
  await refuses(h.decide_skill_request({ actor: 'lead@x.com', id: REQUEST, approve: 'yes' }), /true or false/);
  await refuses(h.decide_skill_request({ actor: 'lead@x.com', id: 'abc', approve: true }), /UUID/);

  await h.withdraw_skill_request({ actor: 'anna@x.com', id: REQUEST });
  assert.deepEqual(calls.at(-1), { fn: 'skills_promotion_withdraw', body: { p_actor: 'anna@x.com', p_id: REQUEST } });
});

test('deprecate, retire, restore: one database function, validated input', async () => {
  const { h, calls } = setup({ state: 'deprecated' });
  const base = { actor: 'Anna@x.com', name: 'expense-check', reason: 'Replaced by the EU rules skill' };
  await h.deprecate_skill({ ...base, sunset: '2026-12-31', replaced_by: 'expense-check-eu' });
  await h.retire_skill({ ...base });
  await h.restore_skill({ ...base });
  assert.deepEqual(calls[0], { fn: 'skills_lifecycle_change', body: { p_actor: 'anna@x.com', p_slug: 'expense-check', p_action: 'deprecate', p_reason: base.reason, p_sunset: '2026-12-31', p_replaced_by: 'expense-check-eu' } });
  assert.deepEqual([calls[1].body.p_action, calls[1].body.p_sunset, calls[1].body.p_replaced_by], ['retire', null, null]);
  assert.deepEqual([calls[2].body.p_action, calls[2].body.p_sunset], ['restore', null]);

  for (const sunset of [undefined, '', '31.12.2026', '2026-13-01', '2026-02-30', '2026-1-5', 20261231]) {
    await refuses(h.deprecate_skill({ ...base, sunset }), /sunset/);
  }
  await refuses(h.deprecate_skill({ ...base, sunset: '2026-12-31', replaced_by: 'Not A Skill' }), /replaced_by/);
  await refuses(h.retire_skill({ ...base, reason: '' }), /reason/);
  await refuses(h.retire_skill({ ...base, reason: 'x'.repeat(401) }), /reason/);
  await refuses(h.restore_skill({ actor: 'anna', name: 'expense-check', reason: 'x' }), /e-mail/);
  assert.equal(calls.length, 3, 'invalid input never reaches the database');
});

test('database rules reach the person as the rule text, other failures stay generic', async () => {
  const keep = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_key_value';
  const answer = (status, body) => { globalThis.fetch = async () => new Response(JSON.stringify(body), { status }); };
  try {
    const rpc = ticketRpc();
    answer(400, { code: 'P0001', message: 'the requester cannot decide their own request', details: null, hint: null });
    await refuses(rpc('skills_promotion_decide', {}), /^the requester cannot decide their own request$/);
    answer(400, { code: '22P02', message: 'invalid input syntax for type uuid: "secret detail"' });
    await assert.rejects(rpc('skills_promotion_decide', {}), (error) => error instanceof ToolError && /Supabase answered HTTP 400/.test(error.message) && !/secret detail/.test(error.message));
    answer(401, { code: 'P0001', message: 'looks like a rule but is not a 400' });
    await assert.rejects(rpc('x', {}), (error) => /HTTP 401/.test(error.message) && !/looks like a rule/.test(error.message));
    globalThis.fetch = async () => new Response('<html>bad gateway</html>', { status: 400 });
    await assert.rejects(rpc('x', {}), (error) => /HTTP 400/.test(error.message));
    answer(200, { ok: true });
    assert.deepEqual(await rpc('x', {}), { ok: true });
  } finally {
    globalThis.fetch = keep.fetch;
    for (const [name, value] of [['SUPABASE_URL', keep.url], ['SUPABASE_SECRET_KEY', keep.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

// ---------- the migration itself (static; test/skill-lifecycle-sql.test.mjs runs it against a real Postgres) ----------
const migration = readFileSync(join(ROOT, 'supabase/migrations/20261031_020_skill_lifecycle.sql'), 'utf8');
const sql = migration.replace(/--.*$/gm, '');

test('migration 020: every table is closed to anon and authenticated, every public function is service_role only', () => {
  for (const [, table] of sql.matchAll(/create table if not exists (skills\.\w+)/g)) {
    assert.match(sql, new RegExp(`alter table ${table.replace('.', '\\.')} enable row level security`), `${table}: row level security`);
    assert.match(sql, new RegExp(`revoke all on [^;]*${table.replace('.', '\\.')}[^;]* from anon, authenticated`), `${table}: closed to the API`);
  }
  const revoke = [...sql.matchAll(/revoke all on function ([^;]*?) from public, anon, authenticated;/gs)].map((m) => m[1]).join(',');
  const grant = [...sql.matchAll(/grant execute on function ([^;]*?) to service_role;/gs)].map((m) => m[1]).join(',');
  const publicFunctions = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(publicFunctions.length >= 10, 'found the public functions');
  for (const name of publicFunctions) {
    assert.match(revoke, new RegExp(`public\\.${name}\\(`), `${name}: revoked from public, anon, authenticated`);
    assert.match(grant, new RegExp(`public\\.${name}\\(`), `${name}: granted to service_role`);
  }
  assert.doesNotMatch(sql, /grant [^;]* to [^;]*\b(anon|authenticated)\b/i, 'nothing is granted to anon or authenticated');
  // Public functions run as the owner with an empty search path, so every reference is schema-qualified.
  const bodies = sql.split(/create or replace function /).slice(1).filter((body) => /^public\./.test(body));
  for (const body of bodies) {
    assert.match(body, /security definer/, body.slice(0, 50));
    assert.match(body, /set search_path = ''/, body.slice(0, 50));
  }
});

test('migration 020: the checks and the audit trail are wired in', () => {
  assert.match(sql, /check_id in \('secrets', 'scripts', 'permissions', 'harness', 'data', 'description', 'duplicate'\)/);
  assert.match(sql, /from skills\.registry_checks\(p_slug, p_to_scope, lower\(p_actor\)\)/, 'the promotion request runs the registry checks');
  for (const trigger of ['lifecycle_version', 'lifecycle_status', 'lifecycle_promotion']) assert.match(sql, new RegExp(`create trigger ${trigger}`));
  assert.doesNotMatch(sql, /(delete from|truncate|update) skills\.lifecycle_event/i, 'the history is append-only');
  assert.match(sql, /s\.status <> 'retired'/, 'retired skills are not synced');
});
