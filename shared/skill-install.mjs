/**
 * Writing a skill that the agent has drafted. Used by the dev server (POST /__skills/install).
 * The rules are in skill-check.mjs, which the Develop screen uses too.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSkillMd } from './skill-check.mjs';

export { MAX_SKILL_BYTES, checkSkillMd } from './skill-check.mjs';

/** Writes <skillsDir>/<name>/SKILL.md. An existing skill is only replaced when replace is true. */
export function installSkill(skillsDir, text, { replace = false } = {}) {
  const check = checkSkillMd(text);
  if (!check.ok) throw Object.assign(new Error(check.problems.join(' ')), { status: 400 });
  const dir = join(skillsDir, check.name);
  const exists = existsSync(join(dir, 'SKILL.md'));
  if (exists && !replace) throw Object.assign(new Error(`A skill named "${check.name}" already exists.`), { status: 409, exists: true, name: check.name });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `${String(text).trim()}\n`, 'utf8');
  return { name: check.name, description: check.description, dir: check.name, replaced: exists };
}
