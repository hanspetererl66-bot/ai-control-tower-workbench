/**
 * Online interview records (Supabase, migration 035).
 * The Werkbank's main process saves a record after an interview (`saveInterviewRecord`, NOT a tool: the agent cannot write one).
 * The agent may READ the records of the requisitions the person manages (`recruiting_interview_records`), for example to answer
 * "what did the interviews for REQ-2203 show?". A record holds answers, the task text, the result per criterion, counts and a summary:
 * no name, no e-mail address, no score. A person decides about every application.
 */
import { ToolError } from './tools.mjs';
import { actorOf } from './skill-lifecycle.mjs';

export const INTERVIEW_TOOL_DEFINITIONS = [
  {
    name: 'recruiting_interview_records',
    description: 'Read: saved online interview records of the requisitions the person manages: session code, whether an AI or the text-search stand-in checked the task, the result per criterion (correct, partly correct, wrong, not present, each with a quote), the counts, the answers and a short summary. There is no score and no ranking; the hiring manager decides.',
    inputSchema: {
      type: 'object',
      properties: {
        actor: { type: 'string', description: 'E-mail of the person acting (identity label, set once in the Werkbank).' },
        requisition: { type: 'string', description: 'Optional requisition id, for example REQ-2203.' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      required: ['actor'],
      additionalProperties: false,
    },
  },
];

const MAIL = /[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}/;

export function createInterviewHandlers(rpc) {
  const call = async (fn, body) => {
    if (!rpc) throw new ToolError('The shared database is not set up: enter the Supabase URL and the secret key in the settings of this connector.');
    return rpc(fn, body);
  };
  return {
    async recruiting_interview_records(args) {
      const rows = await call('recruiting_interview_records', { p_actor: actorOf(args), p_requisition: args?.requisition ?? null, p_limit: args?.limit ?? 50 });
      return { records: Array.isArray(rows) ? rows : [], note: 'No score, no ranking. The hiring manager reads the answers and decides.' };
    },
  };
}

/** Called by the main process after the interview. Checks the shape; the database checks the manager and refuses an e-mail address. */
export async function saveInterviewRecord(rpc, actor, requisition, record) {
  if (!record || typeof record !== 'object') throw new ToolError('no record');
  const session = String(record.session ?? '');
  if (!/^[A-Z0-9-]{4,24}$/.test(session)) throw new ToolError('the session code is not valid');
  if (!['ai', 'mock'].includes(record.mode)) throw new ToolError('the mode must be ai or mock');
  if (!Array.isArray(record.result) || !Array.isArray(record.answers)) throw new ToolError('the record is incomplete');
  const text = JSON.stringify(record);
  if (text.length > 40000) throw new ToolError('the record is too long');
  if (MAIL.test(text)) throw new ToolError('a record holds no e-mail address');
  return rpc('recruiting_interview_save', {
    p_actor: actor, p_requisition: String(requisition ?? ''), p_session: session, p_mode: record.mode,
    p_mode_note: String(record.modeNote ?? '').slice(0, 200), p_payload: record, p_summary: String(record.summary ?? '').slice(0, 1500),
  });
}

const LEVEL_KEYS = ['content', 'collab', 'rhetoric', 'creativity'];
/**
 * Called by the main process: keeps one revision of the rubric assessment of an application interview (migration 041).
 * NOT a tool. `record.levels` has four rows (key, status, ai, human, question, quote, reason, note, reviewedBy); `final` is true once the
 * hiring manager confirmed them. The shape is checked here and again by the database.
 */
export async function saveAssessment(rpc, actor, requisition, record) {
  if (!record || typeof record !== 'object') throw new ToolError('no assessment');
  const session = String(record.session ?? '');
  if (!/^[A-Z0-9-]{4,24}$/.test(session)) throw new ToolError('the session code is not valid');
  if (!/^[a-z0-9-]{2,40}$/.test(String(record.profile ?? ''))) throw new ToolError('the profile is not valid');
  if (!['ai', 'fallback'].includes(record.mode)) throw new ToolError('the mode must be ai or fallback');
  const levels = record.levels;
  if (!Array.isArray(levels) || levels.length !== 4 || !LEVEL_KEYS.every((k) => levels.some((l) => l?.key === k))) throw new ToolError('the four levels are incomplete');
  const whole = (n) => n === null || n === undefined || (Number.isInteger(n) && n >= 1 && n <= 5);
  if (!levels.every((l) => whole(l.ai) && whole(l.human))) throw new ToolError('a level must be a whole number from 1 to 5');
  const text = JSON.stringify(record);
  if (text.length > 40000) throw new ToolError('the assessment is too long');
  if (MAIL.test(text)) throw new ToolError('an assessment holds no e-mail address');
  const overall = typeof record.overall === 'number' && record.overall >= 1 && record.overall <= 5 ? Math.round(record.overall * 10) / 10 : null;
  const clean = { ...record, levels: levels.map((l) => ({ ...l, ai: l.ai ?? null, human: l.human ?? null })) };
  return rpc('recruiting_assessment_save', {
    p_actor: actor, p_requisition: String(requisition ?? ''), p_session: session, p_profile: record.profile, p_rubric: String(record.rubric ?? '').slice(0, 20),
    p_mode: record.mode, p_mode_note: String(record.modeNote ?? '').slice(0, 200), p_levels: clean.levels, p_payload: clean,
    p_final: record.final === true, p_overall: overall,
  });
}

/** Called by the main process for the Space: the saved assessment revisions of a requisition the person manages. */
export async function listAssessments(rpc, actor, requisition) {
  const rows = await rpc('recruiting_assessments', { p_actor: actor, p_requisition: requisition ? String(requisition) : null, p_limit: 100 });
  return Array.isArray(rows) ? rows : [];
}
