/**
 * Extra files of a skill in the shared registry (migration 021): scripts, templates and reference documents next to SKILL.md.
 * SKILL.md itself is published with the skill; these files are the rest. Same identity rule as the other skill tools.
 */
import { ToolError } from './tools.mjs';
import { actorOf } from './skill-lifecycle.mjs';
import { checkFiles } from './work-items.mjs';

const SKILL = /^[a-z0-9][a-z0-9-]{1,48}$/;
const ACTOR = { type: 'string', description: 'E-mail of the person acting (identity label, set once in the Werkbank). Never use someone else’s e-mail.' };
const NAME = { type: 'string', description: 'Skill name, for example "expense-check".' };
const PATH = { type: 'string', description: 'Relative path inside the skill, for example "scripts/check.py". Not SKILL.md.' };
const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });

export const SKILL_FILE_TOOL_DEFINITIONS = [
  {
    name: 'list_skill_files',
    description: 'The extra files of a skill (scripts, templates, reference documents next to SKILL.md): path, language, size, checksum, who changed it last. Only skills the person may see.',
    inputSchema: obj({ actor: ACTOR, name: NAME }, ['actor', 'name']),
  },
  {
    name: 'get_skill_file',
    description: 'Read one extra file of a skill with its full text.',
    inputSchema: obj({ actor: ACTOR, name: NAME, path: PATH }, ['actor', 'name', 'path']),
  },
  {
    name: 'set_skill_file',
    description: 'Write: add or replace one extra file of a skill (owner, department admin or Governance board only), for example a Python script the skill runs. The text must not contain keys, tokens or passwords. Ask the person first.',
    inputSchema: obj({
      actor: ACTOR, name: NAME, path: PATH,
      content: { type: 'string', description: 'File text, at most 500000 characters.' },
      language: { type: 'string', description: 'Optional: python, markdown, json, ...' },
    }, ['actor', 'name', 'path', 'content']),
  },
  {
    name: 'delete_skill_file',
    description: 'Write: remove one extra file of a skill (owner, department admin or Governance board only). Ask the person first.',
    inputSchema: obj({ actor: ACTOR, name: NAME, path: PATH }, ['actor', 'name', 'path']),
  },
];

const str = (args, name) => (typeof args[name] === 'string' ? args[name] : '');
const skillName = (args) => {
  const value = str(args, 'name').trim();
  if (!SKILL.test(value)) throw new ToolError('name must be a skill name such as "expense-check"');
  return value;
};

export function createSkillFileHandlers(rpc) {
  const call = async (fn, body) => {
    if (!rpc) throw new ToolError('The shared database is not set up: enter the Supabase URL and the secret key in the settings of this connector.');
    return rpc(fn, body);
  };
  return {
    async list_skill_files(args) {
      return call('skills_files', { p_actor: actorOf(args), p_slug: skillName(args), p_path: null });
    },
    async get_skill_file(args) {
      const [file] = checkFiles([{ path: str(args, 'path'), content: '' }]);
      const result = await call('skills_files', { p_actor: actorOf(args), p_slug: skillName(args), p_path: file.path });
      if (!result) throw new ToolError(`The skill has no file ${file.path}`);
      return result;
    },
    async set_skill_file(args) {
      const [file] = checkFiles([{ path: str(args, 'path'), content: str(args, 'content'), language: args.language }]);
      if (file.path === 'SKILL.md') throw new ToolError('SKILL.md is the skill text itself; publish it with the skill');
      return call('skills_file_set', { p_actor: actorOf(args), p_slug: skillName(args), p_path: file.path, p_language: file.language, p_content: file.content });
    },
    async delete_skill_file(args) {
      const [file] = checkFiles([{ path: str(args, 'path'), content: '' }]);
      return call('skills_file_delete', { p_actor: actorOf(args), p_slug: skillName(args), p_path: file.path });
    },
  };
}
