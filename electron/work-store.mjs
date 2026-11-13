/**
 * The window's access to the shared database for the work items (agents, workflows, code; migration 021).
 * The page never sees the Supabase key and never names the person: this module reads URL and key from the settings of the
 * connector that already holds them, and adds the e-mail (MVP identity, one place to change when a real sign-in comes).
 * Only the five work item tools can be called, and each one goes through the same checks as the connector tools.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createWorkItemHandlers, WORK_ITEM_TOOL_DEFINITIONS } from '../connectors/_lib/server/work-items.mjs';
import { createJobRunHandlers, recordJobRuns } from '../connectors/_lib/server/job-runs.mjs';
import { createMockClient, importFromSmartRecruiters } from '../connectors/_lib/server/smartrecruiters.mjs';
import { shadowStart, shadowSummary, shadowVerdict } from '../connectors/_lib/server/autonomy.mjs';
import { createRecruitingHandlers, decideHire, decideProposal, releaseContract, onboardingList, onboardingHandover, onboardingSet } from '../connectors/_lib/server/recruiting.mjs';
import { observeCall } from '../connectors/_lib/server/observability.mjs';
import { saveInterviewRecord, saveAssessment, listAssessments } from '../connectors/_lib/server/interviews.mjs';
import { publishPostingMock, releasePosting, sendBackPosting, withdrawPosting } from '../connectors/_lib/server/job-postings.mjs';
import { casesList, caseSave, caseReset } from '../connectors/_lib/server/renewals-cases.mjs';
import { RuleError, supabaseRpc } from '../connectors/_lib/server/runtime.mjs';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const ALLOWED_TOOLS = new Set(WORK_ITEM_TOOL_DEFINITIONS.map((t) => t.name));
/** Connectors whose settings may hold the database access, in this order. */
export const CONFIG_SOURCES = ['werkbank-workspace', 'skill-marketplace'];

/** The person every project is saved under, until a real sign-in replaces this (private prototype, one user). */
export const DEFAULT_EMAIL = 'hanspeter.erl66@gmail.com';

const PROPOSAL_LIST_ARGS = new Set(['status', 'requisition', 'limit']);
const HIRE_LIST_ARGS = new Set(['status', 'limit']);
const RUN_LIST_ARGS = new Set(['days', 'job', 'status', 'trigger', 'only_mine', 'limit']);

export function createWorkStore({ file, readConnector, defaultEmail = '' }) {
  const readEmail = () => {
    try { const v = existsSync(file) ? String(JSON.parse(readFileSync(file, 'utf8')).email ?? '') : ''; if (EMAIL.test(v)) return v; } catch { /* fall through to the default */ }
    return EMAIL.test(defaultEmail) ? defaultEmail : '';
  };
  /** { url, key, source } from the first connector that has both; key is read only here. */
  const access = () => {
    for (const name of CONFIG_SOURCES) {
      const { url, key } = readConnector(name) ?? {};
      if (url && key) return { url, key, source: name };
    }
    return null;
  };
  /** rpc bound to the database access and the stored e-mail; throws a readable message when either is missing. */
  const connect = () => {
    const acc = access();
    if (!acc) throw new Error('The shared database is not set up: enter the Supabase URL and the secret key in the settings of the connector "werkbank-workspace".');
    const email = readEmail();
    if (!email) throw new Error('Enter your e-mail first. It names you as the author of every saved revision.');
    const rpc = async (fn, body) => {
      try { return await supabaseRpc(fn, body, acc.url, acc.key); }
      catch (e) { if (e instanceof RuleError) throw new Error(e.message); throw new Error(`The database did not answer: ${e?.message ?? e}`); }
    };
    return { rpc, email };
  };
  return {
    /** { url, key, email } for other main-process stores (skills), or null when the database or the e-mail is missing. */
    credentials() {
      const acc = access(), email = readEmail();
      return acc && email ? { url: acc.url, key: acc.key, email } : null;
    },
    status() { return { configured: !!access(), email: readEmail(), source: access()?.source ?? '' }; },
    setEmail(raw) {
      const email = String(raw ?? '').trim().toLowerCase();
      if (email && (!EMAIL.test(email) || email.length > 120)) return { ok: false, detail: 'This is not an e-mail address.' };
      writeFileSync(file, JSON.stringify({ email }), 'utf8');
      return { ok: true, email };
    },
    /** Writes finished Scheduler runs to the run log (append only). Not a tool: the agent cannot call this. */
    async recordRuns(runs) {
      const { rpc, email } = connect();
      return recordJobRuns(rpc, email, runs);
    },
    /** Reads the run log for the Activity tab: only the filters of list_job_runs, always as the stored e-mail. */
    async listRuns(args) {
      const { rpc, email } = connect();
      const clean = {};
      for (const [k, v] of Object.entries(args && typeof args === 'object' ? args : {})) if (RUN_LIST_ARGS.has(k)) clean[k] = v;
      return createJobRunHandlers(rpc).list_job_runs({ ...clean, actor: email });
    },
    /** Joule's recruiting proposals for the approval screen: fixed filters, always as the stored e-mail. */
    async listProposals(args) {
      const { rpc, email } = connect();
      const clean = {};
      for (const [k, v] of Object.entries(args && typeof args === 'object' ? args : {})) if (PROPOSAL_LIST_ARGS.has(k)) clean[k] = v;
      return createRecruitingHandlers(rpc).recruiting_list_proposals({ limit: 200, ...clean, actor: email });
    },
    /** Import from SmartRecruiters. Only the MOCK client exists in the app today (no account, no key): it reads a fixture, never the network. */
    async importSmartRecruiters() {
      const { rpc, email } = connect();
      const fixture = JSON.parse(readFileSync(new URL('../connectors/_lib/server/smartrecruiters-mock.json', import.meta.url), 'utf8'));
      return importFromSmartRecruiters({ client: createMockClient(fixture), rpc, actor: email });
    },
    /** The open requisitions of the stored e-mail with their criteria, for the criteria editor. */
    async listCriteria() {
      const { rpc, email } = connect();
      const rows = await rpc('recruiting_criteria_mine', { p_actor: email });
      return Array.isArray(rows) ? rows : [];
    },
    /** Creates or edits one criterion. Not a tool. Arguments are whitelisted and the actor is the stored e-mail; the database allows only the hiring manager. */
    async setCriterion(a) {
      const { rpc, email } = connect();
      const x = a && typeof a === 'object' ? a : {};
      const list = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string').map((t) => t.slice(0, 80)).slice(0, 10) : []);
      return rpc('recruiting_criterion_set', {
        p_actor: email, p_requisition: String(x.requisition ?? ''), p_crit_id: x.id ? String(x.id) : null, p_must: x.must === true,
        p_label: String(x.label ?? '').slice(0, 120), p_kind: String(x.kind ?? ''),
        p_min_years: Number.isInteger(x.minYears) ? x.minYears : null, p_needles: list(x.needles), p_partial: list(x.partial),
      });
    },
    async deleteCriterion(requisition, id) {
      const { rpc, email } = connect();
      return rpc('recruiting_criterion_delete', { p_actor: email, p_requisition: String(requisition ?? ''), p_crit_id: String(id ?? '') });
    },
    /** Keeps the record of an online interview for the hiring manager. Not a tool: the agent cannot write one. The database accepts only the manager of the requisition and refuses an e-mail address. */
    async saveInterview(requisition, record) {
      const { rpc, email } = connect();
      return saveInterviewRecord(rpc, email, requisition, record);
    },
    /** Keeps one revision of the rubric assessment of an application interview (migration 041). Not a tool. */
    async saveAssessment(requisition, record) {
      const { rpc, email } = connect();
      return saveAssessment(rpc, email, requisition, record);
    },
    /** The saved assessment revisions of a requisition, for the hiring manager only (the database checks). */
    async listAssessments(requisition) {
      const { rpc, email } = connect();
      return listAssessments(rpc, email, requisition);
    },
    /**
     * Agent observability for the Observability space: seven fixed reading functions, whitelisted arguments, always as the stored e-mail.
     * Read only. Nothing here writes, and the run history in the database is append only anyway.
     */
    async observe(view, params) {
      const { rpc, email } = connect();
      return observeCall(rpc, email, view, params);
    },
    /** Hiring approvals for the Hiring Approvals space: fixed filters, always as the stored e-mail. */
    async listHireRequests(args) {
      const { rpc, email } = connect();
      const clean = {};
      for (const [k, v] of Object.entries(args && typeof args === 'object' ? args : {})) if (HIRE_LIST_ARGS.has(k)) clean[k] = v;
      return createRecruitingHandlers(rpc).recruiting_list_hire_requests({ limit: 200, ...clean, actor: email });
    },
    /** One approver's decision after a click. Not a tool: the agent cannot call this. The database accepts only the approver whose turn it is. */
    async decideHire(id, decision, note) {
      const { rpc, email } = connect();
      return decideHire(rpc, email, id, decision, note);
    },
    /** HR releases the contract after a click. Not a tool: the agent cannot call this. The database accepts only the HR approver of the request. */
    async releaseContract(id) {
      const { rpc, email } = connect();
      return releaseContract(rpc, email, id);
    },
    /** Onboarding: read, hand over (HR, signed contract) and mark a step. After a click only, never an agent tool. */
    /** Shadow protocol of the Orchestrator: decisions and a person's verdict. After a click only, never an agent tool. */
    async shadowStart(run, decisions) { const { rpc, email } = connect(); return shadowStart(rpc, email, run, decisions); },
    async shadowVerdict(decisionId, verdict, reason, note) { const { rpc, email } = connect(); return shadowVerdict(rpc, email, decisionId, verdict, reason, note); },
    async shadowSummary() { const { rpc, email } = connect(); return shadowSummary(rpc, email); },
    /** Renewals autopilot and win-back cases (migration 050): always as the stored e-mail. */
    async renewalsCases() { const { rpc, email } = connect(); return casesList(rpc, email); },
    async renewalsCaseSave(args) { const { rpc, email } = connect(); return caseSave(rpc, email, args); },
    async renewalsCaseReset(args) { const { rpc, email } = connect(); return caseReset(rpc, email, args); },
    async onboardingList() { const { rpc, email } = connect(); return onboardingList(rpc, email); },
    async onboardingHandover(id, start) { const { rpc, email } = connect(); return onboardingHandover(rpc, email, id, start); },
    async onboardingSet(id, step, status, note) { const { rpc, email } = connect(); return onboardingSet(rpc, email, id, step, status, note); },
    /** Job postings of the requisitions the stored e-mail manages, plus the channels, for the posting screen. Fixed filters, always as the stored e-mail. */
    async listPostings(args) {
      const { rpc, email } = connect();
      const status = typeof args?.status === 'string' && ['draft', 'in_review', 'released', 'withdrawn'].includes(args.status) ? args.status : null;
      const postings = await rpc('recruiting_postings_list', { p_actor: email, p_status: status, p_requisition: null, p_limit: 200 });
      const context = await rpc('recruiting_posting_context', { p_actor: email });
      return { postings: Array.isArray(postings) ? postings : [], channels: Array.isArray(context?.channels) ? context.channels : [] };
    },
    /** The hiring manager's steps on a posting after a click: release, send back, withdraw. Not tools: the agent cannot call these. The database accepts only the manager of the requisition. */
    async postingStep(action, id, note) {
      const { rpc, email } = connect();
      if (action === 'release') return releasePosting(rpc, email, id, note);
      if (action === 'send_back') return sendBackPosting(rpc, email, id, note);
      if (action === 'withdraw') return withdrawPosting(rpc, email, id, note);
      throw new Error('This step is not allowed.');
    },
    /** Publishing, SIMULATED: the main process builds the channel texts, the database records "simulated", nothing leaves the computer. */
    async publishPosting(id, channelIds) {
      const { rpc, email } = connect();
      return publishPostingMock(rpc, email, id, channelIds);
    },
    /** The hiring manager's decision after a click. Not a tool: the agent cannot call this. The database only accepts the manager of the requisition. */
    async decideProposal(id, decision, note) {
      const { rpc, email } = connect();
      return decideProposal(rpc, email, id, decision, note);
    },
    async call(tool, args) {
      if (!ALLOWED_TOOLS.has(tool)) throw new Error('This call is not allowed.');
      const { rpc, email } = connect();
      const handler = createWorkItemHandlers(rpc)[tool];
      return handler({ ...(args && typeof args === 'object' ? args : {}), actor: email });
    },
  };
}
