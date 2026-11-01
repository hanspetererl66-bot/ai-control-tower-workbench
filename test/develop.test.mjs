import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STAGES, approve, artifactOf, buildPrompt, canEnter, changeIntent, checkSkillMd, checkWorkflowJson, projectFiles, emptyIntent, extractFence,
  intentProblems, loadProjects, newProject, prdPrompt, sanitizeProject, saveProjects, setDocument, skillSlug, specPrompt, upsertProject,
} from '../src/develop.ts';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)) }; };
const filled = (kind = 'workflow') => {
  const p = newProject(kind, 1000);
  p.intent = { ...emptyIntent(), name: 'Contract notice check', goal: 'Warn account owners before a notice deadline passes.', systems: ['Icertis'], data: 'Contract list in, alert digest out', success: 'No deadline is missed', extra: 'Retry twice, then tell the owner' };
  return p;
};

test('the intent mask names what is missing and is ready when complete', () => {
  assert.equal(intentProblems(emptyIntent()).length, 5);
  assert.deepEqual(intentProblems(filled().intent), []);
  assert.deepEqual(intentProblems({ ...filled().intent, systems: [], otherSystems: 'Our own DMS' }), []);
  assert.match(intentProblems({ ...filled().intent, goal: 'short' }).join(), /goal/);
});

test('each prompt carries the earlier documents and asks for one document only', () => {
  const p = filled();
  const prd = prdPrompt('workflow', p.intent);
  assert.match(prd, /Contract notice check/);
  assert.match(prd, /REQ-01/);
  assert.match(prd, /Answer with the document only/);
  const spec = specPrompt('workflow', p.intent, '# PRD\nREQ-01 …');
  assert.match(spec, /## Approved PRD\n# PRD/);
  assert.match(spec, /n8n node plan/);
  assert.doesNotMatch(spec, /mermaid/i);
  assert.match(specPrompt('agent', p.intent, '# PRD'), /Skill outline/);
  const build = buildPrompt('workflow', p.intent, '# PRD', '# SPEC');
  assert.match(build, /# SPEC/);
  assert.match(build, /```json fence/);
  assert.match(buildPrompt('agent', p.intent, '# PRD', '# SPEC'), /SKILL\.md in a single ```markdown fence/);
});

test('feedback and the previous version go into the next try', () => {
  const p = filled();
  const t = prdPrompt('agent', p.intent, 'Add a requirement for audit logs', '# Old PRD');
  assert.match(t, /Changes asked for by the person\nAdd a requirement for audit logs/);
  assert.match(t, /Previous version\n# Old PRD/);
  assert.doesNotMatch(prdPrompt('agent', p.intent), /Previous version/);
});

test('stages open one after the other, and a changed document takes later approvals back', () => {
  let p = filled();
  assert.deepEqual(STAGES.map((s) => canEnter(p, s)), [true, true, false, false]);
  p = setDocument(p, 'requirements', '# PRD');
  p = approve(p, 'requirements');
  assert.deepEqual(STAGES.map((s) => canEnter(p, s)), [true, true, true, false]);
  p = approve(setDocument(p, 'specification', '# SPEC'), 'specification');
  assert.equal(canEnter(p, 'build'), true);
  const edited = setDocument(p, 'requirements', '# PRD v2');
  assert.deepEqual(edited.approved, [], 'editing the PRD takes both approvals back');
  assert.equal(canEnter(edited, 'build'), false);
  assert.equal(setDocument(p, 'requirements', '# PRD'), p, 'same text changes nothing');
  assert.deepEqual(changeIntent(p, { goal: 'Something else entirely, longer' }).approved, []);
  assert.equal(canEnter({ ...p, intent: emptyIntent() }, 'requirements'), false);
});

test('fenced blocks are found by language', () => {
  const t = 'Intro\n```mermaid\nA-->B\n```\nand\n```json\n{"a":1}\n```\n';
  assert.equal(extractFence(t, 'json'), '{"a":1}');
  assert.equal(extractFence(t), 'A-->B');
  assert.equal(extractFence(t, 'markdown'), '');
});

const goodWf = { name: 'W', nodes: [{ name: 'A', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] }, { name: 'B', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0] }], connections: { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } }, active: false, settings: { executionOrder: 'v1' } };

test('workflow check: accepts a good one, names the problems of a bad one', () => {
  assert.deepEqual(checkWorkflowJson(JSON.stringify(goodWf)).problems, []);
  assert.equal(checkWorkflowJson('{nope').ok, false);
  assert.equal(checkWorkflowJson('[]').ok, false);
  const bad = { ...goodWf, nodes: [goodWf.nodes[0], { ...goodWf.nodes[0] }], connections: { A: { main: [[{ node: 'Ghost' }]] }, Z: { main: [] } } };
  const r = checkWorkflowJson(JSON.stringify(bad));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('|'), /used twice.*unknown node: Ghost.*unknown node: Z/);
  assert.match(checkWorkflowJson(JSON.stringify({ ...goodWf, active: true })).warnings.join(), /active/);
  assert.match(checkWorkflowJson(JSON.stringify({ ...goodWf, nodes: [{ ...goodWf.nodes[0], parameters: { key: 'sk-abcdefghijklmnopqrstuvwxyz' } }, goodWf.nodes[1]] })).problems.join(), /secret/);
  assert.match(checkWorkflowJson(JSON.stringify({ ...goodWf, nodes: [{ name: 'A', type: 'custom.thing' }] })).warnings.join(), /Unusual node type/);
});

test('skill check: needs front matter with a kebab-case name, a description and real instructions', () => {
  const body = 'You help account owners with contract notices. '.repeat(4);
  const ok = checkSkillMd(`---\nname: contract-notice-agent\ndescription: "Use when a contract notice deadline must be checked."\n---\n\n# Instructions\n${body}`);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.name, 'contract-notice-agent');
  assert.match(checkSkillMd('no front matter').problems.join(), /front matter/);
  assert.match(checkSkillMd(`---\nname: Bad Name\ndescription: x\n---\n${body}`).problems.join(), /kebab-case/);
  assert.match(checkSkillMd(`---\nname: a\ndescription: x\n---\nshort`).problems.join(), /too short/);
  assert.match(checkSkillMd(`---\nname: a\ndescription: x\n---\n${body} AKIAABCDEFGHIJKLMNOP`).problems.join(), /secret/);
  assert.equal(skillSlug('Contract Notice – Agent!'), 'contract-notice-agent');
});

test('the artifact is taken from the build answer by kind, and the documents become files', () => {
  let p = filled();
  p = { ...p, docs: { prd: '# PRD', spec: '# SPEC', build: 'Here:\n```json\n{"name":"W"}\n```\nTo do: …' } };
  assert.equal(artifactOf('workflow', p.docs.build), '{"name":"W"}');
  assert.deepEqual(projectFiles(p).map((f) => f.path), ['contract-notice-check/01-intent/intent.md', 'contract-notice-check/02-requirements/PRD.html', 'contract-notice-check/03-specification/specification-architecture.html', 'contract-notice-check/04-build/contract-notice-check.workflow.json', 'contract-notice-check/04-build/build-answer.md']);
  const a = { ...filled('agent'), docs: { prd: '# PRD', spec: '', build: '```markdown\n---\nname: x\n---\nbody\n```' } };
  assert.deepEqual(projectFiles(a).map((f) => f.path).filter((x) => x.includes('04-build')), ['contract-notice-check/04-build/SKILL.md', 'contract-notice-check/04-build/build-answer.md']);
});

test('projects are stored, sorted newest first, capped, and junk is dropped', () => {
  const store = mem();
  let list = [];
  list = upsertProject(list, { ...filled(), id: 'a', updatedAt: 1 });
  list = upsertProject(list, { ...filled('agent'), id: 'b', updatedAt: 2 });
  list = upsertProject(list, { ...list.find((p) => p.id === 'a'), updatedAt: 3 });
  assert.deepEqual(list.map((p) => p.id), ['a', 'b']);
  saveProjects(store, list);
  assert.deepEqual(loadProjects(store).map((p) => p.id), ['a', 'b']);
  store.setItem('werkbank.develop.projects', JSON.stringify([{ kind: 'nonsense' }, null, 5, { kind: 'agent', stage: 'weird', intent: { name: 'x'.repeat(500), systems: [1, 'ok'] }, approved: ['intent', 'zzz'] }]));
  const loaded = loadProjects(store);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].stage, 'intent');
  assert.equal(loaded[0].intent.name.length, 80);
  assert.deepEqual(loaded[0].intent.systems, ['ok']);
  assert.deepEqual(loaded[0].approved, ['intent']);
  assert.equal(sanitizeProject('x'), null);
  store.setItem('werkbank.develop.projects', '{broken');
  assert.deepEqual(loadProjects(store), []);
});
