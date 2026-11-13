/**
 * Bridge for the Alerts Space (it-operations). The Space may send one fixed request and nothing else:
 *   mon:alerts-request → mon:alerts  (the alerts of the monitoring of the last hours, read only)
 * The main process reads the monitoring with a login that stays there: not the Space, not the chat, not the agent.
 * The answer is cut down again here to the fields the Space shows. Alert text stays untrusted: the Space checks it itself.
 */
export const MONITORING_SPACE = 'it-operations';
/** The Orchestrator reads findings (live alerts through the rules of the local map) in shadow mode, with the same limits. */
export const SHADOW_SPACE = 'infra-orchestrator';

type Res = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
export interface MonitoringHost { alerts: (sinceHours: number) => Promise<Res>; findings?: (sinceHours: number) => Promise<Res> }

const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const ID = /^[A-Za-z0-9._:-]{1,40}$/;
const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const LEVELS = ['high', 'medium', 'low'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').slice(0, max) : '');

export function pickAlerts(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const a of raw.slice(0, 200)) {
    if (!isObject(a) || typeof a.id !== 'string' || !ID.test(a.id) || typeof a.host !== 'string' || !HOST.test(a.host) || typeof a.at !== 'string' || !TIME.test(a.at)) continue;
    const text = str(a.text, 300).trim();
    if (!text || !SEVERITIES.includes(String(a.severity))) continue;
    out.push({ id: a.id, customer: str(a.customer, 60), host: a.host, service: str(a.service, 60) || a.host, severity: a.severity, impact: LEVELS.includes(String(a.impact)) ? a.impact : 'medium',
      customerFacing: a.customerFacing === true, repeat24h: typeof a.repeat24h === 'number' ? Math.max(0, Math.min(9, Math.round(a.repeat24h))) : 0, text, at: a.at });
  }
  return out;
}

export function pickTopology(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!isObject(raw)) return out;
  for (const [h, deps] of Object.entries(raw).slice(0, 200)) {
    if (!HOST.test(h) || !Array.isArray(deps)) continue;
    const list = deps.filter((d): d is string => typeof d === 'string' && HOST.test(d)).slice(0, 10);
    if (list.length) out[h] = list;
  }
  return out;
}

const KINDS = ['cert-expiry', 'patch-age', 'disk-trend', 'dns-stale'];
const TEMPLATES = ['renew-certificate', 'patch-vm', 'move-vm', 'update-dns-record'];
const ENVS = ['PRD', 'QAS', 'DEV'];

export function pickFindings(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const f of raw.slice(0, 100)) {
    if (!isObject(f) || typeof f.id !== 'string' || !ID.test(f.id) || typeof f.host !== 'string' || !HOST.test(f.host)) continue;
    if (!KINDS.includes(String(f.kind)) || !TEMPLATES.includes(String(f.template)) || !ENVS.includes(String(f.env))) continue;
    const days = typeof f.deadlineDays === 'number' && Number.isInteger(f.deadlineDays) ? f.deadlineDays : 0;
    if (days < 1 || days > 365) continue;
    const customer = typeof f.customer === 'string' && /^[a-z0-9]{0,12}$/.test(f.customer) ? f.customer : '';
    out.push({ id: f.id, customer, customerName: str(f.customerName, 60), host: f.host, env: f.env, kind: f.kind, template: f.template, deadlineDays: days, signal: str(f.signal, 120), evidence: str(f.evidence, 240), live: true });
  }
  return out;
}

/** The alerts that matched no rule: only what the person needs to fit a rule to the wording. */
export function pickUnmatched(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const a of raw.slice(0, 50)) {
    if (!isObject(a) || typeof a.id !== 'string' || !ID.test(a.id) || typeof a.host !== 'string' || !HOST.test(a.host)) continue;
    const text = str(a.text, 200).trim();
    if (text) out.push({ id: a.id, host: a.host, severity: SEVERITIES.includes(String(a.severity)) ? a.severity : 'low', text });
  }
  return out;
}

export async function handleMonitoringMessage(data: unknown, host: MonitoringHost | undefined): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || (data.type !== 'mon:alerts-request' && data.type !== 'mon:findings-request')) return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'ct:error', requestId, message });
  if (!host) return fail('Live alerts need the desktop app.');
  const hours = typeof data.sinceHours === 'number' && Number.isFinite(data.sinceHours) ? Math.max(1, Math.min(168, Math.round(data.sinceHours))) : 24;
  try {
    if (data.type === 'mon:findings-request') {
      if (!host.findings) return fail('Live findings need the desktop app.');
      const f = await host.findings(hours);
      if (!f.ok) return fail(f.error);
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100000, Math.round(v))) : 0);
      return { type: 'mon:findings', requestId, source: 'live', adapter: str(f.data.adapter, 30), fetchedAt: str(f.data.fetchedAt, 16), sinceHours: hours, alerts: num(f.data.alerts), skipped: num(f.data.skipped), withheld: num(f.data.withheld), rulesDropped: num(f.data.rulesDropped), findings: pickFindings(f.data.findings), unmatched: pickUnmatched(f.data.unmatched) };
    }
    const res = await host.alerts(hours);
    if (!res.ok) return fail(res.error);
    return { type: 'mon:alerts', requestId, source: 'live', adapter: str(res.data.adapter, 30), fetchedAt: str(res.data.fetchedAt, 16), sinceHours: hours, alerts: pickAlerts(res.data.alerts), topology: pickTopology(res.data.topology) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
