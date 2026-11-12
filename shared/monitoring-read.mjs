/**
 * Read-only access to a monitoring system, built for the Alerts Space. Runs only in the main process:
 *  - an adapter can only READ: it has a name and one function, listAlerts. Anything else is refused before it is used,
 *    and the one adapter that exists sends GET requests only (no write method exists in this file).
 *  - the login stays here: it is never put into a Space, the chat or the agent, and never into an error text or the log.
 *  - every answer is cut down to a fixed list of fields (data minimisation), alert text is plain short text, and the customer
 *    does NOT come from the monitoring but from a local map (host -> customer), kept outside the repository.
 * The alert text stays untrusted: the Alerts Space still checks it for instructions aimed at an AI assistant before it shows it.
 * Not an agent tool: the agent has no way to call this.
 */
import { readFileSync } from 'node:fs';

export class MonitoringError extends Error {}

const ID = /^[A-Za-z0-9._:-]{1,40}$/;
const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const MAX_ALERTS = 200;
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;
const SEVERITY = { critical: 'critical', fatal: 'critical', disaster: 'critical', high: 'high', major: 'high', error: 'high', average: 'medium', medium: 'medium', warning: 'medium', warn: 'medium', low: 'low', minor: 'low', info: 'low', information: 'low' };
const LEVEL = ['high', 'medium', 'low'];

/** Plain short text: no control characters or angle brackets, one line, cut to length. */
export const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** A time as UTC to the minute (YYYY-MM-DDTHH:MM), or '' when it is not a time. */
export function toMinute(v) {
  const ms = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms) || ms < Date.parse('2000-01-01') || ms > Date.parse('2100-01-01')) return '';
  return new Date(ms).toISOString().slice(0, 16);
}

/** One alert of the neutral format -> the alert of the Alerts Space. Only the listed fields are taken; a monitoring that sends more is ignored. */
export function normalizeAlert(raw, hosts = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : '', host = typeof raw.host === 'string' ? raw.host : '';
  if (!ID.test(id) || !HOST.test(host)) return null;
  const severity = SEVERITY[String(raw.severity ?? '').toLowerCase()], at = toMinute(raw.at), text = clip(raw.text, 300);
  if (!severity || !at || !text) return null;
  const m = hosts[host] && typeof hosts[host] === 'object' ? hosts[host] : {};
  return { id, customer: clip(m.customer, 60), host, service: clip(raw.service, 60) || clip(m.service, 60) || host, severity, impact: LEVEL.includes(m.impact) ? m.impact : 'medium',
    customerFacing: m.customerFacing === true, repeat24h: 0, text, at };
}

/** A list of raw alerts: valid ones only, each id once, oldest first, at most 200; repeats of the same text on the same host within a day are counted. */
export function normalizeAll(list, hosts = {}, limit = MAX_ALERTS) {
  const seen = new Set(), out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const a = normalizeAlert(raw, hosts);
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id); out.push(a);
  }
  out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const cut = out.slice(0, Math.max(1, Math.min(MAX_ALERTS, limit)));
  for (const a of cut) {
    const same = cut.filter((b) => b.host === a.host && b.text === a.text && Math.abs(Date.parse(b.at + ':00Z') - Date.parse(a.at + ':00Z')) <= 86_400_000).length - 1;
    a.repeat24h = Math.max(0, Math.min(9, same));
  }
  return cut;
}

/** An adapter reads and nothing else: a name and listAlerts. */
export function assertReadOnly(adapter) {
  const keys = adapter && typeof adapter === 'object' ? Object.keys(adapter) : [];
  if (!keys.length || keys.some((k) => k !== 'name' && k !== 'listAlerts') || typeof adapter.listAlerts !== 'function') throw new MonitoringError('A monitoring adapter may only read: a name and listAlerts, nothing else.');
  return adapter;
}

function baseUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new MonitoringError('The monitoring address is not a valid URL.'); }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new MonitoringError('The monitoring address must use https.');
  if (u.username || u.password) throw new MonitoringError('The monitoring address must not contain a login.');
  return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
}

/**
 * The one adapter that exists: any monitoring (or a small proxy in front of it) that answers GET <base>/alerts?since=<ISO time>&limit=<n>
 * with { "alerts": [ { id, host, service, severity, at, text } ] } and a bearer token that may only read. No redirects (the token would follow).
 */
export function createHttpJsonAdapter({ baseUrl: base, token, fetchImpl = fetch, timeoutMs = TIMEOUT_MS }) {
  const root = baseUrl(base);
  if (typeof token !== 'string' || !token.trim()) throw new MonitoringError('The monitoring read token is missing.');
  return Object.freeze({
    name: 'http-json',
    async listAlerts({ since, limit }) {
      const url = `${root}/alerts?since=${encodeURIComponent(since)}&limit=${encodeURIComponent(String(limit))}`;
      let res;
      try { res = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
      catch { throw new MonitoringError('The monitoring did not answer (network, timeout or a redirect).'); }
      if (!res.ok) throw new MonitoringError(`The monitoring answered HTTP ${res.status}.`);
      const body = await res.text();
      if (body.length > MAX_BYTES) throw new MonitoringError('The monitoring answer is too large.');
      let json;
      try { json = JSON.parse(body); } catch { throw new MonitoringError('The monitoring answer is not JSON.'); }
      return Array.isArray(json) ? json : Array.isArray(json?.alerts) ? json.alerts : [];
    },
  });
}

/** The adapter named by the settings, or null while nothing is configured. env: MONITORING_BASE_URL, MONITORING_READ_TOKEN, optional MONITORING_ADAPTER (only http-json). */
export function adapterFromEnv(env, fetchImpl = fetch) {
  if (!env || !env.MONITORING_BASE_URL || !env.MONITORING_READ_TOKEN) return null;
  const kind = (env.MONITORING_ADAPTER || 'http-json').trim();
  if (kind !== 'http-json') throw new MonitoringError(`Unknown monitoring adapter "${clip(kind, 30)}". Only http-json exists so far.`);
  return createHttpJsonAdapter({ baseUrl: env.MONITORING_BASE_URL, token: env.MONITORING_READ_TOKEN, fetchImpl });
}

/** The local map (not in the repository): { "hosts": { "<host>": { customer, service, impact, customerFacing, dependsOn: ["<host>"] } } }. Missing or broken: empty. */
export function readMap(file) {
  let raw = {};
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { /* no map: hosts are unknown, the customer stays empty */ }
  const hosts = {}, topology = {};
  for (const [h, m] of Object.entries(raw && typeof raw.hosts === 'object' && raw.hosts ? raw.hosts : {})) {
    if (!HOST.test(h) || !m || typeof m !== 'object') continue;
    hosts[h] = { customer: clip(m.customer, 60), service: clip(m.service, 60), impact: LEVEL.includes(m.impact) ? m.impact : 'medium', customerFacing: m.customerFacing === true };
    const deps = (Array.isArray(m.dependsOn) ? m.dependsOn : []).filter((d) => typeof d === 'string' && HOST.test(d)).slice(0, 10);
    if (deps.length) topology[h] = deps;
  }
  return { hosts, topology };
}

/** adapter: an adapter or a function that returns one (or null) each time, so a changed setting needs no restart. */
export function createMonitoringRead({ adapter, mapFile, now = () => new Date(), log = () => {} }) {
  const current = () => { const a = typeof adapter === 'function' ? adapter() : adapter; return a ? assertReadOnly(a) : null; };
  return {
    status() { try { const a = current(); return { configured: !!a, adapter: a ? a.name : '' }; } catch { return { configured: false, adapter: '' }; } },
    async alerts({ sinceHours } = {}) {
      const a = current();
      if (!a) throw new MonitoringError('No monitoring is connected. Set MONITORING_BASE_URL and MONITORING_READ_TOKEN (a token that may only read).');
      const hours = Math.max(1, Math.min(168, Math.round(Number(sinceHours) || 24)));
      const t = now(), since = new Date(t.getTime() - hours * 3_600_000).toISOString();
      const map = readMap(mapFile);
      const alerts = normalizeAll(await a.listAlerts({ since, limit: MAX_ALERTS }), map.hosts);
      const hostsSeen = new Set(alerts.map((x) => x.host)), topology = {};
      for (const [h, deps] of Object.entries(map.topology)) if (hostsSeen.has(h)) topology[h] = deps.filter((d) => hostsSeen.has(d));
      log({ at: t.toISOString(), adapter: a.name, hours, alerts: alerts.length });
      return { source: 'live', adapter: a.name, fetchedAt: toMinute(t.toISOString()), sinceHours: hours, alerts, topology };
    },
  };
}
