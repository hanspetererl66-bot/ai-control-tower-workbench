import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BUILTIN_HARNESSES, chooseHarness, copyHarness, sanitizeHarnessState } from '../src/harness.ts';
import {
  MAX_GROUP_HARNESSES, copyGroupHarness, groupChoices, groupProfileMissing, harnessChoices, publishGroupHarness, resolveHarness, sanitizeGroupHarnesses, unpublishGroupHarness,
} from '../src/harness-share.ts';
import { checkToolCall } from '../src/harness.ts';
import { createLocalGroupCall } from '../src/groups-local.ts';
import { createGroupClient } from '../src/groups.ts';

const read = (rel) => readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');
const review = BUILTIN_HARNESSES.find((p) => p.id === 'review');
const own = () => copyHarness(sanitizeHarnessState({}), 'review', 'Controlling review').custom[0];
const T0 = new Date('2026-10-31T10:00:00Z');

test('publishing adds a profile, a second publish of the same id raises the version, and the sender\'s origin is not stored', () => {
  let list = publishGroupHarness([], { ...own(), origin: 'Imported file' }, 'Admin@Example.com', T0);
  assert.equal(list.length, 1);
  assert.equal(list[0].version, 1);
  assert.equal(list[0].publishedBy, 'admin@example.com');
  assert.equal(list[0].publishedAt, T0.toISOString());
  assert.equal('origin' in list[0], false);
  list = publishGroupHarness(list, { ...own(), maxSteps: 3 }, 'admin@example.com', new Date('2026-11-02T08:00:00Z'));
  assert.equal(list.length, 1, 'same id: replaced, not duplicated');
  assert.equal(list[0].version, 2);
  assert.equal(list[0].maxSteps, 3);
  assert.deepEqual(unpublishGroupHarness(list, list[0].id), []);
});

test('an invalid profile cannot be published and the group is limited to ten profiles', () => {
  assert.deepEqual(publishGroupHarness([], { id: 'Bad Id', name: 'x' }, 'a@b.de'), []);
  let list = [];
  for (let i = 0; i < MAX_GROUP_HARNESSES + 3; i += 1) list = publishGroupHarness(list, { ...review, id: `p${i}`, name: `P${i}` }, 'a@b.de');
  assert.equal(list.length, MAX_GROUP_HARNESSES);
  assert.equal(publishGroupHarness(list, { ...review, id: 'p0', name: 'P0' }, 'a@b.de').find((p) => p.id === 'p0').version, 2, 'a published profile can still get a new version');
});

test('what the server returns is sanitized: bad entries, duplicates, bad versions, bad addresses', () => {
  const out = sanitizeGroupHarnesses([
    { ...review, id: 'ok', name: 'OK', version: 3.4, publishedBy: 'Anna@Example.com', publishedAt: '2026-10-31T10:00:00Z' },
    { ...review, id: 'ok', name: 'Duplicate' },
    { id: 'bad id', name: 'Broken' },
    { ...review, id: 'weird', name: 'Weird', version: -5, publishedBy: 'not an address', publishedAt: 'yesterday', permission: 'root' },
    null, 'x', 5,
  ]);
  assert.deepEqual(out.map((p) => p.id), ['ok', 'weird']);
  assert.equal(out[0].version, 3);
  assert.equal(out[0].publishedBy, 'anna@example.com');
  assert.equal(out[1].version, 1);
  assert.equal(out[1].publishedBy, '');
  assert.equal(out[1].publishedAt, '');
  assert.equal(out[1].permission, 'standard');
  assert.deepEqual(sanitizeGroupHarnesses(undefined), []);
  assert.deepEqual(sanitizeGroupHarnesses({ not: 'a list' }), []);
});

test('group profiles are offered with their own ids, apart from the person\'s own and the ready-made ones', () => {
  const list = publishGroupHarness([], own(), 'a@b.de', T0);
  const state = sanitizeHarnessState({});
  const choices = harnessChoices(state, list, 'Sales EMEA');
  assert.deepEqual(choices.slice(0, BUILTIN_HARNESSES.length).map((p) => p.id), BUILTIN_HARNESSES.map((p) => p.id));
  const g = choices.at(-1);
  assert.equal(g.id, 'group:controlling-review');
  assert.match(g.origin, /Group "Sales EMEA" · version 1/);
  assert.ok(!state.custom.some((p) => p.id === 'controlling-review'), 'nothing is added to the person\'s own profiles');
});

test('choosing a group profile works only while the group offers it, and the rules then come from the group', () => {
  const list = publishGroupHarness([], { ...own(), permission: 'read-only', connectors: ['ai-control-tower'] }, 'a@b.de', T0);
  const ids = groupChoices(list, 'G').map((p) => p.id);
  let state = sanitizeHarnessState({});
  assert.equal(chooseHarness(state, 'group:controlling-review'), state, 'unknown without the group');
  state = chooseHarness(state, 'group:controlling-review', ids);
  assert.equal(state.active, 'group:controlling-review');
  assert.equal(sanitizeHarnessState(state).active, 'group:controlling-review', 'the choice survives saving and loading');
  const profile = resolveHarness(state, list, 'G');
  assert.equal(profile.permission, 'read-only');
  assert.equal(checkToolCall(profile, { toolName: 'ai-control-tower__create_ticket' }).ok, false, 'the group rules are enforced like any others');
  assert.equal(checkToolCall(profile, { toolName: 'gmail__search' }).ok, false);
});

test('a group profile that is gone gives the standard rules and says so', () => {
  const list = publishGroupHarness([], own(), 'a@b.de', T0);
  const state = chooseHarness(sanitizeHarnessState({}), 'group:controlling-review', ['group:controlling-review']);
  assert.equal(groupProfileMissing(state, list), false);
  assert.equal(groupProfileMissing(state, []), true, 'withdrawn or group not loaded');
  assert.equal(resolveHarness(state, [], '').id, 'standard');
  assert.equal(groupProfileMissing(sanitizeHarnessState({ active: 'sales' }), []), false);
  assert.equal(sanitizeHarnessState({ active: 'group:../etc' }).active, 'standard', 'only well-formed group ids are kept');
});

test('a member copies a group profile into their own profiles; the copy can be changed and records its source', () => {
  const list = publishGroupHarness([], own(), 'a@b.de', T0);
  const state = copyGroupHarness(sanitizeHarnessState({}), list[0], 'Sales EMEA');
  assert.equal(state.custom.length, 1);
  assert.equal(state.custom[0].origin, 'Group "Sales EMEA" · version 1');
  assert.equal('version' in state.custom[0], false);
  assert.equal('publishedBy' in state.custom[0], false);
  assert.equal(state.active, 'standard', 'copying does not switch the profile');
});

test('the group configuration carries the profiles through the local group backend, only for admins, and keeps the instructions', async () => {
  const store = (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; })();
  const call = createLocalGroupCall(store, () => T0);
  const admin = createGroupClient(call, 'me@example.com');
  const g = (await admin.list())[0];
  const detail = await admin.get(g.id);
  const list = publishGroupHarness([], own(), 'me@example.com', T0);
  await admin.saveConfig(g.id, { ...detail.config, harnesses: list });
  const after = await admin.get(g.id);
  assert.equal(after.config.instructions, detail.config.instructions);
  assert.deepEqual(sanitizeGroupHarnesses(after.config.harnesses).map((p) => p.id), ['controlling-review']);
  await admin.saveConfig(g.id, { ...after.config, instructions: 'Short.' });
  assert.equal(sanitizeGroupHarnesses((await admin.get(g.id)).config.harnesses).length, 1, 'saving only the instructions keeps the profiles');
  await admin.saveConfig(g.id, { ...after.config, harnesses: [{ id: 'bad id', name: 'x' }, { ...review, permission: 'root' }] });
  assert.equal(sanitizeGroupHarnesses((await admin.get(g.id)).config.harnesses).length, 1, 'junk is dropped on the way in');
  const member = createGroupClient(call, 'anna.schmidt@example.com');
  await assert.rejects(() => member.saveConfig(g.id, { harnesses: [] }), /admin/i);
});

test('the app and the group panel use the group profiles', () => {
  const app = read('src/App.tsx');
  assert.match(app, /sanitizeGroupHarnesses\(activeGroup\?\.config\.harnesses\)/);
  assert.match(app, /resolveHarness\(prefs\.harness, groupHarnesses, groupName\)/);
  assert.match(app, /harnessChoices\(prefs\.harness, groupHarnesses, groupName\)/);
  assert.match(app, /chooseHarness\(current\.harness, id, groupChoices\(groupHarnesses, groupName\)/);
  assert.match(app, /groupProfileMissing\(prefs\.harness, groupHarnesses\)/);
  assert.match(app, /onCopyHarness:/);
  const panel = read('src/ui/GroupsPanel.tsx');
  assert.match(panel, /title="Working profiles"/);
  assert.match(panel, /\{ \.\.\.detail\.config, harnesses: next \}/, 'saving profiles keeps the rest of the configuration');
  assert.match(panel, /\{admin && <button[\s\S]{0,160}Withdraw<\/button>\}/, 'only admins can withdraw');
  assert.match(panel, /aria-label="Own profile to publish"/);
  assert.match(panel, /Copy to my profiles/);
});
