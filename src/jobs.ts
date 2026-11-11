/**
 * Scheduler jobs (like jobs in the Databricks scheduler): one job runs one agent, one workflow or one skill at a set time,
 * once or repeatedly. Jobs run while the app is open; a missed run is made up for up to six hours. Pure logic, no UI.
 */
export type TargetType = 'agent' | 'workflow' | 'skill';
export type Target = { type: TargetType; id: string; label: string };

export type Cadence =
  | { kind: 'once'; at: string }
  | { kind: 'interval'; every: number; unit: 'minutes' | 'hours' | 'days' }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; days: number[] }
  | { kind: 'monthly'; time: string; day: number }
  | { kind: 'cron'; expr: string };

export type JobRun = { id: string; at: string; ms: number; status: 'ok' | 'error' | 'skipped'; trigger: 'schedule' | 'manual'; note: string };

export type Job = {
  id: string;
  name: string;
  target: Target;
  /** Extra instruction for the run (workflows and skills). */
  note: string;
  cadence: Cadence;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  runs: JobRun[];
  /** Sample job: a run only writes a mock entry into the history and starts nothing. */
  example?: boolean;
  /** Sample job that keeps failing: its mock runs are written as failed, so the "failing" state stays visible. */
  fails?: boolean;
  /** Values for the groupings that are not derived (business area, organization unit, own groupings): dimension id to value. */
  groups?: Record<string, string>;
};

export const JOBS_KEY = 'werkbank.jobs.v1';
export const JOBS_SEEDED_KEY = 'werkbank.jobs.seeded';
/** Set once the larger sample set (groupings, many states) has replaced the first seven sample jobs. */
export const JOBS_EXAMPLES_KEY = 'werkbank.jobs.examples.v2';
export const MAX_JOBS = 120;
export const MAX_RUNS = 20;
export const CATCH_UP_MS = 6 * 3600_000;
export const TARGET_LABEL: Record<TargetType, string> = { agent: 'Agent', workflow: 'Workflow', skill: 'Skill' };
export const WEEKDAYS = [
  { day: 1, short: 'Mo' }, { day: 2, short: 'Tu' }, { day: 3, short: 'We' }, { day: 4, short: 'Th' }, { day: 5, short: 'Fr' }, { day: 6, short: 'Sa' }, { day: 0, short: 'Su' },
] as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const clean = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');

/* ---- Cron (five fields: minute hour day-of-month month day-of-week; numbers, *, lists, ranges, steps) ---- */
type CronSets = { min: Set<number>; hour: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number>; domAny: boolean; dowAny: boolean };

function field(text: string, lo: number, hi: number, wrap7 = false): Set<number> | null {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) return null;
    let a = lo, b = hi;
    if (m[1] !== '*') {
      const [x, y] = m[1].split('-').map(Number);
      a = x; b = y ?? (m[2] === undefined ? x : hi);
    }
    if (a < lo || b > hi || a > b) return null;
    for (let v = a; v <= b; v += step) out.add(wrap7 && v === 7 ? 0 : v);
  }
  return out.size ? out : null;
}

export function parseCron(expr: string): CronSets | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const min = field(p[0], 0, 59), hour = field(p[1], 0, 23), dom = field(p[2], 1, 31), mon = field(p[3], 1, 12), dow = field(p[4], 0, 7, true);
  if (!min || !hour || !dom || !mon || !dow) return null;
  return { min, hour, dom, mon, dow, domAny: p[2] === '*', dowAny: p[4] === '*' };
}

const dayMatches = (c: CronSets, d: Date): boolean => {
  if (!c.mon.has(d.getMonth() + 1)) return false;
  const a = c.dom.has(d.getDate()), b = c.dow.has(d.getDay());
  return c.domAny && c.dowAny ? true : c.domAny ? b : c.dowAny ? a : a || b;
};
const cronMatches = (c: CronSets, d: Date): boolean => dayMatches(c, d) && c.hour.has(d.getHours()) && c.min.has(d.getMinutes());

/** The cron text behind daily, weekly, monthly and cron jobs; null for once and interval. */
export function toCron(c: Cadence): string | null {
  if (c.kind === 'cron') return c.expr.trim();
  if (c.kind !== 'daily' && c.kind !== 'weekly' && c.kind !== 'monthly') return null;
  const [h, m] = c.time.split(':').map(Number);
  if (c.kind === 'daily') return `${m} ${h} * * *`;
  if (c.kind === 'weekly') return `${m} ${h} * * ${[...c.days].sort().join(',')}`;
  return `${m} ${h} ${c.day} * *`;
}

const startOfMinute = (d: Date) => { const x = new Date(d); x.setSeconds(0, 0); return x; };

function cronNext(c: CronSets, after: Date): Date | null {
  const day = startOfMinute(after); day.setHours(0, 0, 0, 0);
  for (let i = 0; i <= 800; i += 1) {
    const d = new Date(day); d.setDate(day.getDate() + i);
    if (!dayMatches(c, d)) continue;
    for (const h of [...c.hour].sort((a, b) => a - b)) {
      for (const m of [...c.min].sort((a, b) => a - b)) {
        const t = new Date(d); t.setHours(h, m, 0, 0);
        if (t > after) return t;
      }
    }
  }
  return null;
}

function cronPrev(c: CronSets, now: Date, windowMs: number): Date | null {
  const t = startOfMinute(now);
  for (let i = 0; i * 60_000 <= windowMs; i += 1) {
    const x = new Date(t.getTime() - i * 60_000);
    if (cronMatches(c, x)) return x;
  }
  return null;
}

/* ---- Cadence ---- */
const unitMs = { minutes: 60_000, hours: 3600_000, days: 86_400_000 } as const;
const intervalMs = (c: Extract<Cadence, { kind: 'interval' }>) => c.every * unitMs[c.unit];
const MIN_INTERVAL_MS = 5 * 60_000;

/** What is wrong with the cadence (empty list = fine). `now` is needed to reject a one-time run in the past. */
export function cadenceProblems(c: Cadence, now: Date): string[] {
  switch (c.kind) {
    case 'once': {
      if (!LOCAL_DT.test(c.at) || Number.isNaN(new Date(c.at).getTime())) return ['Pick a date and time.'];
      return new Date(c.at) > now ? [] : ['The time is in the past.'];
    }
    case 'interval':
      if (!Number.isInteger(c.every) || c.every < 1) return ['Enter a whole number of minutes, hours or days.'];
      return intervalMs(c) < MIN_INTERVAL_MS ? ['The shortest interval is 5 minutes.'] : [];
    case 'daily': return TIME.test(c.time) ? [] : ['Pick a time.'];
    case 'weekly': return !TIME.test(c.time) ? ['Pick a time.'] : c.days.length ? [] : ['Pick at least one weekday.'];
    case 'monthly': return !TIME.test(c.time) ? ['Pick a time.'] : Number.isInteger(c.day) && c.day >= 1 && c.day <= 31 ? [] : ['The day must be between 1 and 31.'];
    case 'cron': return parseCron(c.expr) ? [] : ['Cron needs five fields: minute hour day-of-month month day-of-week, for example 30 7 * * 1-5.'];
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
export const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function describeCadence(c: Cadence): string {
  switch (c.kind) {
    case 'once': return `once, ${c.at.replace('T', ' ')}`;
    case 'interval': return `every ${c.every} ${c.every === 1 ? c.unit.slice(0, -1) : c.unit}`;
    case 'daily': return `every day at ${c.time}`;
    case 'weekly': return `every ${WEEKDAYS.filter((w) => c.days.includes(w.day)).map((w) => w.short).join(', ')} at ${c.time}`;
    case 'monthly': return `monthly on day ${c.day} at ${c.time}`;
    case 'cron': return `cron ${c.expr.trim()}`;
  }
}

/** The next planned run after `now` (for an interval job already due: now). Null when there is none. */
export function nextRun(job: Job, now: Date): Date | null {
  const c = job.cadence;
  if (c.kind === 'once') { if (job.lastRun) return null; const at = new Date(c.at); return at > now ? at : null; }
  if (c.kind === 'interval') {
    const next = new Date(Date.parse(job.lastRun ?? job.createdAt) + intervalMs(c));
    return next < now ? now : next;
  }
  const cron = parseCron(toCron(c) ?? '');
  return cron ? cronNext(cron, now) : null;
}

/** The next `count` planned runs, for the preview in the form. */
export function upcoming(cadence: Cadence, now: Date, count = 3): Date[] {
  const out: Date[] = [];
  let at = now;
  for (let i = 0; i < count; i += 1) {
    const probe: Job = { id: 'x', name: '', target: { type: 'agent', id: '', label: '' }, note: '', cadence, enabled: true, createdAt: at.toISOString(), runs: [] };
    const next = cadence.kind === 'interval'
      ? new Date((out.length ? out[out.length - 1].getTime() : now.getTime()) + intervalMs(cadence))
      : nextRun(probe, at);
    if (!next) break;
    out.push(next); at = next;
    if (cadence.kind === 'once') break;
  }
  return out;
}

/** Due when a planned run has passed that was not run yet (interval: when the interval is over). */
export function isDue(job: Job, now: Date): boolean {
  if (!job.enabled) return false;
  const c = job.cadence;
  if (c.kind === 'once') {
    const at = new Date(c.at);
    return !job.lastRun && at <= now && now.getTime() - at.getTime() <= CATCH_UP_MS;
  }
  if (c.kind === 'interval') return Date.parse(job.lastRun ?? job.createdAt) + intervalMs(c) <= now.getTime();
  const cron = parseCron(toCron(c) ?? '');
  if (!cron) return false;
  const planned = cronPrev(cron, now, CATCH_UP_MS);
  if (!planned || planned.getTime() < Date.parse(job.createdAt)) return false;
  return !job.lastRun || Date.parse(job.lastRun) < planned.getTime();
}

export type JobState = 'scheduled' | 'failing' | 'paused' | 'done' | 'missed';
export const STATE_LABEL: Record<JobState, string> = { scheduled: 'Active', failing: 'Failing', paused: 'Paused', done: 'Done', missed: 'Missed' };
/** Failing = active, but the latest run failed. A one-time job is done after its run and missed when its time passed unnoticed. */
export function jobState(job: Job, now: Date): JobState {
  if (job.cadence.kind === 'once') {
    if (job.lastRun) return 'done';
    if (new Date(job.cadence.at).getTime() + CATCH_UP_MS < now.getTime()) return 'missed';
  }
  if (!job.enabled) return 'paused';
  return job.runs[0]?.status === 'error' ? 'failing' : 'scheduled';
}

/* ---- Groupings: functional type (derived), business area, organization unit, and groupings the user defines ---- */
export type GroupDim = { id: string; label: string; kind: 'type' | 'field'; builtin: boolean };
export const BUILTIN_DIMS: GroupDim[] = [
  { id: 'type', label: 'Functional type', kind: 'type', builtin: true },
  { id: 'area', label: 'Business area', kind: 'field', builtin: true },
  { id: 'unit', label: 'Organization unit', kind: 'field', builtin: true },
];
export const GROUPS_KEY = 'werkbank.jobGroups.v1';
export const GROUP_BY_KEY = 'werkbank.jobGroupBy';
export const MAX_CUSTOM_DIMS = 6;
export const UNASSIGNED = 'Unassigned';
export const TYPE_PLURAL: Record<TargetType, string> = { workflow: 'Workflows', agent: 'Agents', skill: 'Skills' };
const TYPE_ORDER: TargetType[] = ['workflow', 'agent', 'skill'];

export function newDim(label: string, existing: GroupDim[]): GroupDim | null {
  const text = clean(label, 30);
  if (!text || existing.some((d) => d.label.toLowerCase() === text.toLowerCase()) || existing.filter((d) => !d.builtin).length >= MAX_CUSTOM_DIMS) return null;
  return { id: newId('g'), label: text, kind: 'field', builtin: false };
}
/** The built-in groupings followed by the user's own; broken stored entries are dropped. */
export function loadDims(storage?: Pick<Storage, 'getItem'>): GroupDim[] {
  let raw: unknown = [];
  try { raw = JSON.parse(storage?.getItem(GROUPS_KEY) ?? '[]'); } catch { raw = []; }
  const custom: GroupDim[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const r = (x ?? {}) as Record<string, unknown>;
    const id = typeof r.id === 'string' && /^[a-z0-9-]{1,40}$/i.test(r.id) ? r.id : '';
    const label = clean(r.label, 30);
    if (!id || !label || BUILTIN_DIMS.some((d) => d.id === id) || custom.some((d) => d.id === id || d.label.toLowerCase() === label.toLowerCase())) continue;
    custom.push({ id, label, kind: 'field', builtin: false });
    if (custom.length >= MAX_CUSTOM_DIMS) break;
  }
  return [...BUILTIN_DIMS, ...custom];
}
export function saveDims(dims: GroupDim[], storage?: Pick<Storage, 'setItem'>): void {
  try { storage?.setItem(GROUPS_KEY, JSON.stringify(dims.filter((d) => !d.builtin).map(({ id, label }) => ({ id, label })))); } catch { /* kept in memory only */ }
}

export function groupValue(job: Job, dim: GroupDim): string {
  return dim.kind === 'type' ? TYPE_PLURAL[job.target.type] : job.groups?.[dim.id] || UNASSIGNED;
}
/** Every value used for one grouping, for the suggestions in the form. */
export function groupValues(jobs: Job[], dimId: string): string[] {
  return [...new Set(jobs.map((j) => j.groups?.[dimId]).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
}
/** Set or clear one value of one grouping on a job. */
export function withGroup(job: Job, dimId: string, value: string): Job {
  const groups = { ...(job.groups ?? {}) }, v = clean(value, 40);
  if (v) groups[dimId] = v; else delete groups[dimId];
  const { groups: _old, ...rest } = job;
  return Object.keys(groups).length ? { ...rest, groups } : rest;
}
/** Remove a user's own grouping from every job. */
export function withoutDim(jobs: Job[], dimId: string): Job[] { return jobs.map((j) => withGroup(j, dimId, '')); }

export type GroupStats = { total: number; active: number; failing: number; paused: number; ok: number; runs: number };
export type JobGroup = { key: string; label: string; jobs: Job[]; stats: GroupStats };
export function groupStats(jobs: Job[], now: Date): GroupStats {
  const states = jobs.map((j) => jobState(j, now));
  const runs = jobs.flatMap((j) => j.runs);
  return { total: jobs.length, active: states.filter((s) => s === 'scheduled' || s === 'failing').length, failing: states.filter((s) => s === 'failing').length, paused: states.filter((s) => s === 'paused').length, ok: runs.filter((r) => r.status === 'ok').length, runs: runs.length };
}
/** Jobs sorted into groups of one grouping. No grouping = one group. Functional type keeps the order workflows, agents, skills; the others are alphabetical with "Unassigned" last. */
export function groupJobs(jobs: Job[], dim: GroupDim | null, now: Date): JobGroup[] {
  if (!dim) return jobs.length ? [{ key: '', label: 'All jobs', jobs, stats: groupStats(jobs, now) }] : [];
  const map = new Map<string, Job[]>();
  for (const j of jobs) { const k = groupValue(j, dim); map.set(k, [...(map.get(k) ?? []), j]); }
  const keys = [...map.keys()].sort((a, b) => {
    if (dim.kind === 'type') return TYPE_ORDER.findIndex((t) => TYPE_PLURAL[t] === a) - TYPE_ORDER.findIndex((t) => TYPE_PLURAL[t] === b);
    if (a === UNASSIGNED) return 1;
    if (b === UNASSIGNED) return -1;
    return a.localeCompare(b);
  });
  return keys.map((k) => ({ key: k, label: k, jobs: map.get(k) ?? [], stats: groupStats(map.get(k) ?? [], now) }));
}

/* ---- What a run asks the agent ---- */
export function jobPrompt(job: Job, manual = false): string {
  const t = job.target, extra = job.note ? `\n\nAdditional instruction: ${job.note}` : '';
  const tag = `\n\n(Scheduled job "${job.name}"${manual ? ', run by hand' : ''})`;
  if (t.type === 'agent') return `/agent ${t.id}`;
  if (t.type === 'workflow') return `Run the n8n workflow "${t.label}" now with the n8n connector: find it by name, start one execution, wait for the result and report it in a few lines. If it cannot be started, say exactly why and do not guess a result.${extra}${tag}`;
  return `Use the skill "${t.label}" now and show its result.${extra}${tag}`;
}

export function addRun(job: Job, run: JobRun): Job {
  return { ...job, ...(run.status === 'skipped' ? {} : { lastRun: run.at }), runs: [run, ...job.runs].slice(0, MAX_RUNS) };
}

let counter = 0;
export const newId = (prefix: string, now = Date.now()) => `${prefix}-${now.toString(36)}${(counter++ % 1296).toString(36)}`;

export function newJob(input: { name: string; target: Target; note?: string; cadence: Cadence; groups?: Record<string, string> }, now = new Date()): Job {
  const groups = Object.fromEntries(Object.entries(input.groups ?? {}).map(([k, v]) => [k, clean(v, 40)]).filter(([k, v]) => v && /^[a-z0-9-]{1,40}$/i.test(k as string) && k !== 'type'));
  return { id: newId('job', now.getTime()), name: clean(input.name, 60) || `${TARGET_LABEL[input.target.type]}: ${input.target.label}`.slice(0, 60), target: input.target, note: clean(input.note, 400), cadence: input.cadence, enabled: true, createdAt: now.toISOString(), runs: [], ...(Object.keys(groups).length ? { groups } : {}) };
}

/* ---- Storage ---- */
function sanitizeCadence(raw: unknown): Cadence | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const time = typeof r.time === 'string' ? r.time : '';
  switch (r.kind) {
    case 'once': return typeof r.at === 'string' && LOCAL_DT.test(r.at) ? { kind: 'once', at: r.at } : null;
    case 'interval': {
      const c: Cadence = { kind: 'interval', every: Number(r.every), unit: r.unit === 'hours' || r.unit === 'days' ? r.unit : 'minutes' };
      return cadenceProblems(c, new Date(0)).length === 0 ? c : null;
    }
    case 'daily': return TIME.test(time) ? { kind: 'daily', time } : null;
    case 'weekly': {
      const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
      return TIME.test(time) && days.length ? { kind: 'weekly', time, days } : null;
    }
    case 'monthly': return TIME.test(time) && Number.isInteger(r.day) && (r.day as number) >= 1 && (r.day as number) <= 31 ? { kind: 'monthly', time, day: r.day as number } : null;
    case 'cron': return typeof r.expr === 'string' && parseCron(r.expr) ? { kind: 'cron', expr: clean(r.expr, 60) } : null;
    default: return null;
  }
}

function sanitizeGroups(raw: unknown): { groups?: Record<string, string> } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const groups: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 12)) {
    const val = clean(v, 40);
    if (/^[a-z0-9-]{1,40}$/i.test(k) && k !== 'type' && val) groups[k] = val;
  }
  return Object.keys(groups).length ? { groups } : {};
}

export function sanitizeJobs(value: unknown): Job[] {
  if (!Array.isArray(value)) return [];
  const out: Job[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' && /^[a-z0-9-]{1,40}$/i.test(r.id) ? r.id : '';
    const t = (r.target ?? {}) as Record<string, unknown>;
    const type = t.type === 'agent' || t.type === 'workflow' || t.type === 'skill' ? t.type : null;
    const targetId = clean(t.id, 80), label = clean(t.label, 80);
    const cadence = sanitizeCadence(r.cadence);
    if (!id || !type || !targetId || !cadence || out.some((j) => j.id === id)) continue;
    const created = typeof r.createdAt === 'string' && !Number.isNaN(Date.parse(r.createdAt)) ? r.createdAt : new Date().toISOString();
    const runs: JobRun[] = (Array.isArray(r.runs) ? r.runs : []).flatMap((x): JobRun[] => {
      const q = (x ?? {}) as Record<string, unknown>;
      if (typeof q.at !== 'string' || Number.isNaN(Date.parse(q.at)) || !(q.status === 'ok' || q.status === 'error' || q.status === 'skipped')) return [];
      return [{ id: clean(q.id, 40) || newId('run'), at: q.at, ms: Number.isFinite(q.ms) ? Math.max(0, q.ms as number) : 0, status: q.status, trigger: q.trigger === 'manual' ? 'manual' : 'schedule', note: clean(q.note, 200) }];
    }).slice(0, MAX_RUNS);
    out.push({
      id, name: clean(r.name, 60) || label || targetId, target: { type, id: targetId, label: label || targetId }, note: clean(r.note, 400), cadence,
      enabled: r.enabled !== false, createdAt: created,
      ...(typeof r.lastRun === 'string' && !Number.isNaN(Date.parse(r.lastRun)) ? { lastRun: r.lastRun } : {}), runs,
      ...(r.example === true ? { example: true } : {}),
      ...(r.fails === true && r.example === true ? { fails: true } : {}),
      ...sanitizeGroups(r.groups),
    });
    if (out.length >= MAX_JOBS) break;
  }
  return out;
}

export function loadJobs(storage?: Pick<Storage, 'getItem'>): Job[] {
  try { return sanitizeJobs(JSON.parse(storage?.getItem(JOBS_KEY) ?? '[]')); } catch { return []; }
}
export function saveJobs(list: Job[], storage?: Pick<Storage, 'setItem'>): void {
  try { storage?.setItem(JOBS_KEY, JSON.stringify(list)); } catch { /* kept in memory only */ }
}

/* ---- Example jobs: every kind of target, repeat and state, with a mock history ---- */
type Profile = 'good' | 'flaky' | 'failing' | 'new' | 'paused' | 'done' | 'missed' | 'upcoming';
const ERROR_NOTES = ['Example: connector timed out', 'Example: target system answered 503', 'Example: approval was not given in time', 'Example: input file was empty', 'Example: rate limit reached'];

export function exampleJobs(now = new Date()): Job[] {
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();
  const inH = (hours: number) => toLocalInput(new Date(now.getTime() + hours * 3600_000));
  const run = (n: number, hours: number, ms: number, status: JobRun['status'], note: string, trigger: JobRun['trigger'] = 'schedule'): JobRun => ({ id: `ex-run-${n}`, at: ago(hours), ms, status, trigger, note });
  const mk = (id: string, name: string, target: Target, cadence: Cadence, runs: JobRun[], note = '', enabled = true, groups?: Record<string, string>, extra: Partial<Job> = {}): Job =>
    ({ id, name, target, note, cadence, enabled, createdAt: ago(24 * 9), example: true, ...(runs.length ? { lastRun: runs[0].at } : {}), runs, ...(groups ? { groups } : {}), ...extra });
  const g = (area: string, unit: string) => ({ area, unit });

  const base: Job[] = [
    mk('ex-preclose', 'Finance pre-close check', { type: 'agent', id: 'example-agent', label: 'Pre-close agent' }, { kind: 'weekly', time: '07:30', days: [1, 2, 3, 4, 5] },
      [run(1, 14, 41_000, 'ok', 'Example run'), run(2, 38, 38_000, 'ok', 'Example run'), run(3, 62, 52_000, 'error', 'Example: SAP connector timed out')], '', true, g('Financial close', 'Finance')),
    mk('ex-margin', 'Margin report for the board', { type: 'agent', id: 'example-agent-2', label: 'Margin analyst' }, { kind: 'cron', expr: '0 8 1 * *' },
      [run(4, 24 * 3, 66_000, 'ok', 'Example run')], '', true, g('Financial close', 'Finance')),
    mk('ex-reminders', 'Payment reminders', { type: 'workflow', id: 'example-workflow', label: 'Invoice reminder (n8n)' }, { kind: 'daily', time: '09:00' },
      [run(5, 12, 9_000, 'ok', 'Example run'), run(6, 36, 8_000, 'ok', 'Example run'), run(7, 60, 12_000, 'ok', 'Example run', 'manual')], 'Only overdue invoices above 1,000 EUR.', true, g('Order-to-Cash', 'Finance')),
    mk('ex-sync', 'Ticket sync', { type: 'workflow', id: 'example-workflow-2', label: 'Jira to Sub4Me sync' }, { kind: 'interval', every: 2, unit: 'hours' },
      [run(8, 1, 6_000, 'ok', 'Example run'), run(9, 3, 7_000, 'ok', 'Example run')], '', true, g('Service & support', 'Customer Service')),
    mk('ex-monday', 'Monday close briefing', { type: 'skill', id: 'monday-close', label: 'monday-close' }, { kind: 'weekly', time: '06:30', days: [1] },
      [run(12, 34, 74_000, 'ok', 'Example run: 8 accruals, 1 item differs from SAP'), run(13, 34 + 168, 71_000, 'ok', 'Example run')], 'Overnight check before the close: load, orders, accruals. Reads only; booking needs your yes in the chat.', true, g('Financial close', 'Finance')),
    mk('ex-brief', 'Morning briefing', { type: 'skill', id: 'example-skill', label: 'daily-briefing' }, { kind: 'daily', time: '07:45' },
      [run(10, 13, 21_000, 'ok', 'Example run'), run(11, 37, 19_000, 'ok', 'Example run')], '', true, g('Management reporting', 'Finance')),
    mk('ex-cleanup', 'Skill registry clean-up', { type: 'skill', id: 'example-skill-2', label: 'skill-registry-review' }, { kind: 'monthly', time: '06:00', day: 15 },
      [], 'List skills without owner or description.', false, g('Governance & compliance', 'IT & Platform')),
  ];

  let n = 100;
  /** A deterministic mock history for one profile; `step` is the usual gap between two runs in hours. */
  const history = (profile: Profile, step: number, ms: number): JobRun[] => {
    const first = Math.min(step * 0.4, 20);
    const seq: JobRun['status'][] = { good: ['ok', 'ok', 'ok', 'ok'], flaky: ['ok', 'skipped', 'ok', 'error', 'ok'], failing: ['error', 'error', 'ok', 'ok'], paused: ['ok', 'ok', 'error'], new: [], done: [], missed: [], upcoming: [] }[profile] as JobRun['status'][];
    return seq.map((status, k) => {
      n += 1;
      const note = status === 'error' ? ERROR_NOTES[n % ERROR_NOTES.length] : status === 'skipped' ? 'Example: skipped, the agent was busy' : 'Example run';
      return run(n, first + k * step, ms + (k % 3) * 2_000, status, note);
    });
  };
  // id, name, type, target id, target label, repeat, area, unit, profile, hours between runs, run time in ms, instruction
  type Row = [string, string, TargetType, string, string, Cadence, string, string, Profile, number, number, string?];
  const rows: Row[] = [
    // agents
    ['ex-a-credit', 'Credit limit review', 'agent', 'example-agent-3', 'Credit risk agent', { kind: 'daily', time: '06:15' }, 'Order-to-Cash', 'Finance', 'good', 24, 47_000],
    ['ex-a-dunning', 'Dunning proposals', 'agent', 'example-agent-4', 'Dunning agent', { kind: 'weekly', time: '08:00', days: [1, 4] }, 'Order-to-Cash', 'Finance', 'flaky', 84, 58_000],
    ['ex-a-forecast', 'Weekly sales forecast', 'agent', 'example-agent-5', 'Forecast agent', { kind: 'weekly', time: '07:00', days: [1] }, 'Customer & sales', 'Sales', 'good', 168, 83_000],
    ['ex-a-porisk', 'PO delay risk scan', 'agent', 'example-agent-6', 'PO risk agent', { kind: 'daily', time: '05:30' }, 'Procure-to-Pay', 'Supply Chain', 'failing', 24, 64_000],
    ['ex-a-joiner', 'New joiner checklist', 'agent', 'example-agent-7', 'Onboarding agent', { kind: 'daily', time: '07:00' }, 'Hire-to-Retire', 'HR', 'good', 24, 29_000],
    ['ex-a-shortlist', 'Candidate shortlist refresh', 'agent', 'example-agent-8', 'Shortlist agent', { kind: 'interval', every: 4, unit: 'hours' }, 'Hire-to-Retire', 'HR', 'flaky', 4, 36_000],
    ['ex-a-access', 'Access review reminders', 'agent', 'example-agent-9', 'Access review agent', { kind: 'monthly', time: '09:00', day: 1 }, 'Governance & compliance', 'IT & Platform', 'paused', 720, 52_000],
    ['ex-a-renewal', 'Contract renewal watch', 'agent', 'example-agent-10', 'Renewal agent', { kind: 'weekly', time: '07:30', days: [2] }, 'Contract management', 'Legal & Compliance', 'good', 168, 71_000],
    ['ex-a-triage', 'Ticket triage', 'agent', 'example-agent-11', 'Triage agent', { kind: 'interval', every: 30, unit: 'minutes' }, 'IT operations', 'IT & Platform', 'good', 0.5, 14_000],
    ['ex-a-esg', 'ESG data collection', 'agent', 'example-agent-12', 'ESG agent', { kind: 'monthly', time: '08:00', day: 5 }, 'Governance & compliance', 'Legal & Compliance', 'new', 720, 0],
    ['ex-a-variance', 'Budget variance explainer', 'agent', 'example-agent-13', 'Variance agent', { kind: 'monthly', time: '07:00', day: 3 }, 'Financial close', 'Finance', 'good', 720, 91_000],
    ['ex-a-rehearsal', 'Quarter-end accrual rehearsal', 'agent', 'example-agent-14', 'Accrual agent', { kind: 'once', at: inH(52) }, 'Financial close', 'Finance', 'upcoming', 0, 0],
    // workflows
    ['ex-w-grir', 'GR/IR clearing export', 'workflow', 'example-workflow-3', 'GR/IR export (n8n)', { kind: 'daily', time: '02:00' }, 'Procure-to-Pay', 'Procurement', 'good', 24, 18_000],
    ['ex-w-vendor', 'Vendor master sync', 'workflow', 'example-workflow-4', 'Vendor sync (n8n)', { kind: 'interval', every: 6, unit: 'hours' }, 'Procure-to-Pay', 'Procurement', 'good', 6, 12_000],
    ['ex-w-leads', 'Lead routing', 'workflow', 'example-workflow-5', 'Lead router (n8n)', { kind: 'interval', every: 15, unit: 'minutes' }, 'Customer & sales', 'Sales', 'flaky', 0.25, 5_000],
    ['ex-w-quote', 'Quote follow-up', 'workflow', 'example-workflow-6', 'Quote follow-up (n8n)', { kind: 'daily', time: '10:00' }, 'Customer & sales', 'Sales', 'good', 24, 9_000, 'Quotes older than five days without an answer.'],
    ['ex-w-invoice', 'Invoice dispatch', 'workflow', 'example-workflow-7', 'Invoice dispatch (n8n)', { kind: 'cron', expr: '0 6 * * 1-5' }, 'Order-to-Cash', 'Finance', 'failing', 24, 22_000],
    ['ex-w-shipment', 'Shipment status mails', 'workflow', 'example-workflow-8', 'Shipment notice (n8n)', { kind: 'cron', expr: '*/20 6-20 * * 1-5' }, 'Order-to-Cash', 'Supply Chain', 'good', 0.33, 7_000],
    ['ex-w-timesheet', 'Timesheet reminder', 'workflow', 'example-workflow-9', 'Timesheet reminder (n8n)', { kind: 'weekly', time: '14:00', days: [5] }, 'Hire-to-Retire', 'HR', 'good', 168, 6_000],
    ['ex-w-backup', 'Backup check', 'workflow', 'example-workflow-10', 'Backup check (n8n)', { kind: 'daily', time: '03:30' }, 'IT operations', 'IT & Platform', 'good', 24, 31_000],
    ['ex-w-cert', 'Certificate expiry scan', 'workflow', 'example-workflow-11', 'Certificate scan (n8n)', { kind: 'weekly', time: '06:00', days: [1] }, 'IT operations', 'IT & Platform', 'flaky', 168, 24_000],
    ['ex-w-nps', 'NPS survey send', 'workflow', 'example-workflow-12', 'NPS survey (n8n)', { kind: 'monthly', time: '09:30', day: 10 }, 'Service & support', 'Customer Service', 'paused', 720, 16_000],
    ['ex-w-migration', 'Data migration, wave 3', 'workflow', 'example-workflow-13', 'Migration wave (n8n)', { kind: 'once', at: inH(-20) }, 'IT operations', 'IT & Platform', 'done', 0, 4_200_000],
    ['ex-w-cutover', 'Cut-over rehearsal', 'workflow', 'example-workflow-14', 'Cut-over rehearsal (n8n)', { kind: 'once', at: inH(-30) }, 'IT operations', 'IT & Platform', 'missed', 0, 0, 'Was planned for the weekend; nobody had the app open.'],
    ['ex-w-newsletter', 'Partner newsletter', 'workflow', 'example-workflow-15', 'Newsletter (n8n)', { kind: 'once', at: inH(30) }, 'Marketing & content', 'Marketing', 'upcoming', 0, 0],
    ['ex-w-kfeeds', 'SAP knowledge feeds (daily)', 'workflow', 'example-workflow-16', 'Knowledge feeder: feeds (npm run knowledge:feeds)', { kind: 'daily', time: '05:00' }, 'IT operations', 'IT & Platform', 'good', 24, 12_000, 'Example entry. Refreshes the title/URL/date index of SAP News and Community feeds (metadata only, no article text; robots.txt is honored). Dry run unless --seed is added.'],
    ['ex-w-kgit', 'SAP knowledge repos (weekly)', 'workflow', 'example-workflow-17', 'Knowledge feeder: git (npm run knowledge:git)', { kind: 'weekly', time: '03:00', days: [0] }, 'IT operations', 'IT & Platform', 'good', 168, 95_000, 'Example entry. Pulls the open-licensed SAP documentation repos in sources/scope.json and prepares the changed files for Cognee. Seeding calls the model: check --estimate first.'],
    // skills
    ['ex-s-kpi', 'KPI summary', 'skill', 'kpi-summary', 'kpi-summary', { kind: 'weekly', time: '07:15', days: [1] }, 'Management reporting', 'Finance', 'good', 168, 33_000],
    ['ex-s-risk', 'Risk register digest', 'skill', 'risk-digest', 'risk-digest', { kind: 'weekly', time: '15:00', days: [5] }, 'Governance & compliance', 'Legal & Compliance', 'good', 168, 28_000],
    ['ex-s-health', 'Skill health report', 'skill', 'skill-health-report', 'skill-health-report', { kind: 'weekly', time: '08:30', days: [1] }, 'Governance & compliance', 'IT & Platform', 'good', 168, 26_000],
    ['ex-s-news', 'Customer news scan', 'skill', 'customer-news', 'customer-news', { kind: 'daily', time: '06:45' }, 'Customer & sales', 'Sales', 'flaky', 24, 23_000],
    ['ex-s-hiring', 'Hiring pipeline digest', 'skill', 'hiring-digest', 'hiring-digest', { kind: 'weekly', time: '08:00', days: [1, 3] }, 'Hire-to-Retire', 'HR', 'good', 84, 19_000],
    ['ex-s-policy', 'Policy change check', 'skill', 'policy-change-check', 'policy-change-check', { kind: 'cron', expr: '0 7 * * 1' }, 'Governance & compliance', 'Legal & Compliance', 'failing', 168, 30_000],
    ['ex-s-docs', 'Documentation freshness', 'skill', 'doc-freshness', 'doc-freshness', { kind: 'monthly', time: '07:00', day: 20 }, 'IT operations', 'IT & Platform', 'paused', 720, 41_000],
    ['ex-s-cases', 'Open case digest', 'skill', 'case-digest', 'case-digest', { kind: 'daily', time: '07:30' }, 'Service & support', 'Customer Service', 'good', 24, 17_000],
    ['ex-s-spend', 'Spend anomaly report', 'skill', 'spend-anomaly', 'spend-anomaly', { kind: 'weekly', time: '09:00', days: [4] }, 'Procure-to-Pay', 'Procurement', 'good', 168, 38_000],
    ['ex-s-board', 'Board one-pager', 'skill', 'board-briefing', 'board-briefing', { kind: 'once', at: inH(80) }, 'Management reporting', 'Finance', 'upcoming', 0, 0],
    ['ex-s-close', 'Close checklist status', 'skill', 'close-status', 'close-status', { kind: 'cron', expr: '0 8 25-31 * *' }, 'Financial close', 'Finance', 'new', 720, 0],
  ];
  const more = rows.map(([id, name, type, tid, label, cadence, area, unit, profile, step, ms, note]) => {
    let runs = history(profile, step, ms);
    if (profile === 'done') { n += 1; runs = [run(n, 19.9, ms, 'ok', 'Example run: 14,200 records moved')]; }
    const created = profile === 'upcoming' ? ago(4) : profile === 'done' || profile === 'missed' ? ago(24 * 3) : undefined;
    return { ...mk(id, name, { type, id: tid, label }, cadence, runs, note ?? '', profile !== 'paused', g(area, unit), profile === 'failing' ? { fails: true } : {}), ...(created ? { createdAt: created } : {}) };
  });
  return [...base, ...more];
}

/** The sample jobs are renewed (new set, new states); the user's own jobs stay and come first. */
export function mergeExamples(stored: Job[], fresh: Job[]): Job[] {
  return [...stored.filter((j) => !j.example), ...fresh];
}
