/**
 * SmartRecruiters connection for the recruiting tables: first as a MOCK, so the whole path can be shown without an account.
 *
 *   client (mock or http)  ->  mapToRecruiting (removes every personal field)  ->  recruiting_import (database)
 *
 * The mock returns data SHAPED like the SmartRecruiters Customer API (jobs, candidates with a primary assignment and a status),
 * including invented names and e-mail addresses, so the test can prove that the mapping drops them. The shape follows the public
 * documentation only in broad strokes and is NOT verified against the real API; the HTTP client is the same: written from the
 * documented authentication (header X-SmartToken, base https://api.smartrecruiters.com) and exercised with a fake fetch only.
 *
 * What is NOT done here: CV text. The real API returns attachments, not text. The mock supplies `resumeLines`; a real connection
 * would first need a text extraction step (and the privacy questions that come with it). Nothing is written back to SmartRecruiters.
 */
import { ToolError } from './tools.mjs';
import { actorOf } from './skill-lifecycle.mjs';

/** SmartRecruiters candidate status -> our six stages. INTERVIEW_2 and FINAL are names of the mock only (the real API has one INTERVIEW status plus custom sub-statuses, unchecked). Anything else (hired, rejected, withdrawn, unknown) is not in the process. */
export const STAGE_OF = {
  LEAD: 'Applied', NEW: 'Applied', IN_REVIEW: 'Screening', PHONE_SCREEN: 'Screening', INTERVIEW: 'Online interview', INTERVIEW_2: 'In-person interview', FINAL: 'Final conversation', OFFER: 'Offer',
};

const EMAIL = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/;
const URL_LIKE = /(https?:\/\/|www\.)/i;
const PHONE = /(\+|\b00)[0-9][0-9 ()/.-]{7,}[0-9]|(^|[^0-9])0[0-9]{2,4}[ /.-][0-9]{3,}[ /.-][0-9]{3,}|[0-9]{9,}/;

export const personalLine = (s) => EMAIL.test(s) || URL_LIKE.test(s) || PHONE.test(s) || s.length > 300;
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** Pure: SmartRecruiters-shaped jobs and candidates -> the payload of recruiting_import. Only whitelisted fields are copied. */
export function mapToRecruiting(jobs, candidatesByJob, { asOf } = {}) {
  const today = asOf ?? new Date().toISOString().slice(0, 10);
  const requisitions = [];
  const candidates = [];
  const dropped = { notInProcess: 0, personalLines: 0, noDate: 0 };
  for (const j of Array.isArray(jobs) ? jobs : []) {
    const opened = day(j?.createdOn);
    if (!j?.id || !j?.title || !opened) { dropped.noDate += 1; continue; }
    requisitions.push({
      ref: String(j.id), title: String(j.title).slice(0, 120), dept: String(j.department?.label ?? 'Unknown').slice(0, 60),
      location: [j.location?.city, j.location?.remote ? 'remote' : null].filter(Boolean).join(' / ').slice(0, 80),
      managerRole: String(j.customField?.hiringManagerRole ?? '').slice(0, 80), openedOn: opened,
      targetDays: Number.isInteger(j.customField?.targetDays) ? j.customField.targetDays : 45,
    });
    for (const c of candidatesByJob?.[j.id] ?? []) {
      const stage = STAGE_OF[c?.primaryAssignment?.status ?? c?.status];
      if (!c?.id || !stage) { dropped.notInProcess += 1; continue; }
      const applied = day(c.appliedOn) ?? day(c.primaryAssignment?.createdOn) ?? opened;
      const since = day(c.primaryAssignment?.statusChangedOn) ?? applied;
      const cv = [];
      for (const line of Array.isArray(c.resumeLines) ? c.resumeLines : []) {
        const t = String(line).replace(/\s+/g, ' ').trim();
        if (!t) continue;
        if (personalLine(t)) { dropped.personalLines += 1; continue; }
        cv.push(t);
      }
      const years = Number.isInteger(c.experienceYears) ? c.experienceYears : null;
      candidates.push({
        ref: String(c.id), requisitionRef: String(j.id), stage, stageSince: since > today ? today : since < applied ? applied : since, appliedOn: applied,
        years, yearsLine: years !== null && cv.length ? 1 : null, cv: cv.slice(0, 60),
      });
    }
  }
  return { payload: { requisitions, candidates }, dropped };
}

/** Mock client: answers like the API, from a fixture. Never touches the network. */
export function createMockClient(fixture) {
  return {
    kind: 'mock',
    async listJobs() { return { content: structuredClone(fixture.jobs ?? []), totalFound: (fixture.jobs ?? []).length }; },
    async listCandidates(jobId) { const list = fixture.candidates?.[jobId] ?? []; return { content: structuredClone(list), totalFound: list.length }; },
  };
}

/**
 * HTTP client for the Customer API. UNVERIFIED: written from the documented key header and base URL; paths and field names are
 * assumptions. The key stays in this process and goes only to the SmartRecruiters host.
 */
export function createHttpClient({ token, baseUrl = 'https://api.smartrecruiters.com', fetchImpl = globalThis.fetch } = {}) {
  if (!token || typeof token !== 'string') throw new ToolError('A SmartRecruiters API key is needed.');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || !/(^|\.)smartrecruiters\.com$/.test(base.hostname)) throw new ToolError('The API key is only sent to smartrecruiters.com.');
  const get = async (path) => {
    const res = await fetchImpl(new URL(path, base), { headers: { 'X-SmartToken': token, accept: 'application/json' } });
    if (!res.ok) throw new ToolError(`SmartRecruiters answered ${res.status} for ${path.split('?')[0]}`);
    return res.json();
  };
  return {
    kind: 'http',
    listJobs: () => get('/jobs?status=SOURCING&limit=100'),
    listCandidates: (jobId) => get(`/jobs/${encodeURIComponent(jobId)}/candidates?limit=100`),
  };
}

/** Reads through the client, maps, and sends one payload to the database. `actor` becomes the hiring manager of new requisitions. */
export async function importFromSmartRecruiters({ client, rpc, actor, asOf }) {
  if (!rpc) throw new ToolError('The shared database is not set up: enter the Supabase URL and the secret key in the settings of the connector.');
  const who = actorOf({ actor });
  const jobs = (await client.listJobs())?.content ?? [];
  const byJob = {};
  for (const j of jobs) byJob[j.id] = (await client.listCandidates(j.id))?.content ?? [];
  const { payload, dropped } = mapToRecruiting(jobs, byJob, { asOf });
  const result = await rpc('recruiting_import', { p_actor: who, p_payload: payload });
  return { source: client.kind, ...result, dropped };
}
