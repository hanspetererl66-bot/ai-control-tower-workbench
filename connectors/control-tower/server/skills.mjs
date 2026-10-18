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
  {
    name: 'list_skill_catalog',
    description:
      'Overview of the shared skill marketplace (approved skills only): how many skills exist per board area (Finance, Sales, Marketing, Engineering), LOB (BTP, Concur, SuccessFactors), team and reach (individual, team, lob, board-area, company), plus the skills themselves with a short description. Optionally filter by boardArea, lob, team, scope or owner. Answers "Welche Skills gibt es in Engineering?" or "Was hat das AI Programme Office gebaut?". Does not return skill text.',
    inputSchema: {
      type: 'object',
      properties: {
        boardArea: { type: 'string', enum: ['Finance', 'Sales', 'Marketing', 'Engineering'] },
        lob: { type: 'string', enum: ['BTP', 'Concur', 'SuccessFactors'] },
        team: { type: 'string', description: 'Team name, case-insensitive.' },
        scope: { type: 'string', enum: ['individual', 'team', 'lob', 'board-area', 'company'] },
        owner: { type: 'string', description: 'Owner name or part of it, case-insensitive.' },
      },
      additionalProperties: false,
    },
  },
];

const UNSORTED = 'Nicht eingeordnet';
const count = (items, pick) => {
  const out = {};
  for (const item of items) {
    const key = pick(item) || UNSORTED;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
};
/** Flat view of one registry row; skills published before the classification existed read as unsorted, scope individual. */
export function catalogEntry(row) {
  const meta = row.meta ?? {};
  return {
    name: row.slug,
    description: row.description,
    owner: row.owner || '',
    version: row.version,
    maturity: row.maturity,
    domain: meta.domain || '',
    process: meta.process || '',
    boardArea: meta.board_area || '',
    lob: meta.lob || '',
    team: meta.team || '',
    scope: meta.scope || 'individual',
    dataClass: meta.data_class || '',
    tools: meta.tools ?? [],
  };
}

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
    async list_skill_catalog(args = {}) {
      const { boardArea, lob, team, scope, owner } = args;
      const enums = {
        boardArea: ['Finance', 'Sales', 'Marketing', 'Engineering'],
        lob: ['BTP', 'Concur', 'SuccessFactors'],
        scope: ['individual', 'team', 'lob', 'board-area', 'company'],
      };
      for (const [key, value] of Object.entries({ boardArea, lob, scope })) {
        if (value !== undefined && !enums[key].includes(value)) throw new ToolError(`${key} must be one of: ${enums[key].join(', ')}`);
      }
      for (const [key, value] of Object.entries({ team, owner })) {
        if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 80)) throw new ToolError(`${key} must be a non-empty string of at most 80 characters`);
      }
      const all = (await need()('skills_list', {})).map(catalogEntry);
      const has = (text, needle) => text.toLowerCase().includes(String(needle).trim().toLowerCase());
      const skills = all.filter((e) =>
        (!boardArea || e.boardArea === boardArea) && (!lob || e.lob === lob) && (!scope || e.scope === scope)
        && (!team || has(e.team, team)) && (!owner || has(e.owner, owner)));
      return {
        total: all.length,
        count: skills.length,
        byBoardArea: count(all, (e) => e.boardArea),
        byLob: count(all.filter((e) => e.lob), (e) => e.lob),
        byTeam: count(all, (e) => e.team),
        byScope: count(all, (e) => e.scope),
        skills,
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
