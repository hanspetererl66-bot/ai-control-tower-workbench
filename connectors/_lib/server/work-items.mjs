/**
 * Work items in the shared database (Supabase, migration 021): agents, workflows and code of any kind (Python, JSON,
 * Markdown, ...). Every save is a new revision with all its files; nothing is overwritten, so the history stays complete.
 * Same identity rule as the skill registry: the acting person is named by e-mail ("actor"), every permission is checked in the
 * database function, and `actorOf` in skill-lifecycle.mjs stays the one place to change when the sign-in is decided.
 */
import { ToolError } from './tools.mjs';
import { actorOf } from './skill-lifecycle.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['agent', 'workflow', 'code'];
const VISIBILITY = ['private', 'team', 'company'];
const MAX_FILES = 200;
const MAX_CHARS = 1_000_000;
// Same pattern as the database check (werkbank.find_secret): refuse early, with the file name, before anything leaves the machine.
const SECRET = /(sb_secret_|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|(?:api[_-]?key|secret|password|passwort|token)\s*[:=]\s*['"]?[A-Za-z0-9_./+-]{8,})/i;
const PATH = /^[A-Za-z0-9._][A-Za-z0-9._/ -]{0,199}$/;

const ACTOR = { type: 'string', description: 'E-mail of the person acting (identity label, set once in the Werkbank). Never use someone else’s e-mail.' };
const ID = { type: 'string', description: 'Id of the work item (UUID), from list_work_items or save_work_item.' };
const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });

export const WORK_ITEM_TOOL_DEFINITIONS = [
  {
    name: 'save_work_item',
    description:
      'Write: save an agent, a workflow or code in the shared database as a new revision. Without id a new item is created (you are the owner); with id the item is changed and expected_rev must be the revision you loaded (otherwise someone changed it meanwhile). Send ALL files of the item every time (path, content, optional language): the revision is a full snapshot, earlier revisions stay available. Files must not contain keys, tokens or passwords. Ask the person before saving.',
    inputSchema: obj({
      actor: ACTOR,
      id: { type: 'string', description: 'Omit to create a new item; otherwise the id of the item to change.' },
      kind: { type: 'string', enum: KINDS, description: 'agent, workflow (for example n8n JSON) or code (Python, scripts, documents).' },
      name: { type: 'string', description: 'Name of the item, 1 to 120 characters.' },
      files: {
        type: 'array', minItems: 1, maxItems: MAX_FILES,
        items: obj({
          path: { type: 'string', description: 'Relative path, for example "agent.md", "workflow.json" or "src/main.py".' },
          content: { type: 'string', description: `File text, at most ${MAX_CHARS} characters.` },
          language: { type: 'string', description: 'Optional: markdown, json, python, ...' },
        }, ['path', 'content']),
        description: 'All files of this revision.',
      },
      visibility: { type: 'string', enum: VISIBILITY, description: 'Who may read it: private (default), team (needs team_id) or company.' },
      team_id: { type: 'string', description: 'Group id when visibility is team; you must be a member.' },
      stage: { type: 'string', description: 'Optional: where the item is in its process, for example "specification".' },
      intent: { type: 'object', description: 'Optional: the goal, systems and guardrails the item was built from (JSON, at most 64 KB).' },
      approved: { type: 'array', items: { type: 'string' }, description: 'Optional: the process steps already confirmed by the person.' },
      note: { type: 'string', description: 'Optional: what changed in this revision, at most 300 characters.' },
      expected_rev: { type: 'integer', minimum: 0, description: 'The revision you loaded (0 or omitted for a new item).' },
    }, ['actor', 'kind', 'name', 'files']),
  },
  {
    name: 'get_work_item',
    description: 'Read one agent, workflow or code item with its files: the current revision or an earlier one. Set include_content false to get only the file list (path, size, checksum).',
    inputSchema: obj({
      actor: ACTOR, id: ID,
      rev: { type: 'integer', minimum: 1, description: 'Optional: an earlier revision (default: the current one).' },
      include_content: { type: 'boolean', description: 'Default true.' },
    }, ['actor', 'id']),
  },
  {
    name: 'list_work_items',
    description: 'List the agents, workflows and code items the person may see (own, shared with their team, company-wide), newest first, without file contents.',
    inputSchema: obj({
      actor: ACTOR,
      kind: { type: 'string', enum: KINDS, description: 'Optional filter.' },
      include_archived: { type: 'boolean', description: 'Default false.' },
    }, ['actor']),
  },
  {
    name: 'work_item_history',
    description: 'The revisions of one item: number, author, note, time and file count, newest first.',
    inputSchema: obj({ actor: ACTOR, id: ID }, ['actor', 'id']),
  },
  {
    name: 'archive_work_item',
    description: 'Write: archive an item (it disappears from the default list, all revisions stay) or bring it back. Owner, team admin or Governance board only. Ask the person first.',
    inputSchema: obj({ actor: ACTOR, id: ID, archived: { type: 'boolean', description: 'true to archive, false to bring back.' } }, ['actor', 'id', 'archived']),
  },
];

const str = (args, name) => (typeof args[name] === 'string' ? args[name] : '');
const itemId = (args) => {
  const value = str(args, 'id').trim();
  if (!UUID.test(value)) throw new ToolError('id must be the id of a work item (UUID)');
  return value;
};

/** Checks that need no database: shape, size and credentials, so the person sees the problem with the file name. */
export function checkFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new ToolError('files must be a non-empty list of {path, content}');
  if (files.length > MAX_FILES) throw new ToolError(`at most ${MAX_FILES} files per save`);
  const seen = new Set();
  return files.map((file) => {
    const path = typeof file?.path === 'string' ? file.path : '';
    if (!PATH.test(path) || path.includes('..') || path.includes('//') || path.endsWith('/')) throw new ToolError(`invalid file path: ${path.slice(0, 60) || '(missing)'}`);
    if (seen.has(path)) throw new ToolError(`the path ${path} appears twice`);
    seen.add(path);
    if (typeof file.content !== 'string') throw new ToolError(`file ${path} has no content`);
    if (file.content.length > MAX_CHARS) throw new ToolError(`file ${path} is larger than ${MAX_CHARS} characters`);
    if (SECRET.test(file.content)) throw new ToolError(`file ${path} looks like it contains a credential (key, token or password). Remove it and use a setting instead`);
    return { path, language: typeof file.language === 'string' ? file.language.slice(0, 30) : '', content: file.content };
  });
}

export function createWorkItemHandlers(rpc) {
  const call = async (fn, body) => {
    if (!rpc) throw new ToolError('The shared database is not set up: enter the Supabase URL and the secret key in the settings of this connector.');
    return rpc(fn, body);
  };
  return {
    async save_work_item(args) {
      const kind = str(args, 'kind');
      if (!KINDS.includes(kind)) throw new ToolError('kind must be agent, workflow or code');
      const name = str(args, 'name').trim();
      if (name.length < 1 || name.length > 120) throw new ToolError('name must have 1 to 120 characters');
      const visibility = args.visibility === undefined ? 'private' : args.visibility;
      if (!VISIBILITY.includes(visibility)) throw new ToolError('visibility must be private, team or company');
      const team = str(args, 'team_id').trim();
      if (visibility === 'team' && !UUID.test(team)) throw new ToolError('team_id (group id) is required when visibility is team');
      const id = str(args, 'id').trim();
      if (id && !UUID.test(id)) throw new ToolError('id must be the id of a work item (UUID)');
      const expected = args.expected_rev === undefined ? 0 : args.expected_rev;
      if (!Number.isInteger(expected) || expected < 0) throw new ToolError('expected_rev must be a whole number');
      if (args.intent !== undefined && (typeof args.intent !== 'object' || args.intent === null || Array.isArray(args.intent))) throw new ToolError('intent must be an object');
      if (args.approved !== undefined && (!Array.isArray(args.approved) || args.approved.some((x) => typeof x !== 'string'))) throw new ToolError('approved must be a list of texts');
      return call('work_save', {
        p_actor: actorOf(args), p_id: id || null, p_kind: kind, p_name: name, p_visibility: visibility,
        p_team: visibility === 'team' ? team : null, p_stage: str(args, 'stage').slice(0, 40),
        p_intent: args.intent ?? {}, p_approved: args.approved ?? [], p_files: checkFiles(args.files),
        p_note: str(args, 'note').slice(0, 300), p_expected_rev: id ? expected : null,
      });
    },
    async get_work_item(args) {
      const rev = args.rev === undefined ? null : args.rev;
      if (rev !== null && (!Number.isInteger(rev) || rev < 1)) throw new ToolError('rev must be a whole number from 1');
      return call('work_get', { p_actor: actorOf(args), p_id: itemId(args), p_rev: rev, p_with_content: args.include_content !== false });
    },
    async list_work_items(args) {
      const kind = args.kind === undefined ? null : args.kind;
      if (kind !== null && !KINDS.includes(kind)) throw new ToolError('kind must be agent, workflow or code');
      return call('work_list', { p_actor: actorOf(args), p_kind: kind, p_include_archived: args.include_archived === true });
    },
    async work_item_history(args) {
      return call('work_history', { p_actor: actorOf(args), p_id: itemId(args) });
    },
    async archive_work_item(args) {
      if (typeof args.archived !== 'boolean') throw new ToolError('archived must be true or false');
      return call('work_archive', { p_actor: actorOf(args), p_id: itemId(args), p_archived: args.archived });
    },
  };
}
