/**
 * Policy manifest (stage 1 of a governance layer under the Werkbank): what an agent or workflow is allowed to do, written down
 * as data and stored with every revision of the registry item (file `policy.json`). Nothing here enforces anything. It makes the
 * business side of governance (what was declared, who may change it, what widened between revisions) readable and comparable,
 * and it is the input a later execution layer (a sandbox with network and file rules) would translate.
 *
 * The manifest is derived from what a project already declares: an agent answers rights, sources, volume, sensitivity and
 * trigger; a workflow answers systems, guardrail and trigger. So there is nothing extra to type and the manifest cannot drift
 * away from the project. What the forms do not ask (exact tool allow-list, network targets) stays `null` = "not declared", and
 * `policyGaps` says so; the manifest never invents a limit.
 */
import { VOLUME, type AgentProject, type Sensitivity } from './agent-project.ts';
import { GUARDRAILS, TRIGGERS, type Project } from './develop.ts';

export const POLICY_FORMAT = 'werkbank.policy.v1';
export const POLICY_FILE = 'policy.json';

/** How far an item may go: look things up, prepare drafts, act after a person approves, act on its own. Ordered, wider = higher. */
export type Mode = 'read-only' | 'draft' | 'act-after-approval' | 'autonomous';
export const MODES: Mode[] = ['read-only', 'draft', 'act-after-approval', 'autonomous'];
export const MODE_LABEL: Record<Mode, string> = { 'read-only': 'Read only', draft: 'Draft only', 'act-after-approval': 'Acts after approval', autonomous: 'Acts on its own' };

export type SystemRule = { id: string; label: string; access: 'read' | 'write' };
export type Trigger = 'manual' | 'schedule' | 'event' | 'chained';
export type DataClass = Sensitivity | 'unspecified';
const DATA_CLASSES: DataClass[] = ['public', 'internal', 'confidential', 'personal', 'unspecified'];
const TRIGGER_LIST: Trigger[] = ['manual', 'schedule', 'event', 'chained'];

export type PolicyManifest = {
  format: typeof POLICY_FORMAT;
  mode: Mode;
  /** A person stands between a proposal and a change. False only for items that act on their own. */
  humanApproval: boolean;
  systems: SystemRule[];
  /** Exact tool allow-list. null = not declared (the forms do not ask for it yet). */
  tools: string[] | null;
  /** Network targets the item may reach. null = not declared. */
  egressHosts: string[] | null;
  limits: { maxSteps: number | null };
  data: DataClass;
  run: { trigger: Trigger; unattended: boolean };
  owner: string;
};

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'system';

// ---------- derive from a project ----------

/** An agent: `read` rights = read only; `propose` = it prepares, a person approves (the Studio always asks before a write). */
export function deriveAgentPolicy(p: AgentProject): PolicyManifest {
  const a = p.answers;
  const mode: Mode = a.rights === 'propose' ? 'draft' : 'read-only';
  const systems: SystemRule[] = a.sources.map((id) => ({ id: clip(id, 60), label: clip(id, 60), access: 'read' }));
  if (a.otherSystems.trim()) systems.push({ id: slug(a.otherSystems), label: clip(a.otherSystems, 80), access: 'read' });
  const trigger: Trigger = a.trigger === 'manual' ? 'manual' : 'schedule';
  return {
    format: POLICY_FORMAT, mode, humanApproval: true, systems, tools: null, egressHosts: null,
    limits: { maxSteps: (VOLUME.find((v) => v.id === a.volume) ?? VOLUME[0]).steps },
    data: a.sensitivity, run: { trigger, unattended: trigger !== 'manual' }, owner: clip(a.owner, 80),
  };
}

const guardrailMode = (text: string): Mode => {
  const i = (GUARDRAILS as readonly string[]).indexOf(text);
  // An unrecognised guardrail text cannot be read as a limit; it falls back to the form default (draft only).
  return i < 0 ? 'draft' : MODES[i];
};

const triggerOf = (text: string): Trigger => {
  const i = (TRIGGERS as readonly string[]).indexOf(text);
  return i === 1 ? 'schedule' : i === 2 ? 'event' : i === 3 ? 'chained' : 'manual';
};

/** A workflow: the chosen guardrail is the mode; systems it names get write access only when the mode lets it change things. */
export function deriveWorkflowPolicy(p: Project): PolicyManifest {
  const mode = guardrailMode(p.intent.guardrail);
  const writes = mode === 'act-after-approval' || mode === 'autonomous';
  const names = [...p.intent.systems, ...(p.intent.otherSystems.trim() ? [p.intent.otherSystems] : [])];
  const systems: SystemRule[] = names.map((n) => ({ id: slug(n), label: clip(n, 80), access: writes ? 'write' : 'read' }));
  const trigger = triggerOf(p.intent.trigger);
  return {
    format: POLICY_FORMAT, mode, humanApproval: mode !== 'autonomous', systems, tools: null, egressHosts: null,
    limits: { maxSteps: null }, data: 'unspecified', run: { trigger, unattended: trigger !== 'manual' }, owner: '',
  };
}

// ---------- read and write the file ----------

/** Tolerant reader: anything unknown falls back to the narrowest value, never to a wider one. */
export function sanitizePolicy(v: unknown): PolicyManifest | null {
  const d = v as any;
  if (!d || d.format !== POLICY_FORMAT) return null;
  const strings = (x: unknown, n: number): string[] | null => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').map((s) => clip(s, 120)).filter(Boolean).slice(0, n) : null);
  const steps = Number(d.limits?.maxSteps);
  const trigger: Trigger = TRIGGER_LIST.includes(d.run?.trigger) ? d.run.trigger : 'manual';
  return {
    format: POLICY_FORMAT,
    mode: MODES.includes(d.mode) ? d.mode : 'read-only',
    humanApproval: d.humanApproval !== false,
    systems: (Array.isArray(d.systems) ? d.systems : []).slice(0, 60).filter((s: any) => s && typeof s.id === 'string').map((s: any): SystemRule => ({ id: clip(s.id, 60), label: clip(s.label ?? s.id, 80), access: s.access === 'write' ? 'write' : 'read' })),
    tools: strings(d.tools, 200), egressHosts: strings(d.egressHosts, 60),
    limits: { maxSteps: Number.isFinite(steps) && steps > 0 ? Math.floor(steps) : null },
    data: DATA_CLASSES.includes(d.data) ? d.data : 'unspecified',
    run: { trigger, unattended: d.run?.unattended === true },
    owner: clip(d.owner, 80),
  };
}

export const policyFile = (m: PolicyManifest) => ({ path: POLICY_FILE, language: 'json', content: JSON.stringify(m) });

/** The manifest inside the files of a revision, or null for a revision saved before manifests existed. */
export function policyOf(files: Array<{ path: string; content?: string }>): PolicyManifest | null {
  const text = files.find((f) => f.path === POLICY_FILE)?.content;
  if (!text) return null;
  try { return sanitizePolicy(JSON.parse(text)); } catch { return null; }
}

/** What the manifest does not say yet. Shown as such: an undeclared limit is not a limit. */
export function policyGaps(m: PolicyManifest): string[] {
  const gaps: string[] = [];
  if (m.tools === null) gaps.push('tool allow-list');
  if (m.egressHosts === null) gaps.push('network targets');
  if (m.limits.maxSteps === null) gaps.push('step limit');
  if (m.data === 'unspecified') gaps.push('data sensitivity');
  if (!m.owner) gaps.push('owner');
  return gaps;
}

/** Small summary stored in the intent of the work item, so the list can show it without opening files. */
export function policySummary(m: PolicyManifest): Record<string, unknown> {
  return { mode: m.mode, systems: m.systems.length, writes: m.systems.some((s) => s.access === 'write'), unattended: m.run.unattended, gaps: policyGaps(m).length };
}

// ---------- differences between two manifests ----------

export type Direction = 'wider' | 'narrower' | 'neutral';
export type PolicyChange = { field: string; label: string; from: string; to: string; direction: Direction };

const yn = (b: boolean) => (b ? 'yes' : 'no');
const list = (l: string[] | null) => (l === null ? 'not declared' : l.length ? l.join(', ') : 'none');

function setChange(field: string, label: string, a: string[] | null, b: string[] | null): PolicyChange[] {
  if (a === null && b === null) return [];
  // Declaring a list where there was none narrows the item; dropping the list widens it back to "anything".
  if (a === null) return [{ field, label, from: list(a), to: list(b), direction: 'narrower' }];
  if (b === null) return [{ field, label, from: list(a), to: list(b), direction: 'wider' }];
  const added = b.filter((x) => !a.includes(x)), removed = a.filter((x) => !b.includes(x));
  const out: PolicyChange[] = [];
  if (added.length) out.push({ field, label, from: list(a), to: list(b), direction: 'wider' });
  else if (removed.length) out.push({ field, label, from: list(a), to: list(b), direction: 'narrower' });
  return out;
}

/** Every difference in what the item may do, marked as wider, narrower or neutral. Order follows the manifest. */
export function diffPolicy(a: PolicyManifest, b: PolicyManifest): PolicyChange[] {
  const out: PolicyChange[] = [];
  if (a.mode !== b.mode) out.push({ field: 'mode', label: 'How far it may go', from: MODE_LABEL[a.mode], to: MODE_LABEL[b.mode], direction: MODES.indexOf(b.mode) > MODES.indexOf(a.mode) ? 'wider' : 'narrower' });
  if (a.humanApproval !== b.humanApproval) out.push({ field: 'humanApproval', label: 'A person approves changes', from: yn(a.humanApproval), to: yn(b.humanApproval), direction: b.humanApproval ? 'narrower' : 'wider' });
  const before = new Map(a.systems.map((s) => [s.id, s])), after = new Map(b.systems.map((s) => [s.id, s]));
  for (const [id, s] of after) {
    const o = before.get(id);
    if (!o) out.push({ field: `system:${id}`, label: `System ${s.label}`, from: 'no access', to: s.access, direction: 'wider' });
    else if (o.access !== s.access) out.push({ field: `system:${id}`, label: `System ${s.label}`, from: o.access, to: s.access, direction: s.access === 'write' ? 'wider' : 'narrower' });
  }
  for (const [id, s] of before) if (!after.has(id)) out.push({ field: `system:${id}`, label: `System ${s.label}`, from: s.access, to: 'no access', direction: 'narrower' });
  out.push(...setChange('tools', 'Allowed tools', a.tools, b.tools), ...setChange('egressHosts', 'Network targets', a.egressHosts, b.egressHosts));
  const x = a.limits.maxSteps, y = b.limits.maxSteps;
  if (x !== y) out.push({ field: 'maxSteps', label: 'Step limit', from: x === null ? 'none' : String(x), to: y === null ? 'none' : String(y), direction: y === null || (x !== null && y > x) ? 'wider' : 'narrower' });
  if (a.data !== b.data) out.push({ field: 'data', label: 'Data sensitivity', from: a.data, to: b.data, direction: 'neutral' });
  if (a.run.trigger !== b.run.trigger) out.push({ field: 'trigger', label: 'Started by', from: a.run.trigger, to: b.run.trigger, direction: 'neutral' });
  if (a.run.unattended !== b.run.unattended) out.push({ field: 'unattended', label: 'Runs without a person present', from: yn(a.run.unattended), to: yn(b.run.unattended), direction: b.run.unattended ? 'wider' : 'narrower' });
  if (a.owner !== b.owner) out.push({ field: 'owner', label: 'Owner', from: a.owner || 'none', to: b.owner || 'none', direction: 'neutral' });
  return out;
}

export type RevisionPolicy = { policy: PolicyManifest | null; changes: PolicyChange[]; note: string };

/**
 * The manifest of a revision and what changed against the revision before it. A revision without a manifest (saved before
 * manifests existed) shows no changes and says why; it is never read as "nothing allowed" or "everything allowed".
 */
export function revisionPolicy(before: Array<{ path: string; content?: string }>, now: Array<{ path: string; content?: string }>): RevisionPolicy {
  const b = policyOf(before), n = policyOf(now);
  if (!n) return { policy: null, changes: [], note: 'This revision has no policy manifest (it was saved before manifests existed).' };
  if (!b) return { policy: n, changes: [], note: before.length ? 'The revision before has no policy manifest, so there is nothing to compare.' : '' };
  return { policy: n, changes: diffPolicy(b, n), note: '' };
}

/** True when any change gives the item more room. A review should look at these first. */
export const widens = (changes: PolicyChange[]) => changes.some((c) => c.direction === 'wider');
