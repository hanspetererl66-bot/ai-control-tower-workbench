import assert from 'node:assert/strict';
import test from 'node:test';
import { PREFERENCE_TOOL_DEFINITIONS, createPreferenceHandlers, findSecretName } from '../connectors/control-tower/server/preferences.mjs';

test('two tools, one read one write', () => {
  assert.deepEqual(PREFERENCE_TOOL_DEFINITIONS.map((t) => t.name), ['get_preferences', 'save_preferences']);
});

test('save passes key and data to the RPC; get returns null when empty', async () => {
  const calls = [];
  const h = createPreferenceHandlers(async (fn, args) => (calls.push([fn, args]), fn === 'werkbank_get_preferences' ? null : { updatedAt: 't' }));
  assert.deepEqual((await h.get_preferences({})).data, null);
  const out = await h.save_preferences({ key: 'work', data: { accent: '#fff' } });
  assert.equal(out.saved, true);
  assert.deepEqual(calls[1], ['werkbank_save_preferences', { p_key: 'work', p_data: { accent: '#fff' } }]);
});

test('refuses secrets, bad keys, big and non-object data', async () => {
  const h = createPreferenceHandlers(async () => ({}));
  await assert.rejects(h.save_preferences({ data: { nested: { apiKey: 'x' } } }), /looks like a secret/);
  await assert.rejects(h.save_preferences({ key: 'Bad Key', data: {} }));
  await assert.rejects(h.save_preferences({ data: [] }));
  await assert.rejects(h.save_preferences({ data: { a: 'x'.repeat(70000) } }), /64 KB/);
  assert.equal(findSecretName({ a: [{ token: 1 }] }), 'a[0].token');
});

test('without Supabase the tools say what is missing', async () => {
  const h = createPreferenceHandlers(null);
  await assert.rejects(h.get_preferences({}), /Supabase/);
});
