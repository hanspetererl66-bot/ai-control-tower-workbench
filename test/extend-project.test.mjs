import assert from 'node:assert/strict';
import test from 'node:test';
import { extendAgent, extendWorkflow, localProjectOf } from '../src/extend-project.ts';
import { newProject as newAgent, setAnswers } from '../src/agent-project.ts';
import { newProject as newFlow } from '../src/develop.ts';

const h = (extra = {}) => ({
  base: 'agent', name: 'Renewals', goal: 'Extend "Renewal watcher": remind owners of renewals', refs: [{ source: 'jira', key: 'A-2', title: 'Remind owners', url: '' }],
  extends: { id: 'item-1', name: 'Renewal watcher' }, brief: '# x\n\n## Requirements\n- **A-2** (jira) Remind owners', ...extra,
});

test('the local project behind a work item comes from the sync map', () => {
  const map = { 'a:p-1': { itemId: 'item-1', rev: 2, hash: 'x' }, 'd:p-2': { itemId: 'item-2', rev: 1, hash: 'y' } };
  assert.equal(localProjectOf(map, 'item-1', 'agent'), 'p-1');
  assert.equal(localProjectOf(map, 'item-1', 'workflow'), undefined);
  assert.equal(localProjectOf(map, 'item-2', 'workflow'), 'p-2');
  assert.equal(localProjectOf(map, 'nope', 'agent'), undefined);
});

test('an extension changes the agent: objective grows, sources merge, approvals fall back, repeating adds nothing', () => {
  let p = newAgent('Watch renewals', 1);
  p = { ...p, docs: { prd: 'x' }, confirmed: { questions: 1 }, sources: [{ source: 'jira', key: 'A-1', title: 'First', url: '' }] };
  const once = extendAgent(p, h(), 5);
  assert.match(once.answers.objective, /^Watch renewals\nExtension: remind owners of renewals$/);
  assert.deepEqual(once.sources.map((r) => r.key), ['A-1', 'A-2']);
  assert.deepEqual(once.confirmed, {});
  assert.deepEqual(once.stale, ['prd']);
  const twice = extendAgent(once, h(), 6);
  assert.equal(twice.answers.objective, once.answers.objective);
  assert.equal(twice.sources.length, 2);
  assert.ok(extendAgent({ ...p, answers: { ...p.answers, objective: 'y'.repeat(399) } }, h(), 7).answers.objective.length <= 400);
});

test('an extension changes the workflow goal and withdraws approvals', () => {
  let p = newFlow('workflow', 1);
  p = { ...p, intent: { ...p.intent, name: 'Upload', goal: 'Upload contracts' }, approved: ['intent', 'requirements'] };
  const out = extendWorkflow(p, h({ base: 'workflow' }), 5);
  assert.match(out.intent.goal, /^Upload contracts\n\nExtension: remind owners of renewals\n- \*\*A-2\*\*/);
  assert.deepEqual(out.approved, []);
  assert.equal(extendWorkflow(out, h({ base: 'workflow' }), 6).intent.goal, out.intent.goal);
});
