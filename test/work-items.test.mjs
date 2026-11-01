import assert from 'node:assert/strict';
import test from 'node:test';
import { WORK_ITEM_TOOL_DEFINITIONS, checkFiles, createWorkItemHandlers } from '../connectors/_lib/server/work-items.mjs';
import { SKILL_FILE_TOOL_DEFINITIONS, createSkillFileHandlers } from '../connectors/_lib/server/skill-files.mjs';
import { ToolError } from '../connectors/_lib/server/tools.mjs';

const ID = '11111111-2222-3333-4444-555555555555';
const GROUP = '00000000-0000-0000-0000-0000000000f1';
const FILES = [{ path: 'agent.md', content: '# Agent', language: 'markdown' }, { path: 'src/main.py', content: 'print(1)' }];
const setup = () => {
  const calls = [];
  const rpc = async (fn, body) => { calls.push({ fn, body }); return { ok: true }; };
  return { calls, w: createWorkItemHandlers(rpc), s: createSkillFileHandlers(rpc) };
};
const refuses = (promise, pattern) => assert.rejects(promise, (error) => error instanceof ToolError && pattern.test(error.message));

test('every tool has a schema, names the actor and has a handler', () => {
  const { w, s } = setup();
  for (const [defs, handlers] of [[WORK_ITEM_TOOL_DEFINITIONS, w], [SKILL_FILE_TOOL_DEFINITIONS, s]]) {
    for (const tool of defs) {
      assert.equal(typeof handlers[tool.name], 'function', tool.name);
      assert.ok(tool.inputSchema.required.includes('actor'), tool.name);
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
      for (const required of tool.inputSchema.required) assert.ok(tool.inputSchema.properties[required], `${tool.name}.${required}`);
    }
  }
  assert.equal(WORK_ITEM_TOOL_DEFINITIONS.length, 5);
  assert.equal(SKILL_FILE_TOOL_DEFINITIONS.length, 4);
});

test('save_work_item sends the whole snapshot with the actor in lower case', async () => {
  const { calls, w } = setup();
  await w.save_work_item({ actor: 'Anna@X.com', kind: 'workflow', name: ' Renewals ', files: FILES, note: 'first' });
  const { fn, body } = calls[0];
  assert.equal(fn, 'work_save');
  assert.deepEqual([body.p_actor, body.p_id, body.p_kind, body.p_name, body.p_visibility, body.p_team, body.p_expected_rev], ['anna@x.com', null, 'workflow', 'Renewals', 'private', null, null]);
  assert.equal(body.p_files.length, 2);
  assert.equal(body.p_files[1].path, 'src/main.py');
});

test('changing an item passes the revision that was loaded', async () => {
  const { calls, w } = setup();
  await w.save_work_item({ actor: 'a@x.com', id: ID, kind: 'agent', name: 'A', files: FILES, expected_rev: 3, visibility: 'team', team_id: GROUP });
  assert.equal(calls[0].body.p_expected_rev, 3);
  assert.equal(calls[0].body.p_team, GROUP);
});

test('bad input is refused before the database is called', async () => {
  const { calls, w } = setup();
  const ok = { actor: 'a@x.com', kind: 'code', name: 'N', files: FILES };
  await refuses(w.save_work_item({ ...ok, actor: 'nobody' }), /e-mail/);
  await refuses(w.save_work_item({ ...ok, kind: 'macro' }), /kind/);
  await refuses(w.save_work_item({ ...ok, name: ' ' }), /name/);
  await refuses(w.save_work_item({ ...ok, visibility: 'team' }), /team_id/);
  await refuses(w.save_work_item({ ...ok, id: 'abc' }), /UUID/);
  await refuses(w.save_work_item({ ...ok, files: [] }), /non-empty/);
  await refuses(w.get_work_item({ actor: 'a@x.com', id: 'x' }), /UUID/);
  await refuses(w.archive_work_item({ actor: 'a@x.com', id: ID }), /true or false/);
  assert.equal(calls.length, 0);
});

test('files: paths, duplicates, size and credentials are checked with the file name', () => {
  assert.throws(() => checkFiles([{ path: '../etc/passwd', content: 'x' }]), /invalid file path/);
  assert.throws(() => checkFiles([{ path: '/abs', content: 'x' }]), /invalid file path/);
  assert.throws(() => checkFiles([{ path: 'a.py', content: 'x' }, { path: 'a.py', content: 'y' }]), /twice/);
  assert.throws(() => checkFiles([{ path: 'big.txt', content: 'x'.repeat(1_000_001) }]), /larger than/);
  assert.throws(() => checkFiles([{ path: 'run.py', content: 'API_KEY = "abcd1234efgh5678"' }]), /run\.py.*credential/);
  assert.throws(() => checkFiles([{ path: 'k.pem', content: '-----BEGIN RSA PRIVATE KEY-----' }]), /credential/);
  assert.equal(checkFiles([{ path: 'dir/ok file.md', content: 'The word token alone is fine.' }]).length, 1);
});

test('skill files: SKILL.md is not an extra file, reading needs a path', async () => {
  const { calls, s } = setup();
  await refuses(s.set_skill_file({ actor: 'a@x.com', name: 'expense-check', path: 'SKILL.md', content: 'x' }), /SKILL\.md/);
  await refuses(s.set_skill_file({ actor: 'a@x.com', name: 'Bad Name', path: 'a.py', content: 'x' }), /skill name/);
  await s.set_skill_file({ actor: 'a@x.com', name: 'expense-check', path: 'scripts/check.py', content: 'print(1)', language: 'python' });
  await s.list_skill_files({ actor: 'a@x.com', name: 'expense-check' });
  assert.deepEqual(calls.map((c) => c.fn), ['skills_file_set', 'skills_files']);
  assert.equal(calls[1].body.p_path, null);
});

test('without a database the tools say what is missing', async () => {
  const w = createWorkItemHandlers(null);
  await refuses(w.list_work_items({ actor: 'a@x.com' }), /not set up/);
});
