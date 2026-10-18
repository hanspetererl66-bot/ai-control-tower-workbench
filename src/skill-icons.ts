/** Which small icon a skill gets next to its title. Chosen from the skill name; unknown names get a neutral icon. */
export type SkillIconKey = 'chart' | 'ticket' | 'search' | 'rocket' | 'layout' | 'spark';

const RULES: [RegExp, SkillIconKey][] = [
  [/ticket|support|incident|störung/i, 'ticket'],
  [/finder|search|suche|discover/i, 'search'],
  [/ship|branch|deploy|release|publish/i, 'rocket'],
  [/space|design|layout|ui\b/i, 'layout'],
  [/brief|report|board|summary|dashboard|chart/i, 'chart'],
];

export function skillIconKey(name: string): SkillIconKey {
  for (const [pattern, key] of RULES) if (pattern.test(name)) return key;
  return 'spark';
}
