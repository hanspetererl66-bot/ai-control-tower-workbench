import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_DESCRIPTION, MAX_SKILL_CHARS, missingConnectors, parseRequires } from '../shared/skill-rules.mjs';
import { checkSkillMd } from '../shared/skill-check.mjs';
import { knownConnectors, parseSkill, validateSkill } from '../scripts/skills-registry.mjs';
import { skillLoadedBy, skillsNamedIn } from '../src/skill-run.ts';
import { skillsFromRows } from '../src/skill-health-db.ts';

const md = (desc, extra = '', body = 'You check things carefully and always ask before changing anything in a system. '.repeat(2)) =>
  `---\nname: a-skill\ndescription: ${desc}\nmetadata:\n  tools: list_agents\n${extra}---\n\n# A\n${body}\n`;

test('Develop check and registry check use the same limits', () => {
  const long = 'x'.repeat(MAX_DESCRIPTION + 1);
  assert.equal(checkSkillMd(md(long)).ok, false);
  assert.throws(() => validateSkill('a-skill', md(long)), new RegExp(String(MAX_DESCRIPTION)));
  assert.equal(checkSkillMd(md('x'.repeat(MAX_DESCRIPTION))).ok, true);
  const big = md('fine', '', 'y'.repeat(MAX_SKILL_CHARS));
  assert.equal(checkSkillMd(big).ok, false);
  assert.throws(() => validateSkill('a-skill', big), /longer than/);
});

test('both checks catch the same credentials', () => {
  for (const secret of ['sk-abcdefghijklmnopqrstuvwxyz', 'xoxb-1234567890-abcdef', 'AKIAABCDEFGHIJKLMNOP', 'sb_secret_abc', 'AIza' + 'a'.repeat(32)]) {
    assert.equal(checkSkillMd(md('fine', '', `Key ${secret} and more text to be long enough for the check to pass.`)).ok, false, secret);
    assert.throws(() => validateSkill('a-skill', md('fine', '', `Key ${secret} and more text.`)), /credential/, secret);
  }
});

test('requires: parsed, checked against known connectors', () => {
  assert.deepEqual(parseRequires('[a, "b"], c'), ['a', 'b', 'c']);
  assert.deepEqual(missingConnectors(['a', 'b'], new Set(['a'])), ['b']);
  const text = md('fine', '  requires: ai-control-tower, nonexistent\n');
  assert.deepEqual(parseSkill(text).meta.requires, ['ai-control-tower', 'nonexistent']);
  const known = knownConnectors();
  assert.ok(known.has('ai-control-tower'));
  assert.throws(() => validateSkill('a-skill', text, { connectors: known }), /nonexistent/);
  assert.doesNotThrow(() => validateSkill('a-skill', md('fine', '  requires: ai-control-tower\n'), { connectors: known }));
});

test('every bundled skill names only connectors that exist', async () => {
  const { readdirSync, readFileSync, existsSync } = await import('node:fs');
  const known = knownConnectors();
  for (const base of ['examples/skills', 'examples/databricks-demo/skills']) {
    for (const d of readdirSync(new URL(`../${base}`, import.meta.url))) {
      const f = new URL(`../${base}/${d}/SKILL.md`, import.meta.url);
      if (!existsSync(f)) continue;
      const { meta } = parseSkill(readFileSync(f, 'utf8'));
      assert.deepEqual(missingConnectors(meta.requires ?? [], known), [], d);
    }
  }
});

test('skill runs are found from the typed text and from a load call', () => {
  const installed = ['contract-checker', 'pricing-guard'];
  assert.deepEqual(skillsNamedIn('Use the contract-checker skill to review this', installed), ['contract-checker']);
  assert.deepEqual(skillsNamedIn('Nutze den Skill pricing-guard bitte', installed), ['pricing-guard']);
  assert.deepEqual(skillsNamedIn('/pricing-guard now', installed), ['pricing-guard']);
  assert.deepEqual(skillsNamedIn('Use the unknown-thing skill', installed), []);
  assert.equal(skillLoadedBy({ toolName: 'skills__loadSkill', rawInput: { name: 'pricing-guard' } }, installed), 'pricing-guard');
  assert.equal(skillLoadedBy({ title: 'Load skill', rawInput: { path: '/x/.agents/skills/contract-checker/SKILL.md' } }, installed), 'contract-checker');
  assert.equal(skillLoadedBy({ toolName: 'developer__shell', rawInput: { name: 'pricing-guard' } }, installed), undefined);
});

test('Skill Health prefers real run counts once there are any', () => {
  const [a, b] = skillsFromRows([
    { slug: 'with-runs', uses30: 9, uses90: 20, runs30: 2, runs90: 5 },
    { slug: 'no-runs', uses30: 9, uses90: 20, runs30: 0, runs90: 0 },
  ]);
  assert.equal(a.uses30, 2); assert.equal(a.uses90, 5);
  assert.equal(b.uses30, 9); assert.equal(b.uses90, 20);
});
