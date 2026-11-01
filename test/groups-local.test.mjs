import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalGroupCall, simulateColleague, DEMO_COLLEAGUES } from '../src/groups-local.ts';
import { createGroupClient, groupNote } from '../src/groups.ts';

const mem = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
const me = 'hans@example.com';

test('a first look creates the sample group with the person as admin', async () => {
  const c = createGroupClient(createLocalGroupCall(mem()), me);
  const list = await c.list();
  assert.equal(list.length, 1); assert.equal(list[0].role, 'admin'); assert.equal(list[0].members, 3);
  const d = await c.get(list[0].id);
  assert.ok(groupNote(d).includes('Quotes above 50k'));
});

test('roles are enforced: a viewer cannot add memory, a member cannot manage members', async () => {
  const store = mem();
  const admin = createGroupClient(createLocalGroupCall(store), me);
  const id = (await admin.list())[0].id;
  const viewer = createGroupClient(createLocalGroupCall(store), DEMO_COLLEAGUES[1].email);
  await assert.rejects(() => viewer.addMemory(id, 'rule', 'x'), /needs the role/);
  const anna = createGroupClient(createLocalGroupCall(store), DEMO_COLLEAGUES[0].email);
  await anna.addMemory(id, 'fact', 'Anna was here');
  await assert.rejects(() => anna.setMember(id, 'new@example.com', 'member'), /admin/);
  await assert.rejects(() => anna.deleteMemory(id, 'm2'), /author or an admin/);
  await admin.deleteMemory(id, 'm2');
});

test('the last admin cannot leave; groups can be created and deleted', async () => {
  const c = createGroupClient(createLocalGroupCall(mem()), me);
  const id = (await c.list())[0].id;
  await assert.rejects(() => c.removeMember(id, me), /last admin/);
  await c.create('Team B', '', 'Hans');
  assert.equal((await c.list()).length, 2);
  await c.remove(id);
  assert.equal((await c.list()).length, 1);
});

test('publishing a Space versions it; the simulated colleague adds a rule', async () => {
  const store = mem();
  const c = createGroupClient(createLocalGroupCall(store), me);
  const id = (await c.list())[0].id;
  await c.publishSpace(id, 'renewals', 'Renewals', '{"a":1}');
  await c.publishSpace(id, 'renewals', 'Renewals', '{"a":2}');
  assert.equal((await c.get(id)).spaces[0].version, 2);
  assert.equal((await c.getSpace(id, 'renewals')).package, '{"a":2}');
  const before = (await c.get(id)).memory.length;
  assert.ok(simulateColleague(store, id));
  assert.equal((await c.get(id)).memory.length, before + 1);
});
