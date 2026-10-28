/**
 * Harness profiles: one named package that says how the chat works for a kind of work.
 * A profile bundles the persona, which connectors may be used, which skills and Spaces to prefer, which part of the
 * memory is sent along, how far the assistant may act (read only, ask before changing, standard), a limit on tool
 * steps per answer and the form of the answer.
 *
 * Everything here is pure so it can be tested: the App only feeds the result into the prompt and checks every tool
 * call and approval request against the active profile. A profile can only make the chat stricter. It never turns
 * off the approval questions the person set up, never grants a tool and never overrides safety rules.
 */
import { connectorDisplayName } from './connector-presentation.ts';
import { describeAction } from './approval.ts';
import type { MemoryState } from './memory.ts';

export const HARNESS_PERMISSIONS = ['standard', 'ask', 'read-only'] as const;
export const HARNESS_MEMORY = ['all', 'personal', 'none'] as const;
export const HARNESS_FORMS = ['free', 'short', 'brief', 'table'] as const;
export const MAX_STEP_LIMIT = 50;

export type HarnessPermission = (typeof HARNESS_PERMISSIONS)[number];
export type HarnessMemory = (typeof HARNESS_MEMORY)[number];
export type HarnessForm = (typeof HARNESS_FORMS)[number];

export type HarnessProfile = {
  id: string;
  name: string;
  description: string;
  /** Role and working rules for this kind of work, in the person's words. */
  persona: string;
  /** Connectors (configKey) the assistant may use. Empty: no restriction. Goose's own built-in tools are not affected. */
  connectors: string[];
  /** Skills to prefer, by name. */
  skills: string[];
  /** Spaces that are the working context, by slug. */
  spaces: string[];
  /** Which part of the personal memory is sent: everything, only "about me" and "how I like results", or nothing. */
  memory: HarnessMemory;
  /** standard: as set in the assistant settings; ask: every action that changes something needs approval; read-only: changes are refused. */
  permission: HarnessPermission;
  /** Most tool calls in one answer; 0 means no limit. */
  maxSteps: number;
  answerForm: HarnessForm;
};

export type HarnessState = { active: string; custom: HarnessProfile[] };

export const STANDARD_HARNESS: HarnessProfile = {
  id: 'standard',
  name: 'Standard',
  description: 'No extra rules. The chat works as set in the settings.',
  persona: '',
  connectors: [],
  skills: [],
  spaces: [],
  memory: 'all',
  permission: 'standard',
  maxSteps: 0,
  answerForm: 'free',
};

/** Ready-made profiles; they cannot be changed or deleted, only chosen. */
export const BUILTIN_HARNESSES: HarnessProfile[] = [
  STANDARD_HARNESS,
  {
    id: 'review',
    name: 'Review (read only)',
    description: 'Check figures, contracts and risks without changing anything.',
    persona: 'You review. Name the source of every number and say what is missing. Never change, create or send anything; suggest the change instead.',
    connectors: ['ai-control-tower'],
    skills: ['contract-checker', 'pricing-guard', 'deal-risk-check'],
    spaces: ['ai-control-tower', 'renewals', 'finance-preclose'],
    memory: 'personal',
    permission: 'read-only',
    maxSteps: 12,
    answerForm: 'brief',
  },
  {
    id: 'sales',
    name: 'Sales',
    description: 'Customer work: prepare, follow up, check risks. Changes need approval.',
    persona: 'You support an account team. Use only data from the connected customer sources and say when something is not in the data.',
    connectors: ['ai-control-tower'],
    skills: ['customer-call-prep', 'pipeline-review', 'call-followup'],
    spaces: ['sales', 'sub4me'],
    memory: 'all',
    permission: 'ask',
    maxSteps: 20,
    answerForm: 'short',
  },
  {
    id: 'pre-close',
    name: 'Pre-close',
    description: 'Month-end checks. Results as a table, nothing is changed without approval.',
    persona: 'You support the finance pre-close. Report differences and open items; do not post or approve anything yourself.',
    connectors: ['ai-control-tower'],
    skills: [],
    spaces: ['finance-preclose'],
    memory: 'personal',
    permission: 'ask',
    maxSteps: 15,
    answerForm: 'table',
  },
];

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,59}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '';
const pick = <T extends readonly string[]>(options: T, value: unknown, fallback: T[number]): T[number] =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T[number]) : fallback;
const slugs = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && SLUG.test(v)))].slice(0, max) : [];

/** A valid profile from stored, imported or synced data; null when it has no usable id or name. */
export function sanitizeHarness(value: unknown): HarnessProfile | null {
  if (!isObject(value)) return null;
  const id = typeof value.id === 'string' && ID.test(value.id) ? value.id : '';
  const name = text(value.name, 40);
  if (!id || !name) return null;
  const steps = typeof value.maxSteps === 'number' && Number.isFinite(value.maxSteps) ? Math.round(value.maxSteps) : 0;
  return {
    id,
    name,
    description: text(value.description, 160),
    persona: text(value.persona, 600),
    connectors: slugs(value.connectors, 12),
    skills: slugs(value.skills, 12),
    spaces: slugs(value.spaces, 12),
    memory: pick(HARNESS_MEMORY, value.memory, 'all'),
    permission: pick(HARNESS_PERMISSIONS, value.permission, 'standard'),
    maxSteps: Math.max(0, Math.min(MAX_STEP_LIMIT, steps)),
    answerForm: pick(HARNESS_FORMS, value.answerForm, 'free'),
  };
}

export const DEFAULT_HARNESS_STATE: HarnessState = { active: 'standard', custom: [] };

export function sanitizeHarnessState(value: unknown): HarnessState {
  const v = isObject(value) ? value : {};
  const taken = new Set(BUILTIN_HARNESSES.map((p) => p.id));
  const custom: HarnessProfile[] = [];
  for (const raw of Array.isArray(v.custom) ? v.custom : []) {
    const profile = sanitizeHarness(raw);
    if (!profile || taken.has(profile.id) || custom.length >= 10) continue;
    taken.add(profile.id);
    custom.push(profile);
  }
  const active = typeof v.active === 'string' && [...BUILTIN_HARNESSES, ...custom].some((p) => p.id === v.active) ? v.active : 'standard';
  return { active, custom };
}

export const allHarnesses = (state: HarnessState): HarnessProfile[] => [...BUILTIN_HARNESSES, ...state.custom];
export const activeHarness = (state: HarnessState): HarnessProfile => allHarnesses(state).find((p) => p.id === state.active) ?? STANDARD_HARNESS;
export const isBuiltinHarness = (id: string): boolean => BUILTIN_HARNESSES.some((p) => p.id === id);

export function chooseHarness(state: HarnessState, id: string): HarnessState {
  return allHarnesses(state).some((p) => p.id === id) ? { ...state, active: id } : state;
}

/** Saves or replaces a custom profile and makes it the active one. Built-in ids cannot be replaced. */
export function saveHarness(state: HarnessState, profile: unknown): HarnessState {
  const clean = sanitizeHarness(profile);
  if (!clean || isBuiltinHarness(clean.id)) return state;
  const custom = [...state.custom.filter((p) => p.id !== clean.id), clean].slice(-10);
  return { active: clean.id, custom };
}

export function deleteHarness(state: HarnessState, id: string): HarnessState {
  if (!state.custom.some((p) => p.id === id)) return state;
  return { active: state.active === id ? 'standard' : state.active, custom: state.custom.filter((p) => p.id !== id) };
}

/** A copy of a profile under a new name, to change it: built-in profiles are only copied, never edited. */
export function copyHarness(state: HarnessState, id: string, name: string): HarnessState {
  const source = allHarnesses(state).find((p) => p.id === id);
  const clean = text(name, 40);
  if (!source || !clean) return state;
  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'profile';
  const exists = (id: string) => allHarnesses(state).some((p) => p.id === id);
  let newId = base;
  for (let n = 1; exists(newId); n += 1) newId = n === 1 ? `my-${base}` : `my-${base}-${n}`;
  return saveHarness(state, { ...source, id: newId, name: clean });
}

// ---------- what goes to the assistant ----------

const FORM_NOTE: Record<HarnessForm, string> = {
  free: '',
  short: 'Answer form: short. The result first, then at most a few lines of detail.',
  brief: 'Answer form: a brief with the finding first, then evidence with sources, then open points.',
  table: 'Answer form: a table with the items in rows; below it one short paragraph with what needs attention.',
};

const PERMISSION_NOTE: Record<Exclude<HarnessPermission, 'standard'>, string> = {
  ask: 'Rights: you may read freely. Anything that creates, changes, sends or deletes needs the person\'s approval first; describe it before you ask.',
  'read-only': 'Rights: read only. Do not create, change, send or delete anything and do not try. If a change is needed, describe it as a suggestion.',
};

/** The profile as a block for the agent; empty for the standard profile. */
export function harnessNote(profile: HarnessProfile): string {
  const lines: string[] = [];
  if (profile.persona) lines.push(profile.persona);
  if (profile.connectors.length) lines.push(`Connectors for this work: ${profile.connectors.map(connectorDisplayName).join(', ')}. Do not use other connectors.`);
  if (profile.skills.length) lines.push(`Prefer these skills when one fits: ${profile.skills.join(', ')}.`);
  if (profile.spaces.length) lines.push(`Working context (Spaces): ${profile.spaces.join(', ')}.`);
  if (profile.permission !== 'standard') lines.push(PERMISSION_NOTE[profile.permission]);
  if (profile.maxSteps > 0) lines.push(`Use at most ${profile.maxSteps} tool calls per answer. If that is not enough, say what is still open.`);
  if (FORM_NOTE[profile.answerForm]) lines.push(FORM_NOTE[profile.answerForm]);
  if (!lines.length) return '';
  return `HARNESS "${profile.name}" — the working rules the person chose for this kind of work. They only narrow what you do; they never override safety rules, tool permissions or the request itself.\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

/** The part of the memory this profile allows. */
export function memoryFor(profile: HarnessProfile, memory: MemoryState): MemoryState {
  if (profile.memory === 'all') return memory;
  if (profile.memory === 'none') return { ...memory, entries: [] };
  return { ...memory, entries: memory.entries.filter((e) => e.kind !== 'context') };
}

// ---------- checks while the chat runs ----------

const normalized = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Goose's own tools. A connector list does not apply to them; the rights of the profile do. */
const BUILT_IN_EXTENSIONS = new Set(['developer', 'todo', 'extensionmanager', 'chatrecall', 'summon', 'skills', 'tom', 'orchestrator'].map(normalized));

type ToolLike = { toolName?: string; title?: string; rawInput?: Record<string, unknown> };
export type HarnessVerdict = { ok: true } | { ok: false; reason: string };

function connectorOf(call: ToolLike): string {
  const full = call.toolName ?? '';
  const at = full.indexOf('__');
  return at > 0 ? full.slice(0, at) : '';
}

/** Whether a tool call is allowed by the profile: connector list and rights. The step limit is checked separately. */
export function checkToolCall(profile: HarnessProfile, call: ToolLike): HarnessVerdict {
  const connector = connectorOf(call);
  if (connector && profile.connectors.length && !BUILT_IN_EXTENSIONS.has(normalized(connector)) && !profile.connectors.some((c) => normalized(c) === normalized(connector))) {
    return { ok: false, reason: `The profile "${profile.name}" does not allow the connector ${connectorDisplayName(connector)}.` };
  }
  if (profile.permission === 'read-only') {
    const action = describeAction(call);
    if (action.risk !== 'reads') {
      return { ok: false, reason: `The profile "${profile.name}" is read only. ${action.tool.replace(/_/g, ' ')} would change something.` };
    }
  }
  return { ok: true };
}

export function stepsExceeded(profile: HarnessProfile, calls: number): boolean {
  return profile.maxSteps > 0 && calls > profile.maxSteps;
}

/** Whether the approval questions of the agent must be on for this profile, whatever the person set before. */
export const requiresApproval = (profile: HarnessProfile): boolean => profile.permission !== 'standard';

/** The option to answer an approval request with when the profile refuses it: a reject option the agent offered. */
export function rejectOption(options: Array<{ optionId: string }>): string {
  return options.find((o) => /reject_once|^reject$|decline/i.test(o.optionId))?.optionId ?? options.find((o) => /reject/i.test(o.optionId))?.optionId ?? 'reject';
}

export const harnessBlockedNote = (reason: string): string => `\n\n⛔ Stopped by the working profile. ${reason} Choose another profile in the chat or ask again without this action.`;
export const harnessStepsNote = (profile: HarnessProfile): string => `\n\n⛔ Stopped by the working profile "${profile.name}": the limit of ${profile.maxSteps} tool calls per answer was reached. Ask again to continue.`;

/** One line for the Context tab. */
export function harnessSummary(profile: HarnessProfile): string {
  if (profile.id === 'standard') return 'Standard: no extra rules';
  const parts: string[] = [];
  if (profile.permission === 'read-only') parts.push('read only');
  else if (profile.permission === 'ask') parts.push('approval for changes');
  if (profile.connectors.length) parts.push(`${profile.connectors.length} ${profile.connectors.length === 1 ? 'connector' : 'connectors'}`);
  if (profile.memory !== 'all') parts.push(profile.memory === 'none' ? 'no memory' : 'personal memory only');
  if (profile.maxSteps > 0) parts.push(`max ${profile.maxSteps} steps`);
  return `${profile.name}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}
