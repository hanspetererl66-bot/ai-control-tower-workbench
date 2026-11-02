/**
 * The window's access to the shared database for the work items (agents, workflows, code; migration 021).
 * The page never sees the Supabase key and never names the person: this module reads URL and key from the settings of the
 * connector that already holds them, and adds the e-mail (MVP identity, one place to change when a real sign-in comes).
 * Only the five work item tools can be called, and each one goes through the same checks as the connector tools.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createWorkItemHandlers, WORK_ITEM_TOOL_DEFINITIONS } from '../connectors/_lib/server/work-items.mjs';
import { RuleError, supabaseRpc } from '../connectors/_lib/server/runtime.mjs';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const ALLOWED_TOOLS = new Set(WORK_ITEM_TOOL_DEFINITIONS.map((t) => t.name));
/** Connectors whose settings may hold the database access, in this order. */
export const CONFIG_SOURCES = ['werkbank-workspace', 'skill-marketplace'];

export function createWorkStore({ file, readConnector }) {
  const readEmail = () => {
    try { const v = existsSync(file) ? String(JSON.parse(readFileSync(file, 'utf8')).email ?? '') : ''; return EMAIL.test(v) ? v : ''; } catch { return ''; }
  };
  /** { url, key, source } from the first connector that has both; key is read only here. */
  const access = () => {
    for (const name of CONFIG_SOURCES) {
      const { url, key } = readConnector(name) ?? {};
      if (url && key) return { url, key, source: name };
    }
    return null;
  };
  return {
    status() { return { configured: !!access(), email: readEmail(), source: access()?.source ?? '' }; },
    setEmail(raw) {
      const email = String(raw ?? '').trim().toLowerCase();
      if (email && (!EMAIL.test(email) || email.length > 120)) return { ok: false, detail: 'This is not an e-mail address.' };
      writeFileSync(file, JSON.stringify({ email }), 'utf8');
      return { ok: true, email };
    },
    async call(tool, args) {
      if (!ALLOWED_TOOLS.has(tool)) throw new Error('This call is not allowed.');
      const acc = access();
      if (!acc) throw new Error('The shared database is not set up: enter the Supabase URL and the secret key in the settings of the connector "werkbank-workspace".');
      const email = readEmail();
      if (!email) throw new Error('Enter your e-mail first. It names you as the author of every saved revision.');
      const rpc = async (fn, body) => {
        try { return await supabaseRpc(fn, body, acc.url, acc.key); }
        catch (e) { if (e instanceof RuleError) throw new Error(e.message); throw new Error(`The database did not answer: ${e?.message ?? e}`); }
      };
      const handler = createWorkItemHandlers(rpc)[tool];
      return handler({ ...(args && typeof args === 'object' ? args : {}), actor: email });
    },
  };
}
