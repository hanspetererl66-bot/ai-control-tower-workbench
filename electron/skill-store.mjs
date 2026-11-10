/**
 * The window's access to the skill registry in the shared database (migrations 010, 019, 020).
 * Like work-store.mjs: URL and key come from the connector settings, the e-mail is the MVP identity, the page never sees the key.
 * What it does: register an imported skill at the lowest level (Individual), pull the person's visible skills with
 * sunset notices, read the usage ranking, and pass a few promotion calls to the lifecycle handlers (the database applies its own rules).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSkillLifecycleHandlers } from '../connectors/_lib/server/skill-lifecycle.mjs';
import { RuleError, supabaseRpc } from '../connectors/_lib/server/runtime.mjs';
import { publishSkills, syncSkills, trackSkills, rpc as registryRpc } from '../scripts/skills-registry.mjs';

/** Lifecycle tools the window may call. Deciding is allowed too: the database refuses the requester and non-admins. */
export const PROMOTION_TOOLS = new Set(['request_skill_promotion', 'list_skill_requests', 'withdraw_skill_request', 'decide_skill_request', 'get_skill_status']);

const say = (e) => (e instanceof RuleError ? e.message : `The database did not answer: ${e?.message ?? e}`);

export function createSkillStore({ credentials, skillsDir, fetchImpl = fetch }) {
  const need = () => {
    const c = credentials();
    if (!c) throw new Error('The shared database is not set up (Supabase URL and secret key in the connector settings) or no e-mail is known.');
    return c;
  };
  return {
    /** Registers an installed skill folder as an Individual draft owned by the person. Never throws: the local install stands either way. */
    async register(slug, files) {
      let c;
      try { c = need(); } catch (e) { return { ok: false, detail: e.message }; }
      const tmp = mkdtempSync(join(tmpdir(), 'werkbank-skill-'));
      try {
        // publishSkills reads a folder named after the skill; the files come from the verified package, not from disk state.
        const dir = join(tmp, slug);
        for (const f of files) { const to = join(dir, f.path); mkdirSync(join(to, '..'), { recursive: true }); writeFileSync(to, f.data); }
        const [res] = await publishSkills({ url: c.url, key: c.key, dirs: [dir], owner: c.email, forceScope: 'individual', fetchImpl });
        if (res?.blocked) return { ok: false, detail: `Not stored in the database: a similar skill exists (${res.similar.map((s) => s.slug).join(', ')}).` };
        return { ok: true, version: res?.version ?? null };
      } catch (e) {
        return { ok: false, detail: say(e) };
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    /** Registers an installed folder (by name) as an Individual draft, so a skill can be requested for promotion. */
    async registerInstalled(slug) {
      let c;
      try { c = need(); } catch (e) { return { ok: false, detail: e.message }; }
      try {
        const [res] = await publishSkills({ url: c.url, key: c.key, dirs: [join(skillsDir, slug)], owner: c.email, fetchImpl });
        if (res?.blocked) return { ok: false, detail: `A similar skill exists (${res.similar.map((x) => x.slug).join(', ')}). Declare a variant in the skill first.` };
        return { ok: true, version: res?.version ?? null };
      } catch (e) { return { ok: false, detail: say(e) }; }
    },
    /** Departments of the person: [{ id, name, role }]. */
    async groups() {
      const c = need();
      try { return { ok: true, rows: (await registryRpc({ url: c.url, key: c.key, fn: 'skills_my_groups', args: { p_actor: c.email }, fetchImpl })) ?? [] }; }
      catch (e) { return { ok: false, detail: say(e) }; }
    },
    /** Pull the person's visible skills (with Auslauf and Ersatz) into the skills folder. */
    async sync() {
      const c = need();
      try { return { ok: true, result: await syncSkills({ url: c.url, key: c.key, skillsDir, actor: c.email, fetchImpl }) }; }
      catch (e) { return { ok: false, detail: say(e) }; }
    },
    /** Counts that these skills were used in a conversation (event 'run'). Best effort: never throws, counts nothing without a database. */
    async trackRun(slugs) {
      let c;
      try { c = need(); } catch { return { ok: false, detail: 'no database' }; }
      const list = [...new Set((Array.isArray(slugs) ? slugs : []).filter((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9-]{1,48}$/.test(x)))].slice(0, 10);
      return { ok: await trackSkills({ url: c.url, key: c.key, slugs: list, event: 'run', fetchImpl }) };
    },
    /** Usage ranking of the last 30 days: [{ slug, installs, views, score, … }]. */
    async ranking() {
      const c = need();
      try { return { ok: true, rows: (await registryRpc({ url: c.url, key: c.key, fn: 'skills_ranking', args: { p_days: 30, p_limit: 50 }, fetchImpl })) ?? [] }; }
      catch (e) { return { ok: false, detail: say(e) }; }
    },
    /** Everything the Skill Health dashboard needs: one row per visible skill with usage, owner, department and lifecycle state. */
    async health() {
      const c = need();
      try { return { ok: true, data: (await registryRpc({ url: c.url, key: c.key, fn: 'skills_health_overview', args: { p_actor: c.email, p_limit: 1000 }, fetchImpl })) ?? { skills: [] }, actor: c.email }; }
      catch (e) { return { ok: false, detail: say(e) }; }
    },
    /** Phase out, retire or restore one skill; the database checks who may do it. */
    async lifecycle({ slug, action, reason, sunsetAt, replacedBy }) {
      if (!['deprecate', 'retire', 'restore'].includes(action)) return { ok: false, detail: 'This action is not allowed.' };
      const c = need();
      try {
        const args = { p_actor: c.email, p_slug: String(slug), p_action: action, p_reason: String(reason || '').slice(0, 400) || 'Changed in Skill health', p_sunset: sunsetAt || null, p_replaced_by: replacedBy || null };
        return { ok: true, data: await registryRpc({ url: c.url, key: c.key, fn: 'skills_lifecycle_change', args, fetchImpl }) };
      } catch (e) { return { ok: false, detail: say(e) }; }
    },
    async promotion(tool, args) {
      if (!PROMOTION_TOOLS.has(tool)) return { ok: false, detail: 'This call is not allowed.' };
      const c = need();
      const rpc = (fn, body) => supabaseRpc(fn, body, c.url, c.key);
      try { return { ok: true, data: await createSkillLifecycleHandlers(rpc)[tool]({ ...(args && typeof args === 'object' ? args : {}), actor: c.email }) }; }
      catch (e) { return { ok: false, detail: say(e) }; }
    },
  };
}
