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
};

export const JOBS_KEY = 'werkbank.jobs.v1';
export const JOBS_SEEDED_KEY = 'werkbank.jobs.seeded';
export const MAX_JOBS = 30;
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

export type JobState = 'scheduled' | 'paused' | 'done' | 'missed';
export function jobState(job: Job, now: Date): JobState {
  if (job.cadence.kind === 'once') {
    if (job.lastRun) return 'done';
    if (new Date(job.cadence.at).getTime() + CATCH_UP_MS < now.getTime()) return 'missed';
  }
  return job.enabled ? 'scheduled' : 'paused';
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

export function newJob(input: { name: string; target: Target; note?: string; cadence: Cadence }, now = new Date()): Job {
  return { id: newId('job', now.getTime()), name: clean(input.name, 60) || `${TARGET_LABEL[input.target.type]}: ${input.target.label}`.slice(0, 60), target: input.target, note: clean(input.note, 400), cadence: input.cadence, enabled: true, createdAt: now.toISOString(), runs: [] };
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

/* ---- Example jobs: one for each kind of target, with a mock history ---- */
export function exampleJobs(now = new Date()): Job[] {
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();
  const run = (n: number, hours: number, ms: number, status: JobRun['status'], note: string, trigger: JobRun['trigger'] = 'schedule'): JobRun => ({ id: `ex-run-${n}`, at: ago(hours), ms, status, trigger, note });
  const mk = (id: string, name: string, target: Target, cadence: Cadence, runs: JobRun[], note = '', enabled = true): Job =>
    ({ id, name, target, note, cadence, enabled, createdAt: ago(24 * 9), example: true, ...(runs.length ? { lastRun: runs[0].at } : {}), runs });
  return [
    mk('ex-preclose', 'Finance pre-close check', { type: 'agent', id: 'example-agent', label: 'Pre-close agent' }, { kind: 'weekly', time: '07:30', days: [1, 2, 3, 4, 5] },
      [run(1, 14, 41_000, 'ok', 'Example run'), run(2, 38, 38_000, 'ok', 'Example run'), run(3, 62, 52_000, 'error', 'Example: SAP connector timed out')]),
    mk('ex-margin', 'Margin report for the board', { type: 'agent', id: 'example-agent-2', label: 'Margin analyst' }, { kind: 'cron', expr: '0 8 1 * *' },
      [run(4, 24 * 3, 66_000, 'ok', 'Example run')]),
    mk('ex-reminders', 'Payment reminders', { type: 'workflow', id: 'example-workflow', label: 'Invoice reminder (n8n)' }, { kind: 'daily', time: '09:00' },
      [run(5, 12, 9_000, 'ok', 'Example run'), run(6, 36, 8_000, 'ok', 'Example run'), run(7, 60, 12_000, 'ok', 'Example run', 'manual')], 'Only overdue invoices above 1,000 EUR.'),
    mk('ex-sync', 'Ticket sync', { type: 'workflow', id: 'example-workflow-2', label: 'Jira to Sub4Me sync' }, { kind: 'interval', every: 2, unit: 'hours' },
      [run(8, 1, 6_000, 'ok', 'Example run'), run(9, 3, 7_000, 'ok', 'Example run')]),
    mk('ex-brief', 'Morning briefing', { type: 'skill', id: 'example-skill', label: 'daily-briefing' }, { kind: 'daily', time: '07:45' },
      [run(10, 13, 21_000, 'ok', 'Example run'), run(11, 37, 19_000, 'ok', 'Example run')]),
    mk('ex-cleanup', 'Skill registry clean-up', { type: 'skill', id: 'example-skill-2', label: 'skill-registry-review' }, { kind: 'monthly', time: '06:00', day: 15 },
      [], 'List skills without owner or description.', false),
  ];
}
