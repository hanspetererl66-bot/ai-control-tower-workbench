import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Copy the bundled example skills into the folder the app's agent reads (goose-home/.agents/skills). */
export function installExampleSkills({ root = ROOT, skillsDir = join(root, 'goose-home/.agents/skills') } = {}) {
  const from = join(root, 'examples/skills');
  const names = readdirSync(from, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(from, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
  for (const name of names) {
    mkdirSync(join(skillsDir, name), { recursive: true });
    cpSync(join(from, name, 'SKILL.md'), join(skillsDir, name, 'SKILL.md'));
  }
  return names;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`Installed skills: ${installExampleSkills().join(', ')}`);
}
