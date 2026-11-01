import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { checkSkillMd, installSkill } from '../shared/skill-install.mjs';

const body = 'You help account owners with contract notices and you never act without approval. '.repeat(3);
const skill = (name = 'contract-notice-agent') => `---\nname: ${name}\ndescription: Use when a contract notice deadline must be checked.\n---\n\n# Instructions\n${body}`;

test('a valid skill is written to <skills>/<name>/SKILL.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  const r = installSkill(dir, skill());
  assert.deepEqual({ name: r.name, replaced: r.replaced }, { name: 'contract-notice-agent', replaced: false });
  assert.match(readFileSync(join(dir, 'contract-notice-agent/SKILL.md'), 'utf8'), /^---\nname: contract-notice-agent/);
});

test('an existing skill is only replaced when asked, and the 409 says which one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  installSkill(dir, skill());
  assert.throws(() => installSkill(dir, skill()), (e) => e.status === 409 && e.exists === true && /already exists/.test(e.message));
  assert.equal(installSkill(dir, skill(), { replace: true }).replaced, true);
});

test('names that could leave the skills folder or break the rules are refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  for (const name of ['../evil', 'a/b', 'Upper', '', '-x', 'x'.repeat(70)]) {
    assert.throws(() => installSkill(dir, skill(name)), (e) => e.status === 400, name);
  }
  assert.equal(existsSync(join(dir, '..', 'evil')), false);
  assert.equal(checkSkillMd(`---\nname: ok\ndescription: d\n---\n${body} sk-abcdefghijklmnopqrstuvwxyz`).ok, false);
  assert.equal(checkSkillMd(`---\nname: ok\ndescription: d\n---\n${'x'.repeat(100_001)}`).ok, false);
});
