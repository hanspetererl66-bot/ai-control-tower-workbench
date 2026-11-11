/**
 * Runs the sync of projects (work-sync.ts) in the background: once at start, after changes, and every half minute.
 * Only in the desktop app (window.host.workCall); in a plain browser nothing happens and the projects stay local.
 * The page keeps its own copy in localStorage; what the database has newer is written there and announced with the event
 * PROJECTS_PULLED, so the open views reload.
 */
import { loadProjects as loadAgent, saveProjects as saveAgent } from './agent-project';
import { loadProjects as loadDevelop, saveProjects as saveDevelop } from './develop';
import { htmlToMarkdown, toHtml } from './doc-html';
import { applyBack, loadMap, saveMap, syncOnce, type Local } from './work-sync';
import { AGENT_GOV_KEY, loadAgents, saveAgents } from './agent-studio';
import { loadGov, saveGov } from './skill-governance';
import { SHARED_MEMORY_PULLED, loadShared, saveShared, syncShared } from './memory-shared';
import { applyOwnLevels, loadShareMap, ownLevels } from './memory-share';
import { MEMORY_GOV_KEY } from './skill-governance';
import { applyAgentLevels, applyBackAgents, loadStudioMap, saveStudioMap, syncStudioAgents, type StudioLocal } from './studio-agent-sync';

export const PROJECTS_PULLED = 'werkbank:projects-pulled';
/** Studio agents or their levels were changed by the database: reload them from localStorage. */
export const AGENTS_PULLED = 'werkbank:agents-pulled';
export type SyncStatus = { state: 'off' | 'needs-setup' | 'needs-email' | 'idle' | 'syncing' | 'error'; message: string; at: number; email: string; pushed: number; pulled: number };

let status: SyncStatus = { state: 'off', message: '', at: 0, email: '', pushed: 0, pulled: 0 };
const listeners = new Set<(s: SyncStatus) => void>();
const set = (patch: Partial<SyncStatus>) => { status = { ...status, ...patch }; listeners.forEach((l) => l(status)); };
export const getSyncStatus = () => status;
export function subscribeSync(cb: (s: SyncStatus) => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

const readLocal = (): Local => ({ agent: loadAgent(window.localStorage), dev: loadDevelop(window.localStorage), map: loadMap(window.localStorage) });
const toMarkdown = (stored: string) => { try { return htmlToMarkdown(toHtml(stored), { images: 'omit' }); } catch { return stored; } };

let running = false, again = false, timer: number | undefined;

export async function syncNow(): Promise<void> {
  const host = window.host;
  if (!host?.workCall || !host.workStatus) return;
  if (running) { again = true; return; }
  running = true;
  try {
    const st = await host.workStatus();
    if (!st.configured) { set({ state: 'needs-setup', message: 'Enter the Supabase URL and the secret key in the settings of the connector "werkbank-workspace".', email: st.email }); return; }
    if (!st.email) { set({ state: 'needs-email', message: 'Enter your e-mail to save projects in the shared database.', email: '' }); return; }
    set({ state: 'syncing', message: 'Saving…', email: st.email });
    const before = readLocal();
    const api = { call: async (tool: string, args: Record<string, unknown>) => { const r = await host.workCall!(tool, args); if (!r.ok) throw new Error(r.error); return r.data; } };
    const after = await syncOnce(api, before, toMarkdown);
    const { local, deferred } = applyBack(readLocal(), before, after);
    saveAgent(window.localStorage, local.agent);
    saveDevelop(window.localStorage, local.dev);
    saveMap(window.localStorage, local.map);
    if (after.pulled || after.removed) window.dispatchEvent(new Event(PROJECTS_PULLED));
    // Studio agents: their own round; their level comes from the visibility of the item.
    const readStudio = (): StudioLocal => ({ agents: loadAgents(window.localStorage), map: loadStudioMap(window.localStorage) });
    const studioBefore = readStudio();
    const studio = await syncStudioAgents(api, studioBefore);
    const back = applyBackAgents(readStudio(), studioBefore, studio);
    const govNow = loadGov(undefined, AGENT_GOV_KEY);
    const leveled = applyAgentLevels(govNow, studio.levels, back.local.map);
    saveAgents(window.localStorage, back.local.agents);
    saveStudioMap(window.localStorage, leveled.map);
    if (leveled.changed.length) saveGov(leveled.gov, undefined, AGENT_GOV_KEY);
    if (studio.pulled || studio.removed || leveled.changed.length) window.dispatchEvent(new Event(AGENTS_PULLED));
    // Memory entries other people shared with this person (read only).
    try {
      const shared = await syncShared(api, st.email, loadShared(window.localStorage));
      // The level of the person's own shared entries comes from the database.
      const own = applyOwnLevels(loadGov(undefined, MEMORY_GOV_KEY), ownLevels(shared.own, loadShareMap(window.localStorage)));
      if (own.changed.length) saveGov(own.gov, undefined, MEMORY_GOV_KEY);
      if (shared.changed) saveShared(window.localStorage, shared.entries);
      if (shared.changed || own.changed.length) window.dispatchEvent(new Event(SHARED_MEMORY_PULLED));
      after.errors.push(...shared.errors);
    } catch (e: any) { after.errors.push(`shared memory: ${String(e?.message ?? e).slice(0, 160)}`); }
    after.errors.push(...studio.errors);
    after.pushed += studio.pushed; after.pulled += studio.pulled;
    const problem = after.errors[0];
    set({
      state: problem ? 'error' : 'idle', at: Date.now(), pushed: after.pushed, pulled: after.pulled, email: st.email,
      message: problem ? `Not saved: ${problem}` : (deferred || back.deferred) ? 'Saved. A project you edited meanwhile is checked in the next round.' : 'All projects are saved in the shared database.',
    });
    if (deferred || back.deferred) again = true;
  } catch (e: any) {
    set({ state: 'error', message: `The shared database could not be reached: ${String(e?.message ?? e).slice(0, 160)}`, at: Date.now() });
  } finally {
    running = false;
    if (again) { again = false; schedule(2500); }
  }
}

/** A change was made: send it after a short pause (many keystrokes become one save). */
export function schedule(ms = 4000) {
  if (!window.host?.workCall) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { void syncNow(); }, ms);
}

export function startWorkSync(): () => void {
  if (!window.host?.workCall) return () => {};
  void syncNow();
  const every = window.setInterval(() => { void syncNow(); }, 30_000);
  const onFocus = () => { void syncNow(); };
  window.addEventListener('focus', onFocus);
  return () => { window.clearInterval(every); window.removeEventListener('focus', onFocus); window.clearTimeout(timer); };
}

export async function setSyncEmail(email: string): Promise<string> {
  const r = await window.host?.workSetEmail?.(email);
  if (!r?.ok) return r?.detail ?? 'The e-mail could not be saved.';
  set({ email: r.email ?? '' });
  void syncNow();
  return '';
}
