/**
 * Skill marketplace lookup (read-only). Lets the agent check whether a skill for a task already
 * exists before someone builds a new one. Only approved skills are ever returned, and the SKILL.md
 * text is not included: installing a skill goes through `npm run skills:sync`.
 */
import { ToolError } from './tools.mjs';

export const SKILL_TOOL_DEFINITIONS = [
  {
    name: 'search_skills',
    description:
      'Search the shared skill registry (approved skills only) by task description, for example "Reisekosten prüfen". Returns matches with owner, team, domain, maturity and the connector tools each skill uses. Use before building a new skill. Needs the Supabase connection.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the skill should do, in a few words.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Maximum number of matches (default 8).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_skill_info',
    description:
      'Show the profile of one approved skill from the shared registry (description, version, owner, team, domain, data class, tools). Does not return the skill text.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill name, for example "board-briefing".' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
];

export function createSkillHandlers(rpc) {
  const need = () => {
    if (!rpc) throw new ToolError('The skill registry lives in Supabase: add the Supabase URL and secret key to this connector.');
    return rpc;
  };
  return {
    async search_skills(args) {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query || query.length > 200) throw new ToolError('query must be a non-empty string of at most 200 characters');
      const limit = args.limit === undefined ? 8 : args.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new ToolError('limit must be an integer between 1 and 25');
      const skills = await need()('skills_search', { p_query: query, p_limit: limit });
      return {
        count: skills.length,
        skills,
        hint: skills.length ? 'Check these before building a new skill; ask the owner or team if one is close.' : 'No approved skill matches. Try other words before building a new one.',
        dataSource: 'supabase',
      };
    },
    async get_skill_info(args) {
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(name)) throw new ToolError('name must be a skill name such as "board-briefing"');
      const skill = await need()('skills_get', { p_slug: name });
      if (!skill) throw new ToolError(`No approved skill named "${name}".`);
      const { body, ...profile } = skill;
      return { skill: profile, dataSource: 'supabase' };
    },
  };
}
