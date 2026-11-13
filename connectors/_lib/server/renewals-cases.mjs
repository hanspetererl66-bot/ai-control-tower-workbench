/**
 * Storage of the Renewals autopilot and win-back cases (migration 050, schema renewals).
 * Three calls, always as the stored e-mail (the page never names the person). The checks here mirror the database,
 * so a bad request is refused before it leaves the app; the database checks again.
 */
import { ToolError } from './tools.mjs';

const CASE_ID = /^R-[A-Za-z0-9-]{1,40}$/;
export const CASE_KINDS = ['renewal', 'winback'];
export const CASE_STATUSES = ['running', 'waiting-person', 'waiting-customer', 'done', 'stopped', 'lost', 'closed'];
export const MAX_STATE_BYTES = 65_536;
export const MAX_LOG_LINES = 60;
export const MAX_LOG_TEXT = 600;
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function caseKey(caseId, kind) {
  if (typeof caseId !== 'string' || !CASE_ID.test(caseId)) throw new ToolError('invalid case id');
  if (!CASE_KINDS.includes(kind)) throw new ToolError('kind must be renewal or winback');
}

/** The visible cases and who the person is: { me: { email, owners, manager, admin }, cases: [...] }. */
export async function casesList(rpc, actor) {
  return rpc('renewals_cases_list', { p_actor: actor });
}

/** Saves one case. expectedRev is the revision the page last saw (0 for a new case). */
export async function caseSave(rpc, actor, args) {
  const a = isObject(args) ? args : {};
  caseKey(a.caseId, a.kind);
  const owner = typeof a.owner === 'string' ? a.owner.trim() : '';
  if (owner.length < 1 || owner.length > 80) throw new ToolError('the owner is needed (1 to 80 characters)');
  const state = a.state;
  if (!isObject(state)) throw new ToolError('the state must be an object');
  if (!CASE_STATUSES.includes(state.status)) throw new ToolError('invalid status');
  if (!Array.isArray(state.log) || state.log.length > MAX_LOG_LINES) throw new ToolError(`the log must be a list of at most ${MAX_LOG_LINES} lines`);
  for (const l of state.log) {
    if (!isObject(l) || !Number.isInteger(l.n) || l.n < 1 || l.n > 9999 || typeof l.actor !== 'string' || !l.actor || l.actor.length > 80
      || typeof l.text !== 'string' || l.text.length > MAX_LOG_TEXT) throw new ToolError('a log line is not valid');
  }
  if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_STATE_BYTES) throw new ToolError('the case is too large (at most 64 KB)');
  const rev = a.expectedRev === undefined || a.expectedRev === null ? 0 : a.expectedRev;
  if (!Number.isInteger(rev) || rev < 0) throw new ToolError('expectedRev must be 0 or a revision number');
  const customer = typeof a.customer === 'string' ? a.customer.slice(0, 120) : '';
  return rpc('renewals_case_save', { p_actor: actor, p_case: a.caseId, p_kind: a.kind, p_owner: owner, p_customer: customer, p_state: state, p_expected_rev: rev });
}

/** Archives the active case (the log stays). */
export async function caseReset(rpc, actor, args) {
  const a = isObject(args) ? args : {};
  caseKey(a.caseId, a.kind);
  return rpc('renewals_case_reset', { p_actor: actor, p_case: a.caseId, p_kind: a.kind });
}
