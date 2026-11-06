/**
 * Recruiting in the shared database (Supabase, migration 028): the control tower numbers, the shortlist against the criteria a hiring
 * manager set, and Joule's proposals.
 *
 * What the agent may do: READ the pipeline and the shortlist (`recruiting_get_pipeline`, `recruiting_get_shortlist`,
 * `recruiting_list_proposals`) and WRITE a proposal (`recruiting_create_proposal`). A proposal changes nothing for the candidate.
 * What the agent may NOT do: decide. `decideProposal` is not a tool; only the Werkbank's main process calls it after the hiring manager
 * clicks Release or Decline, and the database accepts it only from the manager of that requisition. There is no tool that rejects a
 * candidate or changes a status in the recruiting system (no connector to SmartRecruiters exists yet).
 *
 * The numbers and the shortlist come from `recruiting-logic.mjs`, the same code the Space page runs, so Joule and the Space cannot differ.
 * A proposal is not free text from the agent: the tool only accepts a proposal the criteria support (same list the shortlist shows),
 * and the wording comes from the code, so the agent cannot propose something for a candidate who does not meet the criteria.
 */
import { ToolError } from './tools.mjs';
import { actorOf } from './skill-lifecycle.mjs';
import { makeLogic } from './recruiting-logic.mjs';

export const PROPOSAL_KINDS = ['move', 'remind', 'ask'];
export const PROPOSAL_STATUS = ['proposed', 'released', 'declined'];
export const DECISIONS = ['released', 'declined'];
export const GROUP_LABEL = { A: 'Meets all must-haves', B: 'Needs a human look', C: 'Does not meet the criteria as written' };
export const ORDER_RULE = 'Order inside a group: (1) must-haves met, (2) must-haves partly met, (3) nice-to-haves met, (4) earlier application first. Nothing else is used.';
export const REMOVED_BEFORE_READING = ['name', 'photo', 'date of birth', 'gender', 'address', 'nationality', 'gaps in the CV'];

const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const ACTOR = { type: 'string', description: 'E-mail of the person acting (identity label, set once in the Werkbank). Never use someone else’s e-mail.' };
const REQ = { type: 'string', description: 'Requisition id, for example REQ-2204.' };

export const RECRUITING_TOOL_DEFINITIONS = [
  {
    name: 'recruiting_get_pipeline',
    description:
      'Read: the hiring control tower. Per open requisition: days open against the target, status (late, offer out, watch, on track) and why, how many candidates have waited longer than the target for their stage, plus the funnel per stage, the candidates waiting longest, and the offer acceptance of closed requisitions. Aggregated numbers on pseudonymous candidates (C-4101, no names). Normal users see the requisitions they manage, the Governance board sees all. Read only.',
    inputSchema: obj({ actor: ACTOR }, ['actor']),
  },
  {
    name: 'recruiting_get_shortlist',
    description:
      'Read: the shortlist of one requisition against the criteria its hiring manager set. Each candidate (pseudonym only) gets a group (meets all must-haves, needs a human look, does not meet the criteria as written) and, per criterion, met, partly or missing with the CV line as proof. The order uses only the stated rule. Personal fields never reach the model. Also returns the proposals the criteria support. It does not reject anybody: a person decides. Read only.',
    inputSchema: obj({ actor: ACTOR, requisition: REQ }, ['actor', 'requisition']),
  },
  {
    name: 'recruiting_list_proposals',
    description:
      'Read: Joule’s proposals (move a candidate on, remind the hiring manager, ask the hiring manager) with their status (proposed, released, declined), who decided and when. Read only.',
    inputSchema: obj({
      actor: ACTOR,
      status: { type: 'string', enum: PROPOSAL_STATUS, description: 'Default: proposed (waiting for the hiring manager).' },
      requisition: REQ,
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum number of entries, default 50.' },
    }, ['actor']),
  },
  {
    name: 'recruiting_create_proposal',
    description:
      'Write a PROPOSAL for the hiring manager: move a candidate to the next stage, remind the hiring manager about a waiting candidate, or ask them about an open criterion. It changes nothing for the candidate and does not contact anyone: the proposal waits until the hiring manager of the requisition releases or declines it. Only proposals that recruiting_get_shortlist lists as supported are accepted, and the wording comes from the system, not from you. There is no tool to reject a candidate. Asking twice for the same candidate and kind returns the open proposal.',
    inputSchema: obj({
      actor: ACTOR, requisition: REQ,
      candidate: { type: 'string', description: 'Candidate pseudonym, for example C-4102.' },
      kind: { type: 'string', enum: PROPOSAL_KINDS, description: 'move = next stage, remind = nudge the hiring manager, ask = ask about an open criterion.' },
    }, ['actor', 'requisition', 'candidate', 'kind']),
  },
];

const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const REQ_ID = /^[A-Za-z0-9._-]{1,40}$/;
const CAND_ID = /^C-[0-9]{3,8}$/;

const requisitionId = (args) => {
  const v = text(args.requisition, 40);
  if (!REQ_ID.test(v)) throw new ToolError('requisition must be an id such as REQ-2204');
  return v;
};

/** What a person reads next to a result: the line of the CV, or what is missing. */
export function evidenceOf(r, cand) {
  if (r.status === 'missing') return r.crit.kind === 'years' ? `CV states ${cand.years} ${cand.years === 1 ? 'year' : 'years'}, needs ${r.crit.min}` : 'not found in the CV text';
  return `line ${r.line}: ${r.text}`;
}

const candidateView = (e, L) => ({
  rank: e.rank, candidate: e.cand.id, stage: e.cand.stage, daysInStage: L.daysIn(e.cand), pastTargetByDays: Math.max(0, L.over(e.cand)),
  group: e.group, groupLabel: GROUP_LABEL[e.group],
  mustMet: e.mustMet, mustPartly: e.mustPartly, mustMissing: e.mustMissing, mustTotal: e.mustN, niceMet: e.niceMet, niceTotal: e.niceN,
  criteria: e.res.map((r) => ({ id: r.crit.id, must: r.crit.must, text: r.crit.text, status: r.status, line: r.line || null, evidence: evidenceOf(r, e.cand) })),
});

export function createRecruitingHandlers(rpc) {
  const call = async (fn, body) => {
    if (!rpc) throw new ToolError('The shared database is not set up: enter the Supabase URL and the secret key in the settings of this connector.');
    return rpc(fn, body);
  };
  const snapshot = async (args, withCv) => {
    const D = await call('recruiting_snapshot', { p_actor: actorOf(args), p_with_cv: withCv, p_as_of: null });
    if (!D || !Array.isArray(D.jobs)) throw new ToolError('The database returned no recruiting data. Is migration 028 applied?');
    return { D, L: makeLogic(D) };
  };

  return {
    async recruiting_get_pipeline(args) {
      const { D, L } = await snapshot(args, false);
      const status = D.jobs.map(L.jobStatus);
      const waiting = L.stalledList();
      const acc = L.acceptance('all');
      return {
        asOf: D.asOf,
        rule: 'Status: an offer is out; past the target; 70% of the target used (watch); otherwise on track. A rule of thumb, not a forecast model.',
        requisitions: status.map((s) => ({
          id: s.job.id, title: s.job.title, dept: s.job.dept, daysOpen: s.elapsed, targetDays: s.job.target, status: s.status,
          candidates: s.count, waitingPastTarget: s.waiting, driver: s.driver, departmentMedianDaysToFill: L.baseline(s.job.dept).median,
        })),
        candidatesPastTarget: waiting.length, candidatesInProcess: D.candidates.length,
        longestWaiting: waiting.slice(0, 10).map((c) => ({ candidate: c.id, requisition: c.job, stage: c.stage, daysInStage: L.daysIn(c), pastTargetByDays: L.over(c) })),
        funnel: L.funnel(),
        offerAcceptance: { offers: acc.offers, accepted: acc.accepted, rate: acc.rate },
      };
    },

    async recruiting_get_shortlist(args) {
      const id = requisitionId(args);
      const { D, L } = await snapshot(args, true);
      const job = D.jobs.find((j) => j.id === id);
      if (!job) throw new ToolError('unknown requisition, not open, or no access');
      const criteria = D.criteria[id];
      if (!criteria || !criteria.length) throw new ToolError(`${id} has no criteria yet. The hiring manager has to set them first.`);
      if (!L.hasCriteria(id)) throw new ToolError(`${id}: some candidates have no CV text stored, so a comparison would be incomplete.`);
      const list = L.shortlist(id);
      return {
        asOf: D.asOf,
        requisition: { id: job.id, title: job.title, dept: job.dept, location: job.location, hiringManager: job.manager },
        criteria: criteria.map((c) => ({ id: c.id, must: c.must, text: c.text })),
        orderRule: ORDER_RULE,
        removedBeforeReading: REMOVED_BEFORE_READING,
        note: 'Joule shows which stated criteria are met, with the CV line as proof. It does not reject anybody and does not score people. A person decides.',
        candidates: list.map((e) => candidateView(e, L)),
        supportedProposals: L.proposals().filter((p) => p.job === id).map((p) => ({ candidate: p.cand, kind: p.type, text: p.text, basis: p.basis })),
      };
    },

    async recruiting_list_proposals(args) {
      const status = args.status === undefined ? 'proposed' : args.status;
      if (!PROPOSAL_STATUS.includes(status)) throw new ToolError('status must be proposed, released or declined');
      const limit = args.limit === undefined ? 50 : args.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ToolError('limit must be a whole number from 1 to 200');
      const requisition = args.requisition === undefined ? null : requisitionId(args);
      const rows = await call('recruiting_proposals_list', { p_actor: actorOf(args), p_status: status, p_requisition: requisition, p_limit: limit });
      const list = Array.isArray(rows) ? rows : [];
      return { count: list.length, proposals: list };
    },

    async recruiting_create_proposal(args) {
      const id = requisitionId(args);
      const candidate = text(args.candidate, 20);
      if (!CAND_ID.test(candidate)) throw new ToolError('candidate must be a pseudonym such as C-4102');
      if (!PROPOSAL_KINDS.includes(args.kind)) throw new ToolError('kind must be move, remind or ask');
      const { D, L } = await snapshot(args, true);
      if (!D.jobs.some((j) => j.id === id)) throw new ToolError('unknown requisition, not open, or no access');
      if (!L.hasCriteria(id)) throw new ToolError(`${id} has no complete criteria and CV text, so nothing can be proposed.`);
      const cand = L.shortlist(id).find((e) => e.cand.id === candidate);
      if (!cand) throw new ToolError(`${candidate} is not a candidate of ${id}`);
      const wanted = L.proposals().find((p) => p.job === id && p.cand === candidate && p.type === args.kind);
      if (!wanted) {
        throw new ToolError(cand.group === 'C'
          ? `${candidate} does not meet the criteria as written. Joule proposes nothing for such a candidate; a person decides.`
          : `No "${args.kind}" proposal is supported for ${candidate} right now (see supportedProposals in recruiting_get_shortlist).`);
      }
      const out = await call('recruiting_proposal_create', {
        p_actor: actorOf(args), p_requisition: id, p_candidate: candidate, p_kind: wanted.type, p_tool: wanted.tool, p_body: wanted.text, p_basis: wanted.basis,
      });
      return { ...out, candidate, kind: wanted.type, text: wanted.text, message: 'Waiting for the hiring manager. Nothing has been changed for the candidate and nobody has been contacted.' };
    },
  };
}

/**
 * Main-process writer (NOT a tool): the hiring manager's decision after a click on Release or Decline. The database refuses anyone
 * but the manager of the requisition, and a decided proposal cannot change. Releasing does not run anything in a recruiting system yet.
 */
export async function decideProposal(rpc, actor, id, decision, note = '') {
  if (!Number.isInteger(id) || id < 1) throw new ToolError('id must be a proposal number');
  if (!DECISIONS.includes(decision)) throw new ToolError('decision must be released or declined');
  const who = actorOf({ actor });
  return rpc('recruiting_proposal_decide', { p_actor: who, p_id: id, p_decision: decision, p_note: text(note, 300) });
}
