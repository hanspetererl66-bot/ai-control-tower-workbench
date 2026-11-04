/**
 * Projects in the shared database. The Develop hub (workflows) and the Agent Studio (agents) keep their projects on this
 * computer; this module copies them to the work items of the shared database (migration 021) and back, so nothing is lost
 * with the computer and the same projects show up on every computer of the same person.
 *
 * MVP identity: the e-mail of the person (set in the Develop hub). The e-mail is added in the main process, never by the page.
 * Every save is a new revision with all files; the whole project is stored as `project.json`, the documents also as readable files.
 * Conflicts: if the project changed here and somewhere else, the other version is loaded and the local one is kept as a copy.
 */
import { sanitizeProjects as sanitizeAgentProjects, DOC_ORDER, type AgentProject } from './agent-project.ts';
import { sanitizeProject as sanitizeDevelopProject, artifactOf, interviewFiles, type Project } from './develop.ts';
import { extensionNote, sourcesOf } from './requirements.ts';

export type Api = { call: (tool: string, args: Record<string, unknown>) => Promise<any> };
/** `ext` = how many extensions the project had when it was last saved; a higher number now means the next revision is an extension. */
export type Entry = { itemId: string; rev: number; hash: string; ext?: number };
export type SyncMap = Record<string, Entry>;
export type Local = { agent: AgentProject[]; dev: Project[]; map: SyncMap };
export type SyncResult = Local & { pushed: number; pulled: number; removed: number; errors: string[] };

const AGENT_FORMAT = 'werkbank.agent-project.v1';
const DEVELOP_FORMAT = 'werkbank.develop-project.v1';
export const agentKey = (id: string) => `a:${id}`;
export const developKey = (id: string) => `d:${id}`;

/** Small stable hash of a text: tells whether a project changed since the last sync. */
export function hashOf(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + text.length;
}

export type Unit = { key: string; kind: 'agent' | 'workflow'; name: string; stage: string; approved: string[]; intent: Record<string, unknown>; files: Array<{ path: string; content: string; language: string }>; hash: string; ext: number; extNote: string };

const nameOf = (n: string, fallback: string) => (n.trim() || fallback).slice(0, 120);

export function agentUnit(p: AgentProject): Unit {
  const json = JSON.stringify({ format: AGENT_FORMAT, project: p });
  const files = [{ path: 'project.json', content: json, language: 'json' }];
  for (const k of DOC_ORDER) if (p.docs[k]?.trim()) files.push({ path: `${k}.md`, content: p.docs[k]!, language: 'markdown' });
  return {
    key: agentKey(p.id), kind: 'agent', name: nameOf(p.answers.name, 'New agent'), stage: Object.keys(p.confirmed).join(',').slice(0, 40),
    approved: Object.keys(p.confirmed), intent: { source: 'agent-project', objective: p.answers.objective, ...sourcesOf(p) }, files, hash: hashOf(json),
    ext: p.extensions?.length ?? 0, extNote: p.extensions?.length ? extensionNote(p.extensions[p.extensions.length - 1]) : '',
  };
}

export function developUnit(p: Project, toMarkdown: ((stored: string) => string) | null = null): Unit {
  const json = JSON.stringify({ format: DEVELOP_FORMAT, project: p });
  const files = [{ path: 'project.json', content: json, language: 'json' }];
  const art = artifactOf(p.kind, p.docs.build);
  if (art) files.push({ path: p.kind === 'workflow' ? 'workflow.json' : 'SKILL.md', content: art, language: p.kind === 'workflow' ? 'json' : 'markdown' });
  // The interview result (summary and the full log) is stored as a readable file next to project.json.
  for (const f of interviewFiles(p)) files.push({ path: f.name, content: f.text, language: 'markdown' });
  if (toMarkdown) {
    if (p.docs.prd.trim()) files.push({ path: 'PRD.md', content: toMarkdown(p.docs.prd), language: 'markdown' });
    if (p.docs.spec.trim()) files.push({ path: 'specification.md', content: toMarkdown(p.docs.spec), language: 'markdown' });
  }
  return { key: developKey(p.id), kind: p.kind, name: nameOf(p.intent.name, `New ${p.kind}`), stage: p.stage, approved: p.approved, intent: { source: 'develop-project', goal: p.intent.goal, ...sourcesOf(p) }, files, hash: hashOf(json), ext: p.extensions?.length ?? 0, extNote: p.extensions?.length ? extensionNote(p.extensions[p.extensions.length - 1]) : '' };
}

/** The project inside an item (project.json), or null when the item is not one of ours. */
export function restore(files: Array<{ path: string; content?: string }>): { source: 'agent' | 'dev'; agent?: AgentProject; dev?: Project } | null {
  const text = files.find((f) => f.path === 'project.json')?.content;
  if (!text) return null;
  try {
    const doc = JSON.parse(text);
    if (doc?.format === AGENT_FORMAT) { const p = sanitizeAgentProjects([doc.project])[0]; return p ? { source: 'agent', agent: p } : null; }
    if (doc?.format === DEVELOP_FORMAT) { const p = sanitizeDevelopProject(doc.project); return p ? { source: 'dev', dev: p } : null; }
  } catch { /* not ours */ }
  return null;
}

const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 200);
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * One round: take over what is new in the database, then send what changed here.
 * Nothing is thrown away silently: a project that changed on both sides is kept as a local copy.
 */
export async function syncOnce(api: Api, local: Local, toMarkdown: ((stored: string) => string) | null = null, now = Date.now()): Promise<SyncResult> {
  let agent = [...local.agent], dev = [...local.dev];
  const map: SyncMap = { ...local.map };
  const out = { pushed: 0, pulled: 0, removed: 0, errors: [] as string[] };
  const units = () => new Map<string, Unit>([...agent.map(agentUnit), ...dev.map((p) => developUnit(p, toMarkdown))].map((u) => [u.key, u]));
  const before = units();

  const remote: any[] = await api.call('list_work_items', { include_archived: true });
  const rows = (Array.isArray(remote) ? remote : []).filter((r) => r && (r.kind === 'agent' || r.kind === 'workflow'));
  const byItem = new Map<string, string>(Object.entries(map).map(([k, e]) => [e.itemId, k]));

  const replace = (key: string, r: NonNullable<ReturnType<typeof restore>>) => {
    if (r.agent) agent = agent.some((p) => p.id === r.agent!.id) ? agent.map((p) => (p.id === r.agent!.id ? r.agent! : p)) : [r.agent, ...agent];
    if (r.dev) dev = dev.some((p) => p.id === r.dev!.id) ? dev.map((p) => (p.id === r.dev!.id ? r.dev! : p)) : [r.dev, ...dev];
    return key;
  };

  for (const row of rows) {
    const key = byItem.get(row.id);
    const entry = key ? map[key] : undefined;
    try {
      if (row.archived) {
        if (key && entry) {
          const mine = before.get(key);
          if (mine && mine.hash === entry.hash) { // unchanged here: the removal elsewhere is taken over
            if (key.startsWith('a:')) agent = agent.filter((p) => agentKey(p.id) !== key); else dev = dev.filter((p) => developKey(p.id) !== key);
            out.removed++;
          }
          delete map[key]; // changed here: it is sent again as a new item
        }
        continue;
      }
      if (entry && key && row.current_rev <= entry.rev) continue;
      const item = await api.call('get_work_item', { id: row.id });
      const r = restore(item?.files ?? []);
      if (!r) continue;
      const k = r.agent ? agentKey(r.agent.id) : developKey(r.dev!.id);
      const mine = before.get(k);
      if (entry && key && mine && mine.hash !== entry.hash) {
        // changed here and elsewhere: keep a copy of the local version
        const copyId = r.agent ? newId('p-') : newId('p');
        if (key.startsWith('a:')) { const p = agent.find((x) => agentKey(x.id) === key); if (p) agent = [{ ...p, id: copyId, agentId: undefined, answers: { ...p.answers, name: `${p.answers.name} (local copy)`.slice(0, 60) }, updatedAt: now }, ...agent]; }
        else { const p = dev.find((x) => developKey(x.id) === key); if (p) dev = [{ ...p, id: copyId, intent: { ...p.intent, name: `${p.intent.name} (local copy)`.slice(0, 80) }, updatedAt: now }, ...dev]; }
      } else if (!entry && mine) {
        // known project without a link (the link was lost): the newer one wins
        const localAt = r.agent ? (agent.find((x) => agentKey(x.id) === k)?.updatedAt ?? 0) : (dev.find((x) => developKey(x.id) === k)?.updatedAt ?? 0);
        const remoteAt = (r.agent ?? r.dev)!.updatedAt;
        if (localAt > remoteAt) { map[k] = { itemId: row.id, rev: row.current_rev, hash: '' }; continue; }
      }
      replace(k, r);
      const fresh = r.agent ? agentUnit(r.agent) : developUnit(r.dev!, toMarkdown);
      map[k] = { itemId: row.id, rev: row.current_rev, hash: fresh.hash, ...(fresh.ext ? { ext: fresh.ext } : {}) };
      if (key && key !== k) delete map[key];
      out.pulled++;
    } catch (e) { out.errors.push(`${String(row.name ?? 'item')}: ${msg(e)}`); }
  }

  // Projects deleted here: archive the item.
  const now2 = units();
  for (const [key, entry] of Object.entries(map)) {
    if (now2.has(key) || before.has(key)) continue;
    try { await api.call('archive_work_item', { id: entry.itemId, archived: true }); delete map[key]; out.removed++; } catch (e) { out.errors.push(`archive: ${msg(e)}`); }
  }

  // What changed here: send it.
  for (const u of units().values()) {
    const entry = map[u.key];
    if (entry && entry.hash === u.hash) continue;
    try {
      const res = await api.call('save_work_item', {
        ...(entry ? { id: entry.itemId, expected_rev: entry.rev } : {}),
        kind: u.kind, name: u.name, files: u.files, stage: u.stage, approved: u.approved, intent: u.intent,
        note: entry && u.ext > (entry.ext ?? 0) && u.extNote ? u.extNote : 'Saved from the Werkbank',
      });
      map[u.key] = { itemId: String(res?.id ?? entry?.itemId), rev: Number(res?.rev ?? (entry?.rev ?? 0) + 1), hash: u.hash, ...(u.ext ? { ext: u.ext } : {}) };
      out.pushed++;
    } catch (e) { out.errors.push(`${u.name}: ${msg(e)}`); }
  }
  return { agent, dev, map, ...out };
}

export const SYNC_MAP_KEY = 'werkbank.workSync.map';
export function loadMap(store: Pick<Storage, 'getItem'>): SyncMap {
  try {
    const raw = JSON.parse(store.getItem(SYNC_MAP_KEY) ?? '{}');
    const out: SyncMap = {};
    for (const [k, v] of Object.entries(raw ?? {}) as Array<[string, any]>) if (/^[ad]:/.test(k) && typeof v?.itemId === 'string' && Number.isInteger(v.rev)) out[k] = { itemId: v.itemId, rev: v.rev, hash: String(v.hash ?? ''), ...(Number.isInteger(v.ext) && v.ext > 0 ? { ext: v.ext } : {}) };
    return out;
  } catch { return {}; }
}
export function saveMap(store: Pick<Storage, 'setItem'>, map: SyncMap): void { try { store.setItem(SYNC_MAP_KEY, JSON.stringify(map)); } catch { /* ignore */ } }

/**
 * The round took time; the person may have edited meanwhile. Apply what the round changed only where the project is still as it was
 * when the round started. A project that was edited meanwhile is left alone, and its link keeps the old state, so the next round
 * sees a change on both sides and keeps a copy instead of overwriting.
 */
export function applyBack(fresh: Local, before: Local, after: SyncResult): { local: Local; deferred: number } {
  let deferred = 0;
  const skipped = new Set<string>();
  const merge = <T extends { id: string }>(freshList: T[], beforeList: T[], afterList: T[], key: (id: string) => string): T[] => {
    const same = (a?: T, b?: T) => JSON.stringify(a) === JSON.stringify(b);
    let list = [...freshList];
    const ids = new Set([...beforeList, ...afterList].map((p) => p.id));
    for (const id of ids) {
      const b = beforeList.find((p) => p.id === id), a = afterList.find((p) => p.id === id), f = list.find((p) => p.id === id);
      if (same(a, b)) continue; // not touched by the round
      if (!b && a) { if (!f) list = [a, ...list]; continue; } // taken over
      if (b && !a) { if (same(f, b)) list = list.filter((p) => p.id !== id); else { deferred++; skipped.add(key(id)); } continue; } // removed elsewhere
      if (same(f, b)) list = list.map((p) => (p.id === id ? a! : p)); else { deferred++; skipped.add(key(id)); }
    }
    return list;
  };
  const agent = merge(fresh.agent, before.agent, after.agent, agentKey);
  const dev = merge(fresh.dev, before.dev, after.dev, developKey);
  const map: SyncMap = { ...after.map };
  for (const k of skipped) { if (before.map[k]) map[k] = before.map[k]; else delete map[k]; }
  return { local: { agent, dev, map }, deferred };
}
