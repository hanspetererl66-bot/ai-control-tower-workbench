/**
 * Personal settings of the Werkbank, stored in one Supabase row (werkbank.preferences) per key.
 * Two tools: get_preferences (read) and save_preferences (the only write; one row, settings only).
 * The settings are look and working-style choices. Anything that looks like a secret is refused on save.
 * Self-contained apart from ToolError so it ships inside the .mcpb bundle.
 */
import { ToolError } from './tools.mjs';

const KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MAX_BYTES = 64 * 1024;
const SECRET_NAME = /(key|secret|token|password|passwd|credential|authorization)/i;
const KEY_PROP = { type: 'string', description: 'Name of the settings set, lowercase letters, digits, - and _. Default: default.' };

export const PREFERENCE_TOOL_DEFINITIONS = [
  {
    name: 'get_preferences',
    description: 'Load the saved personal Werkbank settings (colour, text size, profiles, starter prompts, assistant instructions, storage locations) from the Supabase table werkbank.preferences. Returns null data when nothing was saved yet. Read only.',
    inputSchema: { type: 'object', properties: { key: KEY_PROP }, additionalProperties: false },
  },
  {
    name: 'save_preferences',
    description: 'Save the personal Werkbank settings as one row in the Supabase table werkbank.preferences (replaces the row of that key). Settings only: no passwords, keys or tokens are accepted. Use only when the person asks to save their settings.',
    inputSchema: {
      type: 'object',
      properties: { key: KEY_PROP, data: { type: 'object', description: 'The settings object, at most 64 KB.' } },
      required: ['data'],
      additionalProperties: false,
    },
  },
];

/** First property name (at any depth) that looks like a secret, or null. */
export function findSecretName(value, path = '') {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const hit = findSecretName(item, `${path}[${i}]`);
      if (hit) return hit;
    }
  } else if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) {
      if (SECRET_NAME.test(name)) return `${path}.${name}`.replace(/^\./, '');
      const hit = findSecretName(item, `${path}.${name}`);
      if (hit) return hit;
    }
  }
  return null;
}

const keyOf = (args) => {
  const key = args.key === undefined || args.key === '' ? 'default' : String(args.key);
  if (!KEY.test(key)) throw new ToolError('key must be lowercase letters, digits, - or _ (max 40 characters)');
  return key;
};

/** `rpc(name, body)` performs the Supabase call and returns parsed JSON. */
export function createPreferenceHandlers(rpc) {
  const need = () => {
    if (!rpc) throw new ToolError('Settings are stored in Supabase: add the Supabase URL and secret key to this connector.');
    return rpc;
  };
  return {
    async get_preferences(args) {
      const key = keyOf(args);
      const row = await need()('werkbank_get_preferences', { p_key: key });
      return { key, data: row?.data ?? null, updatedAt: row?.updatedAt ?? null, dataSource: 'supabase' };
    },
    async save_preferences(args) {
      const key = keyOf(args);
      const data = args.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ToolError('data must be an object');
      const secret = findSecretName(data);
      if (secret) throw new ToolError(`Refused: "${secret}" looks like a secret. Settings must not contain keys, tokens or passwords.`);
      if (Buffer.byteLength(JSON.stringify(data)) > MAX_BYTES) throw new ToolError('data is larger than 64 KB');
      const row = await need()('werkbank_save_preferences', { p_key: key, p_data: data });
      return { key, saved: true, updatedAt: row?.updatedAt ?? null, dataSource: 'supabase' };
    },
  };
}
