import assert from 'node:assert/strict';
import test from 'node:test';
import { GROUP_TOOL_DEFINITIONS, createGroupHandlers } from '../connectors/control-tower/server/groups.mjs';
import { ToolError } from '../connectors/control-tower/server/tools.mjs';

const G = '123e4567-e89b-12d3-a456-426614174000';
const calls = [];
const handlers = createGroupHandlers(async (fn, body) => { calls.push([fn, body]); return fn === 'werkbank_group_delete' ? { ok: false, error: 'forbidden', message: 'Only an admin can delete.' } : { ok: true }; });

test('every group tool has a handler and a schema', () => {
  for (const def of GROUP_TOOL_DEFINITIONS) {
    assert.equal(typeof handlers[def.name], 'function', def.name);
    assert.equal(def.inputSchema.type, 'object');
    assert.ok(def.inputSchema.required.includes('actor'));
  }
  assert.equal(GROUP_TOOL_DEFINITIONS.length, Object.keys(handlers).length);
});

test('arguments are checked and mapped to the database functions', async () => {
  await handlers.group_set_member({ actor: 'A@x.de', group: G, email: 'B@x.de', role: 'viewer' });
  assert.deepEqual(calls.at(-1), ['werkbank_group_set_member', { p_actor: 'a@x.de', p_group: G, p_email: 'b@x.de', p_role: 'viewer', p_name: '' }]);
  await assert.rejects(handlers.group_get({ actor: 'nobody', group: G }), ToolError);
  await assert.rejects(handlers.group_get({ actor: 'a@x.de', group: 'x' }), ToolError);
  await assert.rejects(handlers.group_get_space({ actor: 'a@x.de', group: G, slug: '../x' }), ToolError);
});

test('rule violations from the database become tool errors', async () => {
  await assert.rejects(handlers.group_delete({ actor: 'a@x.de', group: G }), /Only an admin/);
});

test('secrets in the configuration and oversized packages are refused before any call', async () => {
  const n = calls.length;
  await assert.rejects(handlers.group_save_config({ actor: 'a@x.de', group: G, config: { prompts: { apiKey: 'x' } } }), /looks like a secret/);
  await assert.rejects(handlers.group_publish_space({ actor: 'a@x.de', group: G, slug: 's', title: 'T', package: 'x'.repeat(5 * 1024 * 1024 + 1) }), /5 MB/);
  assert.equal(calls.length, n);
});

test('without Supabase the tools say what is missing', async () => {
  await assert.rejects(createGroupHandlers(null).group_list({ actor: 'a@x.de' }), /Supabase/);
});
