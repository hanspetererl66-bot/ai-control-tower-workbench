/**
 * Skill ratings (1 to 5 stars): read the summary per skill and rate a skill.
 * Reads sample ratings from the Skill Marketplace data; live from Supabase (public.skills_ratings, migration 013)
 * when the connector has a connection. Rating needs Supabase: nothing is ever written to a local file.
 * Raters are anonymous: only a hash of the local user is sent, and one person has one rating per skill.
 */
import { createHash } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { ToolError } from './tools.mjs';
import { loadMarketplaceData } from './skill-profiles.mjs';
import { RATING_DEFAULTS, summarise } from './rating-math.mjs';

export { summarise };
const DEFAULTS = RATING_DEFAULTS;

/** Stable anonymous id of the person using this connector. SKILL_RATER_ID overrides it. */
export function raterId() {
  const own = process.env.SKILL_RATER_ID?.trim();
  let who = own;
  if (!who) {
    try { who = `${userInfo().username}@${hostname()}`; } catch { who = 'unknown'; }
  }
  return createHash('sha256').update(`skill-rating-v1|${who}`).digest('hex').slice(0, 32);
}

export const SKILL_RATING_TOOL_DEFINITIONS = [
  {
    name: 'get_skill_ratings',
    description:
      'Star ratings of marketplace skills (1 to 5, anonymous, one rating per person). Without a name: ranking of all skills by a damped average (a skill with two five-star votes does not beat one with 40 votes at 4.6); skills with fewer than 5 ratings are marked "new". With a name: average, number of ratings, how many gave 1 to 5 stars, and the latest comments. Answers "Welche Skills sind am besten bewertet?" or "Wie wird ticket-writer bewertet?". Live from Supabase when connected, otherwise sample data.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name, for example "customer-call-prep". Omit for the ranking.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'How many skills in the ranking (default 10).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'rate_skill',
    description:
      'Rate a published marketplace skill with 1 to 5 stars and an optional short comment (max 280 characters). One rating per person and skill; rating again replaces the earlier one. Ask the person for the stars first and repeat skill, stars and comment back before calling; never rate on your own. Do not put names, customer data or secrets into the comment. Needs the Supabase connection; sample skills cannot be rated.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name, for example "customer-call-prep".' },
        stars: { type: 'integer', minimum: 1, maximum: 5, description: 'Rating from 1 (poor) to 5 (very good).' },
        comment: { type: 'string', description: 'Optional comment, max 280 characters, no personal or customer data.' },
      },
      required: ['name', 'stars'],
      additionalProperties: false,
    },
  },
];

async function withRatings(d, rpc) {
  if (rpc) {
    try {
      const live = await rpc('skills_ratings', {});
      if (live && live.skills) return { ratings: { settings: { ...DEFAULTS, ...(live.settings ?? {}) }, skills: live.skills }, dataSource: 'supabase (ratings)' };
    } catch {
      // fall back to the embedded sample data below
    }
  }
  return { ratings: { settings: { ...DEFAULTS, ...(d.ratings?.settings ?? {}) }, skills: d.ratings?.skills ?? {} }, dataSource: 'sample data (Skill Marketplace example Space)' };
}

export function createSkillRatingHandlers(load = loadMarketplaceData, rpc = null, who = raterId) {
  const data = () => {
    try {
      return load();
    } catch (error) {
      throw new ToolError(`Skill marketplace sample data unavailable: ${error.message}`);
    }
  };
  const find = (d, name) => {
    const needle = String(name ?? '').trim().toLowerCase();
    if (!needle) throw new ToolError('name is required');
    const skill = d.skills.find((s) => s.name.toLowerCase() === needle) ?? d.skills.find((s) => s.name.toLowerCase().includes(needle));
    if (!skill) throw new ToolError(`No skill named "${name}". Known: ${d.skills.map((s) => s.name).join(', ')}`);
    return skill;
  };
  return {
    async get_skill_ratings(args = {}) {
      const d = data();
      const { ratings, dataSource } = await withRatings(d, rpc);
      const row = (skill) => {
        const r = ratings.skills[skill.name];
        return { skill, ...summarise(r?.distribution, ratings.settings), comments: r?.comments ?? [] };
      };
      if (args.name !== undefined) {
        const r = row(find(d, args.name));
        return { skill: r.skill.name, sample: Boolean(r.skill.sample), rating: r.label, average: r.average, ratings: r.count, distribution: { '1': r.distribution[0], '2': r.distribution[1], '3': r.distribution[2], '4': r.distribution[3], '5': r.distribution[4] }, enoughRatings: r.enough, comments: r.comments.slice(0, 5), view: { space: 'skill-marketplace', tab: 'catalog' }, dataSource };
      }
      const limit = args.limit === undefined ? 10 : args.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new ToolError('limit must be an integer between 1 and 25');
      const list = d.skills.map(row).filter((r) => r.count).sort((a, b) => b.score - a.score || b.count - a.count || a.skill.name.localeCompare(b.skill.name));
      return {
        count: list.length,
        ranking: list.slice(0, limit).map((r, i) => ({ rank: i + 1, skill: r.skill.name, rating: r.label, average: r.average, ratings: r.count, score: r.score, ...(r.enough ? {} : { note: 'new, too few ratings to rank reliably' }), ...(r.skill.sample ? { sample: true } : {}) })),
        note: 'score is a damped average: with few ratings it stays close to the overall mean.',
        view: { space: 'skill-marketplace', tab: 'catalog' },
        dataSource,
      };
    },

    async rate_skill(args = {}) {
      const d = data();
      const skill = find(d, args.name);
      if (!Number.isInteger(args.stars) || args.stars < 1 || args.stars > 5) throw new ToolError('stars must be an integer from 1 to 5');
      const comment = args.comment === undefined ? '' : String(args.comment).trim();
      if (comment.length > 280) throw new ToolError('comment must be at most 280 characters');
      if (skill.sample) throw new ToolError(`"${skill.name}" is a sample skill and cannot be rated. Rate a published skill instead.`);
      if (!rpc) throw new ToolError('Ratings are stored in Supabase: add the Supabase URL and secret key to this connector.');
      const result = await rpc('skills_rate', { p_skill: skill.name, p_rater: who(), p_stars: args.stars, p_comment: comment, p_version: skill.version || 1 });
      const s = summarise(result.distribution, d.ratings?.settings);
      return { skill: skill.name, yourRating: args.stars, comment: comment || undefined, status: result.updated ? 'rating updated' : 'rating saved', now: s.label, ratings: s.count, dataSource: 'supabase' };
    },
  };
}
