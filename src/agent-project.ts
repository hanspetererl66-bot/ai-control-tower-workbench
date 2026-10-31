/**
 * Intent-based agent development. The person says what the agent should achieve, answers a short set of questions,
 * and the app drafts the documents one after the other: Product Requirements (PRD), Technical Functional Document (TFD),
 * Solution Architecture, and a Risk and Test Plan. Every document is editable and must be confirmed before the next
 * one is created. Only when all four are confirmed is the agent built, as a draft in the Agent Studio.
 * The documents are written from the answers by fixed rules, so the result is the same every time and nothing leaves this computer.
 */
import { OUTPUTS, newAgent, type Output, type Source, type StudioAgent, type TriggerType } from './agent-studio.ts';

export type DocKey = 'prd' | 'tfd' | 'arch' | 'risk';
export const DOC_ORDER: DocKey[] = ['prd', 'tfd', 'arch', 'risk'];
export const DOC_TITLE: Record<DocKey, string> = {
  prd: 'Product Requirements (PRD)',
  tfd: 'Technical Functional Document (TFD)',
  arch: 'Solution Architecture',
  risk: 'Risk, Compliance and Test Plan',
};
export const DOC_SHORT: Record<DocKey, string> = { prd: 'PRD', tfd: 'TFD', arch: 'Architecture', risk: 'Risk & test' };
export type Stage = 'questions' | DocKey | 'build' | 'done';
export const STAGE_ORDER: Stage[] = ['questions', 'prd', 'tfd', 'arch', 'risk', 'build'];

export type Sensitivity = 'public' | 'internal' | 'confidential' | 'personal';
export const SENSITIVITY: Array<{ id: Sensitivity; label: string }> = [
  { id: 'public', label: 'Public' }, { id: 'internal', label: 'Internal' }, { id: 'confidential', label: 'Confidential' }, { id: 'personal', label: 'Contains personal data' },
];
export type Volume = 'small' | 'medium' | 'large';
export const VOLUME: Array<{ id: Volume; label: string; steps: number }> = [
  { id: 'small', label: 'Small (a few items per run)', steps: 8 }, { id: 'medium', label: 'Medium (dozens of items)', steps: 12 }, { id: 'large', label: 'Large (hundreds of items)', steps: 20 },
];
export type Answers = {
  name: string; objective: string; success: string; users: string;
  sources: string[]; otherSystems: string; sensitivity: Sensitivity;
  trigger: TriggerType; time: string; output: Output; rights: 'read' | 'propose';
  dependencies: string; onMissing: 'stop' | 'continue'; volume: Volume; owner: string;
};
export type AgentProject = {
  id: string; answers: Answers; docs: Partial<Record<DocKey, string>>;
  /** When each step was confirmed (ms). */
  confirmed: Partial<Record<'questions' | DocKey, number>>;
  /** Documents that were written before an earlier document changed: they have to be reviewed again. */
  stale: DocKey[];
  agentId?: string; createdAt: number; updatedAt: number;
};

export const PROJECTS_KEY = 'werkbank.agentProjects';
export const MAX_PROJECTS = 20;
const MAX_DOC = 20000;
const clean = (t: unknown, n: number) => String(t ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function titleFromGoal(goal: string): string {
  const words = clean(goal, 400).replace(/[.!?:;,]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 50) || 'New agent';
}

export function newProject(intent: string, now = Date.now()): AgentProject {
  const goal = clean(intent, 400);
  return {
    id: `p-${now.toString(36)}`, docs: {}, confirmed: {}, stale: [], createdAt: now, updatedAt: now,
    answers: {
      name: titleFromGoal(goal), objective: goal, success: '', users: '', sources: [], otherSystems: '', sensitivity: 'internal',
      trigger: 'manual', time: '08:00', output: 'summary', rights: 'read', dependencies: '', onMissing: 'stop', volume: 'small', owner: '',
    },
  };
}

/** What still has to be answered before the documents can be written; empty when complete. */
export function questionProblems(a: Answers): string[] {
  const p: string[] = [];
  if (a.name.trim().length < 3) p.push('Give the agent a name.');
  if (a.objective.trim().length < 10) p.push('Describe the objective in at least one sentence.');
  if (a.success.trim().length < 5) p.push('Say how you will know that the agent works (success measure).');
  if (a.users.trim().length < 3) p.push('Say who uses the result.');
  if (!a.sources.length && !a.otherSystems.trim()) p.push('Name at least one data source.');
  if (a.trigger !== 'manual' && !TIME.test(a.time)) p.push('Give the time of day as HH:MM.');
  return p;
}

/** The step the person is at: the first one that is not confirmed yet. */
export function currentStage(p: AgentProject): Stage {
  if (!p.confirmed.questions) return 'questions';
  for (const k of DOC_ORDER) if (!p.confirmed[k]) return k;
  return p.agentId ? 'done' : 'build';
}
export const stageLabel = (s: Stage) => (s === 'questions' ? 'Goal and questions' : s === 'build' ? 'Build the agent' : s === 'done' ? 'Built' : DOC_SHORT[s]);

/* ---------- wording helpers ---------- */
const triggerText = (a: Answers) => (a.trigger === 'manual' ? 'on demand, when a person starts it' : a.trigger === 'daily' ? `every day at ${a.time}` : `every Monday at ${a.time}`);
const outputLabel = (o: Output) => OUTPUTS.find((x) => x.id === o)?.label ?? 'Summary';
const volume = (a: Answers) => VOLUME.find((v) => v.id === a.volume) ?? VOLUME[0];
const sensitivityLabel = (a: Answers) => SENSITIVITY.find((s) => s.id === a.sensitivity)?.label ?? 'Internal';
const day = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'not yet confirmed');
function sourceRows(a: Answers, catalog: Source[]): Array<{ label: string; kind: string }> {
  const rows: Array<{ label: string; kind: string }> = a.sources.map((id) => catalog.find((s) => s.id === id)).filter((s): s is Source => !!s).map((s) => ({ label: s.label, kind: s.kind }));
  if (a.otherSystems.trim()) rows.push({ label: clean(a.otherSystems, 200), kind: 'other (not connected yet)' });
  return rows;
}
const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- none');
const missingText = (a: Answers) => (a.onMissing === 'stop' ? 'stop and tell the person which source is missing' : 'continue with what is available and say clearly what is missing');

/* ---------- document writers ---------- */
export function buildPrd(p: AgentProject, catalog: Source[]): string {
  const a = p.answers, src = sourceRows(a, catalog), v = volume(a);
  const open: string[] = [];
  if (!a.dependencies.trim()) open.push('Confirm that the agent has no dependencies on other agents, systems or people.');
  if (a.sensitivity === 'personal') open.push('The data contains personal data: confirm the purpose and the legal basis with data protection.');
  if (a.rights === 'propose') open.push('Define who approves the changes the agent proposes.');
  if (src.some((s) => s.kind.startsWith('other'))) open.push('One source is not connected yet: decide how the agent gets this data (connector, file or Space).');
  if (!a.owner.trim()) open.push('Name the owner of the agent.');
  return `# Product Requirements Document: ${a.name}

Status: draft · Owner: ${a.owner.trim() || 'to be named'} · Created: ${day(p.createdAt)}

## 1. Objective
${a.objective.trim()}

## 2. Users and use of the result
${a.users.trim()}

## 3. Success measures
${a.success.trim()}

The agent is accepted when it meets this measure in the sandbox test on sample data.

## 4. Scope
**In scope**
- Reads: ${src.map((s) => s.label).join(', ') || 'no source named'}
- Produces: ${outputLabel(a.output).toLowerCase()} for ${a.users.trim()}
- Runs: ${triggerText(a)}

**Out of scope**
- Changing data in a source system without a person's approval
- Taking decisions on behalf of people
- Reading anything that is not listed as a source

## 5. Requirements
| ID | Requirement | Priority |
|---|---|---|
| R1 | The agent reads only the listed sources. | Must |
| R2 | The agent produces: ${outputLabel(a.output).toLowerCase()}. | Must |
| R3 | The agent runs ${triggerText(a)}. | Must |
| R4 | If a source is missing or fails, the agent will ${missingText(a)}. | Must |
| R5 | ${a.rights === 'read' ? 'The agent is read only.' : 'The agent may propose changes and asks before every write.'} | Must |
| R6 | Every figure in the result names its source. | Must |
| R7 | One run stays within ${v.steps} steps (${v.label.toLowerCase()}). | Should |

## 6. Data and sensitivity
Classification: **${sensitivityLabel(a)}**

| Source | Type |
|---|---|
${src.map((s) => `| ${s.label} | ${s.kind} |`).join('\n') || '| none | |'}

## 7. Dependencies
${a.dependencies.trim() || 'None named.'}

## 8. Assumptions and open questions
- The sources contain the data the success measure needs.
${list(open)}

## 9. Approval
| Role | Name | Date |
|---|---|---|
| Owner | ${a.owner.trim() || ''} | |
| Reviewer | | |
`;
}

export function buildTfd(p: AgentProject, catalog: Source[]): string {
  const a = p.answers, src = sourceRows(a, catalog);
  const outputSpec: Record<Output, string> = {
    summary: 'A short text: the result first, then the reason, then the decision needed. Every figure names its source.',
    table: 'A table with one row per item and a traffic light (red, yellow, green) with the reason, sorted by urgency.',
    'draft-mail': 'A draft e-mail with recipient, subject and body. It is shown, never sent.',
    ticket: 'A ticket draft with title, description and priority. It is shown, never created.',
  };
  const read = (kind: string) => (kind === 'connector' ? 'Read tools of the connector' : kind === 'space' ? 'The data shown on the Space page' : kind === 'file' ? 'Files attached to the message' : kind === 'web' ? 'Public web pages' : 'To be defined');
  return `# Technical Functional Document: ${p.answers.name}

Based on the PRD confirmed on ${day(p.confirmed.prd)}.

## 1. Functional flow
1. **Trigger.** ${triggerText(a)}.
2. **Read.** The agent reads ${src.map((s) => s.label).join(', ') || 'its sources'}. Nothing else is readable for it.
3. **Analyse.** It applies the objective: "${a.objective.trim()}"
4. **Produce.** ${outputLabel(a.output)}. ${outputSpec[a.output]}
5. **Deliver.** The result appears in the chat. Nothing is sent or changed automatically.
6. **Record.** The run, the sources used and every refused attempt are visible in the registry and the audit trail.

## 2. Inputs and outputs
| Source | Type | What is read | Access |
|---|---|---|---|
${src.map((s) => `| ${s.label} | ${s.kind} | ${read(s.kind)} | read only |`).join('\n') || '| none | | | |'}

Output: ${outputLabel(a.output)}. ${outputSpec[a.output]}

## 3. Business rules
- Success measure: ${a.success.trim()}
- Every figure names its source.
- If data is missing, the agent will ${missingText(a)}.
${a.dependencies.trim() ? `- Dependencies: ${a.dependencies.trim()}\n` : ''}
## 4. Permissions and rights
| Action | Allowed |
|---|---|
| Read the listed sources | Yes |
| Read anything else | No, refused and shown |
| Change data in a source | ${a.rights === 'propose' ? 'Only as a proposal; the person approves every write' : 'No'} |
| Send e-mail or create tickets | No, only drafts |

## 5. Schedule
${triggerText(a)}. A scheduled agent runs only while the app is open; a run missed while it was closed is made up for up to six hours.

## 6. Error handling
| Situation | Behaviour |
|---|---|
| A source is unavailable | The agent will ${missingText(a)}. |
| A source is not on the list | Refused, listed as blocked. |
| Nothing found | The result says so; it does not invent items. |
| Step limit (${volume(a).steps}) reached | The agent stops and reports what it has. |

## 7. Registry entry
| Field | Value |
|---|---|
| Name | ${a.name} |
| Owner | ${a.owner.trim() || 'to be named'} |
| Level | Personal until approved |
| Sources | ${src.map((s) => s.label).join(', ') || 'none'} |
| Rights | ${a.rights === 'read' ? 'read only' : 'proposes changes, asks first'} |
| Trigger | ${triggerText(a)} |
| Output | ${outputLabel(a.output)} |
`;
}

export function buildArchitecture(p: AgentProject, catalog: Source[]): string {
  const a = p.answers, src = sourceRows(a, catalog);
  const conn = src.filter((s) => s.kind === 'connector').map((s) => s.label), spaces = src.filter((s) => s.kind === 'space').map((s) => s.label);
  return `# Solution Architecture: ${a.name}

Based on the TFD confirmed on ${day(p.confirmed.tfd)}.

## 1. Context
${a.objective.trim()} The agent serves ${a.users.trim()} and runs ${triggerText(a)}.

## 2. Building blocks
| Component | Role | Used here |
|---|---|---|
| Agent Studio | Defines, tests and approves the agent | Brief, sources, rights, sandbox test, approval |
| Brief | The instruction plus the allowed sources and rights | Built from the TFD |
| Joule runtime (Goose agent) | Executes the brief | Reads and writes the answer in the chat |
| Connectors (MCP) | Safe link to an app or data source | ${conn.join(', ') || 'none'} |
| Spaces | Read-only pages with embedded data | ${spaces.join(', ') || 'none'} |
| Scheduler | Starts the agent at the set time | ${triggerText(a)} |
| Registry (AI Control Tower) | Lists every agent as a process with owner and approval | One entry for this agent |
| Approval workflow | Moves the agent from Personal to Department to Company | Required before the schedule starts |

## 3. Data flow
1. The scheduler or a person starts the agent.
2. The app turns it into its brief: instruction, allowed sources, rights.
3. Joule reads only the allowed sources, through the connector or the Space.
4. Joule produces ${outputLabel(a.output).toLowerCase()} and names the source of every figure.
5. The result is shown in the chat. The run is recorded in the registry and the audit trail.

## 4. Security and access
- Least privilege: only listed sources are readable; everything else is refused.
- Tokens stay in the connector settings on this computer; the brief contains no secrets.
- ${a.rights === 'read' ? 'The agent is read only.' : 'Every write is a proposal and needs a person\'s approval.'}
- Data classification: ${sensitivityLabel(a)}.${a.sensitivity === 'personal' ? ' Personal data: keep the purpose narrow and keep results out of shared Spaces.' : ''}

## 5. Runtime and operations
- Runs locally while the app is open; no server component in this prototype.
- Cost per run is bounded by the step limit of ${volume(a).steps}.
- Monitoring through the registry and the audit trail.

## 6. Decisions
| Decision | Reason | Alternative |
|---|---|---|
| Local runtime | Fast to demonstrate, no data leaves the computer | Server-side agent with central scheduler |
| Read only by default | Smallest risk | Write access with approval |
| Brief defined by form | Everyone can maintain it | Code-based agent |

## 7. Open points for a production roll-out
- Central scheduler and registry instead of local ones.
- Approval by a second person.
- Rights inherited from the user's identity.
`;
}

export function buildRiskPlan(p: AgentProject, catalog: Source[]): string {
  const a = p.answers, src = sourceRows(a, catalog);
  const web = src.some((s) => s.kind === 'web');
  return `# Risk, Compliance and Test Plan: ${a.name}

Based on the architecture confirmed on ${day(p.confirmed.arch)}.

## 1. Classification
- Data: **${sensitivityLabel(a)}**${a.sensitivity === 'personal' ? ' (personal data: purpose limitation and data protection review apply)' : ''}
- Human oversight: ${a.rights === 'read' ? 'the agent only reports; a person decides' : 'the agent proposes; a person approves every change'}
- EU AI Act: the agent supports people and takes no decision about them. If it is used for areas such as hiring, credit or access to services, it must be assessed again as a high-risk system.

## 2. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A figure is wrong or invented | Medium | High | Every figure names its source; sample check in the sandbox test |
| The agent reads more than it should | Low | High | Only listed sources; others are refused and shown |
| Sensitive data appears where it should not | Low | High | Results stay in the chat; no sending; classification ${sensitivityLabel(a).toLowerCase()} |
| The schedule runs unnoticed | Medium | Medium | Registry shows owner, trigger and last run |
| The source is stale or empty | Medium | Medium | The agent will ${missingText(a)} |
${web ? '| Web pages are unreliable | Medium | Medium | Name the page for every statement; verify before use |\n' : ''}
## 3. Test plan
| # | Scenario | Expected result |
|---|---|---|
| T1 | Run on sample data | Result meets the success measure: ${a.success.trim()} |
| T2 | The agent is asked to read a source that is not listed | Refused and shown as blocked |
| T3 | A listed source returns nothing | The agent will ${missingText(a)} |
| T4 | The agent is asked to change data | ${a.rights === 'read' ? 'Refused: read only' : 'Only a proposal; asks before writing'} |
| T5 | The step limit of ${volume(a).steps} is reached | The agent stops and reports what it has |
| T6 | The same input is run twice | The result is the same |

## 4. Go-live criteria
- [ ] The sandbox test passed (T1 to T6)
- [ ] The owner is named: ${a.owner.trim() || 'to be named'}
- [ ] Approval for the next level is requested
- [ ] The schedule (${triggerText(a)}) is checked
`;
}

const WRITERS: Record<DocKey, (p: AgentProject, c: Source[]) => string> = { prd: buildPrd, tfd: buildTfd, arch: buildArchitecture, risk: buildRiskPlan };

/* ---------- state changes (pure: they return a new project) ---------- */
const touch = (p: AgentProject, now: number): AgentProject => ({ ...p, updatedAt: now });
const laterDocs = (k: DocKey) => DOC_ORDER.slice(DOC_ORDER.indexOf(k) + 1);

/** Changes to the answers after the questions were confirmed reopen everything: the documents are marked outdated. */
export function setAnswers(p: AgentProject, change: Partial<Answers>, now: number): AgentProject {
  const written = DOC_ORDER.filter((k) => p.docs[k]);
  const wasConfirmed = !!p.confirmed.questions;
  return touch({ ...p, answers: { ...p.answers, ...change }, confirmed: wasConfirmed ? {} : p.confirmed, stale: wasConfirmed ? written : p.stale }, now);
}

export function confirmQuestions(p: AgentProject, catalog: Source[], now: number): AgentProject {
  if (questionProblems(p.answers).length) return p;
  const docs = { ...p.docs };
  if (!docs.prd || p.stale.includes('prd')) docs.prd = WRITERS.prd(p, catalog);
  return touch({ ...p, docs, confirmed: { ...p.confirmed, questions: now }, stale: p.stale.filter((k) => k !== 'prd') }, now);
}

/** The person edits a document: it is no longer confirmed, and the documents after it have to be reviewed again. */
export function editDoc(p: AgentProject, key: DocKey, text: string, now: number): AgentProject {
  const confirmed = { ...p.confirmed };
  for (const k of [key, ...laterDocs(key)]) delete confirmed[k];
  const stale = [...new Set([...p.stale, ...laterDocs(key).filter((k) => p.docs[k])])];
  return touch({ ...p, docs: { ...p.docs, [key]: String(text).slice(0, MAX_DOC) }, confirmed, stale, agentId: p.agentId }, now);
}

/** Writes the document again from the answers and the documents before it (replaces the text). */
export function regenerate(p: AgentProject, key: DocKey, catalog: Source[], now: number): AgentProject {
  const text = WRITERS[key](p, catalog);
  return { ...editDoc(p, key, text, now), stale: p.stale.filter((k) => k !== key) };
}

/** "Yes, this is OK": confirms the document and writes the next one. Refused when the step before is not confirmed. */
export function confirmDoc(p: AgentProject, key: DocKey, catalog: Source[], now: number): AgentProject {
  const before = key === 'prd' ? 'questions' : DOC_ORDER[DOC_ORDER.indexOf(key) - 1];
  if (!p.confirmed[before] || !p.docs[key]?.trim() || p.stale.includes(key)) return p;
  const confirmed = { ...p.confirmed, [key]: now };
  const next = DOC_ORDER[DOC_ORDER.indexOf(key) + 1];
  let docs = p.docs, stale = p.stale;
  const moved = { ...p, confirmed };
  if (next && (!docs[next] || stale.includes(next))) { docs = { ...docs, [next]: WRITERS[next](moved, catalog) }; stale = stale.filter((k) => k !== next); }
  return touch({ ...p, confirmed, docs, stale }, now);
}

export function allConfirmed(p: AgentProject): boolean { return !!p.confirmed.questions && DOC_ORDER.every((k) => p.confirmed[k]) && p.stale.length === 0; }

/** The agent that follows from the confirmed documents; stays a draft in the Studio: test and approval come next. */
export function agentFromProject(p: AgentProject, catalog: Source[], now = Date.now()): StudioAgent | null {
  if (!allConfirmed(p)) return null;
  const a = p.answers, src = sourceRows(a, catalog);
  const base = newAgent(null, catalog, now);
  const instruction = [
    `Goal: ${a.objective.trim()}`,
    `Audience: ${a.users.trim()}`,
    `A good result: ${a.success.trim()}`,
    `Read only the allowed sources${src.length ? ` (${src.map((s) => s.label).join(', ')})` : ''}. Name the source of every figure.`,
    `If a source is missing or fails: ${missingText(a)}.`,
    `Produce: ${outputLabel(a.output).toLowerCase()}. Do not send or change anything yourself.`,
    a.dependencies.trim() ? `Dependencies: ${a.dependencies.trim()}` : '',
  ].filter(Boolean).join('\n');
  return {
    ...base, name: a.name.trim().slice(0, 60), purpose: a.objective.trim().slice(0, 300), instruction: instruction.slice(0, 2000),
    sources: a.sources.filter((id) => catalog.some((s) => s.id === id)), canWrite: a.rights === 'propose', askBeforeWrite: true, maxSteps: volume(a).steps,
    output: a.output, trigger: { type: a.trigger, time: TIME.test(a.time) ? a.time : '08:00' }, template: `project:${p.id}`,
  };
}

/** Confirmations as audit events (who confirmed what, when). */
export function projectEvents(projects: AgentProject[]): Array<{ at: number; what: string }> {
  const out: Array<{ at: number; what: string }> = [];
  for (const p of projects) {
    for (const k of ['questions', ...DOC_ORDER] as const) {
      const at = p.confirmed[k];
      if (at) out.push({ at, what: `${p.answers.name}: ${k === 'questions' ? 'goal and questions' : DOC_SHORT[k]}` });
    }
  }
  return out;
}

/* ---------- storage ---------- */
export function sanitizeProjects(v: unknown): AgentProject[] {
  if (!Array.isArray(v)) return [];
  const out: AgentProject[] = [];
  for (const r of v as any[]) {
    if (!r || typeof r.id !== 'string' || out.some((p) => p.id === r.id) || typeof r.answers !== 'object' || !r.answers) continue;
    const a = r.answers, base = newProject('', 0).answers;
    const answers: Answers = {
      name: clean(a.name, 60) || base.name, objective: clean(a.objective, 400), success: clean(a.success, 400), users: clean(a.users, 200),
      sources: Array.isArray(a.sources) ? a.sources.filter((s: unknown) => typeof s === 'string').slice(0, 40) : [], otherSystems: clean(a.otherSystems, 200),
      sensitivity: SENSITIVITY.some((s) => s.id === a.sensitivity) ? a.sensitivity : 'internal',
      trigger: ['manual', 'daily', 'weekly'].includes(a.trigger) ? a.trigger : 'manual', time: TIME.test(a.time ?? '') ? a.time : '08:00',
      output: OUTPUTS.some((o) => o.id === a.output) ? a.output : 'summary', rights: a.rights === 'propose' ? 'propose' : 'read',
      dependencies: clean(a.dependencies, 300), onMissing: a.onMissing === 'continue' ? 'continue' : 'stop', volume: VOLUME.some((x) => x.id === a.volume) ? a.volume : 'small', owner: clean(a.owner, 80),
    };
    const docs: AgentProject['docs'] = {}, confirmed: AgentProject['confirmed'] = {};
    for (const k of DOC_ORDER) if (typeof r.docs?.[k] === 'string') docs[k] = r.docs[k].slice(0, MAX_DOC);
    for (const k of ['questions', ...DOC_ORDER] as const) if (Number(r.confirmed?.[k]) > 0) confirmed[k] = Number(r.confirmed[k]);
    out.push({
      id: r.id.slice(0, 40), answers, docs, confirmed, stale: Array.isArray(r.stale) ? r.stale.filter((k: unknown) => DOC_ORDER.includes(k as DocKey)) : [],
      ...(typeof r.agentId === 'string' ? { agentId: r.agentId } : {}), createdAt: Number(r.createdAt) || 0, updatedAt: Number(r.updatedAt) || 0,
    });
    if (out.length >= MAX_PROJECTS) break;
  }
  return out;
}
export function loadProjects(store: Pick<Storage, 'getItem'>): AgentProject[] { try { return sanitizeProjects(JSON.parse(store.getItem(PROJECTS_KEY) ?? 'null')); } catch { return []; } }
export function saveProjects(store: Pick<Storage, 'setItem'>, p: AgentProject[]): void { try { store.setItem(PROJECTS_KEY, JSON.stringify(p)); } catch { /* ignore */ } }
