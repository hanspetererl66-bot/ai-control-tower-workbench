/**
 * Groups of the Werkbank: a shared set of Spaces, one configuration and a team memory, stored in Supabase
 * (schema werkbank, functions werkbank_group_*). Every call names the acting person by e-mail ("actor").
 * The e-mail is an identity label, not a login: the Supabase secret key stays in this connector and every
 * rule (member, viewer, admin) is checked in the database function. Anything that looks like a secret is refused.
 * Self-contained apart from ToolError and findSecretName so it ships inside the .mcpb bundle.
 */
import { ToolError } from './tools.mjs';
import { findSecretName } from './preferences.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,59}$/;
const MAX_PACKAGE = 5 * 1024 * 1024;
const MAX_CONFIG = 64 * 1024;

const ACTOR = { type: 'string', description: 'E-mail of the person acting (identity label, set once in the Werkbank).' };
const GROUP = { type: 'string', description: 'Group id (UUID) from group_list.' };
const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });

export const GROUP_TOOL_DEFINITIONS = [
  { name: 'group_create', description: 'Create a group; the actor becomes its admin. Write.', inputSchema: obj({ actor: ACTOR, name: { type: 'string', description: '1 to 60 characters.' }, description: { type: 'string' }, actor_name: { type: 'string', description: 'Display name of the actor.' } }, ['actor', 'name']) },
  { name: 'group_list', description: 'List the groups the actor belongs to, with role and revision. Read only.', inputSchema: obj({ actor: ACTOR }, ['actor']) },
  { name: 'group_get', description: 'Load one group: members, published Spaces (without their files), configuration and team memory. Read only.', inputSchema: obj({ actor: ACTOR, group: GROUP }, ['actor', 'group']) },
  { name: 'group_set_member', description: 'Add a member or change a role (admin, member, viewer). Admin only. Write.', inputSchema: obj({ actor: ACTOR, group: GROUP, email: { type: 'string' }, role: { type: 'string', enum: ['admin', 'member', 'viewer'] }, name: { type: 'string' } }, ['actor', 'group', 'email', 'role']) },
  { name: 'group_remove_member', description: 'Remove a member (an admin, or the person themself). Write.', inputSchema: obj({ actor: ACTOR, group: GROUP, email: { type: 'string' } }, ['actor', 'group', 'email']) },
  { name: 'group_delete', description: 'Delete a group with its Spaces and memory. Admin only. Irreversible: ask the person first.', inputSchema: obj({ actor: ACTOR, group: GROUP }, ['actor', 'group']) },
  { name: 'group_publish_space', description: 'Publish a Space package (the file from "Share a Space") to the group; a new version replaces the old one. Admin or member. Write.', inputSchema: obj({ actor: ACTOR, group: GROUP, slug: { type: 'string' }, title: { type: 'string' }, package: { type: 'string', description: 'The Space package JSON as text, at most 5 MB.' } }, ['actor', 'group', 'slug', 'title', 'package']) },
  { name: 'group_get_space', description: 'Load the package of one group Space. Read only.', inputSchema: obj({ actor: ACTOR, group: GROUP, slug: { type: 'string' } }, ['actor', 'group', 'slug']) },
  { name: 'group_remove_space', description: 'Remove a Space from the group (its publisher or an admin). Write.', inputSchema: obj({ actor: ACTOR, group: GROUP, slug: { type: 'string' } }, ['actor', 'group', 'slug']) },
  { name: 'group_save_config', description: 'Save the group configuration (shared instructions, starter prompts, profiles; no secrets). Admin only. Write.', inputSchema: obj({ actor: ACTOR, group: GROUP, config: { type: 'object', description: 'At most 64 KB, no keys, tokens or passwords.' } }, ['actor', 'group', 'config']) },
  { name: 'group_memory_add', description: 'Add an entry to the team memory (fact, decision or rule, 1 to 600 characters). Admin or member. Write.', inputSchema: obj({ actor: ACTOR, group: GROUP, kind: { type: 'string', enum: ['fact', 'decision', 'rule'] }, text: { type: 'string' } }, ['actor', 'group', 'kind', 'text']) },
  { name: 'group_memory_update', description: 'Change a team memory entry (its author or an admin). Write.', inputSchema: obj({ actor: ACTOR, group: GROUP, id: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'decision', 'rule'] }, text: { type: 'string' } }, ['actor', 'group', 'id', 'kind', 'text']) },
  { name: 'group_memory_delete', description: 'Delete a team memory entry (its author or an admin). Ask the person first.', inputSchema: obj({ actor: ACTOR, group: GROUP, id: { type: 'string' } }, ['actor', 'group', 'id']) },
];

const str = (args, name) => (typeof args[name] === 'string' ? args[name] : '');
const email = (args, name) => {
  const v = str(args, name).trim().toLowerCase();
  if (!EMAIL.test(v)) throw new ToolError(`${name} must be an e-mail address`);
  return v;
};
const uuid = (args, name) => {
  const v = str(args, name).trim();
  if (!UUID.test(v)) throw new ToolError(`${name} must be an id (UUID)`);
  return v;
};
const slug = (args) => {
  const v = str(args, 'slug').trim();
  if (!SLUG.test(v)) throw new ToolError('slug must be lowercase letters, digits, . - _ (max 60 characters)');
  return v;
};

/** The database answers { ok:false, error, message } for rule violations; turn those into tool errors. */
const unwrap = (result) => {
  if (result && result.ok === false) throw new ToolError(result.message || result.error || 'Refused by the group rules.');
  return result;
};

/** `rpc(name, body)` performs the Supabase call and returns parsed JSON. */
export function createGroupHandlers(rpc) {
  const call = async (fn, body) => {
    if (!rpc) throw new ToolError('Groups are stored in Supabase: add the Supabase URL and secret key to this connector.');
    return unwrap(await rpc(fn, body));
  };
  const handlers = {
    group_create: (a) => call('werkbank_group_create', { p_actor: email(a, 'actor'), p_name: str(a, 'name'), p_description: str(a, 'description'), p_actor_name: str(a, 'actor_name') }),
    group_list: (a) => call('werkbank_group_list', { p_actor: email(a, 'actor') }),
    group_get: (a) => call('werkbank_group_get', { p_actor: email(a, 'actor'), p_group: uuid(a, 'group') }),
    group_set_member: (a) => call('werkbank_group_set_member', { p_actor: email(a, 'actor'), p_group: uuid(a, 'group'), p_email: email(a, 'email'), p_role: str(a, 'role'), p_name: str(a, 'name') }),
    group_remove_member: (a) => call('werkbank_group_remove_member', { p_actor: email(a, 'actor'), p_group: uuid(a, 'group'), p_email: email(a, 'email') }),
    group_delete: (a) => call('werkbank_group_delete', { p_actor: email(a, 'actor'), p_group: uuid(a, 'group') }),
    group_publish_space: (a) => {
      const pkg = str(a, 'package');
      if (Buffer.byteLength(pkg) > MAX_PACKAGE) throw new ToolError('The Space is larger than 5 MB.');
      return call('werkbank_group_publish_space', { p_actor: email(a, 'actor'), p_group: uuid(a, 'group'), p_slug: slug(a), p_title: str(a, 'title'), p_package: pkg });
    },
    group_get_space: (a) => call('werkbank_group_get_space', { p_actor: email(a, 'actor'), p_group: uuid(a, 'group'), p_slug: slug(a) }),
    group_remove_space: (a) => call('werkbank_group_remove_space', { p_actor: email(a, 'actor'), p_group: uuid(a, 'group'), p_slug: slug(a) }),
    group_save_config: (a) => {
      const config = a.config;
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new ToolError('config must be an object');
      const secret = findSecretName(config);
      if (secret) throw new ToolError(`Refused: "${secret}" looks like a secret. The group configuration must not contain keys, tokens or passwords.`);
      if (Buffer.byteLength(JSON.stringify(config)) > MAX_CONFIG) throw new ToolError('config is larger than 64 KB');
      return call('werkbank_group_save_config', { p_actor: email(a, 'actor'), p_group: uuid(a, 'group'), p_config: config });
    },
    group_memory_add: (a) => call('werkbank_group_memory_add', { p_actor: email(a, 'actor'), p_group: uuid(a, 'group'), p_kind: str(a, 'kind'), p_text: str(a, 'text') }),
    group_memory_update: (a) => call('werkbank_group_memory_update', { p_actor: email(a, 'actor'), p_group: uuid(a, 'group'), p_id: uuid(a, 'id'), p_kind: str(a, 'kind'), p_text: str(a, 'text') }),
    group_memory_delete: (a) => call('werkbank_group_memory_delete', { p_actor: email(a, 'actor'), p_group: uuid(a, 'group'), p_id: uuid(a, 'id') }),
  };
  // A thrown check must reach the caller as a rejected promise like any other tool error.
  return Object.fromEntries(Object.entries(handlers).map(([name, fn]) => [name, async (args) => fn(args)]));
}
