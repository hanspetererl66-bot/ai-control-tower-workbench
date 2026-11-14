/**
 * Writes the answer of a scheduler job to the destination the job names (email draft, file, Slack, Notion, Databricks).
 * The write is done here, after the run, with the saved settings of the job: the agent never decides where its answer goes.
 * Every destination except the file is a connector call. Email only ever becomes a draft, the person sends it.
 */
import { isFailedAnswer } from './schedule-delivery.ts';
import type { Job, JobOutput } from './jobs.ts';

type ToolResult = { isError?: boolean; content?: Array<{ text?: string }> } | unknown;

export type JobOutputDeps = {
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  /** Names of the installed connectors (extensions). */
  extensions: string[];
  /** Writes a text file below workspace/job-results/ and says where it landed. */
  writeFile: (request: { folder: string; fileName: string; content: string }) => Promise<{ ok: boolean; detail?: string; path?: string }>;
};

export type JobOutputResult = { status: 'ok' | 'error'; note: string };

const SLACK_MAX = 3500;
const NOTION_MAX_LINES = 100;
const DB_MAX = 20_000;

/** The installed connector for a service: an exact name first, then one that starts with it (for example gmail-drafts). */
export function connectorFor(service: 'gmail' | 'slack' | 'notion' | 'databricks', names: string[]): string {
  return names.find((n) => n.toLowerCase() === service) ?? names.find((n) => n.toLowerCase().startsWith(service) && !/bridge/i.test(n)) ?? '';
}

const toolFailed = (result: unknown): string => {
  const r = result as { isError?: boolean; content?: Array<{ text?: string }> } | null;
  return r?.isError ? (r.content?.map((c) => c.text).filter(Boolean).join(' ') || 'the tool refused the request').slice(0, 160) : '';
};

const stamp = (now: Date) => now.toISOString().slice(0, 16).replace('T', ' ');
export const resultTitle = (job: Pick<Job, 'name'>, now = new Date()) => `${job.name.replace(/\s+/g, ' ').trim() || 'Scheduled job'} (${now.toISOString().slice(0, 10)})`.slice(0, 150);

export function resultFileName(job: Pick<Job, 'name'>, format: 'md' | 'txt', now = new Date()): string {
  const slug = job.name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'job';
  return `${slug}-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${format}`;
}

const clipText = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Arguments for the connector tools, one function per destination, so the tests can check each one. */
export const emailArgs = (job: Job, to: string, answer: string, now: Date) => ({
  to, subject: `Result: ${resultTitle(job, now)}`.slice(0, 150),
  body: `${answer.trim().slice(0, 8000)}\n\nCreated by Werkbank (scheduled job "${job.name}"). This is a draft: check it and send it from Gmail.`,
});
export const slackArgs = (job: Job, channel: string, answer: string, now: Date) => ({
  channel, text: clipText(`*${resultTitle(job, now)}*\n${answer.trim()}`, SLACK_MAX),
});
export const notionArgs = (job: Job, o: Extract<JobOutput, { kind: 'notion' }>, answer: string, now: Date) => ({
  parent_id: o.parent, parent_type: o.parentType, title: resultTitle(job, now),
  content: answer.trim().split('\n').slice(0, NOTION_MAX_LINES).join('\n'),
});
export const databricksArgs = (job: Job, o: Extract<JobOutput, { kind: 'databricks' }>, answer: string, now: Date) => ({
  table: o.table, job_id: job.id, job_name: job.name, run_at: now.toISOString(), result: clipText(answer.trim(), DB_MAX),
});

/** Delivers the answer. Never throws; the note says in one line what happened and goes into the run history. */
export async function deliverJobResult(job: Job, answer: string, deps: JobOutputDeps, now = new Date()): Promise<JobOutputResult> {
  const o = job.output;
  if (!o || o.kind === 'chat') return { status: 'ok', note: 'Answer shown in the chat.' };
  if (isFailedAnswer(answer)) return { status: 'error', note: 'No answer, so nothing was written.' };
  const call = async (service: 'gmail' | 'slack' | 'notion' | 'databricks', tool: string, args: Record<string, unknown>): Promise<string> => {
    const ext = connectorFor(service, deps.extensions);
    if (!ext) return `the ${service[0].toUpperCase()}${service.slice(1)} connector is not connected`;
    try { return toolFailed(await deps.callTool(`${ext}__${tool}`, args)); } catch (e) { return (e instanceof Error ? e.message : String(e)).slice(0, 160); }
  };
  const fail = (what: string, why: string): JobOutputResult => ({ status: 'error', note: `Answer shown in the chat, but not written to ${what}: ${why}`.slice(0, 200) });
  switch (o.kind) {
    case 'file': {
      let r;
      try { r = await deps.writeFile({ folder: o.path, fileName: resultFileName(job, o.format, now), content: `${o.format === 'md' ? `# ${resultTitle(job, now)}\n\n_${stamp(now)}_\n\n` : ''}${answer.trim()}\n` }); } catch (e) { r = { ok: false, detail: e instanceof Error ? e.message : String(e) }; }
      return r.ok ? { status: 'ok', note: `Saved to job-results/${o.path ? `${o.path}/` : ''}${resultFileName(job, o.format, now)}` } : fail('a file', r.detail ?? 'not available in this window');
    }
    case 'email': { const f = await call('gmail', 'create_draft', emailArgs(job, o.to, answer, now)); return f ? fail('an email draft', f) : { status: 'ok', note: `Draft for ${o.to} created in Gmail (not sent).` }; }
    case 'slack': { const f = await call('slack', 'slack_post_message', slackArgs(job, o.channel, answer, now)); return f ? fail('Slack', f) : { status: 'ok', note: `Posted to Slack ${o.channel}.` }; }
    case 'notion': { const f = await call('notion', 'notion_create_page', notionArgs(job, o, answer, now)); return f ? fail('Notion', f) : { status: 'ok', note: `Page created in Notion (${o.parentType}).` }; }
    case 'databricks': { const f = await call('databricks', 'databricks_append_result', databricksArgs(job, o, answer, now)); return f ? fail('Databricks', f) : { status: 'ok', note: `Row added to ${o.table}.` }; }
  }
}
