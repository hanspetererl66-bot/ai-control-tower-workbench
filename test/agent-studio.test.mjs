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
