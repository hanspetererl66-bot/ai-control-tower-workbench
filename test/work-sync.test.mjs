import test from 'node:test';
import assert from 'node:assert/strict';
import * as ws from '../src/work-sync.ts';
import * as ap from '../src/agent-project.ts';
import * as dv from '../src/develop.ts';

/** A tiny stand-in for the database: items with revisions, optimistic locking, archive. */
function fakeDb() {
  const items = new Map(); let n = 0; const calls = [];
  return {
    items, calls,
    async call(tool, a) {
      calls.push(tool);
      if (tool === 'list_work_items') return [...items.values()].filter((i) => a.include_archived || !i.archived).map((i) => ({ id: i.id, kind: i.kind, name: i.name, archived: i.archived, current_rev: i.rev }));
      if (tool === 'get_work_item') { const i = items.get(a.id); return { id: i.id, files: i.files, current_rev: i.rev }; }
      if (tool === 'save_work_item') {
        if (a.id) { const i = items.get(a.id); if (a.expected_rev !== i.rev) throw new Error('The item was changed meanwhile'); Object.assign(i, { name: a.name, kind: a.kind, files: a.files, rev: i.rev + 1 }); return { id: i.id, rev: i.rev }; }
        const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; items.set(id, { id, kind: a.kind, name: a.name, files: a.files, rev: 1, archived: false }); return { id, rev: 1 };
      }
      if (tool === 'archive_work_item') { items.get(a.id).archived = a.archived; return {}; }
      throw new Error(`unexpected ${tool}`);
    },
  };
}
const agentProject = (now = 1000) => ap.setAnswers(ap.newProject('Watch renewals and tell me which are at risk', now), { name: 'Renewal watch' }, now);
const devProject = () => { const p = dv.newProject('workflow', 500); return dv.changeIntent(p, { name: 'Notice check', goal: 'Warn owners before notice periods end' }, 600); };
const empty = { agent: [], dev: [], map: {} };

test('new local projects are saved as work items, with project.json and the readable documents', async () => {
  const db = fakeDb();
  const r = await ws.syncOnce(db, { ...empty, agent: [agentProject()], dev: [devProject()] });
  assert.equal(r.pushed, 2); assert.deepEqual(r.errors, []);
  const kinds = [...db.items.values()].map((i) => i.kind).sort();
  assert.deepEqual(kinds, ['agent', 'workflow']);
  const agentItem = [...db.items.values()].find((i) => i.kind === 'agent');
  assert.ok(agentItem.files.some((f) => f.path === 'project.json'));
  assert.equal(Object.keys(r.map).length, 2);
  const again = await ws.syncOnce(db, r);
  assert.equal(again.pushed, 0, 'nothing changed, nothing is sent');
});

test('a change is saved as the next revision', async () => {
  const db = fakeDb();
  let r = await ws.syncOnce(db, { ...empty, agent: [agentProject()] });
  const changed = ap.setAnswers(r.agent[0], { owner: 'Anna Berger' }, 2000);
  r = await ws.syncOnce(db, { ...r, agent: [changed] });
  assert.equal(r.pushed, 1);
  assert.equal([...db.items.values()][0].rev, 2);
  assert.equal(r.map[ws.agentKey(changed.id)].rev, 2);
});

test('a second computer gets the projects from the database', async () => {
  const db = fakeDb();
  const a = await ws.syncOnce(db, { ...empty, agent: [agentProject()], dev: [devProject()] });
  const b = await ws.syncOnce(db, empty);
  assert.equal(b.pulled, 2);
  assert.equal(b.agent[0].id, a.agent[0].id);
  assert.equal(b.agent[0].answers.name, 'Renewal watch');
  assert.equal(b.dev[0].intent.name, 'Notice check');
  assert.equal(b.pushed, 0, 'what was just taken over is not sent back');
});

test('a newer version elsewhere replaces an unchanged local one', async () => {
  const db = fakeDb();
  const a = await ws.syncOnce(db, { ...empty, agent: [agentProject()] });
  const b = await ws.syncOnce(db, empty);
  const edited = ap.setAnswers(b.agent[0], { owner: 'Anna' }, 5000);
  await ws.syncOnce(db, { ...b, agent: [edited] });
  const a2 = await ws.syncOnce(db, a);
  assert.equal(a2.agent[0].answers.owner, 'Anna');
  assert.equal(a2.pulled, 1);
});

test('a project changed on both sides keeps a local copy, nothing is lost', async () => {
  const db = fakeDb();
  const a = await ws.syncOnce(db, { ...empty, agent: [agentProject()] });
  const b = await ws.syncOnce(db, empty);
  await ws.syncOnce(db, { ...b, agent: [ap.setAnswers(b.agent[0], { owner: 'Elsewhere' }, 5000)] });
  const local = { ...a, agent: [ap.setAnswers(a.agent[0], { owner: 'Here' }, 6000)] };
  const r = await ws.syncOnce(db, local);
  assert.equal(r.agent.length, 2);
  assert.ok(r.agent.some((p) => p.answers.owner === 'Elsewhere' && !p.answers.name.includes('copy')));
  const copy = r.agent.find((p) => p.answers.name.includes('(local copy)'));
  assert.equal(copy.answers.owner, 'Here');
  assert.deepEqual(r.errors, []);
  assert.equal(r.pushed, 1, 'the copy is saved as its own item');
});

test('deleting a project here archives the item; an unchanged project archived elsewhere disappears here', async () => {
  const db = fakeDb();
  const a = await ws.syncOnce(db, { ...empty, agent: [agentProject()], dev: [devProject()] });
  const del = await ws.syncOnce(db, { ...a, agent: [] });
  assert.equal(del.removed, 1);
  assert.equal([...db.items.values()].filter((i) => i.archived).length, 1);
  const other = await ws.syncOnce(db, { ...a, dev: [] }); // a computer that still has the agent but not the workflow
  assert.deepEqual(other.agent, [], 'the agent was archived elsewhere and is unchanged here');
});

test('errors are reported per project and do not stop the others', async () => {
  const db = fakeDb();
  const bad = { ...db, call: async (t, a) => { if (t === 'save_work_item' && a.kind === 'workflow') throw new Error('refused'); return db.call(t, a); } };
  const r = await ws.syncOnce(bad, { ...empty, agent: [agentProject()], dev: [devProject()] });
  assert.equal(r.pushed, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /Notice check: refused/);
});

test('items that are not ours are ignored; the link map survives storage', async () => {
  const db = fakeDb();
  db.items.set('11111111-1111-4111-8111-111111111111', { id: '11111111-1111-4111-8111-111111111111', kind: 'code', name: 'script', files: [], rev: 1, archived: false });
  db.items.set('22222222-2222-4222-8222-222222222222', { id: '22222222-2222-4222-8222-222222222222', kind: 'agent', name: 'other', files: [{ path: 'agent.md', content: '# x' }], rev: 1, archived: false });
  const r = await ws.syncOnce(db, empty);
  assert.equal(r.pulled, 0);
  const store = new Map();
  const s = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  ws.saveMap(s, { 'a:p-1': { itemId: 'x', rev: 3, hash: 'h' }, junk: { itemId: 1 } });
  assert.deepEqual(ws.loadMap(s), { 'a:p-1': { itemId: 'x', rev: 3, hash: 'h' } });
});

test('edits made while a round runs are not overwritten by the round', async () => {
  const db = fakeDb();
  const a = await ws.syncOnce(db, { ...empty, agent: [agentProject()] });
  const b = await ws.syncOnce(db, empty);
  await ws.syncOnce(db, { ...b, agent: [ap.setAnswers(b.agent[0], { owner: 'Elsewhere' }, 5000)] });
  const before = a; // the round starts here
  const after = await ws.syncOnce(db, before); // it takes over "Elsewhere"
  const typed = ap.setAnswers(before.agent[0], { owner: 'Typed meanwhile' }, 7000); // the person types while it ran
  const { local, deferred } = ws.applyBack({ ...before, agent: [typed] }, before, after);
  assert.equal(deferred, 1);
  assert.equal(local.agent[0].answers.owner, 'Typed meanwhile', 'the typed change stays');
  const next = await ws.syncOnce(db, local);
  assert.ok(next.agent.some((p) => p.answers.name.includes('(local copy)') && p.answers.owner === 'Typed meanwhile'), 'next round keeps it as a copy');
  assert.ok(next.agent.some((p) => p.answers.owner === 'Elsewhere'));
});

test('a round that changed nothing here applies cleanly', async () => {
  const db = fakeDb();
  const a = await ws.syncOnce(db, { ...empty, agent: [agentProject()] });
  const b = await ws.syncOnce(db, empty);
  await ws.syncOnce(db, { ...b, agent: [ap.setAnswers(b.agent[0], { owner: 'Elsewhere' }, 5000)] });
  const after = await ws.syncOnce(db, a);
  const { local, deferred } = ws.applyBack(a, a, after);
  assert.equal(deferred, 0);
  assert.equal(local.agent[0].answers.owner, 'Elsewhere');
});

test('a project with an interview stores the result as a readable file and restores the log', async () => {
  const { startInterview, logTurns } = await import('../src/interview.ts');
  let iv = logTurns(startInterview('Clerk', 'en'), [{ who: 'interviewer', text: 'What starts it?' }, { who: 'person', text: 'An e-mail', via: 'voice' }]);
  const p = dv.setInterview({ ...dv.newProject('workflow', 5), id: 'p-iv' }, iv);
  const unit = ws.developUnit(p);
  const md = unit.files.find((f) => f.path === 'process-interview.md');
  assert.ok(md && md.language === 'markdown' && /\*\*Answer \(spoken\):\*\* An e-mail/.test(md.content));
  const back = ws.restore(unit.files);
  assert.deepEqual(back.dev.interview.transcript, iv.transcript);
  assert.ok(!ws.developUnit(dv.newProject('workflow', 6)).files.some((f) => f.path === 'process-interview.md'));
});
