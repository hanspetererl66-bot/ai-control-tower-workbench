import test from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../src/agent-studio.ts';
import * as pr from '../src/agent-project.ts';

const catalog = s.buildCatalog(['sub4me'], [{ slug: 'renewals', title: 'Renewals' }, { slug: 'finance-preclose', title: 'Finance Pre-Close' }]);
const filled = (now = 1000) => {
  let p = pr.newProject('Watch our renewals and tell me Monday which ones are at risk', now);
  p = pr.setAnswers(p, { success: 'Every red renewal has a reason and a next step', users: 'Sales leads', sources: ['space:renewals', 'conn:sub4me'], trigger: 'weekly', output: 'table', owner: 'Anna Berger' }, now);
  return p;
};

test('the questions must be answered before anything is written', () => {
  const p = pr.newProject('Watch renewals', 1);
  assert.ok(pr.questionProblems(p.answers).length >= 3);
  assert.equal(pr.currentStage(p), 'questions');
  const same = pr.confirmQuestions(p, catalog, 2);
  assert.equal(same.docs.prd, undefined, 'incomplete answers write nothing');
  assert.equal(pr.currentStage(same), 'questions');
});

test('confirming the questions writes the PRD; each confirmation writes the next document, in order', () => {
  let p = pr.confirmQuestions(filled(), catalog, 2000);
  assert.equal(pr.questionProblems(p.answers).length, 0);
  assert.match(p.docs.prd, /Product Requirements Document: Watch our renewals/);
  assert.match(p.docs.prd, /Renewals/);
  assert.equal(pr.currentStage(p), 'prd');
  assert.equal(p.docs.tfd, undefined);
  p = pr.confirmDoc(p, 'prd', catalog, 3000);
  assert.match(p.docs.tfd, /Technical Functional Document/);
  assert.match(p.docs.tfd, /every Monday at 08:00/);
  assert.equal(pr.currentStage(p), 'tfd');
  p = pr.confirmDoc(p, 'tfd', catalog, 4000);
  assert.match(p.docs.arch, /Solution Architecture/);
  p = pr.confirmDoc(p, 'arch', catalog, 5000);
  assert.match(p.docs.risk, /Risk, Compliance and Test Plan/);
  assert.equal(pr.currentStage(p), 'risk');
  p = pr.confirmDoc(p, 'risk', catalog, 6000);
  assert.equal(pr.currentStage(p), 'build');
  assert.ok(pr.allConfirmed(p));
});

test('a step cannot be confirmed out of order', () => {
  const p = pr.confirmQuestions(filled(), catalog, 2000);
  const skip = pr.confirmDoc(p, 'tfd', catalog, 3000);
  assert.equal(skip.confirmed.tfd, undefined);
  assert.equal(pr.agentFromProject(p, catalog), null, 'no agent before all documents are confirmed');
});

test('editing a confirmed document reopens it and marks the later documents outdated', () => {
  let p = pr.confirmQuestions(filled(), catalog, 2000);
  for (const [k, t] of [['prd', 3000], ['tfd', 4000], ['arch', 5000], ['risk', 6000]]) p = pr.confirmDoc(p, k, catalog, t);
  const edited = pr.editDoc(p, 'tfd', p.docs.tfd + '\n- extra rule', 7000);
  assert.equal(edited.confirmed.tfd, undefined);
  assert.equal(edited.confirmed.arch, undefined);
  assert.equal(edited.confirmed.prd, 3000, 'earlier steps stay confirmed');
  assert.deepEqual(edited.stale.sort(), ['arch', 'risk']);
  assert.equal(pr.currentStage(edited), 'tfd');
  assert.equal(pr.allConfirmed(edited), false);
  const again = pr.confirmDoc(edited, 'tfd', catalog, 8000);
  assert.equal(again.confirmed.tfd, 8000);
  assert.match(again.docs.arch, /Solution Architecture/, 'the outdated next document is written again');
  assert.deepEqual(again.stale, ['risk']);
  assert.equal(pr.confirmDoc(again, 'risk', catalog, 9000).confirmed.risk, undefined, 'an outdated document cannot be confirmed');
});

test('changing an answer after the questions were confirmed reopens everything', () => {
  let p = pr.confirmQuestions(filled(), catalog, 2000);
  p = pr.confirmDoc(p, 'prd', catalog, 3000);
  const changed = pr.setAnswers(p, { trigger: 'daily' }, 4000);
  assert.deepEqual(changed.confirmed, {});
  assert.deepEqual(changed.stale.sort(), ['prd', 'tfd']);
  const re = pr.confirmQuestions(changed, catalog, 5000);
  assert.match(re.docs.prd, /every day at 08:00/, 'the PRD is written again from the new answers');
  assert.deepEqual(re.stale, ['tfd']);
});

test('regenerate replaces the text with a fresh draft from the answers', () => {
  let p = pr.confirmQuestions(filled(), catalog, 2000);
  p = pr.editDoc(p, 'prd', 'my own text', 2500);
  assert.equal(p.docs.prd, 'my own text');
  p = pr.regenerate(p, 'prd', catalog, 3000);
  assert.match(p.docs.prd, /Product Requirements Document/);
});

test('the agent is built from the confirmed documents as a read-only draft with the chosen sources and trigger', () => {
  let p = pr.confirmQuestions(filled(), catalog, 2000);
  for (const [k, t] of [['prd', 3000], ['tfd', 4000], ['arch', 5000], ['risk', 6000]]) p = pr.confirmDoc(p, k, catalog, t);
  const a = pr.agentFromProject(p, catalog, 9000);
  assert.equal(a.name, 'Watch our renewals and tell me');
  assert.deepEqual(a.sources.sort(), ['conn:sub4me', 'space:renewals']);
  assert.equal(a.canWrite, false);
  assert.equal(a.askBeforeWrite, true);
  assert.equal(a.trigger.type, 'weekly');
  assert.equal(a.output, 'table');
  assert.equal(a.template, `project:${p.id}`);
  assert.equal(a.tested, false);
  assert.equal(s.problems(a).length, 0);
  assert.match(a.instruction, /Name the source of every figure/);
});

test('rights and sensitivity show up in the documents', () => {
  let p = pr.setAnswers(filled(), { rights: 'propose', sensitivity: 'personal', sources: ['space:renewals'], otherSystems: 'SAP S/4HANA' }, 1500);
  p = pr.confirmQuestions(p, catalog, 2000);
  assert.match(p.docs.prd, /personal data/i);
  assert.match(p.docs.prd, /not connected yet/);
  assert.match(p.docs.prd, /Define who approves/);
  p = pr.confirmDoc(p, 'prd', catalog, 3000);
  p = pr.confirmDoc(p, 'tfd', catalog, 4000);
  p = pr.confirmDoc(p, 'arch', catalog, 5000);
  assert.match(p.docs.risk, /Only a proposal; asks before writing/);
});

test('projects survive storage and broken entries are dropped; confirmations become audit events', () => {
  let p = pr.confirmQuestions(filled(), catalog, 2000);
  p = pr.confirmDoc(p, 'prd', catalog, 3000);
  const back = pr.sanitizeProjects(JSON.parse(JSON.stringify([p, { id: 'x' }, null])));
  assert.equal(back.length, 1);
  assert.equal(back[0].docs.prd, p.docs.prd);
  assert.equal(back[0].confirmed.prd, 3000);
  const ev = pr.projectEvents(back);
  assert.deepEqual(ev.map((e) => e.what), ['Watch our renewals and tell me: goal and questions', 'Watch our renewals and tell me: PRD']);
});
