import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrd, groupByEpic, parseDescription, roleOf, openQuestions } from '../examples/prd-builder/prd-model.mjs';
import { demoIssues } from '../scripts/prd-demo-issues.mjs';
import { handlePrdMessage } from '../src/prd-bridge.ts';

const issues = demoIssues('DEMO');

test('descriptions split into the need and the acceptance criteria', () => {
  const d = parseDescription('As a seller I want X so that Y.\n\nAcceptance criteria\n- one\n* two\n3. three');
  assert.equal(d.need, 'As a seller I want X so that Y.'); assert.deepEqual(d.criteria, ['one', 'two', 'three']);
  assert.equal(roleOf(d.need), 'seller');
  assert.deepEqual(parseDescription('Just text').criteria, []);
});

test('issues group under their epic; loose ones go under "No epic"', () => {
  const g = groupByEpic(issues);
  assert.equal(g.length, 4); assert.ok(g.every((x) => x.items.length >= 3));
  assert.equal(groupByEpic([...issues, { key: 'X-1', type: 'Task', summary: 's', parentKey: null }]).at(-1).epic, null);
});

test('the PRD lists only selected requirements, with ticket keys, criteria, users and what is left out', () => {
  const epic = issues.find((i) => i.type === 'Epic');
  const mine = issues.filter((i) => i.parentKey === epic.key);
  const md = buildPrd({ project: 'DEMO', issues, selectedKeys: [epic.key, ...mine.map((i) => i.key)], today: '2026-10-26' });
  assert.match(md, /^# Product requirements: DEMO/);
  for (const s of mine) { assert.ok(md.includes(s.key) && md.includes(s.summary)); }
  assert.match(md, /Acceptance criteria:\n- /);
  assert.match(md, /\*\*seller\*\*/);
  assert.match(md, /## 5\. Out of scope[\s\S]*DEMO-\d+: /);
  const reqs = md.slice(md.indexOf('## 4.'), md.indexOf('## 5.'));
  assert.ok(!reqs.includes('Kanban view of the pipeline by stage'));
  assert.ok(md.slice(md.indexOf('## 5.')).includes('Kanban view of the pipeline by stage'));
  assert.ok(md.indexOf('R1') < md.indexOf('R2'));
});

test('open questions name tickets without criteria, priority or role', () => {
  const bad = [{ key: 'A-1', type: 'Story', summary: 's', description: 'do it', priority: '', parentKey: null }];
  const q = openQuestions(bad, groupByEpic(bad), new Set(['A-1']));
  assert.equal(q.length, 3);
  assert.match(buildPrd({ project: 'A', issues: [], selectedKeys: [], today: '2026-10-26' }), /Nothing selected yet/);
});

test('the bridge answers only prd: messages, only with the two read-only tools, and checks the project key', async () => {
  const calls = [];
  const call = async (tool, args) => { calls.push([tool, args]); return { content: [{ type: 'text', text: JSON.stringify(tool === 'jira_list_projects' ? { projects: [{ key: 'ABC', name: 'Alpha' }] } : { project: 'ABC', issues: [{ key: 'ABC-1', summary: 's', type: 'Epic' }] }) }] }; };
  assert.equal(await handlePrdMessage({ type: 's4m:tickets-request' }, call), null);
  assert.deepEqual((await handlePrdMessage({ type: 'prd:projects-request' }, call)).projects, [{ key: 'ABC', name: 'Alpha' }]);
  const r = await handlePrdMessage({ type: 'prd:backlog-request', project: 'abc' }, call);
  assert.equal(r.type, 'prd:backlog'); assert.equal(calls.at(-1)[1].project, 'ABC');
  assert.equal((await handlePrdMessage({ type: 'prd:backlog-request', project: 'x; drop' }, call)).type, 'prd:error');
  assert.match((await handlePrdMessage({ type: 'prd:projects-request' }, undefined)).message, /not connected/);
  assert.deepEqual(calls.map((c) => c[0]).filter((t) => !['jira_list_projects', 'jira_read_backlog'].includes(t)), []);
});
