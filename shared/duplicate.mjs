/** Names for a copy of a Skill or Space. Pure, used by the main process, the dev server and the tests. */
const SLUG_MAX = 64;

/** "Report" -> "Report copy", then "Report copy 2", "Report copy 3" … (a copy of a copy stays "Report copy 2"). */
export function copyTitle(title, existing = []) {
  const base = String(title ?? '').replace(/ copy( \d+)?$/i, '').trim() || 'Untitled';
  const taken = new Set(existing.map((t) => String(t).toLowerCase()));
  const first = `${base} copy`;
  if (!taken.has(first.toLowerCase())) return first.slice(0, 120);
  for (let i = 2; i < 1000; i += 1) {
    const next = `${base} copy ${i}`;
    if (!taken.has(next.toLowerCase())) return next.slice(0, 120);
  }
  throw new Error('too many copies');
}

/** "my-skill" -> "my-skill-copy", "my-skill-copy-2" … always a valid folder name of at most 64 characters. */
export function copySlug(slug, existing = []) {
  const base = String(slug).replace(/-copy(-\d+)?$/i, '');
  const taken = new Set(existing.map((s) => String(s).toLowerCase()));
  for (let i = 1; i < 1000; i += 1) {
    const suffix = i === 1 ? '-copy' : `-copy-${i}`;
    const next = `${base.slice(0, SLUG_MAX - suffix.length)}${suffix}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  throw new Error('too many copies');
}

/** Set the `name:` line of a SKILL.md front matter; adds one if the front matter has none. */
export function renameSkillMd(md, name) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!fm) return `---\nname: ${name}\n---\n${md}`;
  const body = /^name:.*$/m.test(fm[1]) ? fm[1].replace(/^name:.*$/m, `name: ${name}`) : `name: ${name}\n${fm[1]}`;
  return md.replace(fm[1], () => body);
}

/** Set the title in a space.json text; keeps every other field. */
export function retitleSpaceJson(text, title) {
  let meta = {};
  try { const parsed = JSON.parse(text ?? ''); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed; } catch { /* start fresh */ }
  return JSON.stringify({ ...meta, title }, null, 2);
}
