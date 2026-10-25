import assert from 'node:assert/strict';
import test from 'node:test';
import { canEditMemory, canWrite, createGroupClient, groupNote, groupSlug, loadIdentity, saveIdentity } from '../src/groups.ts';

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const detail = (over = {}) => ({ role: 'member', group: { id: 'g', name: 'Team A', description: '', rev: 1 }, config: { instructions: 'Answer in English.' }, members: [], spaces: [], audit: [],
  memory: [{ id: '1', kind: 'fact', text: 'Fiscal year ends in June.', createdBy: 'a@x.de', createdAt: '' }, { id: '2', kind: 'rule', text: 'Never send quotes without review.', createdBy: 'b@x.de', createdAt: '' }], ...over });

test('identity is kept as a lower-case label and rejects bad addresses', () => {
  const s = store();
  assert.equal(loadIdentity(s), null);
  saveIdentity(s, { email: ' A@X.de ', name: 'Anna' });
  assert.deepEqual(loadIdentity(s), { email: 'a@x.de', name: 'Anna' });
  saveIdentity(s, { email: 'nope', name: '' });
  assert.equal(loadIdentity(s)?.email, 'a@x.de');
  saveIdentity(s, null);
  assert.equal(loadIdentity(s), null);
});

test('the group note puts rules first, names the group and never overrides safety', () => {
  const note = groupNote(detail());
  assert.match(note, /GROUP "Team A"/);
  assert.ok(note.indexOf('Rule:') < note.indexOf('Fact:'));
  assert.match(note, /Group instructions: Answer in English\./);
  assert.match(note, /never overrides safety rules/);
  assert.equal(groupNote(null), '');
  assert.equal(groupNote(detail({ config: {}, memory: [] })), '');
  assert.ok(groupNote(detail({ memory: [{ id: '3', kind: 'fact', text: 'x'.repeat(5000), createdBy: '', createdAt: '' }] })).length < 3400);
});

test('roles decide who writes and who edits memory', () => {
  assert.ok(canWrite('admin') && canWrite('member') && !canWrite('viewer'));
  const e = detail().memory[0];
  assert.ok(canEditMemory('admin', e, 'z@x.de'));
  assert.ok(canEditMemory('member', e, 'A@x.de'));
  assert.ok(!canEditMemory('member', e, 'b@x.de'));
  assert.ok(!canEditMemory('viewer', e, 'a@x.de'));
});

test('the client names the actor on every call', async () => {
  const seen = [];
  const c = createGroupClient(async (tool, args) => { seen.push([tool, args]); return { groups: [], members: [], role: 'admin', group: {} }; }, 'a@x.de');
  await c.list(); await c.get('g1'); await c.addMemory('g1', 'rule', 't');
  assert.deepEqual(seen.map((s) => s[0]), ['group_list', 'group_get', 'group_memory_add']);
  assert.ok(seen.every((s) => s[1].actor === 'a@x.de'));
});

test('Space slugs are made valid for the group', () => {
  assert.equal(groupSlug('IT Fleet_2'), 'it-fleet_2');
  assert.equal(groupSlug('--x'), 'x');
});
