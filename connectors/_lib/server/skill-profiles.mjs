/**
 * Skill marketplace profiles (read-only): impact, governance, lifecycle and discovery per skill,
 * process gaps and skill requests. Fictional sample data from the Skill Marketplace example Space;
 * read live from Supabase (public.skills_profiles, migration 012) when the connector has a connection.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from './tools.mjs';
import { summarise } from './rating-math.mjs';

const here = (path) => join(dirname(fileURLToPath(import.meta.url)), path);
const BOARD_AREAS = ['Finance', 'Sales', 'Marketing', 'Engineering'];
const RISKS = ['Minimal', 'Limited', 'High'];
const GAP_STATUSES = ['No skill', 'Skill requested', 'Skill in build'];

export function extractMarketplaceData(html) {
  const match = /<script type="application\/json" id="sm-data">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('Skill marketplace data block not found');
  return JSON.parse(match[1]);
}

export function loadMarketplaceData() {
  const candidates = [process.env.SKILL_MARKETPLACE_DATA, here('../data/skill-marketplace.json')].filter(Boolean);
  const file = candidates.find((path) => existsSync(path));
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  const page = here('../../../examples/skill-marketplace/index.html');
  if (existsSync(page)) return extractMarketplaceData(readFileSync(page, 'utf8'));
  throw new Error('Skill marketplace sample data not found');
}

export const SKILL_PROFILE_TOOL_DEFINITIONS = [
  {
    name: 'get_skill_impact',
    description:
      'Impact of the marketplace skills: runs per month, success and error rate, rating, minutes saved per run, hours saved, value in euro (hours × hourly rate), run cost and net value for the last full month, plus skills with little use. Without `name` it returns the overview and a ranking (sort by value, runs or success); with `name` the detail with the monthly runs. Answers "Welche Skills sparen am meisten Zeit?" or "Was kostet Skill X pro Monat?". Sample figures.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name, for example "expense-check".' },
        boardArea: { type: 'string', enum: BOARD_AREAS },
        sort: { type: 'string', enum: ['value', 'runs', 'success'], description: 'Order of the ranking (default value).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_skill_governance',
    description:
      'Governance of the marketplace skills: EU AI Act risk class, DPIA status, allowed data classes, approved models and region, review cycle with last and next review date, approval history and the linked Control Tower risks and agents. Without `name` a filtered list with counts (filter by aiActRisk, dpiaOpen, dueWithinDays); with `name` the detail. Answers "Welche Skills brauchen bis Jahresende ein Re-Review?" or "Welche Skills sind High-Risk?". Sample data.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name.' },
        aiActRisk: { type: 'string', enum: RISKS },
        dpiaOpen: { type: 'boolean', description: 'Only skills whose DPIA is in progress or not started.' },
        dueWithinDays: { type: 'integer', minimum: 0, maximum: 730, description: 'Only skills whose next review is due within this many days (overdue ones included).' },
        dataClass: { type: 'string', description: 'Only skills that may use this data class, for example "vertraulich".' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_skill_lifecycle',
    description:
      'Lifecycle of the marketplace skills: change log per version, dependencies (tools, connectors, other skills), replaced-by and sunset date, deputy owner, support channel, languages, last test result. With `name` the detail; with `dependsOn` (a tool, connector or skill name such as "ai-control-tower" or "expense-check") all skills that depend on it; without arguments the skills that need attention (sunset planned, no deputy, tests below 95%). Answers "Welche Skills hängen vom n8n-Konnektor ab?" or "Was ändert sich in Version 3?". Sample data.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name.' },
        dependsOn: { type: 'string', description: 'Tool, connector or skill name.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'find_skill_gaps',
    description:
      'Processes that have no skill yet (with priority, pain level, potential hours per month and status) and the skill requests from the teams with votes. Optionally filter by boardArea or status (No skill, Skill requested, Skill in build). Answers "Welche Prozesse im Einkauf haben noch keinen Skill?". Sample data.',
    inputSchema: {
      type: 'object',
      properties: {
        boardArea: { type: 'string', enum: BOARD_AREAS },
        status: { type: 'string', enum: GAP_STATUSES },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'recommend_skills',
    description:
      'Recommend marketplace skills for a role (for example "Controller", "Account Executive", "Platform Engineer") and/or a task in a few words (for example "Rechnungen abgleichen"). Returns the best matches with example prompts, demo flow, prerequisites, related skills, maturity and the risk class. Use it for "Empfiehl mir Skills für meine Rolle" or "Gibt es einen Skill für …?".',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role, case-insensitive; partial names work.' },
        task: { type: 'string', description: 'What the person wants to do, in a few words.' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'How many skills (default 5).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'recommend_skill_workflow',
    description:
      'Recommend an ordered sequence of marketplace skills for a role and/or a goal, so the person does not need to know every skill. Example: role "Account Manager", goal "Kundentermin und Verlängerung" returns the steps customer-call-prep, renewal-radar, quote-drafter and ticket-writer, each with why, input, output, maturity, risk class and warnings (sunset, replaced, not in the registry). Use it for "In welcher Reihenfolge nutze ich welche Skills …?". Sample playbooks.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role, for example "Account Manager"; partial names work.' },
        goal: { type: 'string', description: 'What the person wants to get done, in a few words.' },
        limit: { type: 'integer', minimum: 1, maximum: 5, description: 'How many workflows (default 2).' },
      },
      additionalProperties: false,
    },
  },
];

const round1 = (v) => Math.round(v * 10) / 10;
const sum = (list) => list.reduce((a, b) => a + b, 0);
const has = (text, needle) => String(text ?? '').toLowerCase().includes(String(needle).trim().toLowerCase());
const LAST_FULL = 4;

/** Contracts of the cost and value maths: last full month of the profile period, owners' estimates. */
export function economics(profile, hourlyRateEur) {
  const i = profile.impact;
  const runs = i.runsPerMonth[LAST_FULL] ?? 0;
  const hours = (runs * i.minutesSavedPerRun) / 60;
  const value = hours * hourlyRateEur;
  const cost = runs * i.costPerRunEur;
  const before = i.runsPerMonth[LAST_FULL - 1] ?? 0;
  return {
    runsLastFullMonth: runs,
    runsChangePct: before ? Math.round((runs / before - 1) * 100) : null,
    hoursSaved: round1(hours),
    valueEur: Math.round(value),
    runCostEur: round1(cost),
    netValueEur: Math.round(value - cost),
    runsSixMonths: sum(i.runsPerMonth),
  };
}

async function withProfiles(d, rpc) {
  if (rpc) {
    try {
      const live = await rpc('skills_profiles', {});
      if (live && live.profiles && Object.keys(live.profiles).length) {
        return { d: { ...d, profiles: live.profiles, processGaps: live.processGaps ?? d.processGaps, requests: live.requests ?? d.requests, assumptions: live.assumptions?.hourlyRateEur ? live.assumptions : d.assumptions }, dataSource: 'supabase (profiles)' };
      }
    } catch {
      // fall back to the embedded sample data below
    }
  }
  return { d, dataSource: 'sample data (Skill Marketplace example Space)' };
}

export function createSkillProfileHandlers(load = loadMarketplaceData, rpc = null) {
  const data = async () => {
    let d;
    try {
      d = load();
    } catch (error) {
      throw new ToolError(`Skill marketplace sample data unavailable: ${error.message}`);
    }
    return withProfiles(d, rpc);
  };
  const find = (d, name) => {
    const needle = String(name ?? '').trim().toLowerCase();
    if (!needle) throw new ToolError('name is required');
    const skill = d.skills.find((s) => s.name.toLowerCase() === needle) ?? d.skills.find((s) => s.name.toLowerCase().includes(needle));
    if (!skill) throw new ToolError(`No skill named "${name}". Known: ${d.skills.map((s) => s.name).join(', ')}`);
    const profile = d.profiles[skill.name];
    if (!profile) throw new ToolError(`Skill "${skill.name}" has no profile yet.`);
    return { skill, profile };
  };
  const head = (s) => ({ name: s.name, description: s.description, maturity: s.maturity, boardArea: s.boardArea, lob: s.lob, team: s.team, owner: s.owner, sample: Boolean(s.sample) });
  const ratingOf = (d, name) => summarise(d.ratings?.skills?.[name]?.distribution, d.ratings?.settings).label;
  const rows = (d) => d.skills.filter((s) => d.profiles[s.name]).map((s) => ({ skill: s, profile: d.profiles[s.name] }));
  const checkArea = (boardArea) => {
    if (boardArea !== undefined && !BOARD_AREAS.includes(boardArea)) throw new ToolError(`boardArea must be one of: ${BOARD_AREAS.join(', ')}`);
  };
  const daysUntil = (d, iso) => Math.round((new Date(`${iso}T00:00:00Z`) - new Date(`${d.asOf}T00:00:00Z`)) / 864e5);

  return {
    async get_skill_impact(args = {}) {
      const { d, dataSource } = await data();
      checkArea(args.boardArea);
      const rate = d.assumptions?.hourlyRateEur ?? 85;
      const assumptions = { hourlyRateEur: rate, basis: 'last full month (September), minutes saved per run are the owners\' estimates' };
      if (args.name !== undefined) {
        const { skill, profile } = find(d, args.name);
        const i = profile.impact;
        return { asOf: d.asOf, skill: head(skill), months: d.assumptions?.months, runsPerMonth: i.runsPerMonth, successRatePct: i.successRatePct, errorRatePct: i.errorRatePct, avgRating: i.avgRating, ratings: i.ratings, minutesSavedPerRun: i.minutesSavedPerRun, avgSeconds: i.avgSeconds, costPerRunEur: i.costPerRunEur, model: i.model, ...economics(profile, rate), assumptions, view: { space: 'skill-marketplace', tab: 'impact' }, dataSource };
      }
      const sort = args.sort ?? 'value';
      if (!['value', 'runs', 'success'].includes(sort)) throw new ToolError('sort must be one of: value, runs, success');
      const list = rows(d).filter(({ skill }) => !args.boardArea || skill.boardArea === args.boardArea).map(({ skill, profile }) => ({ ...head(skill), successRatePct: profile.impact.successRatePct, avgRating: profile.impact.avgRating, minutesSavedPerRun: profile.impact.minutesSavedPerRun, model: profile.impact.model, ...economics(profile, rate) }));
      const key = { value: 'valueEur', runs: 'runsLastFullMonth', success: 'successRatePct' }[sort];
      list.sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name));
      const runs = sum(list.map((x) => x.runsLastFullMonth));
      return {
        asOf: d.asOf,
        skills: list.length,
        totals: {
          runsLastFullMonth: runs,
          hoursSaved: round1(sum(list.map((x) => x.hoursSaved))),
          valueEur: sum(list.map((x) => x.valueEur)),
          runCostEur: round1(sum(list.map((x) => x.runCostEur))),
          weightedSuccessRatePct: runs ? round1(sum(list.map((x) => x.successRatePct * x.runsLastFullMonth)) / runs) : null,
        },
        sortedBy: sort,
        ranking: list,
        littleUse: list.filter((x) => x.runsSixMonths < 30).map((x) => x.name),
        assumptions,
        view: { space: 'skill-marketplace', tab: 'impact' },
        dataSource,
      };
    },

    async get_skill_governance(args = {}) {
      const { d, dataSource } = await data();
      const { aiActRisk, dpiaOpen, dueWithinDays, dataClass } = args;
      if (aiActRisk !== undefined && !RISKS.includes(aiActRisk)) throw new ToolError(`aiActRisk must be one of: ${RISKS.join(', ')}`);
      if (dpiaOpen !== undefined && typeof dpiaOpen !== 'boolean') throw new ToolError('dpiaOpen must be true or false');
      if (dueWithinDays !== undefined && !(Number.isInteger(dueWithinDays) && dueWithinDays >= 0 && dueWithinDays <= 730)) throw new ToolError('dueWithinDays must be an integer from 0 to 730');
      const shape = ({ skill, profile }) => ({ ...head(skill), ...profile.governance, daysUntilReview: daysUntil(d, profile.governance.nextReview) });
      if (args.name !== undefined) {
        const found = find(d, args.name);
        return { asOf: d.asOf, skill: shape(found), view: { space: 'skill-marketplace', tab: 'governance' }, dataSource };
      }
      const open = (g) => g.dpia === 'In progress' || g.dpia === 'Required, not started';
      const all = rows(d).map(shape);
      const list = all
        .filter((g) => (!aiActRisk || g.aiActRisk === aiActRisk) && (dpiaOpen === undefined || open(g) === dpiaOpen)
          && (dueWithinDays === undefined || g.daysUntilReview <= dueWithinDays) && (!dataClass || g.allowedDataClasses.some((c) => has(c, dataClass))))
        .sort((a, b) => a.daysUntilReview - b.daysUntilReview);
      return {
        asOf: d.asOf,
        count: list.length,
        totalSkills: all.length,
        byAiActRisk: Object.fromEntries(RISKS.map((r) => [r, all.filter((g) => g.aiActRisk === r).length])),
        dpiaOpen: all.filter(open).length,
        reviewOverdue: all.filter((g) => g.daysUntilReview < 0).length,
        reviewDueWithin30Days: all.filter((g) => g.daysUntilReview <= 30).length,
        skills: list,
        view: { space: 'skill-marketplace', tab: 'governance' },
        dataSource,
      };
    },

    async get_skill_lifecycle(args = {}) {
      const { d, dataSource } = await data();
      const view = { space: 'skill-marketplace', tab: 'catalog' };
      const shape = ({ skill, profile }) => ({ ...head(skill), version: skill.version, ...profile.lifecycle });
      if (args.name !== undefined) {
        const found = find(d, args.name);
        const usedBy = rows(d).filter(({ profile }) => profile.lifecycle.dependencies.skills.includes(found.skill.name)).map(({ skill }) => skill.name);
        return { asOf: d.asOf, skill: shape(found), usedBySkills: usedBy, view, dataSource };
      }
      if (args.dependsOn !== undefined) {
        const needle = String(args.dependsOn).trim();
        if (!needle) throw new ToolError('dependsOn must not be empty');
        const hits = rows(d).filter(({ profile }) => {
          const dep = profile.lifecycle.dependencies;
          return [...dep.tools, ...dep.connectors, ...dep.skills].some((x) => has(x, needle));
        }).map(({ skill, profile }) => ({ ...head(skill), dependencies: profile.lifecycle.dependencies }));
        return { asOf: d.asOf, dependsOn: needle, count: hits.length, skills: hits, view, dataSource };
      }
      const all = rows(d);
      const testPct = (l) => (l.tests.total ? Math.round((l.tests.passed / l.tests.total) * 100) : 0);
      return {
        asOf: d.asOf,
        totalSkills: all.length,
        sunsetPlanned: all.filter(({ profile }) => profile.lifecycle.sunsetDate).map(({ skill, profile }) => ({ name: skill.name, sunsetDate: profile.lifecycle.sunsetDate, replacedBy: profile.lifecycle.replacedBy })),
        noDeputy: all.filter(({ profile }) => !profile.lifecycle.deputy).map(({ skill }) => skill.name),
        noSupportChannel: all.filter(({ profile }) => !profile.lifecycle.supportChannel).map(({ skill }) => skill.name),
        testsBelow95Pct: all.filter(({ profile }) => testPct(profile.lifecycle) < 95).map(({ skill, profile }) => ({ name: skill.name, passed: profile.lifecycle.tests.passed, total: profile.lifecycle.tests.total, lastRun: profile.lifecycle.tests.lastRun })),
        hint: 'Pass name for one skill\'s change log and dependencies, or dependsOn to find skills that need a tool, connector or skill.',
        view,
        dataSource,
      };
    },

    async find_skill_gaps(args = {}) {
      const { d, dataSource } = await data();
      checkArea(args.boardArea);
      if (args.status !== undefined && !GAP_STATUSES.includes(args.status)) throw new ToolError(`status must be one of: ${GAP_STATUSES.join(', ')}`);
      const gaps = (d.processGaps ?? []).filter((g) => (!args.boardArea || g.boardArea === args.boardArea) && (!args.status || g.status === args.status)).sort((a, b) => b.minutesPerMonth - a.minutesPerMonth)
        .map((g) => ({ ...g, hoursPerMonth: round1(g.minutesPerMonth / 60) }));
      const requests = (d.requests ?? []).filter((r) => !args.boardArea || r.boardArea === args.boardArea).sort((a, b) => b.votes - a.votes);
      return {
        asOf: d.asOf,
        count: gaps.length,
        potentialHoursPerMonth: round1(sum(gaps.map((g) => g.minutesPerMonth)) / 60),
        gaps,
        requests,
        view: { space: 'skill-marketplace', tab: 'gaps' },
        dataSource,
      };
    },

    async recommend_skill_workflow(args = {}) {
      const { d, dataSource } = await data();
      const role = String(args.role ?? '').trim();
      const goal = String(args.goal ?? '').trim();
      if (!role && !goal) throw new ToolError('Give a role, a goal, or both.');
      const limit = args.limit === undefined ? 2 : args.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new ToolError('limit must be an integer between 1 and 5');
      const words = goal.toLowerCase().split(/[^a-zäöüß0-9-]+/).filter((w) => w.length > 3);
      const scored = (d.playbooks ?? []).map((pb) => {
        let score = 0;
        if (role && pb.roles.some((r) => has(r, role) || has(role, r))) score += 5;
        const text = [pb.title, pb.goal, ...pb.tags].join(' ').toLowerCase();
        for (const w of words) if (text.includes(w)) score += 2;
        return { pb, score };
      }).filter((r) => r.score >= 2).sort((a, b) => b.score - a.score || a.pb.id.localeCompare(b.pb.id)).slice(0, limit);
      const workflows = scored.map(({ pb }) => ({
        id: pb.id,
        title: pb.title,
        goal: pb.goal,
        roles: pb.roles,
        steps: pb.steps.map((st, i) => {
          const skill = d.skills.find((s) => s.name === st.skill);
          const profile = d.profiles[st.skill];
          const warnings = [];
          if (!skill) warnings.push('not in the registry');
          else if (skill.sample) warnings.push('sample skill, not published');
          if (skill && skill.maturity === 'pilot') warnings.push('pilot');
          if (profile?.lifecycle.replacedBy) warnings.push(`replaced by ${profile.lifecycle.replacedBy}`);
          if (profile?.lifecycle.sunsetDate) warnings.push(`sunset ${profile.lifecycle.sunsetDate}`);
          if (profile && daysUntil(d, profile.governance.nextReview) < 0) warnings.push('review overdue');
          return { step: i + 1, skill: st.skill, why: st.why, input: st.input, output: st.output, maturity: skill?.maturity, aiActRisk: profile?.governance.aiActRisk, rating: ratingOf(d, st.skill), examplePrompt: profile?.discovery.examplePrompts[0], ...(warnings.length ? { warnings } : {}) };
        }),
      }));
      return {
        role: role || undefined,
        goal: goal || undefined,
        count: workflows.length,
        workflows,
        hint: workflows.length ? 'Steps are in the order they are usually used. A step can be skipped when its output already exists.' : 'No workflow matches. Use recommend_skills for single skills or find_skill_gaps for missing ones.',
        view: { space: 'skill-marketplace', tab: 'catalog' },
        dataSource,
      };
    },

    async recommend_skills(args = {}) {
      const { d, dataSource } = await data();
      const role = String(args.role ?? '').trim();
      const task = String(args.task ?? '').trim();
      if (!role && !task) throw new ToolError('Give a role, a task, or both.');
      const limit = args.limit === undefined ? 5 : args.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new ToolError('limit must be an integer between 1 and 10');
      const words = task.toLowerCase().split(/[^a-zäöüß0-9-]+/).filter((w) => w.length > 2);
      const scored = rows(d).map(({ skill, profile }) => {
        const disc = profile.discovery;
        let score = 0;
        if (role && disc.recommendedFor.some((r) => has(r, role) || has(role, r))) score += 5;
        const text = [skill.name, skill.description, skill.process, skill.domain, ...disc.tags, ...disc.examplePrompts].join(' ').toLowerCase();
        for (const w of words) if (text.includes(w)) score += 2;
        score += Math.min(disc.favorites, 30) / 30;
        return { skill, profile, score };
      }).filter((r) => r.score >= (role || words.length ? 2 : 0)).sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name)).slice(0, limit);
      return {
        role: role || undefined,
        task: task || undefined,
        count: scored.length,
        skills: scored.map(({ skill, profile }) => ({ ...head(skill), aiActRisk: profile.governance.aiActRisk, rating: ratingOf(d, skill.name), examplePrompts: profile.discovery.examplePrompts, demoFlow: profile.discovery.demoFlow, prerequisites: profile.discovery.prerequisites, related: profile.discovery.related, recommendedFor: profile.discovery.recommendedFor, favorites: profile.discovery.favorites })),
        hint: scored.length ? undefined : 'No skill matches. Look at find_skill_gaps and consider requesting one.',
        view: { space: 'skill-marketplace', tab: 'catalog' },
        dataSource,
      };
    },
  };
}
