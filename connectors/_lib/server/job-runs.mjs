/**
 * Scheduler run log in the shared database (Supabase, migration 027): which job ran, when, for whom, and how it ended.
 * The agent may only READ it (`list_job_runs`, a tool of the connector). Writing is `recordJobRuns`, which is NOT a tool: only the
 * Werkbank's main process calls it after a run, so the agent cannot invent or change log entries (the table is append only anyway).
 * Same identity rule as the work items: the person is the e-mail label, and every permission is checked in the database function.
 */
import { ToolError } from './tools.mjs';
import { actorOf } from './skill-lifecycle.mjs';

export const RUN_STATUS = ['ok', 'error', 'skipped'];
export const RUN_TRIGGER = ['schedule', 'manual'];
export const TARGET_TYPES = ['agent', 'workflow', 'skill'];
export const MAX_BATCH = 50;
const SECRET = /(sb_secret_|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|(?:api[_-]?key|secret|password|passwort|token)\s*[:=]\s*['"]?[A-Za-z0-9_./+-]{8,})/i;

const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');

export const JOB_RUN_TOOL_DEFINITIONS = [
  {
    name: 'list_job_runs',
    description:
      'Read: the Scheduler run log, newest first. Each entry says who ran which job (agent, workflow or skill), when, how long it took, how it ended (ok, error, skipped), and whether the schedule or a person started it. Use it for questions like "Which jobs failed this week?", "Who ran the pre-close job?" or "How often did job X run?". Filter by days (look-back), job (part of the job or target name), status and trigger. Normal users see their own runs, members of the Governance board see everybody’s (set only_mine to limit that). Sample jobs of the app are not logged. Read only: it cannot start, change or delete anything.',
    inputSchema: obj({
      actor: { type: 'string', description: 'E-mail of the person acting (identity label, set once in the Werkbank). Never use someone else’s e-mail.' },
      days: { type: 'integer', minimum: 1, maximum: 365, description: 'Only runs of the last n days (default: all logged runs).' },
      job: { type: 'string', description: 'Only runs whose job name or target contains this text (case does not matter).' },
      status: { type: 'string', enum: RUN_STATUS, description: 'Only runs with this result.' },
      trigger: { type: 'string', enum: RUN_TRIGGER, description: 'schedule = started by the timer, manual = started by a person with "Run now".' },
      only_mine: { type: 'boolean', description: 'Board members only: list just my own runs.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Maximum number of entries, default 100.' },
    }, ['actor']),
  },
];

/** Turns the app’s log entries into what the database function expects; throws with the reason on anything malformed. */
export function checkRuns(runs) {
  if (!Array.isArray(runs) || !runs.length) throw new ToolError('runs must be a list with at least one entry');
  if (runs.length > MAX_BATCH) throw new ToolError(`at most ${MAX_BATCH} runs per call`);
  return runs.map((r, i) => {
    const at = `run ${i + 1}`;
    if (!r || typeof r !== 'object') throw new ToolError(`${at}: not an object`);
    const id = text(r.id, 80), jobId = text(r.jobId, 80);
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) throw new ToolError(`${at}: id may only use letters, digits, dot, dash and underscore`);
    if (!jobId) throw new ToolError(`${at}: jobId is missing`);
    if (!TARGET_TYPES.includes(r.targetType)) throw new ToolError(`${at}: targetType must be agent, workflow or skill`);
    if (!RUN_STATUS.includes(r.status)) throw new ToolError(`${at}: status must be ok, error or skipped`);
    const trigger = r.trigger === undefined ? 'schedule' : r.trigger;
    if (!RUN_TRIGGER.includes(trigger)) throw new ToolError(`${at}: trigger must be schedule or manual`);
    const when = new Date(r.at);
    if (Number.isNaN(when.getTime())) throw new ToolError(`${at}: at is not a date`);
    const ms = Number.isFinite(r.ms) ? Math.max(0, Math.min(2_000_000_000, Math.round(r.ms))) : 0;
    const note = text(r.note, 300);
    return {
      id, jobId, jobName: text(r.jobName, 120) || '(unnamed)', targetType: r.targetType, targetLabel: text(r.targetLabel, 120),
      at: when.toISOString(), ms, status: r.status, trigger, note: SECRET.test(note) ? '[note removed: it looked like it contained a credential]' : note,
    };
  });
}

export function createJobRunHandlers(rpc) {
  const call = async (fn, body) => {
    if (!rpc) throw new ToolError('The shared database is not set up: enter the Supabase URL and the secret key in the settings of this connector.');
    return rpc(fn, body);
  };
  return {
    async list_job_runs(args) {
      const days = args.days === undefined ? null : args.days;
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new ToolError('days must be a whole number from 1 to 365');
      const status = args.status === undefined ? null : args.status;
      if (status !== null && !RUN_STATUS.includes(status)) throw new ToolError('status must be ok, error or skipped');
      const trigger = args.trigger === undefined ? null : args.trigger;
      if (trigger !== null && !RUN_TRIGGER.includes(trigger)) throw new ToolError('trigger must be schedule or manual');
      const limit = args.limit === undefined ? 100 : args.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ToolError('limit must be a whole number from 1 to 500');
      if (args.job !== undefined && typeof args.job !== 'string') throw new ToolError('job must be text');
      if (args.only_mine !== undefined && typeof args.only_mine !== 'boolean') throw new ToolError('only_mine must be true or false');
      const rows = await call('job_runs_list', {
        p_actor: actorOf(args), p_since: days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString(),
        p_job: text(args.job, 120) || null, p_status: status, p_trigger: trigger, p_mine: args.only_mine === true, p_limit: limit,
      });
      const list = Array.isArray(rows) ? rows : [];
      const failed = list.filter((r) => r.status === 'error').length;
      return { count: list.length, failed, runs: list };
    },
  };
}

/** Main-process writer (not a tool): sends finished runs; sending one again is harmless. */
export async function recordJobRuns(rpc, actor, runs) {
  return rpc('job_runs_record', { p_actor: actor, p_runs: checkRuns(runs) });
}
