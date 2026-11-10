/**
 * Studio agents (the form agents of the Agent Studio, src/agent-studio.ts) in the shared database.
 * Each agent is one work item (kind 'agent', stage 'studio-agent', migration 021) with the whole agent as studio-agent.json
 * plus a readable agent.md. The visibility of the item is the level of the agent: private = 0, team = 1, company = 2.
 *
 * The database decides the level, but a level this computer already had (the old local simulation) is never taken away silently:
 *  - first time an agent is seen in the database, its local level stays (the item starts private there, a request moves it up later);
 *  - afterwards the level follows the database whenever the database changed since the last round (map entry `lvl`).
 * Pushing an agent keeps the visibility the item has in the database (work_save would otherwise reset it to private);
 * with other content a shared agent falls back to private in the database (migration 047), the answer says so and the level follows.
 * Conflicts as with projects: changed here and elsewhere => the other version is loaded, the local one stays as "(local copy)".
 */
import { sanitizeAgents, type StudioAgent } from './agent-studio.ts';
import { hashOf, type Api } from './work-sync.ts';
import { levelOf, type LevelIndex, type SkillGov } from './skill-governance.ts';

export const STUDIO_STAGE = 'studio-agent';
export const STUDIO_FILE = 'studio-agent.json';
const FORMAT = 'werkbank.studio-agent.v1';
export const studioKey = (id: string) => `s:${id}`;

export type StudioEntry = { itemId: string; rev: number; hash: string; /** Level the database had at the last round. */ lvl?: LevelIndex };
export type StudioMap = Record<string, StudioEntry>;
export type StudioLocal = { agents: StudioAgent[]; map: StudioMap };
export type StudioResult = StudioLocal & { levels: Record<string, LevelIndex>; pushed: number; pulled: number; removed: number; errors: string[] };

export const levelFromVisibility = (v: unknown): LevelIndex => (v === 'company' ? 2 : v === 'team' ? 1 : 0);
const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 200);

export function studioUnit(a: StudioAgent) {
  const json = JSON.stringify({ format: FORMAT, agent: a });
  const text = [`# ${a.name}`, '', a.purpose, '', '## Instruction', a.instruction, '', `Sources: ${a.sources.join(', ') || 'none'}`, `Can write: ${a.canWrite ? 'yes, asks before writing' : 'no'}`, `Output: ${a.output}`, `Trigger: ${a.trigger.type} ${a.trigger.time}`].join('\n');
  return {
    key: studioKey(a.id), name: (a.name.trim() || 'New agent').slice(0, 120), hash: hashOf(json),
    files: [{ path: STUDIO_FILE, content: json, language: 'json' }, { path: 'agent.md', content: text, language: 'markdown' }],
    intent: { source: 'studio-agent', purpose: a.purpose.slice(0, 300), sources: a.sources.length, canWrite: a.canWrite },
  };
}

/** The agent inside an item, or null when the item is not a studio agent. */
export function restoreStudio(files: Array<{ path: string; content?: string }>): StudioAgent | null {
  const text = files.find((f) => f.path === STUDIO_FILE)?.content;
  if (!text) return null;
  try { const doc = JSON.parse(text); return doc?.format === FORMAT ? (sanitizeAgents([doc.agent])[0] ?? null) : null; } catch { return null; }
}

/** One round: take over what is new in the database, archive what was deleted here, send what changed here. */
export async function syncStudioAgents(api: Api, local: StudioLocal, now = Date.now()): Promise<StudioResult> {
  let agents = [...local.agents];
  const map: StudioMap = { ...local.map };
  const out = { pushed: 0, pulled: 0, removed: 0, errors: [] as string[] };
  const levels: Record<string, LevelIndex> = {};
  const unitsOf = () => new Map(agents.map((a) => [studioKey(a.id), studioUnit(a)]));
  const before = unitsOf();

  const remote: any[] = await api.call('list_work_items', { include_archived: true });
  const rows = (Array.isArray(remote) ? remote : []).filter((r) => r && r.kind === 'agent' && r.stage === STUDIO_STAGE);
  const byItem = new Map(Object.entries(map).map(([k, e]) => [e.itemId, k]));
  const visibility = new Map<string, unknown>();

  for (const row of rows) {
    const key = byItem.get(row.id);
    const entry = key ? map[key] : undefined;
    visibility.set(row.id, row.visibility);
    try {
      if (row.archived) {
        if (key && entry) {
          const mine = before.get(key);
          if (mine && mine.hash === entry.hash) { agents = agents.filter((a) => studioKey(a.id) !== key); out.removed++; }
          delete map[key]; // changed here: it is sent again as a new item
        }
        continue;
      }
      if (entry && key && row.current_rev <= entry.rev) continue;
      const item = await api.call('get_work_item', { id: row.id });
      const remoteAgent = restoreStudio(item?.files ?? []);
      if (!remoteAgent) continue;
      const k = studioKey(remoteAgent.id);
      const mine = before.get(k);
      const fresh = studioUnit(remoteAgent);
      if (entry && key === k && fresh.hash === entry.hash) { map[k] = { ...entry, rev: row.current_rev }; continue; } // only metadata changed elsewhere
      if (entry && key && mine && mine.hash !== entry.hash) {
        const mineAgent = agents.find((a) => studioKey(a.id) === k);
        if (mineAgent) agents = [{ ...mineAgent, id: `a-${now.toString(36)}${Math.random().toString(36).slice(2, 4)}`, name: `${mineAgent.name} (local copy)`.slice(0, 60) }, ...agents];
      } else if (!entry && mine) {
        const mineAgent = agents.find((a) => studioKey(a.id) === k);
        if (mineAgent && mineAgent.createdAt > remoteAgent.createdAt && mine.hash !== fresh.hash) { map[k] = { itemId: row.id, rev: row.current_rev, hash: '' }; continue; } // link lost: keep ours and push over it
      }
      agents = agents.some((a) => a.id === remoteAgent.id) ? agents.map((a) => (a.id === remoteAgent.id ? remoteAgent : a)) : [remoteAgent, ...agents];
      map[k] = { itemId: row.id, rev: row.current_rev, hash: fresh.hash, ...(entry?.lvl !== undefined ? { lvl: entry.lvl } : {}) };
      if (key && key !== k) delete map[key];
      out.pulled++;
    } catch (e) { out.errors.push(`${String(row.name ?? 'agent')}: ${msg(e)}`); }
  }

  // Agents deleted here: archive the item.
  const nowUnits = unitsOf();
  for (const [key, entry] of Object.entries(map)) {
    if (nowUnits.has(key) || before.has(key)) continue;
    try { await api.call('archive_work_item', { id: entry.itemId, archived: true }); delete map[key]; out.removed++; } catch (e) { out.errors.push(`archive: ${msg(e)}`); }
  }

  // What changed here: send it, keeping the visibility (= level) the item has in the database.
  for (const u of unitsOf().values()) {
    const entry = map[u.key];
    if (entry && entry.hash === u.hash) continue;
    try {
      let vis: Record<string, unknown> = {};
      if (entry) {
        const cur = await api.call('get_work_item', { id: entry.itemId });
        vis = { visibility: cur?.visibility ?? 'private', ...(cur?.visibility === 'team' && cur?.team_id ? { team_id: cur.team_id } : {}) };
        visibility.set(entry.itemId, cur?.visibility);
      }
      const res = await api.call('save_work_item', {
        ...(entry ? { id: entry.itemId, expected_rev: entry.rev } : {}), ...vis,
        kind: 'agent', name: u.name, stage: STUDIO_STAGE, files: u.files, intent: u.intent, note: 'Saved from the Werkbank',
      });
      const itemId = String(res?.id ?? entry?.itemId);
      map[u.key] = { itemId, rev: Number(res?.rev ?? (entry?.rev ?? 0) + 1), hash: u.hash, ...(entry?.lvl !== undefined ? { lvl: entry.lvl } : {}) };
      // The save answers with the visibility the item has now: a shared agent that got other content is private again (migration 047).
      if (!entry) visibility.set(itemId, 'private'); else if (typeof res?.visibility === 'string') visibility.set(itemId, res.visibility);
      out.pushed++;
    } catch (e) { out.errors.push(`${u.name}: ${msg(e)}`); }
  }

  for (const a of agents) { const e = map[studioKey(a.id)]; if (e && visibility.has(e.itemId)) levels[a.id] = levelFromVisibility(visibility.get(e.itemId)); }
  return { agents, map, levels, ...out };
}

/**
 * Bring the local level map in line with the database levels of one round (see the header for the rule).
 * Returns the new governance and the map with the level seen now remembered.
 */
export function applyAgentLevels(gov: SkillGov, levels: Record<string, LevelIndex>, map: StudioMap): { gov: SkillGov; map: StudioMap; changed: string[] } {
  const skills = { ...gov.skills };
  const nextMap: StudioMap = { ...map };
  const changed: string[] = [];
  for (const [id, db] of Object.entries(levels)) {
    const key = studioKey(id);
    const entry = nextMap[key];
    if (!entry) continue;
    const local = levelOf(gov, id);
    const follow = entry.lvl === undefined ? local === 0 && db !== 0 : db !== entry.lvl;
    if (follow && db !== local) { if (db === 0) delete skills[id]; else skills[id] = db; changed.push(id); }
    nextMap[key] = { ...entry, lvl: db };
  }
  return { gov: changed.length ? { ...gov, skills } : gov, map: nextMap, changed };
}

/** The round took time: apply its result only to agents that are still as they were when it started; the others wait for the next round. */
export function applyBackAgents(fresh: StudioLocal, before: StudioLocal, after: StudioResult): { local: StudioLocal; deferred: number } {
  let deferred = 0;
  const skipped = new Set<string>();
  const same = (a?: StudioAgent, b?: StudioAgent) => JSON.stringify(a) === JSON.stringify(b);
  let list = [...fresh.agents];
  const ids = new Set([...before.agents, ...after.agents].map((a) => a.id));
  for (const id of ids) {
    const b = before.agents.find((a) => a.id === id), a = after.agents.find((x) => x.id === id), f = list.find((x) => x.id === id);
    if (same(a, b)) continue;
    if (!b && a) { if (!f) list = [a, ...list]; continue; }
    if (b && !a) { if (same(f, b)) list = list.filter((x) => x.id !== id); else { deferred++; skipped.add(studioKey(id)); } continue; }
    if (same(f, b)) list = list.map((x) => (x.id === id ? a! : x)); else { deferred++; skipped.add(studioKey(id)); }
  }
  const map: StudioMap = { ...after.map };
  for (const k of skipped) { if (before.map[k]) map[k] = before.map[k]; else delete map[k]; }
  return { local: { agents: list, map }, deferred };
}

export const STUDIO_MAP_KEY = 'werkbank.studioAgentSync.map';
export function loadStudioMap(store: Pick<Storage, 'getItem'>): StudioMap {
  try {
    const raw = JSON.parse(store.getItem(STUDIO_MAP_KEY) ?? '{}');
    const out: StudioMap = {};
    for (const [k, v] of Object.entries(raw ?? {}) as Array<[string, any]>) if (/^s:/.test(k) && typeof v?.itemId === 'string' && Number.isInteger(v.rev)) out[k] = { itemId: v.itemId, rev: v.rev, hash: String(v.hash ?? ''), ...(v.lvl === 0 || v.lvl === 1 || v.lvl === 2 ? { lvl: v.lvl } : {}) };
    return out;
  } catch { return {}; }
}
export function saveStudioMap(store: Pick<Storage, 'setItem'>, map: StudioMap): void { try { store.setItem(STUDIO_MAP_KEY, JSON.stringify(map)); } catch { /* ignore */ } }
