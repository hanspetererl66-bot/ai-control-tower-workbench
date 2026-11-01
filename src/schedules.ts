/** Recurring questions ("briefings"): run in the chat at a set time, daily or on chosen weekdays. They run while the app is open. */
export type Schedule = {
  id: string;
  prompt: string;
  /** "HH:MM", local time. */
  time: string;
  repeat: 'daily' | 'weekly';
  /** 0 = Sunday … 6 = Saturday; used when repeat is weekly. */
  days: number[];
  enabled: boolean;
  /** ISO time of the last run. */
  lastRun?: string;
  /** Short name shown in the list; the question is used when it is empty. */
  name?: string;
  /** What happens with the answer after a run (apart from showing it in the chat). */
  delivery?: Delivery;
  /** How the last run ended; shown in the list. */
  lastStatus?: 'ok' | 'error';
  /** One line about the last run, for example where the PDF went or what failed. */
  lastNote?: string;
};

/** The answer can be saved as a PDF and put into an email draft with the PDF attached. Nothing is sent without the person. */
export type Delivery = { pdf: boolean; email: boolean; to: string };
export const NO_DELIVERY: Delivery = { pdf: false, email: false, to: '' };
const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
export const isEmail = (value: string): boolean => EMAIL.test(value.trim()) && value.trim().length <= 120;

/** Email needs the PDF, so it implies it. An address is required for email; otherwise email is switched off. */
export function sanitizeDelivery(value: unknown): Delivery {
  if (typeof value !== 'object' || value === null) return NO_DELIVERY;
  const r = value as Record<string, unknown>;
  const to = typeof r.to === 'string' && isEmail(r.to) ? r.to.trim() : '';
  const email = r.email === true && to !== '';
  return { pdf: r.pdf === true || email, email, to: email ? to : '' };
}

export const scheduleTitle = (s: Pick<Schedule, 'name' | 'prompt'>): string => (s.name?.trim() || s.prompt.trim()).slice(0, 80);

export const SCHEDULES_KEY = 'werkbank.schedules.v1';
export const WEEKDAYS = [
  { day: 1, short: 'Mo', long: 'Monday' }, { day: 2, short: 'Tu', long: 'Tuesday' }, { day: 3, short: 'We', long: 'Wednesday' },
  { day: 4, short: 'Th', long: 'Thursday' }, { day: 5, short: 'Fr', long: 'Friday' }, { day: 6, short: 'Sa', long: 'Saturday' }, { day: 0, short: 'Su', long: 'Sunday' },
] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A missed run is still made up for this long (the app was closed at that time). */
export const CATCH_UP_MS = 6 * 3600_000;
export const MAX_SCHEDULES = 12;

export function sanitizeSchedules(value: unknown): Schedule[] {
  if (!Array.isArray(value)) return [];
  const out: Schedule[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const prompt = typeof r.prompt === 'string' ? r.prompt.trim().slice(0, 600) : '';
    const time = typeof r.time === 'string' && TIME.test(r.time) ? r.time : '';
    const id = typeof r.id === 'string' && /^[a-z0-9-]{1,40}$/i.test(r.id) ? r.id : '';
    if (!prompt || !time || !id || out.some((s) => s.id === id)) continue;
    const repeat = r.repeat === 'weekly' ? 'weekly' : 'daily';
    const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
    if (repeat === 'weekly' && days.length === 0) continue;
    const name = typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 60) : '';
    const delivery = sanitizeDelivery(r.delivery);
    const lastNote = typeof r.lastNote === 'string' ? r.lastNote.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 200) : '';
    out.push({
      id, prompt, time, repeat, days, enabled: r.enabled !== false,
      lastRun: typeof r.lastRun === 'string' && !Number.isNaN(Date.parse(r.lastRun)) ? r.lastRun : undefined,
      ...(name ? { name } : {}),
      ...(delivery.pdf ? { delivery } : {}),
      ...(r.lastStatus === 'ok' || r.lastStatus === 'error' ? { lastStatus: r.lastStatus } : {}),
      ...(lastNote ? { lastNote } : {}),
    });
    if (out.length >= MAX_SCHEDULES) break;
  }
  return out;
}

const at = (base: Date, time: string): Date => { const [h, m] = time.split(':').map(Number); const d = new Date(base); d.setHours(h, m, 0, 0); return d; };
const runsOn = (s: Schedule, d: Date): boolean => s.repeat === 'daily' || s.days.includes(d.getDay());

/** The most recent planned run at or before `now` (looks back up to a week), or null. */
export function lastPlanned(s: Schedule, now: Date): Date | null {
  for (let back = 0; back <= 7; back += 1) {
    const day = new Date(now); day.setDate(day.getDate() - back);
    const when = at(day, s.time);
    if (runsOn(s, when) && when <= now) return when;
  }
  return null;
}

/** The next planned run after `now`. */
export function nextRun(s: Schedule, now: Date): Date | null {
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const day = new Date(now); day.setDate(day.getDate() + ahead);
    const when = at(day, s.time);
    if (runsOn(s, when) && when > now) return when;
  }
  return null;
}

/** Due when the latest planned run has passed, was not run yet, and is not older than the catch-up window. */
export function isDue(s: Schedule, now: Date): boolean {
  if (!s.enabled) return false;
  const planned = lastPlanned(s, now);
  if (!planned || now.getTime() - planned.getTime() > CATCH_UP_MS) return false;
  return !s.lastRun || Date.parse(s.lastRun) < planned.getTime();
}

export function describeSchedule(s: Schedule): string {
  const days = s.repeat === 'daily' ? 'every day' : `every ${WEEKDAYS.filter((w) => s.days.includes(w.day)).map((w) => w.short).join(', ')}`;
  return `${days} at ${s.time}`;
}

export function loadSchedules(storage?: Pick<Storage, 'getItem'>): Schedule[] {
  try { return sanitizeSchedules(JSON.parse(storage?.getItem(SCHEDULES_KEY) ?? '[]')); } catch { return []; }
}
export function saveSchedules(list: Schedule[], storage?: Pick<Storage, 'setItem'>): void {
  try { storage?.setItem(SCHEDULES_KEY, JSON.stringify(list)); } catch { /* kept in memory only */ }
}
