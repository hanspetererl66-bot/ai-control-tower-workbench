/**
 * Which installed skills were actually used in a turn, for the usage counter 'run' (migration 042).
 * Two signals: the person named one ("Use the X skill …", "Nutze den Skill X", "/X"), or the agent loaded one with a tool call
 * whose name mentions "skill" and whose input carries the skill name. The second signal is a guess about Goose's tool shape
 * (not checked against a live run): a call that does not match is simply not counted.
 */
export type RunCall = { toolName?: string; title?: string; rawInput?: Record<string, unknown> };

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;

export function skillsNamedIn(text: string, installed: string[]): string[] {
  const known = new Set(installed);
  const out = new Set<string>();
  const patterns = [/\buse the ([a-z0-9-]+) skill\b/gi, /\bnutze den skill ([a-z0-9-]+)/gi, /(?:^|\s)\/([a-z0-9-]+)(?=\s|$)/g];
  for (const re of patterns) for (const m of text.matchAll(re)) if (known.has(m[1]) && SLUG.test(m[1])) out.add(m[1]);
  return [...out];
}

export function skillLoadedBy(call: RunCall, installed: string[]): string | undefined {
  if (!/skill/i.test(`${call.toolName ?? ''} ${call.title ?? ''}`)) return undefined;
  const input = call.rawInput ?? {};
  for (const key of ['name', 'skill', 'skill_name', 'skillName', 'path', 'source']) {
    const v = input[key];
    if (typeof v !== 'string') continue;
    const last = v.replace(/\/+$/, '').split('/').pop()?.replace(/\.md$/i, '') ?? '';
    const hit = installed.find((n) => n === v || n === last || (last === 'SKILL' && v.split('/').slice(-2, -1)[0] === n));
    if (hit) return hit;
  }
  return undefined;
}
