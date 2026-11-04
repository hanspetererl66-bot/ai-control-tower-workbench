import assert from 'node:assert/strict';
import test from 'node:test';
import { extensionNote, extensionText, handover, localTarget, mergeRefs, newExtension, parseClusters, sanitizeExtensions } from '../src/requirements.ts';
import * as dv from '../src/develop.ts';
import * as ap from '../src/agent-project.ts';
import * as ws from '../src/work-sync.ts';

const R = (key, title) => ({ id: `jira:${key}`, source: 'jira', key, title, text: `${title} text`, url: `https://j/${key}`, author: '', date: '' });
const reqs = [R('A-1', 'Weekly renewal report'), R('A-2', 'Remind owners')];
const reg = [{ id: 'w1', kind: 'workflow', name: 'Contract upload' }, { id: 'a1', kind: 'agent', name: 'Renewal watcher' }];
const cluster = (cls, target) => ({ id: 'c1', title: 'Renewal reminders', summary: 'Remind owners every Monday.', cls, confidence: 0.8, reason: 'Fits.', reqIds: ['jira:A-1', 'jira:A-2'], suggestions: [], ...(target ? { target } : {}) });
const ext = (now = 5000) => newExtension(handover(cluster('agent-extension', { id: 'a1', name: 'Renewal watcher', kind: 'agent' }), reqs), now);

test('an extension keeps title, summary, sources and requirement lines; text and note are short', () => {
  const e = ext();
  assert.equal(e.title, 'Renewal reminders'); assert.equal(e.summary, 'Remind owners every Monday.');
  assert.deepEqual(e.refs.map((r) => r.key), ['A-1', 'A-2']);
  assert.match(e.lines, /\*\*A-1\*\* \(jira\) Weekly renewal report/);
  assert.match(extensionText([e]), /^Extension 1: Renewal reminders \(1970-01-01\)\nRemind owners every Monday\./);
  assert.equal(extensionNote(e), 'Extended: Renewal reminders (A-1, A-2)');
  assert.ok(extensionNote({ ...e, refs: Array.from({ length: 9 }, (_, i) => ({ ...e.refs[0], key: `K-${i}` })) }).endsWith(', …)'));
});

test('sanitizeExtensions drops junk and caps the list; mergeRefs removes duplicates', () => {
  assert.deepEqual(sanitizeExtensions('x'), []);
  assert.deepEqual(sanitizeExtensions([{ title: '' }, null, 5]), []);
  assert.equal(sanitizeExtensions(Array.from({ length: 30 }, (_, i) => ({ title: `t${i}` }))).length, 20);
  const e = ext();
  assert.deepEqual(sanitizeExtensions([e]), [e]);
  assert.deepEqual(mergeRefs([e.refs[0]], e.refs).map((r) => r.key), ['A-1', 'A-2']);
  assert.deepEqual(mergeRefs(undefined, []), []);
});

test('localTarget finds the project of a registry item, or null', () => {
  const map = { 'a:p-1': { itemId: 'i-a' }, 'd:p9': { itemId: 'i-d' } };
  assert.deepEqual(localTarget(map, 'i-a'), { kind: 'agent', id: 'p-1' });
  assert.deepEqual(localTarget(map, 'i-d'), { kind: 'dev', id: 'p9' });
  assert.equal(localTarget(map, 'other'), null);
});

test('workflow: the extension goes into the intent, approvals are taken back, sources are added, nothing else is lost', () => {
  let p = dv.changeIntent(dv.newProject('workflow', 100), { name: 'Contract upload', goal: 'Upload contracts and warn owners', systems: ['Icertis'], data: 'PDF in, record out', success: 'No manual upload' }, 200);
  p = { ...p, stage: 'build', approved: ['intent', 'requirements', 'specification'], docs: { prd: 'PRD', spec: 'SPEC', build: '' }, sources: [{ source: 'jira', key: 'A-0', title: 'Old', url: '' }] };
  const next = dv.extendProject(p, ext(), 300);
  assert.deepEqual(next.approved, []); assert.equal(next.stage, 'intent');
  assert.equal(next.docs.prd, 'PRD', 'the documents stay as text');
  assert.equal(next.intent.name, 'Contract upload'); assert.equal(next.intent.goal, p.intent.goal);
  assert.match(next.intent.extension, /Extension 1: Renewal reminders/);
  assert.deepEqual(next.sources.map((r) => r.key), ['A-0', 'A-1', 'A-2']);
  assert.match(dv.intentBlock('workflow', next.intent), /Requirements added later to this existing workflow/);
  assert.doesNotMatch(dv.intentBlock('workflow', p.intent), /added later/);
  const second = dv.extendProject(next, { ...ext(), title: 'Second one' }, 400);
  assert.equal(second.extensions.length, 2); assert.match(second.intent.extension, /Extension 2: Second one/);
  assert.deepEqual(dv.sanitizeProject(JSON.parse(JSON.stringify(second))).extensions, second.extensions, 'survives storage');
});

test('agent: confirmed steps are reopened, the PRD gets an Extensions section when the questions are confirmed again', () => {
  const catalog = [];
  let p = ap.setAnswers(ap.newProject('Watch renewals and tell me which are at risk', 100), { name: 'Renewal watcher', users: 'Account managers', success: 'Every red renewal has a reason', otherSystems: 'Salesforce' }, 100);
  p = ap.confirmQuestions(p, catalog, 200);
  assert.ok(p.confirmed.questions); assert.doesNotMatch(p.docs.prd, /Extensions/);
  const next = ap.extendProject(p, ext(), 300);
  assert.deepEqual(next.confirmed, {}); assert.deepEqual(next.stale, ['prd']);
  assert.equal(next.extensions.length, 1); assert.deepEqual(next.sources.map((r) => r.key), ['A-1', 'A-2']);
  const again = ap.confirmQuestions(next, catalog, 400);
  assert.match(again.docs.prd, /## 9\. Extensions[\s\S]*Extension 1: Renewal reminders[\s\S]*## 10\. Approval/);
  assert.deepEqual(ap.sanitizeProjects(JSON.parse(JSON.stringify([again])))[0].extensions, again.extensions);
});

/** The same stand-in database as in work-sync.test.mjs, but it keeps the note of every revision. */
function fakeDb() {
  const items = new Map(); const saves = []; let n = 0;
  return {
    items, saves,
    async call(tool, a) {
      if (tool === 'list_work_items') return [...items.values()].map((i) => ({ id: i.id, kind: i.kind, name: i.name, archived: false, current_rev: i.rev }));
      if (tool === 'get_work_item') { const i = items.get(a.id); return { id: i.id, files: i.files, current_rev: i.rev }; }
      if (tool === 'save_work_item') {
        saves.push(a);
        if (a.id) { const i = items.get(a.id); if (a.expected_rev !== i.rev) throw new Error('changed meanwhile'); Object.assign(i, { name: a.name, files: a.files, rev: i.rev + 1 }); return { id: i.id, rev: i.rev }; }
        const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; items.set(id, { id, kind: a.kind, name: a.name, files: a.files, rev: 1 }); return { id, rev: 1 };
      }
      throw new Error(`unexpected ${tool}`);
    },
  };
}

test('sync: an extension is the next revision of the SAME item, with a note that names it; an ordinary edit keeps the usual note', async () => {
  const db = fakeDb();
  const p = ap.confirmQuestions(ap.setAnswers(ap.newProject('Watch renewals and tell me which are at risk', 100), { name: 'Renewal watcher', users: 'AMs', success: 'Reasons given', otherSystems: 'Salesforce' }, 100), [], 200);
  let r = await ws.syncOnce(db, { agent: [p], dev: [], map: {} });
  assert.equal(db.items.size, 1); assert.equal(db.saves[0].note, 'Saved from the Werkbank');
  const itemId = r.map[ws.agentKey(p.id)].itemId;
  assert.deepEqual(localTarget(r.map, itemId), { kind: 'agent', id: p.id });

  r = await ws.syncOnce(db, { ...r, agent: [ap.extendProject(r.agent[0], ext(), 300)] });
  assert.equal(db.items.size, 1, 'no second item'); assert.equal([...db.items.values()][0].rev, 2);
  assert.equal(db.saves[1].id, itemId); assert.equal(db.saves[1].expected_rev, 1); assert.equal(db.saves[1].note, 'Extended: Renewal reminders (A-1, A-2)');
  assert.equal(r.map[ws.agentKey(p.id)].ext, 1);

  const again = await ws.syncOnce(db, r);
  assert.equal(again.pushed, 0);
  const edited = ap.setAnswers(again.agent[0], { owner: 'Anna' }, 500);
  await ws.syncOnce(db, { ...again, agent: [edited] });
  assert.equal(db.saves[2].note, 'Saved from the Werkbank', 'a later ordinary edit is not called an extension');
});

test('sync: a workflow extension is the next revision of the same item', async () => {
  const db = fakeDb();
  const p = dv.changeIntent(dv.newProject('workflow', 100), { name: 'Contract upload', goal: 'Upload contracts and warn owners' }, 200);
  let r = await ws.syncOnce(db, { agent: [], dev: [p], map: {} });
  r = await ws.syncOnce(db, { ...r, dev: [dv.extendProject(r.dev[0], ext(), 300)] });
  assert.equal(db.items.size, 1); assert.equal(db.saves[1].note, 'Extended: Renewal reminders (A-1, A-2)');
  assert.equal(JSON.parse(db.saves[1].files.find((f) => f.path === 'project.json').content).project.extensions.length, 1);
});

test('the sync map keeps the extension count in storage', () => {
  const store = { v: '', setItem(_, v) { this.v = v; }, getItem() { return this.v; } };
  ws.saveMap(store, { 'a:p1': { itemId: 'i', rev: 2, hash: 'h', ext: 1 }, 'd:p2': { itemId: 'j', rev: 1, hash: 'k' } });
  assert.deepEqual(ws.loadMap(store), { 'a:p1': { itemId: 'i', rev: 2, hash: 'h', ext: 1 }, 'd:p2': { itemId: 'j', rev: 1, hash: 'k' } });
});

test('parseClusters hands an extension over with the registry item it extends', () => {
  const answer = '```json\n' + JSON.stringify({ clusters: [{ title: 'Renewal reminders', summary: 'Remind owners every Monday.', class: 'agent-extension', confidence: 0.8, reason: 'Fits.', requirements: ['jira:A-1', 'jira:A-2'], target_id: 'a1' }] }) + '\n```';
  const got = parseClusters(answer, reqs, [], reg);
  const h = handover(got.clusters[0], reqs);
  assert.equal(h.base, 'agent'); assert.deepEqual(h.extends, { id: 'a1', name: 'Renewal watcher' });
  assert.equal(newExtension(h).summary, 'Remind owners every Monday.');
});
