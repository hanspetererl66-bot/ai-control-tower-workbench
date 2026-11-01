/**
 * Validation of a SKILL.md. No Node imports, so the browser and the dev server share the same rules.
 */
const SECRET = /\b(sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}|xox[bp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/;
export const MAX_SKILL_BYTES = 100_000;

/** Front matter, name, description; problems are sentences a person can read. */
export function checkSkillMd(text) {
  const problems = [];
  const warnings = [];
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text).trim());
  const grab = (key) => (fm ? (new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm[1])?.[1] ?? '').trim().replace(/^["']|["']$/g, '') : '');
  const name = grab('name');
  const description = grab('description');
  if (!fm) problems.push('SKILL.md must start with front matter between --- lines.');
  if (fm && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) problems.push('The name must be kebab-case (letters, digits, hyphens), at most 64 characters.');
  if (fm && !description) problems.push('The description is missing.');
  if (description.length > 300) warnings.push('The description is longer than 300 characters.');
  if (fm && String(text).trim().length - fm[0].length < 80) problems.push('The instructions are too short.');
  if (SECRET.test(text)) problems.push('The skill seems to contain a secret.');
  if (new TextEncoder().encode(String(text)).length > MAX_SKILL_BYTES) problems.push('The skill is too large.');
  return { ok: problems.length === 0, problems, warnings, name, description };
}
