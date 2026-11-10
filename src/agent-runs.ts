/**
 * Run record and stop switch for Studio agents, kept in this app (browser storage, like the agents themselves).
 *
 * - Every run an agent makes is written down: which agent and version, how it was started, how it ended, how long it took, and the run id
 *   (trace) that ties the questions between agents together. Entries are only added, never changed after the run has ended.
 * - The stop switch removes an agent from every path at once: its schedule does not start it, "/agent" refuses it, the network refuses to
 *   ask it and refuses its questions.
 *
 * Honest limits: this is a local log of this computer, not the shared observability database (that still has no writer); the status
 * "ok" means the assistant finished, not that the result was right (that is what the test bench is for).
 */
export const RUNS_KEY = 'werkbank.agentRuns';
export const STOPS_KEY = 'werkbank.agentStops';
export const MAX_RUNS = 500;

export type RunTrigger = 'manual' | 'schedule' | 'bench' | 'network';
export type RunStatus = 'running' | 'ok' | 'error' | 'stopped' | 'refused';
export type AgentRun = { id: string; agentId: string; version: string; at: number; ms: number; trigger: RunTrigger; status: RunStatus; trace: string; parent?: string; hops: number; note: string };
export type Stops = Record<string, { at: number; reason: string }>;

const TRACE = /^[A-Za-z0-9._-]{4,60}$/;
export function newTrace(rand: () => number = Math.random, now = Date.now()): string {
  return `t-${now.toString(36)}-${Math.floor(rand() * 36 ** 5).toString(36).padStart(5, '0')}`;
}
export const newRunId = (trace: string, hop: number) => `${trace}.${hop}`;

export function startRun(runs: AgentRun[], r: Omit<AgentRun, 'ms' | 'status' | 'note'>): AgentRun[] {
  return [{ ...r, ms: 0, status: 'running' as const, note: '' }, ...runs].slice(0, MAX_RUNS);
}
/** Ends a run that is still running; an ended run is not changed again. */
export function finishRun(runs: AgentRun[], id: string, status: Exclude<RunStatus, 'running'>, note: string, now = Date.now()): AgentRun[] {
  return runs.map((r) => (r.id === id && r.status === 'running' ? { ...r, status, ms: Math.max(0, now - r.at), note: note.replace(/\s+/g, ' ').trim().slice(0, 200) } : r));
}
/** A run that was still "running" when the app closed did not end properly. */
export function closeOpenRuns(runs: AgentRun[], now = Date.now()): AgentRun[] {
  return runs.map((r) => (r.status === 'running' ? { ...r, status: 'error' as const, ms: Math.max(0, now - r.at), note: 'The app closed before the run ended.' } : r));
}

export function isStopped(stops: Stops, agentId: string): boolean { return Object.hasOwn(stops, agentId); }
export function stopAgent(stops: Stops, agentId: string, reason: string, now = Date.now()): Stops { return { ...stops, [agentId]: { at: now, reason: reason.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Stopped by the owner.' } }; }
export function resumeAgent(stops: Stops, agentId: string): Stops { const { [agentId]: _gone, ...rest } = stops; return rest; }

export type AgentStats = { runs: number; ok: number; failed: number; refused: number; avgMs: number; last?: AgentRun };
/** Numbers of the last `days` days for one agent. */
export function statsOf(runs: AgentRun[], agentId: string, days = 7, now = Date.now()): AgentStats {
  const mine = runs.filter((r) => r.agentId === agentId && r.status !== 'running' && now - r.at <= days * 86_400_000).sort((a, b) => b.at - a.at);
  const done = mine.filter((r) => r.ms > 0);
  return { runs: mine.length, ok: mine.filter((r) => r.status === 'ok').length, failed: mine.filter((r) => r.status === 'error').length, refused: mine.filter((r) => r.status === 'refused' || r.status === 'stopped').length, avgMs: done.length ? Math.round(done.reduce((a, r) => a + r.ms, 0) / done.length) : 0, last: mine[0] };
}
/** All runs of one chain of questions, oldest first. */
export const traceRuns = (runs: AgentRun[], trace: string): AgentRun[] => runs.filter((r) => r.trace === trace).sort((a, b) => a.at - b.at || a.hops - b.hops);

export function sanitizeRuns(v: unknown): AgentRun[] {
  if (!Array.isArray(v)) return [];
  const out: AgentRun[] = [];
  for (const r of v as any[]) {
    if (!r || typeof r.id !== 'string' || typeof r.agentId !== 'string' || !TRACE.test(String(r.trace))) continue;
    out.push({
      id: r.id.slice(0, 80), agentId: r.agentId.slice(0, 40), version: String(r.version ?? '').slice(0, 20), at: Number(r.at) || 0, ms: Math.max(0, Number(r.ms) || 0),
      trigger: (['manual', 'schedule', 'bench', 'network'].includes(r.trigger) ? r.trigger : 'manual') as RunTrigger, status: (['running', 'ok', 'error', 'stopped', 'refused'].includes(r.status) ? r.status : 'error') as RunStatus,
      trace: r.trace, ...(typeof r.parent === 'string' ? { parent: r.parent.slice(0, 80) } : {}), hops: Math.min(20, Math.max(0, Number(r.hops) || 0)), note: String(r.note ?? '').slice(0, 200),
    });
    if (out.length >= MAX_RUNS) break;
  }
  return out;
}
export function sanitizeStops(v: unknown): Stops {
  const out: Stops = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Record<string, any>)) if (/^a-[a-z0-9]{1,38}$/.test(k)) out[k] = { at: Number(x?.at) || 0, reason: String(x?.reason ?? '').slice(0, 160) };
  return out;
}
export function loadRuns(store: Pick<Storage, 'getItem'>): AgentRun[] { try { return closeOpenRuns(sanitizeRuns(JSON.parse(store.getItem(RUNS_KEY) ?? 'null'))); } catch { return []; } }
export function saveRuns(store: Pick<Storage, 'setItem'>, r: AgentRun[]): void { try { store.setItem(RUNS_KEY, JSON.stringify(r)); } catch { /* ignore */ } }
export function loadStops(store: Pick<Storage, 'getItem'>): Stops { try { return sanitizeStops(JSON.parse(store.getItem(STOPS_KEY) ?? 'null')); } catch { return {}; } }
export function saveStops(store: Pick<Storage, 'setItem'>, s: Stops): void { try { store.setItem(STOPS_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
