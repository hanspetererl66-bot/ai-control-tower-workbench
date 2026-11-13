/**
 * Shadow protocol of the Orchestrator: the decisions of the agent and a person's verdict on each (migration 049).
 * Called only by the Werkbank's main process after a click, as the stored e-mail. Not an agent tool: the agent cannot write or judge.
 * The checks here repeat what the database enforces, so a bad request fails before it is sent.
 */
import { ToolError } from './tools.mjs';
import { actorOf } from './skill-lifecycle.mjs';

export const SHADOW_KINDS = ['cert-expiry', 'patch-age', 'disk-trend', 'dns-stale'];
export const SHADOW_TEMPLATES = ['renew-certificate', 'patch-vm', 'move-vm', 'update-dns-record'];
export const SHADOW_ENVS = ['PRD', 'QAS', 'DEV'];
export const SHADOW_REASONS = ['floor-missed', 'over-cautious', 'wrong-window', 'wrong-customer-rule', 'wrong-plan', 'other'];
const ID = /^[A-Za-z0-9._:-]{1,40}$/;
const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const count = (v) => (Number.isInteger(v) && v >= 0 && v <= 100000 ? v : 0);

function cleanDecision(d) {
  if (!d || typeof d !== 'object') throw new ToolError('a decision must be an object');
  const bad = (what) => { throw new ToolError(`decision ${text(d.findingId, 40) || '?'}: ${what}`); };
  if (!ID.test(String(d.findingId ?? ''))) bad('the finding id is not valid');
  if (!HOST.test(String(d.host ?? ''))) bad('the host is not valid');
  if (!SHADOW_KINDS.includes(d.kind)) bad('unknown kind');
  if (!SHADOW_TEMPLATES.includes(d.template)) bad('unknown task');
  if (!SHADOW_ENVS.includes(d.env)) bad('unknown environment');
  if (!['auto', 'approval'].includes(d.mode)) bad('the mode must be auto or approval');
  if (!Number.isInteger(d.deadlineDays) || d.deadlineDays < 1 || d.deadlineDays > 365) bad('the deadline must be 1 to 365 days');
  const customer = typeof d.customer === 'string' && /^[a-z0-9]{0,12}$/.test(d.customer) ? d.customer : '';
  const time = (v) => (typeof v === 'string' && TIME.test(v) ? v : '');
  return { findingId: d.findingId, host: d.host, kind: d.kind, template: d.template, env: d.env, customer, deadlineDays: d.deadlineDays, mode: d.mode, customerNeeded: d.customerNeeded === true,
    floors: (Array.isArray(d.floors) ? d.floors : []).slice(0, 5).map((f) => text(f, 20)).filter(Boolean), windowStart: time(d.windowStart), windowEnd: time(d.windowEnd), why: text(d.why, 300) };
}

/** One run with all its decisions. Returns { runId, decisions: { findingId: decisionId } }. */
export async function shadowStart(rpc, actor, run, decisions) {
  if (!run || typeof run !== 'object') throw new ToolError('the run must be an object');
  if (!Array.isArray(decisions) || decisions.length === 0 || decisions.length > 100) throw new ToolError('a run has 1 to 100 decisions');
  const adapter = text(run.adapter, 30), fetchedAt = typeof run.fetchedAt === 'string' && TIME.test(run.fetchedAt) ? run.fetchedAt : '';
  if (!adapter || !fetchedAt) throw new ToolError('the run needs an adapter and the fetch time');
  const clean = decisions.map(cleanDecision);
  if (new Set(clean.map((d) => d.findingId)).size !== clean.length) throw new ToolError('each finding appears once in a run');
  return rpc('autonomy_shadow_start', { p_actor: actorOf({ actor }), p_run: { adapter, fetchedAt, alerts: count(run.alerts), findings: clean.length, skipped: count(run.skipped), withheld: count(run.withheld) }, p_decisions: clean });
}

/** A person's verdict on one decision: agree, or disagree with a reason. */
export async function shadowVerdict(rpc, actor, decisionId, verdict, reason, note = '') {
  if (!Number.isInteger(decisionId) || decisionId < 1) throw new ToolError('unknown decision');
  if (!['agree', 'disagree'].includes(verdict)) throw new ToolError('the verdict must be agree or disagree');
  if (verdict === 'agree' && reason) throw new ToolError('an agreement has no reason');
  if (verdict === 'disagree' && !SHADOW_REASONS.includes(reason)) throw new ToolError('a disagreement needs a known reason');
  return rpc('autonomy_shadow_verdict', { p_actor: actorOf({ actor }), p_decision: decisionId, p_verdict: verdict, p_reason: verdict === 'agree' ? null : reason, p_note: text(note, 300) });
}

export async function shadowSummary(rpc, actor) {
  return rpc('autonomy_shadow_summary', { p_actor: actorOf({ actor }) });
}
