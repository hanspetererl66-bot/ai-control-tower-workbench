/**
 * Sharing your own memory entries: the entry goes to the shared database only when you ask to share it, first as a private item,
 * and a second person decides (same roles and rules as skills and agents, migrations 044 and 045).
 *  - the link between a local entry and its item is kept in the map (entry id -> item id, revision, hash);
 *  - once an entry is shared (team or company) its text is fixed in the database (migration 046): "make private" first, then ask again;
 *  - a level above 0 that only exists locally (the old simulation) is never uploaded: asking starts at the department;
 *  - the level of an entry that has an item always comes from the database.
 */
import { requestAgentLevel } from './agent-promotion-db.ts';
import { MEMORY_FILE, MEMORY_FORMAT } from './memory-shared.ts';
import type { MemoryEntry } from './memory.ts';
import { hashOf, type Api } from './work-sync.ts';
import { levelOf, type LevelIndex, type SkillGov } from './skill-governance.ts';

export const MEMORY_STAGE = 'memory-entry';
export const SHARE_MAP_KEY = 'werkbank.memory.itemMap';
export type ShareEntry = { itemId: string; rev: number; hash: string };
export type ShareMap = Record<string, ShareEntry>;

export function entryUnit(e: MemoryEntry) {
  const json = JSON.stringify({ format: MEMORY_FORMAT, entry: { id: e.id, kind: e.kind, text: e.text, ...(e.space ? { space: e.space } : {}) } });
  return {
    name: (e.text.slice(0, 60) || 'Memory entry'), hash: hashOf(json),
    files: [{ path: MEMORY_FILE, content: json, language: 'json' }, { path: 'memory.md', content: e.text, language: 'markdown' }],
  };
}

const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 200);

/** Make sure the database has the current text of the entry (as a private item). Returns the new map entry. */
async function upload(api: Api, map: ShareMap, e: MemoryEntry): Promise<ShareEntry> {
  const u = entryUnit(e);
  const have = map[e.id];
  if (have && have.hash === u.hash) return have;
  const res = await api.call('save_work_item', {
    ...(have ? { id: have.itemId, expected_rev: have.rev, visibility: 'private' } : {}),
    kind: 'memory', name: u.name, stage: MEMORY_STAGE, files: u.files, intent: { source: 'memory-entry', kind: e.kind }, note: 'Saved from the Werkbank',
  });
  return { itemId: String(res?.id ?? have?.itemId), rev: Number(res?.rev ?? (have?.rev ?? 0) + 1), hash: u.hash };
}

/** The level asked from: what the database has for this entry (0 when it has no item yet, whatever the local simulation says). */
export const dbLevelOf = (gov: SkillGov, map: ShareMap, id: string): LevelIndex => (map[id] ? levelOf(gov, id) : 0);

/** Upload (if needed) and ask for the next level. A request the checks block is withdrawn at once; the item stays private in the database. */
export async function requestEntry(api: Api, map: ShareMap, e: MemoryEntry, level: LevelIndex, groupId: string, note: string): Promise<{ map: ShareMap; id?: string; warnings?: string[]; error?: string }> {
  // A shared entry is fixed text; a changed text would silently make it private again. Make it private first, on purpose.
  if (level > 0 && map[e.id] && map[e.id].hash !== entryUnit(e).hash) return { map, error: 'The text changed after it was shared. Make the entry private first, then ask again.' };
  let next = { ...map };
  try { next[e.id] = await upload(api, next, e); } catch (err) { return { map, error: `Not saved in the shared database: ${msg(err)}` }; }
  try {
    const r = await requestAgentLevel(api, { itemId: next[e.id].itemId, level: level as 0 | 1 | 2, groupId, note });
    return { map: next, ...r };
  } catch (err) { return { map: next, error: msg(err) }; }
}

/** Take a shared entry back to private so it can be edited and asked for again. */
export async function makePrivate(api: Api, map: ShareMap, e: MemoryEntry): Promise<{ map: ShareMap; error?: string }> {
  const have = map[e.id];
  if (!have) return { map };
  try {
    const cur = await api.call('get_work_item', { id: have.itemId, include_content: false });
    const u = entryUnit(e);
    const res = await api.call('save_work_item', { id: have.itemId, expected_rev: Number(cur?.current_rev ?? have.rev), visibility: 'private', kind: 'memory', name: u.name, stage: MEMORY_STAGE, files: u.files, intent: { source: 'memory-entry', kind: e.kind }, note: 'Made private again' });
    return { map: { ...map, [e.id]: { itemId: have.itemId, rev: Number(res?.rev ?? have.rev + 1), hash: u.hash } } };
  } catch (err) { return { map, error: msg(err) }; }
}

/** Forgetting an entry that has an item archives it, so other people stop seeing it. */
export async function forgetEntry(api: Api, map: ShareMap, id: string): Promise<{ map: ShareMap; error?: string }> {
  const have = map[id];
  if (!have) return { map };
  const next = { ...map }; delete next[id];
  try { await api.call('archive_work_item', { id: have.itemId, archived: true }); return { map: next }; } catch (err) { return { map, error: msg(err) }; }
}

const levelFromVisibility = (v: unknown): LevelIndex => (v === 'company' ? 2 : v === 'team' ? 1 : 0);

/** Levels of own entries from the rows of list_work_items (own items only), by local entry id. */
export function ownLevels(rows: Array<{ itemId: string; visibility: unknown; archived?: boolean }>, map: ShareMap): Record<string, LevelIndex> {
  const byItem = new Map(rows.filter((r) => !r.archived).map((r) => [r.itemId, r.visibility]));
  return Object.fromEntries(Object.entries(map).filter(([, m]) => byItem.has(m.itemId)).map(([id, m]) => [id, levelFromVisibility(byItem.get(m.itemId))]));
}

/** For entries that have an item the database decides the level. Entries without an item keep whatever they had. */
export function applyOwnLevels(gov: SkillGov, levels: Record<string, LevelIndex>): { gov: SkillGov; changed: string[] } {
  const skills = { ...gov.skills };
  const changed: string[] = [];
  for (const [id, db] of Object.entries(levels)) {
    if (levelOf(gov, id) === db) continue;
    if (db === 0) delete skills[id]; else skills[id] = db;
    changed.push(id);
  }
  return { gov: changed.length ? { ...gov, skills } : gov, changed };
}

export function loadShareMap(store: Pick<Storage, 'getItem'>): ShareMap {
  try {
    const raw = JSON.parse(store.getItem(SHARE_MAP_KEY) ?? '{}');
    const out: ShareMap = {};
    for (const [k, v] of Object.entries(raw ?? {}) as Array<[string, any]>) if (typeof v?.itemId === 'string' && Number.isInteger(v.rev)) out[k] = { itemId: v.itemId, rev: v.rev, hash: String(v.hash ?? '') };
    return out;
  } catch { return {}; }
}
export function saveShareMap(store: Pick<Storage, 'setItem'>, map: ShareMap): void { try { store.setItem(SHARE_MAP_KEY, JSON.stringify(map)); } catch { /* ignore */ } }
