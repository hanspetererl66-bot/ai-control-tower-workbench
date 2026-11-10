/**
 * Trigger tests for the bundled skills (examples/skills/<name>/triggers.json).
 *   node scripts/skill-trigger-eval.mjs            offline: word overlap on name + description (free, repeatable, rough)
 *   node scripts/skill-trigger-eval.mjs --live     asks a Claude model which skill it would use (needs ANTHROPIC_API_KEY)
 *   --dir <folder>   another skills folder (for example goose-home/.agents/skills)   --model <id>   model for --live
 * Exit code 1 when a case fails or a skill has no triggers.json.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTriggers, evaluateTriggers, lexicalChoose } from '../shared/skill-triggers.mjs';
import { parseSkill } from './skills-registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_MODEL = 'claude-haiku-5-5';

/** Reads every skill folder: name, description from SKILL.md and triggers from triggers.json (null when missing, throws when invalid). */
export function loadSkills(dir = join(ROOT, 'examples/skills')) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const md = join(dir, entry.name, 'SKILL.md');
    if (!entry.isDirectory() || !existsSync(md)) continue;
    const { name, description } = parseSkill(readFileSync(md, 'utf8'));
    const file = join(dir, entry.name, 'triggers.json');
    let triggers = null;
    if (existsSync(file)) {
      triggers = JSON.parse(readFileSync(file, 'utf8'));
      const problems = checkTriggers(triggers);
      if (problems.length) throw new Error(`${entry.name}/triggers.json: ${problems.join(' ')}`);
    }
    out.push({ name, description, triggers });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A model decides like the agent does: it sees only names and descriptions. */
export function modelChoose({ apiKey, model = DEFAULT_MODEL, fetchImpl = fetch }) {
  return async (prompt, skills) => {
    const list = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 40,
        system: 'You are an assistant that has these skills. Pick the ONE skill whose description fits the user request best, or none if no skill fits. Answer with the skill name only, or the word none.',
        messages: [{ role: 'user', content: `Skills:\n${list}\n\nUser request: ${prompt}` }],
      }),
    });
    if (!res.ok) throw new Error(`The model did not answer (${res.status}).`);
    const text = String((await res.json()).content?.[0]?.text ?? '').trim().toLowerCase().replace(/[`"'.]/g, '');
    return skills.find((s) => s.name === text)?.name ?? null;
  };
}

export function report({ results, failures, missing }) {
  const lines = [];
  for (const r of results) {
    if (r.missing) { lines.push(`MISSING  ${r.skill}: no triggers.json`); continue; }
    const bad = r.cases.filter((c) => !c.ok);
    lines.push(`${bad.length ? 'FAIL' : 'ok  '}     ${r.skill}  ${r.cases.length - bad.length}/${r.cases.length}`);
    for (const c of bad) lines.push(`           ${c.expect === 'pick' ? 'should pick' : 'should NOT pick'} it, but got ${c.picked ?? 'none'}: “${c.prompt}”`);
  }
  lines.push('', `${results.length - missing.length} skills with triggers, ${failures.length} failing case(s), ${missing.length} without triggers.`);
  return lines.join('\n');
}

async function main(argv) {
  const flag = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
  const live = argv.includes('--live');
  let choose = lexicalChoose;
  if (live) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('--live needs ANTHROPIC_API_KEY.');
    choose = modelChoose({ apiKey, model: flag('model') || DEFAULT_MODEL });
  }
  const outcome = await evaluateTriggers(loadSkills(flag('dir') || undefined), choose, { live });
  console.log(`${live ? 'Live (model)' : 'Offline (word overlap)'} trigger test\n`);
  console.log(report(outcome));
  if (outcome.failures.length || outcome.missing.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
