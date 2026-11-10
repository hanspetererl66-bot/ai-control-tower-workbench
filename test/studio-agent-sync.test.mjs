import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAgentLevels, applyBackAgents, levelFromVisibility, restoreStudio, studioUnit, syncStudioAgents } from '../src/studio-agent-sync.ts';
import { syncOnce } from '../src/work-sync.ts';
import { defaultGov, levelOf } from '../src/skill-governance.ts';
import { newAgent } from '../src/agent-studio.ts';

/** In-memory work items. Like work_save: an update without a visibility resets it to private (the connector's default). */
function fakeDb() {
  const items = new Map();
  let n = 0;
  const calls = [];
  const api = {
    calls, items,
    async call(tool, args) {
      calls.push({ tool, args });
      if (tool === 'list_work_items') return [...items.values()].filter((i) => args.include_archived || !i.archived).map(({ files, intent, ...row }) => ({ ...row, files: files.length }));
      if (tool === 'get_work_item') { const i = items.get(args.id); if (!i) throw new Error('not visible'); return { ...i }; }
      if (tool === 'archive_work_item') { items.get(args.id).archived = args.archived; return {}; }
      if (tool === 'save_work_item') {
        let i = args.id ? items.get(args.id) : null;
        if (i && args.expected_rev !== i.current_rev) throw new Error('The item was changed meanwhile');
        if (!i) { i = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, current_rev: 0, archived: false, owner: 'a@b.de' }; items.set(i.id, i); }
        Object.assign(i, { kind: args.kind, name: args.name, stage: args.stage ?? '', intent: args.intent ?? {}, files: args.files, visibility: args.visibility ?? 'private', team_id: args.team_id ?? null, current_rev: i.current_rev + 1 });
        return { id: i.id, rev: i.current_rev };
      }
      throw new Error(`unexpected ${tool}`);
    },
  };
  return api;
}
const agent = (name = 'Renewal watcher', now = 1000) => ({ ...newAgent(null, [], now), name, instruction: 'Watch the renewals and tell me which ones are red.', sources: ['conn:sub4me'] });

test('a new studio agent is pushed as a private work item with the whole agent in studio-agent.json', async () => {
  const db = fakeDb();
  const a = agent();
  const r = await syncStudioAgents(db, { agents: [a], map: {} });
  assert.equal(r.pushed, 1);
  const item = [...db.items.values()][0];
  assert.equal(item.kind, 'agent'); assert.equal(item.stage, 'studio-agent'); assert.equal(item.visibility, 'private');
  assert.deepEqual(restoreStudio(item.files), a, 'the stored agent is the whole agent');
  assert.ok(item.files.some((f) => f.path === 'agent.md'));
  assert.equal(r.levels[a.id], 0);
  const again = await syncStudioAgents(db, { agents: r.agents, map: r.map });
  assert.equal(again.pushed, 0, 'unchanged agents are not saved again');
});

test('a push keeps the visibility the database has (work_save would reset it to private)', async () => {
  const db = fakeDb();
  const a = agent();
  const r1 = await syncStudioAgents(db, { agents: [a], map: {} });
  const item = [...db.items.values()][0];
  item.visibility = 'company'; // somebody with the right (the later promotion) published it
  const edited = { ...a, instruction: 'Watch the renewals and also the contracts that end soon.' };
  const r2 = await syncStudioAgents(db, { agents: [edited], map: r1.map });
  assert.equal(r2.pushed, 1);
  assert.equal(item.visibility, 'company', 'still company after the push');
  assert.equal(r2.levels[a.id], 2);
});

test('levels: first sight keeps a local level, a later database change wins, a pulled agent takes the database level', async () => {
  assert.deepEqual([levelFromVisibility('private'), levelFromVisibility('team'), levelFromVisibility('company'), levelFromVisibility('x')], [0, 1, 2, 0]);
  const key = 's:a-1';
  const map = { [key]: { itemId: 'i1', rev: 1, hash: 'h' } };
  const gov = { ...defaultGov(), skills: { 'a-1': 1 } }; // published locally in the old simulation
  const first = applyAgentLevels(gov, { 'a-1': 0 }, map);
  assert.equal(levelOf(first.gov, 'a-1'), 1, 'not demoted on first sight');
  assert.equal(first.map[key].lvl, 0, 'the database level is remembered');
  const same = applyAgentLevels(first.gov, { 'a-1': 0 }, first.map);
  assert.equal(levelOf(same.gov, 'a-1'), 1, 'database unchanged: local stays');
  const moved = applyAgentLevels(same.gov, { 'a-1': 2 }, same.map);
  assert.equal(levelOf(moved.gov, 'a-1'), 2, 'database changed: it wins');
  assert.deepEqual(moved.changed, ['a-1']);
  const back = applyAgentLevels(moved.gov, { 'a-1': 0 }, moved.map);
  assert.equal(levelOf(back.gov, 'a-1'), 0, 'and it can lower the level');
  const pulled = applyAgentLevels(defaultGov(), { 'a-9': 1 }, { 's:a-9': { itemId: 'i9', rev: 1, hash: 'h' } });
  assert.equal(levelOf(pulled.gov, 'a-9'), 1, 'an agent that arrives from another computer takes the database level');
  assert.equal(applyAgentLevels(gov, {}, map).gov, gov, 'no levels: nothing changes');
});

test('an agent from another computer arrives, and a change on both sides keeps a local copy', async () => {
  const db = fakeDb();
  const a = agent('Shared helper');
  const r1 = await syncStudioAgents(db, { agents: [a], map: {} });
  // second computer: empty
  const other = await syncStudioAgents(db, { agents: [], map: {} });
  assert.equal(other.pulled, 1); assert.deepEqual(other.agents, [a]);
  // both change
  const theirs = { ...other.agents[0], purpose: 'changed on computer two' };
  const push2 = await syncStudioAgents(db, { agents: [theirs], map: other.map });
  assert.equal(push2.pushed, 1);
  const mine = { ...a, purpose: 'changed on computer one' };
  const r2 = await syncStudioAgents(db, { agents: [mine], map: r1.map });
  assert.equal(r2.agents.length, 2);
  assert.ok(r2.agents.some((x) => x.name.endsWith('(local copy)') && x.purpose === 'changed on computer one'));
  assert.ok(r2.agents.some((x) => x.id === a.id && x.purpose === 'changed on computer two'));
});

test('deleting an agent here archives the item; an item archived elsewhere removes an unchanged agent here', async () => {
  const db = fakeDb();
  const a = agent('One'), b = agent('Two', 2000);
  const r1 = await syncStudioAgents(db, { agents: [a, b], map: {} });
  assert.equal(r1.pushed, 2);
  const r2 = await syncStudioAgents(db, { agents: [b], map: r1.map });
  assert.equal(r2.removed, 1);
  assert.equal([...db.items.values()].filter((i) => i.archived).length, 1);
  [...db.items.values()].find((i) => i.name === 'Two').archived = true;
  const r3 = await syncStudioAgents(db, { agents: r2.agents, map: r2.map });
  assert.equal(r3.agents.length, 0);
  assert.equal(Object.keys(r3.map).length, 0);
});

test('the project sync leaves studio agents alone', async () => {
  const db = fakeDb();
  await syncStudioAgents(db, { agents: [agent()], map: {} });
  db.calls.length = 0;
  const r = await syncOnce(db, { agent: [], dev: [], map: {} });
  assert.equal(r.pulled, 0);
  assert.equal(db.calls.filter((c) => c.tool === 'get_work_item').length, 0, 'no fetch of studio-agent items');
});

test('the result of a round is applied only to agents that were not edited meanwhile', () => {
  const a = agent('Same'), b = agent('Other', 2000);
  const before = { agents: [a, b], map: {} };
  const after = { agents: [{ ...a, purpose: 'from the database' }, b], map: { 's:x': { itemId: 'i', rev: 2, hash: 'h' } }, levels: {}, pushed: 0, pulled: 1, removed: 0, errors: [] };
  const untouched = applyBackAgents({ agents: [a, b], map: {} }, before, after);
  assert.equal(untouched.local.agents[0].purpose, 'from the database');
  assert.equal(untouched.deferred, 0);
  const edited = { ...a, instruction: 'I edited this while the round was running.' };
  const deferred = applyBackAgents({ agents: [edited, b], map: {} }, before, after);
  assert.equal(deferred.local.agents[0].instruction, edited.instruction, 'my edit stays');
  assert.equal(deferred.deferred, 1);
});

test('the unit has a stable hash and no secrets of the machine', () => {
  const a = agent();
  assert.equal(studioUnit(a).hash, studioUnit({ ...a }).hash);
  assert.notEqual(studioUnit(a).hash, studioUnit({ ...a, purpose: 'x' }).hash);
});
