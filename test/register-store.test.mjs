import test from 'node:test';
import assert from 'node:assert/strict';
import * as rs from '../src/register-store.ts';
import * as rc from '../src/registry-card.ts';
import * as rg from '../src/registry.ts';
import * as ws from '../src/work-sync.ts';
import * as ap from '../src/agent-project.ts';
import * as ex from '../src/registry-examples.ts';

/** Stand-in for the database that keeps files, intent and revision, with optimistic locking. */
function fakeDb() {
  const items = new Map(); let n = 0;
  return {
    items,
    async call(tool, a) {
      if (tool === 'list_work_items') return [...items.values()].map((i) => ({ id: i.id, kind: i.kind, name: i.name, archived: i.archived, current_rev: i.rev }));
      if (tool === 'get_work_item') { const i = items.get(a.id); return { id: i.id, kind: i.kind, files: i.files, intent: i.intent, current_rev: i.rev }; }
      if (tool === 'save_work_item') {
        if (a.id) { const i = items.get(a.id); if (a.expected_rev !== i.rev) throw new Error('The item was changed meanwhile'); Object.assign(i, { name: a.name, kind: a.kind, files: a.files, intent: a.intent, rev: i.rev + 1, note: a.note }); return { id: i.id, rev: i.rev }; }
        const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; items.set(id, { id, kind: a.kind, name: a.name, files: a.files, intent: a.intent, rev: 1, archived: false }); return { id, rev: 1 };
      }
      throw new Error(`unexpected ${tool}`);
    },
  };
}
const project = () => ap.setAnswers(ap.newProject('Watch renewals and tell me which are at risk', 1000), { name: 'Renewal watch' }, 1000);
const filled = () => ({ ...rs.emptyCard(), purpose: 'Warns about renewals at risk', organization: 'Sales', steward: 'Anna Berger', phase: 'active', criticality: 'critical', risk: 'limited', riskReason: 'Reads contracts only', relations: [{ kind: 'system', name: 'Sub4Me', access: 'read' }], tags: ['sales'] });

test('an empty card declares nothing and takes the least favourable values', () => {
  const c = rs.emptyCard();
  assert.equal(c.phase, null); assert.equal(c.criticality, null);
  assert.equal(c.verification, 'unverified'); assert.equal(c.risk, 'not-assessed');
  assert.deepEqual(c.relations, []);
});

test('the card round-trips through register.json; a broken or foreign file is no card', () => {
  const c = filled();
  const f = rs.registerFile(c);
  assert.equal(f.path, 'register.json');
  assert.deepEqual(rs.registerFrom([{ path: 'x.md', content: 'y' }, f]), rc.sanitizeCard(c));
  assert.equal(rs.registerFrom([{ path: 'register.json', content: '{nope' }]), null);
  assert.equal(rs.registerFrom([{ path: 'register.json', content: JSON.stringify({ format: 'other', card: c }) }]), null);
  assert.equal(rs.registerFrom([]), null);
});

test('withRegister replaces an old card and leaves every other file exactly as it was', () => {
  const files = [{ path: 'project.json', content: '{"a":1}', language: 'json' }, rs.registerFile(rs.emptyCard())];
  const out = rs.withRegister(files, filled());
  assert.equal(out.length, 2);
  assert.equal(out[0].content, '{"a":1}');
  assert.equal(rs.registerFrom(out).organization, 'Sales');
});

test('markVerified sets who, when and the next review, and nothing else', () => {
  const c = filled();
  const v = rs.markVerified(c, ' anna@example.com ', '2026-11-07');
  assert.equal(v.verification, 'verified'); assert.equal(v.verifiedBy, 'anna@example.com');
  assert.equal(v.verifiedAt, '2026-11-07'); assert.equal(v.reviewDue, '2027-05-07');
  assert.deepEqual({ ...v, verification: c.verification, verifiedBy: '', verifiedAt: '', reviewDue: '' }, { ...c, verifiedBy: '', verifiedAt: '', reviewDue: '' });
  assert.equal(rs.markVerified(c, 'a', '2026-08-31', 6).reviewDue, '2027-03-03', 'month overflow rolls over in the calendar');
});

test('cardProblems names what does not hang together', () => {
  assert.deepEqual(rs.cardProblems(filled()), []);
  assert.equal(rs.cardProblems({ ...filled(), verification: 'verified' }).length, 1);
  assert.match(rs.cardProblems({ ...filled(), verifiedAt: '2026-11-07', reviewDue: '2026-11-01' })[0], /after the day/);
  assert.match(rs.cardProblems({ ...filled(), risk: 'high', riskReason: '' })[0], /reason/);
  assert.match(rs.cardProblems({ ...filled(), dates: { plan: '2026-05-01', active: '2026-03-01' } })[0], /dated before/);
  assert.match(rs.cardProblems({ ...filled(), relations: [{ kind: 'system', name: 'SAP' }, { kind: 'system', name: 'sap' }] })[0], /twice/);
});

test('the revision note names the groups that changed', () => {
  const a = filled();
  assert.equal(rs.cardNote(a, a), 'Register card saved');
  assert.equal(rs.cardNote(null, a), 'Register card: purpose, ownership, lifecycle, criticality, risk, connections, tags');
  assert.equal(rs.cardNote(a, { ...a, criticality: 'mission-critical', tags: [] }), 'Register card: criticality, tags');
  assert.ok(rs.cardLines(a).includes('organization: Sales') && rs.cardLines(a).includes('system: Sub4Me (read)'));
});

test('every example card survives the file round trip unchanged', () => {
  for (const i of ex.exampleRegistry().items.filter((x) => x.card)) assert.deepEqual(rs.registerFrom([rs.registerFile(i.card)]), i.card, i.name);
});

test('saveCardArgs keeps every file, fills intent.register and sets the note', () => {
  const u = ws.agentUnit(project());
  const args = rg.saveCardArgs({ id: 'i1', kind: 'agent', name: u.name, currentRev: 3, intent: {} }, u.files, filled(), 'Register card: purpose');
  assert.equal(args.expected_rev, 3); assert.equal(args.note, 'Register card: purpose');
  assert.deepEqual(args.files.filter((f) => f.path !== 'register.json'), u.files);
  assert.equal(args.intent.register.organization, 'Sales');
  assert.equal(args.intent.source, 'agent-project', 'the intent of the project is rebuilt from the project, not lost');
});

test('rollback keeps the card of the revision it restores in intent.register', () => {
  const u = ws.agentUnit(project());
  const files = rs.withRegister(u.files, filled());
  const args = rg.rollbackArgs({ id: 'i1', kind: 'agent', name: 'x', currentRev: 4 }, files, 2);
  assert.equal(args.intent.register.steward, 'Anna Berger');
  const old = rg.rollbackArgs({ id: 'i1', kind: 'agent', name: 'x', currentRev: 4 }, u.files, 1);
  assert.equal(old.intent.register, undefined, 'a revision without a card restores to no card');
});

test('saveCard writes a new revision; the project files are untouched', async () => {
  const db = fakeDb();
  const r = await ws.syncOnce(db, { agent: [project()], dev: [], map: {} });
  const item = [...db.items.values()][0];
  const before = item.files.map((f) => f.content);
  const rev = await rg.saveCard(db, { id: item.id, type: 'agent', name: item.name, rev: item.rev, card: null }, filled());
  assert.equal(rev, 2); assert.equal(item.note, 'Register card: purpose, ownership, lifecycle, criticality, risk, connections, tags');
  assert.deepEqual(item.files.filter((f) => f.path !== 'register.json').map((f) => f.content), before);
  assert.equal(item.intent.register.organization, 'Sales');
  assert.ok(r.map);
});

test('the project sync keeps the card when it pushes a project change, and a card-only revision is no conflict', async () => {
  const db = fakeDb();
  let local = await ws.syncOnce(db, { agent: [project()], dev: [], map: {} });
  const item = [...db.items.values()][0];
  await rg.saveCard(db, { id: item.id, type: 'agent', name: item.name, rev: item.rev, card: null }, filled());
  // the person also changes the project on this computer before the next round
  const changed = ap.setAnswers(local.agent[0], { owner: 'Anna Berger' }, 2000);
  local = await ws.syncOnce(db, { ...local, agent: [changed] });
  assert.deepEqual(local.errors, []);
  assert.equal(local.agent.length, 1, 'no "(local copy)" for a card-only revision');
  assert.equal(local.agent[0].answers.owner, 'Anna Berger', 'our change is kept');
  assert.equal(item.rev, 3, 'the project change was pushed on top of the card revision');
  assert.equal(rs.registerFrom(item.files).organization, 'Sales', 'the card survived the push');
  assert.equal(item.intent.register.organization, 'Sales');
  // a round with nothing changed sends nothing
  const again = await ws.syncOnce(db, local);
  assert.equal(again.pushed, 0);
});

test('a card that cannot be read is not overwritten by the sync', async () => {
  const db = fakeDb();
  let local = await ws.syncOnce(db, { agent: [project()], dev: [], map: {} });
  const item = [...db.items.values()][0];
  item.files.push({ path: 'register.json', content: '{broken', language: 'json' });
  const changed = ap.setAnswers(local.agent[0], { owner: 'Anna Berger' }, 2000);
  local = await ws.syncOnce(db, { ...local, agent: [changed] });
  assert.equal(local.errors.length, 1); assert.match(local.errors[0], /register\.json/);
  assert.equal(item.rev, 1, 'nothing was pushed');
});

test('a feature change keeps the card of the revision it is based on', () => {
  const doc = rg.newFeature({ name: 'Teams source', goal: 'Read Teams', refs: [], brief: '' });
  const based = rs.withRegister(rg.featureFiles(doc), filled());
  const args = rg.keepCard(rg.featureArgs(rg.setStage(doc, 'build'), { id: 'i1', expectedRev: 2, note: 'Stage: Build' }), based);
  assert.equal(rs.registerFrom(args.files).organization, 'Sales');
  assert.equal(args.intent.register.organization, 'Sales');
  assert.equal(args.intent.source, 'feature');
  const none = rg.featureArgs(doc, { note: 'x' });
  assert.equal(rg.keepCard(none, rg.featureFiles(doc)), none, 'no card, nothing added');
});
