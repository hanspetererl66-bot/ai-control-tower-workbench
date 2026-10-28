/**
 * Intent-based development: before anything is built, an intent is captured in a form, turned into a
 * Product Requirements Definition (PRD), then into a specification with the solution architecture, and only
 * then is the n8n workflow or the agent built from those documents. Pure functions: prompts, validation,
 * extraction of the result from the model's answer, and the project store.
 */

export type Kind = 'workflow' | 'agent';
export type Stage = 'intent' | 'requirements' | 'specification' | 'build';
export const STAGES: Stage[] = ['intent', 'requirements', 'specification', 'build'];
export const STAGE_LABEL: Record<Stage, string> = {
  intent: 'Intent',
  requirements: 'Requirements',
  specification: 'Specification & Architecture',
  build: 'Build',
};

export const TRIGGERS = ['A person asks in the chat', 'On a schedule', 'An event or webhook from a system', 'Started by another workflow or agent'] as const;
export const GUARDRAILS = [
  'Read only: it may look things up, never change anything',
  'Draft only: it prepares, a person approves every action',
  'Acts after approval: changes data only after a named person approves',
  'Acts on its own within clear limits',
] as const;
export const SYSTEMS = ['SAP S/4HANA', 'SAP SuccessFactors', 'SAP Ariba', 'SAP Cloud ALM', 'Salesforce', 'Icertis', 'Microsoft 365 / Teams', 'E-mail', 'Ticket system', 'Database (Supabase)', 'Spreadsheets / CSV'] as const;

export type Intent = {
  name: string;
  goal: string;
  trigger: string;
  systems: string[];
  otherSystems: string;
  data: string;
  guardrail: string;
  success: string;
  /** Optional: who uses it, who approves, who is affected. */
  stakeholders: string;
  /** Optional: what it should explicitly not do. */
  outOfScope: string;
  /** Workflow: what happens on errors. Agent: example requests it must handle. */
  extra: string;
};

export type Documents = { prd: string; spec: string; build: string };

export type Project = {
  id: string;
  kind: Kind;
  stage: Stage;
  intent: Intent;
  docs: Documents;
  /** Stages whose document the person has approved. */
  approved: Stage[];
  createdAt: number;
  updatedAt: number;
};

export const emptyIntent = (): Intent => ({ name: '', goal: '', trigger: TRIGGERS[0], systems: [], otherSystems: '', data: '', guardrail: GUARDRAILS[1], success: '', stakeholders: '', outOfScope: '', extra: '' });

export function newProject(kind: Kind, now = Date.now()): Project {
  return { id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, stage: 'intent', intent: emptyIntent(), docs: { prd: '', spec: '', build: '' }, approved: [], createdAt: now, updatedAt: now };
}

/** The text of the mask: what is asked, depending on what is built. */
export function extraQuestion(kind: Kind): { label: string; hint: string } {
  return kind === 'workflow'
    ? { label: 'What should happen when something goes wrong?', hint: 'For example: retry twice, then notify the owner in Teams.' }
    : { label: 'Which requests must it handle? Give two or three examples.', hint: 'For example: "Which contracts can we terminate before year end?"' };
}

const MIN_GOAL = 15;

/** What is missing before requirements can be written. Empty list = ready. */
export function intentProblems(intent: Intent): string[] {
  const out: string[] = [];
  if (!intent.name.trim()) out.push('Give it a short name.');
  if (intent.goal.trim().length < MIN_GOAL) out.push('Describe the goal in a sentence or two.');
  if (intent.systems.length === 0 && !intent.otherSystems.trim()) out.push('Pick at least one system or describe another one.');
  if (!intent.data.trim()) out.push('Say what data goes in and what should come out.');
  if (!intent.success.trim()) out.push('Say how you will know that it works.');
  return out;
}

export function intentBlock(kind: Kind, i: Intent): string {
  const systems = [...i.systems, ...(i.otherSystems.trim() ? [i.otherSystems.trim()] : [])].join(', ');
  const q = extraQuestion(kind);
  return [
    `Kind: ${kind === 'workflow' ? 'n8n workflow' : 'agent (a skill with instructions plus connectors)'}`,
    `Name: ${i.name.trim()}`,
    `Goal: ${i.goal.trim()}`,
    `Started by: ${i.trigger}`,
    `Systems: ${systems}`,
    `Data in and out: ${i.data.trim()}`,
    `Guardrail: ${i.guardrail}`,
    `Success: ${i.success.trim()}`,
    `Stakeholders named by the person: ${i.stakeholders.trim() || '(not given)'}`,
    `Explicitly out of scope: ${i.outOfScope.trim() || '(not given)'}`,
    `${q.label} ${i.extra.trim() || '(not answered)'}`,
  ].join('\n');
}

const ONLY_DOC = 'Answer with the document only, as Markdown, starting with a level-1 heading. No introduction, no closing remarks. Do not use tools and do not create files. Where information is missing, make a clear assumption and list it under "Open questions and assumptions"; never ask the person a question in the answer.';

export function prdPrompt(kind: Kind, intent: Intent, feedback = '', previous = ''): string {
  return [
    'You are a senior business analyst. Write the Product Requirements Definition (PRD) for the following intent.',
    '',
    '## Intent',
    intentBlock(kind, intent),
    '',
    '## Structure of the PRD',
    '1. Summary and intent (what and why, in plain words; one short paragraph)',
    '2. Stakeholders: a table with columns Role, Who (team or function, no invented names), Interest, Involvement (Responsible / Accountable / Consulted / Informed)',
    '3. Scope: "In scope" as a bullet list and "Out of scope" as a bullet list with a short reason for each item',
    '4. Goals, business value and success metrics: a table with Metric, Baseline, Target, How measured',
    '5. Functional requirements: a numbered table REQ-01, REQ-02 … with columns ID, Requirement, Priority (Must/Should/Could), Acceptance criterion',
    '6. Non-functional requirements (security, privacy, auditability, performance, availability; mention the EU AI Act only where it applies)',
    '7. Data and systems (which systems, which data, direction of flow)',
    '8. Autonomy, guardrails and approvals (what it may do alone, what needs a person, what is forbidden)',
    '9. Risks, dependencies and assumptions: a table with Item, Type (Risk/Dependency/Assumption), Impact, Mitigation or owner',
    '10. Evaluation and acceptance (how quality is tested before go-live, the quality bar, who signs off)',
    '11. Rollout, change management and go/no-go (phases, pilot group, training, rollback, go/no-go criteria)',
    '12. Open questions',
    '',
    'Use the stakeholders and the out-of-scope items the person named; add only what is clearly implied and mark additions as assumptions.',
    'Requirements must be testable and written so that a later specification can refer to them by ID.',
    feedback.trim() ? `\n## Changes asked for by the person\n${feedback.trim()}\n\n## Previous version\n${previous.slice(0, 20_000)}` : '',
    '',
    ONLY_DOC,
  ].filter((x) => x !== '').join('\n');
}

export function specPrompt(kind: Kind, intent: Intent, prd: string, feedback = '', previous = ''): string {
  const structure = kind === 'workflow'
    ? [
        '1. Overview and scope (what is built, what is not)',
        '2. Solution architecture: components, systems, trigger, data flow. Show the components as a table (Component, Role, Technology, Interfaces) and describe the data flow as numbered sentences. No diagrams in code fences.',
        '3. Process specification: numbered steps, each traced to REQ IDs',
        '4. n8n node plan: a table with node name, node type (n8n-nodes-base.*), purpose, key settings, credentials or environment variables',
        '5. Data contracts: example input and output as JSON',
        '6. Error handling, retries and notifications',
        '7. Security: secrets (environment variables or credentials only), authentication of the trigger, least privilege',
        '8. Test plan: test cases with input, expected result and the REQ IDs they cover',
        '9. Deployment and operation (activation, monitoring, owner)',
      ]
    : [
        '1. Overview and scope (what the agent does, what it does not do)',
        '2. Solution architecture: the agent, its skill, the connectors it uses, memory and context. Show the components as a table (Component, Role, Technology, Interfaces) and describe the data flow as numbered sentences. No diagrams in code fences.',
        '3. Behaviour specification: role, tone, how it decides, what it asks back, when it hands over to a person; each traced to REQ IDs',
        '4. Skill outline: name (kebab-case), description (one sentence that says when to use it), the sections of its instructions',
        '5. Connectors and tools: which are needed, what each is used for, read or write',
        '6. Guardrails: approvals, forbidden actions, data it must never reveal',
        '7. Evaluation: ten example requests with the expected behaviour and the REQ IDs they cover',
        '8. Deployment and operation (who owns it, how it is updated)',
      ];
  return [
    `You are a solution architect. Write the Specification and Solution Architecture for the ${kind === 'workflow' ? 'n8n workflow' : 'agent'} below, based on the approved PRD.`,
    '',
    '## Intent',
    intentBlock(kind, intent),
    '',
    '## Approved PRD',
    prd.slice(0, 30_000),
    '',
    '## Structure of the specification',
    ...structure,
    '',
    'Stay within the PRD: do not add requirements. If the PRD is unclear, state the assumption you make.',
    feedback.trim() ? `\n## Changes asked for by the person\n${feedback.trim()}\n\n## Previous version\n${previous.slice(0, 20_000)}` : '',
    '',
    ONLY_DOC,
  ].filter((x) => x !== '').join('\n');
}

export function buildPrompt(kind: Kind, intent: Intent, prd: string, spec: string, feedback = '', previous = ''): string {
  const head = kind === 'workflow'
    ? [
        'You are an n8n expert. Build the n8n workflow exactly as the specification describes. If n8n tools are available in this chat, create the workflow there as well, inactive.',
        'Always answer with ONE importable workflow in a single ```json fence (File → Import from file in n8n), followed by a short list "To do before activating" with credentials, environment variables and the webhook address.',
        'Rules for the JSON: top-level keys name, nodes, connections, settings ({"executionOrder":"v1"}), active:false. Node types start with n8n-nodes-base. Node names and ids are unique, every node has typeVersion and position. Never put secrets or real addresses in the file: use $env.NAME or credentials placeholders. Add a sticky note that lists the REQ IDs the workflow covers.',
      ]
    : [
        'You are an agent builder. Write the skill that makes the agent described in the specification.',
        'Answer with ONE SKILL.md in a single ```markdown fence, followed by a short list "Connectors to connect" (name, what for).',
        'Rules for SKILL.md: it starts with front matter between --- lines containing name (kebab-case, at most 64 characters) and description (one sentence, at most 300 characters, says when to use it). The instructions are written to the agent in the second person, are traceable to the REQ IDs, state the guardrails, and say what to do when information is missing. Never put secrets in the file.',
      ];
  return [
    ...head,
    '',
    '## Intent',
    intentBlock(kind, intent),
    '',
    '## Approved PRD',
    prd.slice(0, 20_000),
    '',
    '## Approved specification and solution architecture',
    spec.slice(0, 30_000),
    feedback.trim() ? `\n## Changes asked for by the person\n${feedback.trim()}\n\n## Previous version\n${previous.slice(0, 20_000)}` : '',
  ].filter((x) => x !== '').join('\n');
}

/* ---------------- reading the answer ---------------- */

/** The first fenced block with the given language (or any language when none is given). */
export function extractFence(text: string, lang?: string): string {
  const re = /```([\w-]*)[^\n]*\n([\s\S]*?)\n```/g;
  for (const m of text.matchAll(re)) if (!lang || m[1].toLowerCase() === lang.toLowerCase()) return m[2];
  return '';
}

export type CheckResult = { ok: boolean; problems: string[]; warnings: string[] };

/** Does the JSON look like something n8n can import, and is it free of obvious secrets? */
export function checkWorkflowJson(text: string): CheckResult & { workflow?: Record<string, any> } {
  const problems: string[] = [];
  const warnings: string[] = [];
  let wf: any;
  try { wf = JSON.parse(text); } catch { return { ok: false, problems: ['The workflow is not valid JSON.'], warnings }; }
  if (!wf || typeof wf !== 'object' || Array.isArray(wf)) return { ok: false, problems: ['The workflow must be a JSON object.'], warnings };
  if (typeof wf.name !== 'string' || !wf.name.trim()) problems.push('The workflow has no name.');
  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) problems.push('The workflow has no nodes.');
  if (!wf.connections || typeof wf.connections !== 'object') problems.push('The workflow has no connections.');
  const names = new Set<string>();
  for (const n of Array.isArray(wf.nodes) ? wf.nodes : []) {
    if (typeof n?.name !== 'string' || typeof n?.type !== 'string') { problems.push('A node has no name or type.'); continue; }
    if (names.has(n.name)) problems.push(`Node name used twice: ${n.name}`);
    names.add(n.name);
    if (!/^n8n-nodes-base\.|^@n8n\//.test(n.type)) warnings.push(`Unusual node type: ${n.type}`);
    if (!Array.isArray(n.position) || n.position.length !== 2) warnings.push(`Node without position: ${n.name}`);
    if (typeof n.typeVersion !== 'number') warnings.push(`Node without typeVersion: ${n.name}`);
  }
  for (const [from, outs] of Object.entries<any>(wf.connections ?? {})) {
    if (!names.has(from)) problems.push(`Connection from an unknown node: ${from}`);
    for (const out of outs?.main ?? []) for (const t of out ?? []) if (!names.has(t?.node)) problems.push(`Connection to an unknown node: ${t?.node}`);
  }
  if (wf.active === true) warnings.push('The workflow is marked active. Check it before you activate it.');
  if (/\b(sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}|xox[bp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/.test(text)) problems.push('The workflow seems to contain a secret. Remove it and use credentials or environment variables.');
  return { ok: problems.length === 0, problems, warnings, workflow: wf };
}

export function skillSlug(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export { checkSkillMd } from '../shared/skill-check.mjs';

/** The build result: the artifact (workflow JSON or SKILL.md) from the answer. */
export function artifactOf(kind: Kind, buildText: string): string {
  return kind === 'workflow' ? extractFence(buildText, 'json') : extractFence(buildText, 'markdown') || extractFence(buildText, 'md');
}

/* ---------------- stages ---------------- */

/** Can the person go to this stage? Each stage needs the approved document of the one before. */
export function canEnter(project: Project, stage: Stage): boolean {
  const i = STAGES.indexOf(stage);
  if (i <= 0) return true;
  const need = STAGES[i - 1];
  if (need === 'intent') return intentProblems(project.intent).length === 0;
  return project.approved.includes(need) && Boolean(need === 'requirements' ? project.docs.prd.trim() : project.docs.spec.trim());
}

/** Approving a document; changing an earlier document takes the approval of the later ones back. */
export function setDocument(project: Project, stage: 'requirements' | 'specification' | 'build', text: string, now = Date.now()): Project {
  const key = stage === 'requirements' ? 'prd' : stage === 'specification' ? 'spec' : 'build';
  if (project.docs[key] === text) return project;
  const later = STAGES.slice(STAGES.indexOf(stage));
  return { ...project, docs: { ...project.docs, [key]: text }, approved: project.approved.filter((s) => !later.includes(s)), updatedAt: now };
}

export function approve(project: Project, stage: Stage, now = Date.now()): Project {
  return project.approved.includes(stage) ? project : { ...project, approved: [...project.approved, stage], updatedAt: now };
}

export function changeIntent(project: Project, patch: Partial<Intent>, now = Date.now()): Project {
  // A changed intent makes the documents based on it stale: they stay as text, but are no longer approved.
  return { ...project, intent: { ...project.intent, ...patch }, approved: [], updatedAt: now };
}

/* ---------------- store ---------------- */

const KEY = 'werkbank.develop.projects';
const MAX_PROJECTS = 30;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function sanitizeProject(raw: any): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'workflow' && raw.kind !== 'agent') return null;
  const base = emptyIntent();
  const i = raw.intent ?? {};
  const intent: Intent = {
    name: str(i.name, 80), goal: str(i.goal, 1500), trigger: str(i.trigger, 120) || base.trigger,
    systems: Array.isArray(i.systems) ? i.systems.filter((s: unknown) => typeof s === 'string').slice(0, 20).map((s: string) => s.slice(0, 60)) : [],
    otherSystems: str(i.otherSystems, 300), data: str(i.data, 1500), guardrail: str(i.guardrail, 160) || base.guardrail,
    success: str(i.success, 1000), stakeholders: str(i.stakeholders, 800), outOfScope: str(i.outOfScope, 800), extra: str(i.extra, 1000),
  };
  const d = raw.docs ?? {};
  const stage: Stage = STAGES.includes(raw.stage) ? raw.stage : 'intent';
  return {
    id: str(raw.id, 40) || `p${Date.now().toString(36)}`, kind: raw.kind, stage, intent,
    docs: { prd: str(d.prd, 60_000), spec: str(d.spec, 80_000), build: str(d.build, 120_000) },
    approved: Array.isArray(raw.approved) ? raw.approved.filter((s: unknown) => STAGES.includes(s as Stage)) : [],
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(), updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function loadProjects(store: Store): Project[] {
  try {
    const raw = JSON.parse(store.getItem(KEY) ?? '[]');
    return (Array.isArray(raw) ? raw : []).map(sanitizeProject).filter((p): p is Project => p !== null).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PROJECTS);
  } catch {
    return [];
  }
}

/** True when the projects were stored; false when the browser refused (storage full or unavailable). */
export function saveProjects(store: Store, projects: Project[]): boolean {
  try { store.setItem(KEY, JSON.stringify(projects.slice(0, MAX_PROJECTS))); return true; } catch { return false; }
}

export function upsertProject(projects: Project[], project: Project): Project[] {
  return [project, ...projects.filter((p) => p.id !== project.id)].slice(0, MAX_PROJECTS);
}

export type ProjectFile = { path: string; text: string };

/**
 * The project folder: intent, PRD, specification and the build result in a fixed structure.
 * `wrap` turns a stored HTML document into a complete, self-contained file (given by the caller, because it needs a browser).
 */
export function projectFiles(project: Project, wrap: (html: string, title: string) => string = (h) => h): ProjectFile[] {
  const slug = skillSlug(project.intent.name) || 'project';
  const name = project.intent.name.trim() || slug;
  const out: ProjectFile[] = [{ path: `${slug}/01-intent/intent.md`, text: `# Intent: ${name}\n\n${intentBlock(project.kind, project.intent).split('\n').map((l) => `- ${l}`).join('\n')}\n` }];
  if (project.docs.prd.trim()) out.push({ path: `${slug}/02-requirements/PRD.html`, text: wrap(project.docs.prd, `PRD: ${name}`) });
  if (project.docs.spec.trim()) out.push({ path: `${slug}/03-specification/specification-architecture.html`, text: wrap(project.docs.spec, `Specification: ${name}`) });
  const artifact = artifactOf(project.kind, project.docs.build);
  if (artifact) out.push({ path: `${slug}/04-build/${project.kind === 'workflow' ? `${slug}.workflow.json` : 'SKILL.md'}`, text: artifact });
  if (project.docs.build.trim()) out.push({ path: `${slug}/04-build/build-answer.md`, text: project.docs.build });
  return out;
}

/** Name of the build artifact file for a single download. */
export function artifactFileName(project: Project): string {
  const slug = skillSlug(project.intent.name) || 'project';
  return project.kind === 'workflow' ? `${slug}.workflow.json` : `${slug}-SKILL.md`;
}
