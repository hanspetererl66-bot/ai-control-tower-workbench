/**
 * Activity log of the Scheduler: one entry for every run of a job, kept separate from the jobs themselves, so it survives deleting a
 * job and is not cut at the 20 runs of the per-job history. Stored locally (localStorage) and sent to the shared database when the
 * desktop app has access (append only there). Pure logic: filter, summary, CSV, the batches for the database. No UI, no network.
 * Sample jobs are never logged: their runs are mock entries.
 */
import type { Job, JobRun, TargetType } from './jobs';

export type LogEntry = {
  id: string;
  jobId: string;
  jobName: string;
  targetType: TargetType;
  targetLabel: string;
  at: string;
  ms: number;
  status: JobRun['status'];
  trigger: JobRun['trigger'];
  note: string;
  /** Who ran it (e-mail label). Local entries carry none; entries read from the database do. */
  who?: string;
  /** Already written to the shared database. */
  sent?: boolean;
};

export const LOG_KEY = 'werkbank.jobLog.v1';
export const MAX_LOG = 2000;
export const BATCH = 50;
export const STATUSES: JobRun['status'][] = ['ok', 'error', 'skipped'];

const clean = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const isTime = (s: unknown): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s));

/** The log entry for one finished run of a job. */
export function entryOf(job: Pick<Job, 'id' | 'name' | 'target'>, run: JobRun): LogEntry {
  return {
    id: run.id, jobId: job.id, jobName: clean(job.name, 120) || '(unnamed)', targetType: job.target.type, targetLabel: clean(job.target.label, 120),
    at: run.at, ms: Math.max(0, Math.round(run.ms)), status: run.status, trigger: run.trigger, note: clean(run.note, 300),
  };
}

/** Reads what localStorage holds; anything malformed is dropped. Newest first. */
export function sanitizeLog(raw: unknown): LogEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LogEntry[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object') continue;
    const id = clean(r.id, 80), jobId = clean(r.jobId, 80);
    const targetType = r.targetType as TargetType, status = r.status as JobRun['status'], trigger = r.trigger as JobRun['trigger'];
    if (!id || !jobId || seen.has(id) || !isTime(r.at)) continue;
    if (!['agent', 'workflow', 'skill'].includes(targetType) || !STATUSES.includes(status) || !['schedule', 'manual'].includes(trigger)) continue;
    seen.add(id);
    out.push({
      id, jobId, jobName: clean(r.jobName, 120) || '(unnamed)', targetType, targetLabel: clean(r.targetLabel, 120), at: r.at,
      ms: typeof r.ms === 'number' && Number.isFinite(r.ms) ? Math.max(0, Math.round(r.ms)) : 0, status, trigger, note: clean(r.note, 300),
      ...(clean(r.who, 120) ? { who: clean(r.who, 120) } : {}), ...(r.sent === true ? { sent: true } : {}),
    });
  }
  return out.sort(byNewest).slice(0, MAX_LOG);
}

const byNewest = (a: LogEntry, b: LogEntry) => Date.parse(b.at) - Date.parse(a.at);

export function loadLog(store: Pick<Storage, 'getItem'>): LogEntry[] {
  try { return sanitizeLog(JSON.parse(store.getItem(LOG_KEY) ?? '[]')); } catch { return []; }
}
export function saveLog(log: LogEntry[], store: Pick<Storage, 'setItem'>): void {
  try { store.setItem(LOG_KEY, JSON.stringify(log.slice(0, MAX_LOG))); } catch { /* no storage or full: the log stays in memory */ }
}

/** Adds an entry (an id already in the log is ignored) and keeps the newest MAX_LOG. */
export function appendEntry(log: LogEntry[], entry: LogEntry): LogEntry[] {
  if (log.some((e) => e.id === entry.id)) return log;
  return [entry, ...log].sort(byNewest).slice(0, MAX_LOG);
}

/** The next batch for the database: unsent entries, oldest first, at most BATCH. */
export const pending = (log: LogEntry[]): LogEntry[] => log.filter((e) => !e.sent).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, BATCH);

export function markSent(log: LogEntry[], ids: string[]): LogEntry[] {
  const set = new Set(ids);
  return log.map((e) => (set.has(e.id) ? { ...e, sent: true } : e));
}

/** The shape the database function takes (no `who`, no `sent`: the database names the person itself). */
export const toRecord = (e: LogEntry) => ({
  id: e.id, jobId: e.jobId, jobName: e.jobName, targetType: e.targetType, targetLabel: e.targetLabel, at: e.at, ms: e.ms, status: e.status, trigger: e.trigger, note: e.note,
});

/** Rows from `list_job_runs` as log entries (with who), newest first; malformed rows are dropped. */
export const fromDatabase = (rows: unknown): LogEntry[] => sanitizeLog(rows).map((e) => ({ ...e, sent: true }));

/** Local and database entries together: the database is the source for what it knows, local entries not yet sent are added. */
export function mergeSources(local: LogEntry[], remote: LogEntry[], me: string): LogEntry[] {
  const known = new Set(remote.map((e) => `${(e.who ?? me).toLowerCase()}|${e.id}`));
  const own = local.filter((e) => !known.has(`${me.toLowerCase()}|${e.id}`)).map((e) => ({ ...e, who: me || e.who }));
  return [...remote, ...own].sort(byNewest);
}

export type LogFilter = { text: string; status: '' | JobRun['status']; trigger: '' | JobRun['trigger']; type: '' | TargetType; days: number; who: string };
export const NO_FILTER: LogFilter = { text: '', status: '', trigger: '', type: '', days: 0, who: '' };

export function filterLog(log: LogEntry[], f: Partial<LogFilter>, now = Date.now()): LogEntry[] {
  const text = (f.text ?? '').trim().toLowerCase(), who = (f.who ?? '').trim().toLowerCase();
  const since = f.days && f.days > 0 ? now - f.days * 86_400_000 : 0;
  return log.filter((e) =>
    (!f.status || e.status === f.status) && (!f.trigger || e.trigger === f.trigger) && (!f.type || e.targetType === f.type)
    && (!since || Date.parse(e.at) >= since) && (!who || (e.who ?? '').toLowerCase() === who)
    && (!text || `${e.jobName} ${e.targetLabel} ${e.note}`.toLowerCase().includes(text)));
}

export type Summary = { runs: number; ok: number; error: number; skipped: number; successRate: number | null; avgMs: number; jobs: number; lastFailure?: LogEntry };
export function summarize(log: LogEntry[]): Summary {
  const ok = log.filter((e) => e.status === 'ok').length, error = log.filter((e) => e.status === 'error').length, skipped = log.length - ok - error;
  const done = ok + error;
  const timed = log.filter((e) => e.status !== 'skipped');
  return {
    runs: log.length, ok, error, skipped, successRate: done ? ok / done : null,
    avgMs: timed.length ? Math.round(timed.reduce((n, e) => n + e.ms, 0) / timed.length) : 0,
    jobs: new Set(log.map((e) => e.jobId)).size, lastFailure: [...log].filter((e) => e.status === 'error').sort(byNewest)[0],
  };
}

/** CSV for Excel: quotes and line breaks are escaped, and a cell that starts like a formula is neutralised. */
export function toCsv(log: LogEntry[]): string {
  const cell = (v: string | number) => {
    let t = String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ['Started', 'Job', 'Type', 'Target', 'Result', 'Trigger', 'Duration (s)', 'Who', 'Note'];
  const lines = log.map((e) => [e.at, e.jobName, e.targetType, e.targetLabel, e.status, e.trigger, Math.round(e.ms / 100) / 10, e.who ?? '', e.note].map(cell).join(','));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}
