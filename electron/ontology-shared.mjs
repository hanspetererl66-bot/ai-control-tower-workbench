/**
 * Shared governance for the Ontology Manager (migration 026): the same document as governance.json, kept in the shared database
 * so that several people see the same owners, declared users, views and plans.
 * Like skill-store.mjs: URL and key come from the connector settings, the e-mail is the MVP identity, the page never sees the key.
 * The local file stays the working copy and the fallback. A save names the revision it was based on; the database refuses a
 * save on top of a newer revision and nothing is merged silently: the newer shared version is loaded and the person's own
 * version is kept next to it as governance.local-copy.json.
 */
import { supabaseRpc, RuleError } from '../connectors/_lib/server/runtime.mjs';
import { normalizeGovernance } from './ontology-store.mjs';

const say = (e) => (e instanceof RuleError ? e.message : `The shared database did not answer: ${e?.message ?? e}`);

export function createSharedGovernance({ credentials, rpcImpl = supabaseRpc }) {
  const need = () => {
    const c = credentials();
    if (!c) throw new Error('The shared database is not set up (Supabase URL and secret key in the connector settings) or no e-mail is known.');
    return c;
  };
  const shape = (r) => ({ rev: Number(r?.rev) || 0, governance: normalizeGovernance(r?.data), updatedBy: String(r?.updatedBy ?? ''), updatedAt: r?.updatedAt ?? null });
  return {
    /** The shared state: { ok, rev, governance, updatedBy, updatedAt }. Revision 0 = nothing shared yet. */
    async pull() {
      try {
        const c = need();
        return { ok: true, ...shape(await rpcImpl('ontology_governance_get', { p_actor: c.email }, c.url, c.key)) };
      } catch (e) { return { ok: false, detail: say(e) }; }
    },
    /** Saves `governance` on top of `baseRev`. On a conflict nothing is written and the newer shared version comes back. */
    async push(governance, baseRev) {
      try {
        const c = need();
        const res = await rpcImpl('ontology_governance_set', { p_actor: c.email, p_base_rev: Number(baseRev) || 0, p_data: normalizeGovernance(governance) }, c.url, c.key);
        return { ok: true, conflict: Boolean(res?.conflict), ...shape(res) };
      } catch (e) { return { ok: false, detail: say(e) }; }
    },
  };
}

const isEmpty = (g) => !Object.keys(g.ontologies).length && !g.bindings.length && !g.views.length && !g.plans.length && !Object.keys(g.termMeta ?? {}).length && !(g.questions ?? []).length && !Object.keys(g.usageDecisions ?? {}).length;

/**
 * Local file + shared database together. `save` writes the file first (it always works), then tries the database.
 * `open` runs when the view opens: it adopts newer shared data, uploads local data when nothing is shared yet, and on a clash
 * (local changes the database never got AND a newer shared revision) keeps the local version as governance.local-copy.json.
 * Result `state`: 'synced' | 'local' (database unreachable or not set up, the file has it) | 'conflict' (shared version loaded).
 */
export function createGovernanceSync({ store, shared }) {
  const done = (state, governance, extra = {}) => ({ ok: true, state, governance, ...extra });
  async function reconcile(local) {
    const meta = store.sharedMeta();
    const remote = await shared.pull();
    if (!remote.ok) return done('local', local, { detail: remote.detail });
    if (remote.rev === 0) {
      if (isEmpty(local)) return done('synced', local, { rev: 0 });
      const up = await shared.push(local, 0);
      if (!up.ok) { store.setSharedMeta({ rev: 0, dirty: true }); return done('local', local, { detail: up.detail }); }
      store.setSharedMeta({ rev: up.rev, dirty: false });
      return done('synced', up.governance, { rev: up.rev, by: up.updatedBy });
    }
    if (remote.rev === meta.rev) {
      if (!meta.dirty) return done('synced', local, { rev: remote.rev, by: remote.updatedBy });
      const up = await shared.push(local, meta.rev);
      if (!up.ok) return done('local', local, { detail: up.detail });
      if (!up.conflict) { store.setSharedMeta({ rev: up.rev, dirty: false }); return done('synced', up.governance, { rev: up.rev, by: up.updatedBy }); }
      return adopt(local, up);
    }
    if (meta.dirty) return adopt(local, remote);
    store.saveGovernance(remote.governance);
    store.setSharedMeta({ rev: remote.rev, dirty: false });
    return done('synced', remote.governance, { rev: remote.rev, by: remote.updatedBy, updated: true });
  }
  function adopt(local, remote) {
    const kept = store.saveLocalCopy(local);
    store.saveGovernance(remote.governance);
    store.setSharedMeta({ rev: remote.rev, dirty: false });
    return done('conflict', remote.governance, { rev: remote.rev, by: remote.updatedBy, localCopy: kept });
  }
  return {
    open: () => reconcile(store.read().governance ?? normalizeGovernance(null)),
    async save(input) {
      const saved = store.saveGovernance(input);
      if (!saved.ok) return saved;
      const meta = store.sharedMeta();
      const up = await shared.push(saved.governance, meta.rev);
      if (!up.ok) { store.setSharedMeta({ rev: meta.rev, dirty: true }); return { ...saved, state: 'local', detail: up.detail }; }
      if (up.conflict) return { ...adopt(saved.governance, up), ok: true };
      store.setSharedMeta({ rev: up.rev, dirty: false });
      return { ...saved, state: 'synced', rev: up.rev, by: up.updatedBy };
    },
  };
}
