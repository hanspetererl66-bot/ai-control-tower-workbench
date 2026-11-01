/**
 * Skill lifecycle of the shared registry (Supabase, migrations 019 and 020): the marketplace card, the check for
 * duplicates, the approval flow (request, decide, withdraw) and deprecate, retire, restore, with the history of every step.
 * Every call names the acting person by e-mail ("actor"). The e-mail is an identity label, not a login: the Supabase secret key
 * stays in this connector and every rule (who may decide, no self-approval, sunset before retirement) is checked in the database
 * function. `actorOf` is the one place that decides who is acting; replace it when the sign-in (SSO) is decided.
 */
import { ToolError } from './tools.mjs';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SKILL = /^[a-z0-9][a-z0-9-]{1,48}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Mirrors the secret pattern of skills.run_checks (migration 019): the card is shown to colleagues, so no credentials in it.
const SECRET = /(sb_secret_|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|(?:api[_-]?key|secret|password|passwort|token)\s*[:=]\s*['"]?[A-Za-z0-9_./+-]{8,})/i;

const ACTOR = { type: 'string', description: 'E-mail of the person acting (identity label, set once in the Werkbank). Never use someone else’s e-mail.' };
const NAME = { type: 'string', description: 'Skill name, for example "expense-check".' };
const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });

export const SKILL_LIFECYCLE_TOOL_DEFINITIONS = [
  {
    name: 'check_skill_duplicates',
    description:
      'Before building or sharing a skill: does a similar or identical skill already exist? Compares the description (and, if given, the text, domain and tools) with the skills that are shared (department, organization) and with the actor’s own. Verdict "identical" (same text: use that skill), "similar" (ask its owner or declare the new skill a variant), "variant" (similar, but declared as a variant) or "none". Individual skills of other people are not compared. Needs the Supabase connection. Read only.',
    inputSchema: obj({
      actor: ACTOR,
      description: { type: 'string', description: 'What the skill should do, 1 to 240 characters.' },
      name: { type: 'string', description: 'Skill name if it already exists in the registry (excludes itself from the comparison).' },
      domain: { type: 'string', description: 'Domain, for example "Finanzen".' },
      tools: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Connector tools the skill uses, for example ["get_invoices"].' },
      text: { type: 'string', description: 'The skill text (SKILL.md), at most 20000 characters. Needed to find an identical copy.' },
    }, ['actor', 'description']),
  },
  {
    name: 'get_skill_card',
    description:
      'The marketplace card of a skill: description, when to use it, when not, inputs, outputs and an example prompt, plus what is still missing before it may be shared with a department (level "team") or the whole organization (level "company"). Read only. Needs the Supabase connection.',
    inputSchema: obj({
      actor: ACTOR,
      name: NAME,
      level: { type: 'string', enum: ['team', 'company'], description: 'Level the skill wants to reach (default team). The organization level also needs a contact and a domain.' },
    }, ['actor', 'name']),
  },
  {
    name: 'set_skill_card',
    description:
      'Write the marketplace card of a skill (owner, department admin or Governance board only): when to use it, optionally when not, inputs, outputs and an example prompt. Replaces the earlier card as a whole. A skill cannot be shared before its card is complete. No credentials or customer data in the text. Write: show the person the text first.',
    inputSchema: obj({
      actor: ACTOR,
      name: NAME,
      use_when: { type: 'string', description: 'When to use the skill, 1 to 400 characters.' },
      not_for: { type: 'string', description: 'Optional: when not to use it, at most 300 characters.' },
      inputs: { type: 'string', description: 'What the skill needs, 1 to 300 characters.' },
      outputs: { type: 'string', description: 'What it returns, 1 to 300 characters.' },
      example_prompt: { type: 'string', description: 'A prompt that starts the skill, 1 to 300 characters.' },
    }, ['actor', 'name', 'use_when', 'inputs', 'outputs', 'example_prompt']),
  },
  {
    name: 'get_skill_status',
    description:
      'Live lifecycle state of one skill in the registry (not the sample profile of get_skill_lifecycle): draft, department, in_review, blocked, published, deprecated or retired, its level, version, sunset date and replacement, the open approval request with its automatic checks, what is missing on the card, whether the actor may change it, and the history (who did what and why). Only skills the actor may see. Read only. Needs the Supabase connection.',
    inputSchema: obj({ actor: ACTOR, name: NAME }, ['actor', 'name']),
  },
  {
    name: 'list_skill_lifecycle',
    description:
      'Lifecycle overview of the skills the actor may see: how many are in each state, the skills themselves, those that need attention (sunset passed or close, checks failed) and how many approval requests wait for this person. Read only. Needs the Supabase connection.',
    inputSchema: obj({ actor: ACTOR }, ['actor']),
  },
  {
    name: 'list_skill_requests',
    description:
      'Approval requests for skills: the actor’s own and those waiting for the actor to decide (department admin or Governance board), with the automatic checks (secrets, scripts, permissions, harness, data, description, duplicate) and whether the actor can decide. Read only. Needs the Supabase connection.',
    inputSchema: obj({ actor: ACTOR }, ['actor']),
  },
  {
    name: 'request_skill_promotion',
    description:
      'Ask to share a skill: from Individual to a department (to "team", the actor must be a member) or from a department to the whole organization (to "company"). The seven automatic checks run on the exact version; a failed check blocks the request, otherwise a person who is not the requester decides. Write: ask the person first and say which level.',
    inputSchema: obj({
      actor: ACTOR,
      name: NAME,
      to: { type: 'string', enum: ['team', 'company'], description: 'Target level.' },
      group: { type: 'string', description: 'Department (group id, UUID from group_list). Required for "team".' },
      note: { type: 'string', description: 'Optional note for the reviewer, at most 400 characters.' },
    }, ['actor', 'name', 'to']),
  },
  {
    name: 'decide_skill_request',
    description:
      'Approve or reject an approval request (department admin for a department, Governance board for the organization; never the requester). Rejecting needs a reason. Write: only when the person who decides has told you their decision. Never decide for someone else and never approve on your own initiative.',
    inputSchema: obj({
      actor: ACTOR,
      id: { type: 'string', description: 'Request id (UUID) from list_skill_requests.' },
      approve: { type: 'boolean', description: 'true to approve, false to reject.' },
      reason: { type: 'string', description: 'Reason, at most 400 characters. Required to reject.' },
    }, ['actor', 'id', 'approve']),
  },
  {
    name: 'withdraw_skill_request',
    description: 'Withdraw an open approval request. Only the person who made the request. Write: ask the person first.',
    inputSchema: obj({ actor: ACTOR, id: { type: 'string', description: 'Request id (UUID) from list_skill_requests.' } }, ['actor', 'id']),
  },
  {
    name: 'deprecate_skill',
    description:
      'Announce that a shared skill (department or organization) will end: sets a sunset date and, optionally, the skill that replaces it. The skill stays usable until it is retired and everyone who syncs it sees the date. Owner, department admin or Governance board. Write: ask the person first.',
    inputSchema: obj({
      actor: ACTOR,
      name: NAME,
      sunset: { type: 'string', description: 'Sunset date, YYYY-MM-DD, today or later and within two years.' },
      reason: { type: 'string', description: 'Why, 1 to 400 characters.' },
      replaced_by: { type: 'string', description: 'Optional: name of the skill that replaces it.' },
    }, ['actor', 'name', 'sunset', 'reason']),
  },
  {
    name: 'retire_skill',
    description:
      'Take a skill out of the marketplace and out of every sync. A skill published for everyone is deprecated first; its owner may retire it after the sunset date, the Governance board at any time. A skill with active variants cannot be retired. Open requests are withdrawn. Owner, department admin or Governance board. Write: ask the person first.',
    inputSchema: obj({
      actor: ACTOR,
      name: NAME,
      reason: { type: 'string', description: 'Why, 1 to 400 characters.' },
      replaced_by: { type: 'string', description: 'Optional: name of the skill that replaces it.' },
    }, ['actor', 'name', 'reason']),
  },
  {
    name: 'restore_skill',
    description:
      'Undo a deprecation (the skill stays at its level) or bring a retired skill back as an Individual draft. A restored skill needs a new approval before it is shared again. Owner, department admin or Governance board. Write: ask the person first.',
    inputSchema: obj({ actor: ACTOR, name: NAME, reason: { type: 'string', description: 'Why, 1 to 400 characters.' } }, ['actor', 'name', 'reason']),
  },
];

const str = (args, name) => (typeof args[name] === 'string' ? args[name] : '');
/** The one place that decides who is acting. Replace with the signed-in person once the sign-in is decided. */
export const actorOf = (args) => {
  const value = str(args, 'actor').trim().toLowerCase();
  if (!EMAIL.test(value) || value.length > 120) throw new ToolError('actor must be an e-mail address');
  return value;
};
const skillName = (args, field = 'name') => {
  const value = str(args, field).trim();
  if (!SKILL.test(value)) throw new ToolError(`${field} must be a skill name such as "expense-check"`);
  return value;
};
const uuid = (args, field) => {
  const value = str(args, field).trim();
  if (!UUID.test(value)) throw new ToolError(`${field} must be an id (UUID)`);
  return value;
};
/** Text of 1..max characters (or 0..max when optional); no credentials. */
const text = (args, field, max, { optional = false } = {}) => {
  const value = str(args, field).trim();
  if (!value && optional) return '';
  if (!value || value.length > max) throw new ToolError(`${field} must be 1 to ${max} characters`);
  if (SECRET.test(value)) throw new ToolError(`${field} looks like a credential. Remove it: the card and the reasons are visible to colleagues.`);
  return value;
};
const day = (args, field) => {
  const value = str(args, field).trim();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!DAY.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ToolError(`${field} must be a date as YYYY-MM-DD`);
  }
  return value;
};

/** `rpc(name, body)` performs the Supabase call and returns parsed JSON; database rules arrive as ToolError. */
export function createSkillLifecycleHandlers(rpc) {
  const call = async (fn, body) => {
    if (!rpc) throw new ToolError('The skill lifecycle lives in Supabase: add the Supabase URL and secret key to this connector.');
    return rpc(fn, body);
  };
  const change = (action, extra = () => ({})) => async (args) => {
    const result = await call('skills_lifecycle_change', {
      p_actor: actorOf(args), p_slug: skillName(args), p_action: action, p_reason: text(args, 'reason', 400),
      p_sunset: null, p_replaced_by: args.replaced_by === undefined ? null : skillName(args, 'replaced_by'), ...extra(args),
    });
    return { skill: result, dataSource: 'supabase' };
  };
  return {
    async check_skill_duplicates(args) {
      const description = text(args, 'description', 240);
      const body = args.text === undefined ? null : text(args, 'text', 20000);
      const tools = args.tools === undefined ? [] : args.tools;
      if (!Array.isArray(tools) || tools.length > 20 || tools.some((tool) => typeof tool !== 'string' || !/^[a-z][a-z0-9_]{1,60}$/.test(tool))) {
        throw new ToolError('tools must be a list of at most 20 tool names such as "get_invoices"');
      }
      const result = await call('skills_check_duplicates', {
        p_actor: actorOf(args), p_slug: args.name === undefined ? null : skillName(args), p_description: description,
        p_domain: str(args, 'domain').trim().slice(0, 40) || null, p_tools: tools, p_body: body,
      });
      const hint = {
        identical: 'The same text already exists: use or extend that skill instead of building a copy.',
        similar: 'A similar skill exists. Ask its owner or team first. If the new skill is meant to differ, declare it as a variant (variant_of and variant_reason).',
        variant: 'Similar skills exist, but this one is declared as a variant of them.',
        none: 'No shared skill looks like this one.',
      }[result?.verdict];
      return { ...result, hint, dataSource: 'supabase' };
    },
    async get_skill_card(args) {
      const level = args.level === undefined ? 'team' : args.level;
      if (!['team', 'company'].includes(level)) throw new ToolError('level must be "team" or "company"');
      return { card: await call('skills_card_get', { p_actor: actorOf(args), p_slug: skillName(args), p_to: level }), dataSource: 'supabase' };
    },
    async set_skill_card(args) {
      const card = await call('skills_card_set', {
        p_actor: actorOf(args), p_slug: skillName(args), p_use_when: text(args, 'use_when', 400), p_not_for: text(args, 'not_for', 300, { optional: true }),
        p_inputs: text(args, 'inputs', 300), p_outputs: text(args, 'outputs', 300), p_example: text(args, 'example_prompt', 300),
      });
      return { card, dataSource: 'supabase' };
    },
    async get_skill_status(args) {
      return { status: await call('skills_lifecycle_state', { p_actor: actorOf(args), p_slug: skillName(args) }), dataSource: 'supabase' };
    },
    async list_skill_lifecycle(args) {
      return { ...(await call('skills_lifecycle_overview', { p_actor: actorOf(args) })), dataSource: 'supabase' };
    },
    async list_skill_requests(args) {
      const requests = await call('skills_promotion_list', { p_actor: actorOf(args) });
      return { count: requests.length, requests, dataSource: 'supabase' };
    },
    async request_skill_promotion(args) {
      if (!['team', 'company'].includes(args.to)) throw new ToolError('to must be "team" or "company"');
      if (args.to === 'team' && !str(args, 'group').trim()) throw new ToolError('group (the department id) is required for "team"');
      const result = await call('skills_promotion_request', {
        p_actor: actorOf(args), p_slug: skillName(args), p_to_scope: args.to, p_group: args.to === 'team' ? uuid(args, 'group') : null,
        p_note: text(args, 'note', 400, { optional: true }),
      });
      return {
        request: result,
        hint: result?.status === 'blocked'
          ? 'An automatic check failed. Read the checks with get_skill_status, fix the skill or its card, withdraw this request and ask again.'
          : 'The request waits for a person who is not the requester. They find it with list_skill_requests.',
        dataSource: 'supabase',
      };
    },
    async decide_skill_request(args) {
      if (typeof args.approve !== 'boolean') throw new ToolError('approve must be true or false');
      const reason = text(args, 'reason', 400, { optional: args.approve });
      return { decision: await call('skills_promotion_decide', { p_actor: actorOf(args), p_id: uuid(args, 'id'), p_approve: args.approve, p_reason: reason }), dataSource: 'supabase' };
    },
    async withdraw_skill_request(args) {
      return { withdrawn: await call('skills_promotion_withdraw', { p_actor: actorOf(args), p_id: uuid(args, 'id') }), dataSource: 'supabase' };
    },
    deprecate_skill: change('deprecate', (args) => ({ p_sunset: day(args, 'sunset') })),
    retire_skill: change('retire'),
    restore_skill: change('restore'),
  };
}
