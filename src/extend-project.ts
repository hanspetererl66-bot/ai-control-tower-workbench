/**
 * An extension from the Sources tile changes the existing agent or workflow instead of starting a second project.
 * The change goes through the normal paths (setAnswers / changeIntent), so approvals fall back as they always do when an earlier
 * step changes, and the next sync saves it as a NEW REVISION of the same work item. Pure.
 * Only projects that sit on this computer and are linked to the work item can be changed; for the rest the caller starts a new project, as before.
 */
import { setAnswers, type AgentProject } from './agent-project.ts';
import { changeIntent, type Project } from './develop.ts';
import { requirementLines, type Handover, type SourceRef } from './requirements.ts';
import type { SyncMap } from './work-sync.ts';

/** The local project id behind a work item id, from the sync map ("a:<id>" agents, "d:<id>" workflows). */
export function localProjectOf(map: SyncMap, itemId: string, kind: 'agent' | 'workflow'): string | undefined {
  const prefix = kind === 'agent' ? 'a:' : 'd:';
  for (const [key, entry] of Object.entries(map)) if (key.startsWith(prefix) && entry.itemId === itemId) return key.slice(prefix.length);
  return undefined;
}

const mergeRefs = (have: SourceRef[] = [], more: SourceRef[] = []): SourceRef[] => {
  const seen = new Set(have.map((r) => `${r.source}:${r.key}`));
  return [...have, ...more.filter((r) => !seen.has(`${r.source}:${r.key}`))];
};

const MARK = 'Extension: ';

/** Adds the extension to the objective of an agent (400 characters), keeping the original first. Idempotent for the same text. */
export function extendAgent(p: AgentProject, h: Handover, now = Date.now()): AgentProject {
  const addition = `${MARK}${h.goal.replace(/^Extend "[^"]*": /, '')}`.replace(/\s+/g, ' ').trim();
  const cur = p.answers.objective;
  const objective = cur.includes(addition) ? cur : `${cur}\n${addition}`.slice(0, 400);
  const out = setAnswers(p, { objective }, now);
  return { ...out, sources: mergeRefs(p.sources, h.refs) };
}

/** Adds the extension and its requirement lines to the goal of a workflow project (1500 characters). */
export function extendWorkflow(p: Project, h: Handover, now = Date.now()): Project {
  const lines = requirementLines(h);
  const addition = `${MARK}${h.goal.replace(/^Extend "[^"]*": /, '')}${lines ? `\n${lines}` : ''}`.trim();
  const cur = p.intent.goal;
  const goal = cur.includes(addition) ? cur : `${cur}\n\n${addition}`.slice(0, 1500);
  const out = changeIntent(p, { goal }, now);
  return { ...out, sources: mergeRefs(p.sources, h.refs) };
}
