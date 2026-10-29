/**
 * Agent Studio: simple agents defined by a form instead of code. An agent is a brief (purpose, instruction), the
 * sources it may read, its rights, an output and a trigger. Anything not ticked as a source is not readable for it.
 * The test run is a simulation on sample data (a sandbox): it shows which sources the agent touches and what it would
 * answer, before anything runs for real. "Run in chat" hands the same brief to the assistant, restricted to the sources.
 */
import type { Schedule } from './schedules';

export type SourceKind = 'connector' | 'space' | 'file' | 'web';
export type Source = { id: string; kind: SourceKind; label: string; hint: string };
export type Output = 'summary' | 'table' | 'draft-mail' | 'ticket';
export type TriggerType = 'manual' | 'daily' | 'weekly';
export type StudioAgent = {
  id: string; name: string; purpose: string; instruction: string;
  sources: string[]; canWrite: boolean; askBeforeWrite: boolean; maxSteps: number;
  output: Output; trigger: { type: TriggerType; time: string };
  tested: boolean; testedAt?: number; template: string; createdAt: number;
};
export const AGENTS_KEY = 'werkbank.studioAgents';
export const AGENT_GOV_KEY = 'werkbank.agentGovernance';
export const MAX_AGENTS = 20;
export const OUTPUTS: Array<{ id: Output; label: string }> = [
  { id: 'summary', label: 'Summary' }, { id: 'table', label: 'Table with traffic lights' }, { id: 'draft-mail', label: 'Draft e-mail' }, { id: 'ticket', label: 'Ticket draft' },
];

const clean = (t: unknown, n: number) => String(t ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, n);

/** Sources the person can tick: their connectors and Spaces plus files and the web. */
export function buildCatalog(connectors: string[], spaces: Array<{ slug: string; title: string }>): Source[] {
  return [
    ...spaces.map((s) => ({ id: `space:${s.slug}`, kind: 'space' as const, label: s.title, hint: 'Space on this computer' })),
    ...connectors.map((c) => ({ id: `conn:${c}`, kind: 'connector' as const, label: c, hint: 'Connector' })),
    { id: 'file', kind: 'file', label: 'Files I attach', hint: 'Only files attached to the message' },
    { id: 'web', kind: 'web', label: 'Web search', hint: 'Public web pages' },
  ];
}

export type Template = { id: string; name: string; purpose: string; instruction: string; match: string[]; output: Output; trigger: { type: TriggerType; time: string }; canWrite: boolean; story: string };
export const TEMPLATES: Template[] = [
  {
    id: 'renewal-watch', name: 'Renewal watch', story: 'Use case 1',
    purpose: 'Watch the renewals of the next 90 days and prepare the first step for every red one.',
    instruction: 'Look at all contracts with a decision date in the next 90 days. Rate each one red, yellow or green (lapsed or decision date passed = red; decision within 30 days or low usage = yellow). Show a table sorted by urgency with customer, product, annual value, decision date and the reason. For every red renewal write a short draft e-mail to the account owner with the next step. Name the source for every figure.',
    match: ['renewals', 'sub4me'], output: 'table', trigger: { type: 'weekly', time: '08:00' }, canWrite: false,
  },
  {
    id: 'cost-watch', name: 'Cost watch', story: 'Use case 2',
    purpose: 'Watch the monthly AI spend against the ceiling and propose levers before it is crossed.',
    instruction: 'Compare the actual monthly spend with the ceiling and the plan. Say how much headroom is left and which teams are over their allocation. If utilisation is above 85 percent or a team is over budget, propose the levers from the What-if Simulator with the saving per lever. Result first, then the reason, then the decision needed.',
    match: ['ai-control-tower', 'what-if', 'control-tower'], output: 'summary', trigger: { type: 'weekly', time: '07:30' }, canWrite: false,
  },
  {
    id: 'prd-writer', name: 'PRD writer', story: 'Use case 3',
    purpose: 'Turn the chosen Jira requirements into a product requirements document.',
    instruction: 'Read the epics and stories of the Jira project the person names. Write a PRD with overview, goals, users, requirements per epic (every requirement with its ticket key and acceptance criteria), what is out of scope, and open questions for tickets without criteria, priority or user role. Do not invent requirements that are not in a ticket. Change nothing in Jira.',
    match: ['jira', 'prd-builder'], output: 'summary', trigger: { type: 'manual', time: '08:00' }, canWrite: false,
  },
  {
    id: 'preclose-check', name: 'Pre-close checker', story: 'Use case 4',
    purpose: 'Check the month-end pre-close every morning: open items, anomalies and accrual proposals, with the first step for every red one.',
    instruction: 'Read the pre-close of the current month. List the open items (intercompany differences, bank reconciliation, goods received not invoiced, unbilled revenue) with amount and age in working days, the anomalies of the last days rated red or yellow, and the accrual proposals with their confidence. Rate each finding red (amount above 400 thousand EUR, older than 5 working days or a red anomaly), yellow or green. Name the owner and the next step for every red one. Do not post anything: accruals are only proposed, a person approves them.',
    match: ['finance-preclose', 'preclose', 'databricks'], output: 'table', trigger: { type: 'daily', time: '07:45' }, canWrite: false,
  },
];

export function newAgent(t: Template | null, catalog: Source[], now = Date.now()): StudioAgent {
  const sources = t ? catalog.filter((s) => t.match.some((m) => s.id.toLowerCase().includes(m))).map((s) => s.id) : [];
  return {
    id: `a-${now.toString(36)}`, name: t?.name ?? 'New agent', purpose: t?.purpose ?? '', instruction: t?.instruction ?? '',
    sources, canWrite: t?.canWrite ?? false, askBeforeWrite: true, maxSteps: 10, output: t?.output ?? 'summary',
    trigger: t?.trigger ?? { type: 'manual', time: '08:00' }, tested: false, template: t?.id ?? '', createdAt: now,
  };
}

export function sanitizeAgents(v: unknown): StudioAgent[] {
  if (!Array.isArray(v)) return [];
  const out: StudioAgent[] = [];
  for (const r of v as any[]) {
    if (!r || typeof r.id !== 'string' || !clean(r.name, 60) || out.some((a) => a.id === r.id)) continue;
    out.push({
      id: r.id.slice(0, 40), name: clean(r.name, 60), purpose: clean(r.purpose, 300), instruction: String(r.instruction ?? '').trim().slice(0, 2000),
      sources: Array.isArray(r.sources) ? r.sources.filter((s: unknown) => typeof s === 'string').slice(0, 40) : [],
      canWrite: r.canWrite === true, askBeforeWrite: r.askBeforeWrite !== false, maxSteps: Math.min(30, Math.max(1, Number(r.maxSteps) || 10)),
      output: OUTPUTS.some((o) => o.id === r.output) ? r.output : 'summary',
      trigger: { type: ['manual', 'daily', 'weekly'].includes(r.trigger?.type) ? r.trigger.type : 'manual', time: /^([01]\d|2[0-3]):[0-5]\d$/.test(r.trigger?.time ?? '') ? r.trigger.time : '08:00' },
      tested: r.tested === true, ...(Number(r.testedAt) > 0 ? { testedAt: Number(r.testedAt) } : {}), template: typeof r.template === 'string' ? r.template : '', createdAt: Number(r.createdAt) || 0,
    });
    if (out.length >= MAX_AGENTS) break;
  }
  return out;
}
export function loadAgents(store: Pick<Storage, 'getItem'>): StudioAgent[] { try { return sanitizeAgents(JSON.parse(store.getItem(AGENTS_KEY) ?? 'null')); } catch { return []; } }
export function saveAgents(store: Pick<Storage, 'setItem'>, a: StudioAgent[]): void { try { store.setItem(AGENTS_KEY, JSON.stringify(a)); } catch { /* ignore */ } }

/** What is wrong with the agent before it can be tested; empty when fine. */
export function problems(a: StudioAgent): string[] {
  const p: string[] = [];
  if (!a.name.trim()) p.push('Give the agent a name.');
  if (a.instruction.trim().length < 20) p.push('Describe in at least one sentence what the agent should do.');
  if (!a.sources.length) p.push('Tick at least one source; without a source the agent has nothing to read.');
  if (a.canWrite && !a.askBeforeWrite) p.push('Writing without asking is not allowed in this prototype: switch “ask before writing” on.');
  return p;
}

/** The brief for the assistant: instruction, the only sources it may use, rights and the shape of the answer. */
export function agentPrompt(a: StudioAgent, catalog: Source[]): string {
  const labels = a.sources.map((id) => catalog.find((s) => s.id === id)).filter(Boolean).map((s) => `${s!.label} (${s!.kind})`);
  const out = OUTPUTS.find((o) => o.id === a.output)?.label ?? 'Summary';
  return [
    `AGENT "${a.name}" — ${a.purpose}`,
    a.instruction,
    `SOURCES: use only these: ${labels.join(', ') || 'none'}. Do not read or call anything else. If the answer needs another source, say so instead of guessing.`,
    a.canWrite ? `RIGHTS: you may propose changes${a.askBeforeWrite ? ' but ask before every write' : ''}. At most ${a.maxSteps} steps.` : `RIGHTS: read only. Change nothing. At most ${a.maxSteps} steps.`,
    `OUTPUT: ${out}. Name the source for every figure.`,
  ].join('\n\n');
}

/* ---- Sandbox test run (simulation on sample data) ---- */
export type RunStep = { text: string; source?: string; blocked?: boolean };
export type RunResult = { steps: RunStep[]; title: string; table?: { head: string[]; rows: Array<{ cells: string[]; level: 'red' | 'yellow' | 'green' }> }; lines: string[]; mail?: string; sources: string[]; blocked: string[] };

type Case = { customer: string; product: string; status: string; end: string; decision: string; eur: number; usedPct: number | null; owner: string; stage: string; prob: number | null; next: string };
export const SAMPLE_CASES: Case[] = [
 {
  "customer": "Hanse Handelsgruppe AG",
  "product": "Integration Suite",
  "status": "Lapsed",
  "end": "2026-04-30",
  "decision": "2026-01-30",
  "eur": 135000,
  "usedPct": 100,
  "owner": "Mira Hoffmann",
  "stage": "Proposal sent",
  "prob": 40,
  "next": "Technical review with the platform team by 2026-11-12"
 },
 {
  "customer": "Muster Industrie AG",
  "product": "SuccessFactors Employee Central",
  "status": "Renewal due",
  "end": "2026-12-31",
  "decision": "2026-10-02",
  "eur": 410000,
  "usedPct": 97,
  "owner": "Katrin Lindner",
  "stage": "Proposal sent",
  "prob": 70,
  "next": "Customer review with HR leadership by 2026-11-06"
 },
 {
  "customer": "Hanse Handelsgruppe AG",
  "product": "SAP Commerce Cloud",
  "status": "Renewal due",
  "end": "2026-12-31",
  "decision": "2026-11-01",
  "eur": 380000,
  "usedPct": 100,
  "owner": "Sven Albrecht",
  "stage": "Proposal sent",
  "prob": 55,
  "next": "Workshop with E-Commerce on the traffic block by 2026-11-05"
 },
 {
  "customer": "Muster Industrie AG",
  "product": "Ariba Procurement",
  "status": "Renewal due",
  "end": "2027-01-31",
  "decision": "2026-11-02",
  "eur": 290000,
  "usedPct": 92,
  "owner": "Katrin Lindner",
  "stage": "Proposal sent",
  "prob": 60,
  "next": "Workshop on supplier risk module on 2026-10-29"
 },
 {
  "customer": "Muster Industrie AG",
  "product": "AI units (Joule, AI Core, Document AI)",
  "status": "Running",
  "end": "2026-12-31",
  "decision": "2026-11-01",
  "eur": 360000,
  "usedPct": 78,
  "owner": "Mira Hoffmann",
  "stage": "",
  "prob": null,
  "next": ""
 },
 {
  "customer": "Muster Industrie AG",
  "product": "Business Technology Platform",
  "status": "Running",
  "end": "2027-03-31",
  "decision": "2026-12-31",
  "eur": 640000,
  "usedPct": 69,
  "owner": "Mira Hoffmann",
  "stage": "",
  "prob": null,
  "next": ""
 },
 {
  "customer": "Hanse Handelsgruppe AG",
  "product": "AI units (Joule, AI Core, Document AI, Ariba AI)",
  "status": "Running",
  "end": "2026-12-31",
  "decision": "2026-11-01",
  "eur": 240000,
  "usedPct": 66,
  "owner": "Mira Hoffmann",
  "stage": "",
  "prob": null,
  "next": ""
 },
 {
  "customer": "Muster Industrie AG",
  "product": "SAP Signavio Process Manager add-on",
  "status": "Running",
  "end": "2027-01-31",
  "decision": "2026-12-02",
  "eur": 24000,
  "usedPct": 82,
  "owner": "Mira Hoffmann",
  "stage": "",
  "prob": null,
  "next": ""
 }
];

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export function health(c: Case, today: string): { level: 'red' | 'yellow' | 'green'; why: string } {
  const d = daysBetween(today, c.decision);
  if (c.status === 'Lapsed') return { level: 'red', why: 'contract lapsed' };
  if (c.status === 'Renewal due' && d < 0) return { level: 'red', why: `decision date passed ${-d} days ago` };
  if (d <= 30) return { level: 'yellow', why: `decision in ${d} days` };
  if ((c.usedPct ?? 100) < 70) return { level: 'yellow', why: `usage only ${c.usedPct}%` };
  return { level: 'green', why: 'on track' };
}
const eur = (n: number) => `${n.toLocaleString('en-US')} EUR`;

function label(catalog: Source[], id: string) { return catalog.find((s) => s.id === id)?.label ?? id; }

/** Runs the agent on sample data. Reading a source that was not ticked is refused and shown, which is the point of the sandbox. */
export function simulateRun(a: StudioAgent, catalog: Source[], today = new Date().toISOString().slice(0, 10)): RunResult {
  const has = (frag: string) => a.sources.find((id) => id.toLowerCase().includes(frag));
  const steps: RunStep[] = [];
  const used: string[] = [], blocked: string[] = [];
  const read = (frag: string, wanted: string, text: string) => {
    const id = has(frag);
    if (id) { steps.push({ text, source: label(catalog, id) }); used.push(label(catalog, id)); return true; }
    steps.push({ text: `Tried to read ${wanted}: refused, it is not one of the agent's sources.`, blocked: true }); blocked.push(wanted); return false;
  };
  steps.push({ text: `Start: "${a.name}", at most ${a.maxSteps} steps, ${a.canWrite ? 'may propose changes' : 'read only'}.` });

  if (a.template === 'renewal-watch') {
    const ok = read('renewals', 'the Renewals Space', `Read the contracts and decision dates: ${SAMPLE_CASES.length} contracts in the next 12 months.`);
    read('sub4me', 'open tickets in Sub4Me', 'Read open tickets of the customers: 2 critical tickets at Muster Industrie AG.');
    if (!ok) return { steps, title: 'No result', lines: ['The agent cannot rate renewals without the Renewals Space. Tick it as a source.'], sources: used, blocked };
    const rated = SAMPLE_CASES.map((c) => ({ c, h: health(c, today) })).sort((x, y) => ['red', 'yellow', 'green'].indexOf(x.h.level) - ['red', 'yellow', 'green'].indexOf(y.h.level) || x.c.decision.localeCompare(y.c.decision));
    steps.push({ text: `Rated ${rated.length} renewals: ${rated.filter((r) => r.h.level === 'red').length} red, ${rated.filter((r) => r.h.level === 'yellow').length} yellow, ${rated.filter((r) => r.h.level === 'green').length} green.` });
    const firstRed = rated.find((r) => r.h.level === 'red');
    if (!has('sub4me')) steps.push({ text: 'Without Sub4Me the ticket situation is missing; the rating uses contract data only.' });
    steps.push({ text: 'Tried to open the Finance Space to check overdue invoices: refused, it is not one of the agent\'s sources.', blocked: true }); blocked.push('the Finance Space');
    const table = { head: ['Customer', 'Product', 'Annual value', 'Decision', 'Why'], rows: rated.map(({ c, h }) => ({ level: h.level, cells: [c.customer, c.product, eur(c.eur), c.decision, h.why] })) };
    const atRisk = rated.filter((r) => r.h.level === 'red').reduce((s, r) => s + r.c.eur, 0);
    const mail = firstRed ? `To: ${firstRed.c.owner}\nSubject: ${firstRed.c.customer}: ${firstRed.c.product} needs a decision\n\nHello ${firstRed.c.owner.split(' ')[0]},\n\n${firstRed.c.product} (${eur(firstRed.c.eur)} per year) is red: ${firstRed.h.why}. ${firstRed.c.next ? `Open step: ${firstRed.c.next}.` : 'There is no open offer yet.'} Please confirm the next step this week.\n\n(Draft by the agent "${a.name}". Not sent.)` : undefined;
    steps.push({ text: 'Wrote a draft e-mail for the most urgent red renewal. Nothing was sent.' });
    return { steps, title: `${rated.filter((r) => r.h.level === 'red').length} red renewals, ${eur(atRisk)} at risk`, table, lines: [`Source for contract data: ${label(catalog, has('renewals')!)}; today is ${today}.`], mail, sources: used, blocked };
  }

  if (a.template === 'cost-watch') {
    const ok = read('control-tower', 'the AI Control Tower', 'Read the monthly spend: 16.37 M EUR actual, ceiling 21.5 M EUR, token API 15.12 M EUR.');
    read('what-if', 'the What-if Simulator', 'Read the four levers and their savings.');
    if (!ok && !has('ai-control')) return { steps, title: 'No result', lines: ['The agent needs the AI Control Tower as a source to compare spend and ceiling.'], sources: used, blocked };
    steps.push({ text: 'Utilisation of the ceiling: 76 percent. Two teams are over their allocation.' });
    steps.push({ text: 'Tried to read the HR Space for team sizes: refused, it is not one of the agent\'s sources.', blocked: true }); blocked.push('the HR Space');
    return { steps, title: 'Headroom 5.1 M EUR, two teams over budget', sources: used, blocked,
      lines: ['Result: the spend is 16.37 M EUR of 21.5 M EUR (76 percent). Headroom 5.13 M EUR. No action is urgent.', 'Reason: token API is 15.12 M EUR (92 percent of the spend). Engineering and Finance are over their allocation.', 'Decision needed: approve two levers before the next month: model routing (saves 1.1 M EUR) and hard limits for teams over budget (saves 0.8 M EUR).'] };
  }

  if (a.template === 'preclose-check') {
    const ok = read('preclose', 'the Finance Pre-Close Space', 'Read the pre-close of October 2026 at working day 17: 30 open items (3.56 M EUR), 6 anomalies, 7 accrual proposals (646 thousand EUR). Mockup data in the shape of an S/4HANA extract.');
    const db = read('databricks', 'Databricks', 'Databricks (read only): in this prototype the same figures come from the demo data; with a SQL warehouse the connector would run the same read-only query on the finance tables.');
    if (!ok && !db) return { steps, title: 'No result', lines: ['The agent has no finance data. Tick the Finance Pre-Close Space (demo data) or the Databricks connector as a source.'], sources: used, blocked };
    steps.push({ text: 'Rated the findings: 3 red anomalies (1.26 M EUR), 3 yellow, largest open item OI-005 (880 thousand EUR).' });
    steps.push({ text: 'Tried to post the accrual proposals: refused, the agent is read only. A person approves every accrual.', blocked: true }); blocked.push('posting accruals');
    const table = { head: ['Finding', 'Entity', 'Amount', 'Next step'], rows: [
      { level: 'red' as const, cells: ['OI-001 Intercompany difference (royalty cut-off)', 'DE10 / US10', '412 thousand EUR', 'Post the cut-off correction in US10 and confirm with the controller (Karl Heim)'] },
      { level: 'red' as const, cells: ['OI-005 Largest open item', 'see Space', '880 thousand EUR', 'Owner to clear or justify before the close call'] },
      { level: 'red' as const, cells: ['Cloud hosting 38 % above the 3-month average', 'UK10', '75 thousand EUR', 'Ask the provider manager for the usage breakdown'] },
      { level: 'yellow' as const, cells: ['Possible duplicate vendor invoice', 'DE10', '64 thousand EUR', 'Block the second invoice for payment'] },
      { level: 'green' as const, cells: ['Accrual proposals: 7, 5 with high confidence', 'all', '646 thousand EUR', 'Approve in the Space; a person posts'] },
    ] };
    return { steps, title: '3 red findings, 30 open items worth 3.56 M EUR', table, sources: used, blocked,
      lines: ['Source: Finance Pre-Close Space, working day 17 of October 2026 (mockup data). Nothing was posted or changed.', 'For the briefing to the controller use the Space (Joule writes the daily briefing from the same figures).'] };
  }

  if (a.template === 'prd-writer') {
    const ok = read('jira', 'Jira', 'Read the backlog of the project: 4 epics and 14 stories with priority and acceptance criteria (sample project).');
    read('prd-builder', 'the PRD Builder Space', 'Used the PRD structure of the PRD Builder: overview, goals, users, requirements, out of scope, open questions, sources.');
    if (!ok) return { steps, title: 'No result', lines: ['The agent cannot read requirements without Jira as a source. Tick the Jira connector.'], sources: used, blocked };
    steps.push({ text: 'Tried to create a comment in Jira with the PRD link: refused, the agent is read only.', blocked: true }); blocked.push('writing to Jira');
    return { steps, title: 'PRD draft: 14 requirements in 4 epics', sources: used, blocked,
      lines: ['Overview and goals taken from the four epics; users: seller (11 stories) and sales manager (3 stories).', 'Every requirement carries its ticket key and its three acceptance criteria.', 'Open questions: none found from the tickets alone. Use the PRD Builder to tick the stories that belong in the first release.'] };
  }

  /* any other agent: list the sources and what would happen */
  for (const id of a.sources) { steps.push({ text: `Would read ${label(catalog, id)}.`, source: label(catalog, id) }); used.push(label(catalog, id)); }
  steps.push({ text: 'There is no sample data for a custom agent. Use “Run in chat” to run it for real with the ticked sources.' });
  return { steps, title: 'Setup checked', lines: [`The agent may read: ${used.join(', ') || 'nothing'}. Everything else is blocked.`], sources: used, blocked };
}

/* ---- Scheduler: published agents with a trigger run through the app's schedules ---- */
export const AGENT_SCHEDULE_PREFIX = 'agent-';
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The schedule list with one entry per published agent that has a trigger. The entry only says "/agent <id>": the
 * brief is built when it runs, so a changed instruction or source list applies at once and an unpublished agent stops.
 */
export function agentSchedules(agents: StudioAgent[], levelOf: (id: string) => number, existing: Schedule[]): Schedule[] {
  const others = existing.filter((s) => !s.id.startsWith(AGENT_SCHEDULE_PREFIX));
  const own: Schedule[] = [];
  for (const a of agents) {
    if (a.trigger.type === 'manual' || levelOf(a.id) < 1) continue;
    const id = `${AGENT_SCHEDULE_PREFIX}${a.id}`.slice(0, 40);
    const old = existing.find((s) => s.id === id);
    own.push({ id, prompt: `/agent ${a.id}`, time: a.trigger.time, repeat: a.trigger.type === 'daily' ? 'daily' : 'weekly', days: a.trigger.type === 'daily' ? [] : [1], enabled: old?.enabled !== false, ...(old?.lastRun ? { lastRun: old.lastRun } : {}) });
  }
  const next = [...others, ...own];
  return sameJson(next, existing) ? existing : next;
}

/** "/agent <id>" typed or scheduled: the brief, or why it does not run. */
export function expandAgentCommand(text: string, agents: StudioAgent[], catalog: Source[], levelOf: (id: string) => number): { prompt: string } | { error: string } | null {
  const m = /^\/agent\s+(a-[a-z0-9]+)\b([\s\S]*)$/i.exec(text.trim());
  if (!m) return null;
  const a = agents.find((x) => x.id === m[1]);
  if (!a) return { error: 'This agent no longer exists.' };
  if (levelOf(a.id) < 1) return { error: `"${a.name}" is not published (approved) yet, so it does not run on a schedule.` };
  return { prompt: agentPrompt(a, catalog) };
}

/* ---- Registry: every agent from the Studio is registered as a process in the AI Control Tower ---- */
export type RegistryEntry = {
  id: string; name: string; purpose: string; lifecycle: 'production' | 'pending_review' | 'draft'; level: string; owner: string;
  sources: string[]; rights: string; trigger: string; steps: number; output: string; lastTest: string; lastRun: string; approval: string;
};
export function registryEntries(agents: StudioAgent[], catalog: Source[], levelOf: (id: string) => number, levelNames: string[], pendingTo: (id: string) => number | null, schedules: Schedule[], owner: string): RegistryEntry[] {
  return agents.slice(0, MAX_AGENTS).map((a, i) => {
    const lvl = levelOf(a.id), req = pendingTo(a.id);
    const trigger = a.trigger.type === 'manual' ? 'On demand' : a.trigger.type === 'daily' ? `Every day at ${a.trigger.time}` : `Every Monday at ${a.trigger.time}`;
    const run = schedules.find((s) => s.id === `${AGENT_SCHEDULE_PREFIX}${a.id}`.slice(0, 40))?.lastRun ?? '';
    return {
      id: `AGT-S-${String(i + 1).padStart(3, '0')}`, name: a.name, purpose: a.purpose, owner: owner || 'You',
      lifecycle: lvl > 0 ? 'production' : a.tested || req ? 'pending_review' : 'draft',
      level: levelNames[lvl] ?? 'Personal',
      sources: a.sources.map((id) => catalog.find((s) => s.id === id)?.label ?? id),
      rights: a.canWrite ? (a.askBeforeWrite ? 'Proposes changes, asks before each write' : 'Writes') : 'Read only',
      trigger: lvl > 0 || a.trigger.type === 'manual' ? trigger : `${trigger} (starts after approval)`,
      steps: a.maxSteps, output: OUTPUTS.find((o) => o.id === a.output)?.label ?? 'Summary',
      lastTest: a.testedAt ? new Date(a.testedAt).toISOString() : '', lastRun: run,
      approval: lvl > 0 ? `Approved for ${levelNames[lvl]}` : req ? `Waiting: ${levelNames[req]}` : 'Not requested',
    };
  });
}
