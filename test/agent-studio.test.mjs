import test from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../src/agent-studio.ts';

const spaces = [{ slug: 'renewals', title: 'Renewals' }, { slug: 'finance', title: 'Finance Pre-Close' }, { slug: 'ai-control-tower', title: 'AI Control Tower' }, { slug: 'what-if', title: 'What-if Simulator' }];
const catalog = s.buildCatalog(['sub4me', 'control-tower'], spaces);

test('a template ticks the matching sources and nothing else', () => {
  const a = s.newAgent(s.TEMPLATES[0], catalog);
  assert.deepEqual(a.sources.sort(), ['conn:sub4me', 'space:renewals']);
  assert.equal(s.problems(a).length, 0);
});

test('problems: no source, short brief, silent writes', () => {
  const a = { ...s.newAgent(null, catalog), name: 'x' };
  assert.equal(s.problems(a).length, 2);
  assert.ok(s.problems({ ...a, instruction: 'Do something useful for me.', sources: ['web'], canWrite: true, askBeforeWrite: false }).some((p) => /Writing without asking/.test(p)));
});

test('the renewal run rates red/yellow/green, drafts a mail, and is refused outside its sources', () => {
  const a = s.newAgent(s.TEMPLATES[0], catalog);
  const r = s.simulateRun(a, catalog, '2026-10-26');
  assert.ok(r.table.rows.some((x) => x.level === 'red') && r.table.rows.some((x) => x.level === 'green'));
  assert.equal(r.table.rows[0].level, 'red');
  assert.match(r.mail, /Not sent/);
  assert.ok(r.blocked.includes('the Finance Space'));
  assert.ok(r.steps.some((x) => x.blocked));
});

test('without the Renewals Space the agent cannot rate; the refusal is visible', () => {
  const a = { ...s.newAgent(s.TEMPLATES[0], catalog), sources: ['web'] };
  const r = s.simulateRun(a, catalog, '2026-10-26');
  assert.equal(r.title, 'No result');
  assert.ok(r.blocked.includes('the Renewals Space'));
});

test('cost watch and the prompt restrict to the ticked sources', () => {
  const a = s.newAgent(s.TEMPLATES[1], catalog);
  const r = s.simulateRun(a, catalog);
  assert.match(r.lines.join(' '), /76 percent/);
  const prompt = s.agentPrompt(a, catalog);
  assert.match(prompt, /use only these: .*AI Control Tower/);
  assert.match(prompt, /read only/);
});

test('sanitizeAgents drops broken entries and clamps values', () => {
  const out = s.sanitizeAgents([{ id: 'a', name: 'ok', maxSteps: 999, trigger: { type: 'weird', time: 'x' } }, { id: 'a', name: 'dup' }, { name: 'no id' }, null]);
  assert.equal(out.length, 1); assert.equal(out[0].maxSteps, 30); assert.equal(out[0].trigger.type, 'manual');
});

test('published agents with a trigger get a schedule that only says /agent <id>; unpublished ones do not', () => {
  const a = s.newAgent(s.TEMPLATES[0], catalog, 1000);
  assert.equal(s.agentSchedules([a], () => 0, []).length, 0);
  const sch = s.agentSchedules([a], () => 1, [{ id: 'other', prompt: 'x', time: '07:00', repeat: 'daily', days: [], enabled: true }]);
  assert.equal(sch.length, 2);
  const mine = sch.find((x) => x.id.startsWith('agent-'));
  assert.equal(mine.prompt, `/agent ${a.id}`); assert.deepEqual(mine.days, [1]); assert.equal(mine.repeat, 'weekly');
  const again = s.agentSchedules([a], () => 1, [...sch.map((x) => (x === mine ? { ...x, lastRun: '2026-10-26T06:00:00Z' } : x))]);
  assert.equal(again.find((x) => x.id === mine.id).lastRun, '2026-10-26T06:00:00Z');
  assert.equal(s.agentSchedules([a], () => 1, again), again);
  assert.equal(s.agentSchedules([], () => 1, again).length, 1);
  assert.equal(s.agentSchedules([{ ...a, trigger: { type: 'manual', time: '08:00' } }], () => 1, again).length, 1);
});

test('/agent runs only published agents and builds the brief at run time', () => {
  const a = s.newAgent(s.TEMPLATES[0], catalog, 1000);
  assert.match(s.expandAgentCommand(`/agent ${a.id}\n\n(Recurring)`, [a], catalog, () => 1).prompt, /use only these/);
  assert.match(s.expandAgentCommand(`/agent ${a.id}`, [a], catalog, () => 0).error, /not published/);
  assert.match(s.expandAgentCommand('/agent a-nope', [a], catalog, () => 1).error, /no longer exists/);
  assert.equal(s.expandAgentCommand('/briefing', [a], catalog, () => 1), null);
});

test('registry entries describe the agent as a process', () => {
  const a = { ...s.newAgent(s.TEMPLATES[0], catalog, 1000), tested: true, testedAt: Date.parse('2026-10-26T10:00:00Z') };
  const [e] = s.registryEntries([a], catalog, () => 0, ['Personal', 'Department', 'Company'], () => 1, [], 'Hans');
  assert.equal(e.id, 'AGT-S-001'); assert.equal(e.lifecycle, 'pending_review'); assert.equal(e.rights, 'Read only');
  assert.match(e.trigger, /starts after approval/); assert.equal(e.approval, 'Waiting: Department'); assert.deepEqual(e.sources.sort(), ['Renewals', 'sub4me']);
  const [p] = s.registryEntries([a], catalog, () => 1, ['Personal', 'Department', 'Company'], () => null, [], '');
  assert.equal(p.lifecycle, 'production'); assert.equal(p.level, 'Department'); assert.equal(p.owner, 'You');
});

test('PRD writer: Jira is its source, it cannot write to Jira, and it needs Jira to run', () => {
  const cat = s.buildCatalog(['jira', 'sub4me'], spaces);
  const a = s.newAgent(s.TEMPLATES.find((t) => t.id === 'prd-writer'), cat);
  assert.deepEqual(a.sources, ['conn:jira']);
  const r = s.simulateRun(a, cat);
  assert.match(r.title, /14 requirements in 4 epics/); assert.ok(r.blocked.includes('writing to Jira'));
  assert.equal(s.simulateRun({ ...a, sources: ['web'] }, cat).title, 'No result');
  assert.match(s.agentPrompt(a, cat), /read only/);
});

test('pre-close checker reads the Finance Pre-Close Space and Databricks, is read only and refuses posting', () => {
  const cat = s.buildCatalog(['databricks'], [{ slug: 'finance-preclose', title: 'Finance Pre-Close' }, { slug: 'renewals', title: 'Renewals' }]);
  const t = s.TEMPLATES.find((x) => x.id === 'preclose-check');
  const a = s.newAgent(t, cat);
  assert.deepEqual(a.sources.sort(), ['conn:databricks', 'space:finance-preclose']);
  assert.equal(s.problems(a).length, 0);
  assert.equal(a.canWrite, false);
  const r = s.simulateRun(a, cat);
  assert.match(r.title, /3 red findings/);
  assert.ok(r.table.rows.some((x) => x.level === 'red'));
  assert.ok(r.blocked.includes('posting accruals'));
  const none = s.simulateRun({ ...a, sources: ['web'] }, cat);
  assert.equal(none.title, 'No result');
});

test('a goal becomes a workflow plan request that changes nothing in n8n', () => {
  const prompt = s.workflowPlanPrompt('Check notice periods of uploaded contracts');
  assert.match(prompt, /Do not create or change anything in n8n yet/);
  assert.match(prompt, /Check notice periods/);
});
