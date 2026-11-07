/**
 * Register card: the profile of a registry item, modelled on what an enterprise architecture inventory (SAP LeanIX, AI Agent Hub)
 * keeps for an application or an AI agent: who is responsible, where it stands in its life, how critical it is, whether anybody
 * has verified it, what it connects to, and what it costs and returns. See docs/registry-leanix.md for what was confirmed in the
 * LeanIX documentation and what is our own addition.
 *
 * The card is data and nothing else: it enforces nothing. Like the policy manifest, a field that nobody declared stays empty
 * ("not declared") and is never filled with a guess; flags only say "look at this", they do not block anything.
 *
 * Where it lives: `intent.register` of the work item (read here). Nothing in the app writes it yet, so items built in the
 * Werkbank show what can be derived (owner, step, rights from the policy summary) and the rest as not declared; the example
 * register (registry-examples.ts) shows the full card.
 */
import { MODES, type Mode } from './policy-manifest.ts';

// ---------- vocabularies ----------

/** LeanIX lifecycle phases of a fact sheet. */
export const PHASES = ['plan', 'phase-in', 'active', 'phase-out', 'end-of-life'] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABEL: Record<Phase, string> = { plan: 'Plan', 'phase-in': 'Phase in', active: 'Active', 'phase-out': 'Phase out', 'end-of-life': 'End of life' };

/** LeanIX business criticality, four levels. */
export const CRITICALITY = ['administrative', 'operational', 'critical', 'mission-critical'] as const;
export type Criticality = (typeof CRITICALITY)[number];
export const CRITICALITY_LABEL: Record<Criticality, string> = { administrative: 'Administrative', operational: 'Business operational', critical: 'Business critical', 'mission-critical': 'Mission critical' };

/** Has a person confirmed that this entry is right and still in use (the idea of a LeanIX quality seal / verification record). */
export const VERIFICATION = ['verified', 'unverified', 'expired', 'broken'] as const;
export type Verification = (typeof VERIFICATION)[number];
export const VERIFICATION_LABEL: Record<Verification, string> = { verified: 'Verified', unverified: 'Not verified', expired: 'Review overdue', broken: 'Changed since verified' };

/** Our own addition: where the EU AI Act would place the use. A self-assessment, not a legal opinion. */
export const RISK = ['minimal', 'limited', 'high', 'not-assessed'] as const;
export type RiskClass = (typeof RISK)[number];
export const RISK_LABEL: Record<RiskClass, string> = { minimal: 'Minimal risk', limited: 'Limited risk', high: 'High risk', 'not-assessed': 'Not assessed' };

export const DISCOVERY = ['built', 'imported', 'discovered'] as const;
export type Discovery = (typeof DISCOVERY)[number];
export const DISCOVERY_LABEL: Record<Discovery, string> = { built: 'Built in the Werkbank', imported: 'Imported', discovered: 'Discovered on a platform' };

export const REL_KINDS = ['capability', 'process', 'system', 'data', 'model', 'mcp', 'item'] as const;
export type RelKind = (typeof REL_KINDS)[number];
export const REL_LABEL: Record<RelKind, string> = {
  capability: 'Business capabilities', process: 'Business processes', system: 'Systems', data: 'Data', model: 'Models', mcp: 'Connectors and MCP servers', item: 'Related items',
};
export type Relation = { kind: RelKind; name: string; access?: 'read' | 'write'; note?: string };

export type Telemetry = { runs30: number | null; successPct: number | null; users30: number | null; costEur: number | null; valueEur: number | null; lastRun: string };

export type RegisterCard = {
  purpose: string;
  /** Department or business unit. */
  organization: string;
  /** Accountable person (the item's owner is the responsible one). */
  steward: string;
  /** Where it runs: the platform. */
  provider: string;
  discovery: Discovery;
  /** Declared phase; null = not declared (the register then derives one from the build steps, see profileOf). */
  phase: Phase | null;
  /** Dates as YYYY-MM-DD, one per phase that has a date. */
  dates: Partial<Record<Phase, string>>;
  criticality: Criticality | null;
  verification: Verification;
  verifiedBy: string;
  verifiedAt: string;
  reviewDue: string;
  risk: RiskClass;
  riskReason: string;
  relations: Relation[];
  telemetry: Telemetry;
  tags: string[];
};

/** The part of the policy summary (`intent.policy`) the register reads. */
export type PolicyBrief = { mode: Mode; systems: number; writes: boolean; unattended: boolean; gaps: number };

// ---------- tolerant readers ----------

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (list as readonly string[]).includes(v as string) ? (v as T) : null;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown) => (DAY.test(String(v ?? '')) && Number.isFinite(Date.parse(String(v))) ? String(v) : '');
const count = (v: unknown, max = 1e9): number | null => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : null; };

export function sanitizeTelemetry(v: unknown): Telemetry {
  const t = (v ?? {}) as any;
  return { runs30: count(t.runs30), successPct: count(t.successPct, 100), users30: count(t.users30), costEur: count(t.costEur), valueEur: count(t.valueEur), lastRun: day(t.lastRun) };
}

/** Anything unknown falls back to "not declared" / the least favourable value (not verified, not assessed), never to a better one. */
export function sanitizeCard(v: unknown): RegisterCard | null {
  const d = v as any;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const dates: Partial<Record<Phase, string>> = {};
  for (const p of PHASES) { const s = day(d.dates?.[p]); if (s) dates[p] = s; }
  const relations: Relation[] = (Array.isArray(d.relations) ? d.relations : []).slice(0, 60).flatMap((r: any): Relation[] => {
    const kind = oneOf(REL_KINDS, r?.kind), name = clip(r?.name, 100);
    if (!kind || !name) return [];
    const access = r?.access === 'write' ? 'write' : r?.access === 'read' ? 'read' : undefined;
    const note = clip(r?.note, 160);
    return [{ kind, name, ...(access ? { access } : {}), ...(note ? { note } : {}) }];
  });
  return {
    purpose: clip(d.purpose, 300), organization: clip(d.organization, 80), steward: clip(d.steward, 120), provider: clip(d.provider, 60),
    discovery: oneOf(DISCOVERY, d.discovery) ?? 'built', phase: oneOf(PHASES, d.phase), dates, criticality: oneOf(CRITICALITY, d.criticality),
    verification: oneOf(VERIFICATION, d.verification) ?? 'unverified', verifiedBy: clip(d.verifiedBy, 120), verifiedAt: day(d.verifiedAt), reviewDue: day(d.reviewDue),
    risk: oneOf(RISK, d.risk) ?? 'not-assessed', riskReason: clip(d.riskReason, 240), relations, telemetry: sanitizeTelemetry(d.telemetry),
    tags: (Array.isArray(d.tags) ? d.tags : []).map((t: unknown) => clip(t, 30)).filter(Boolean).slice(0, 12),
  };
}

export function policyBriefOf(v: unknown): PolicyBrief | null {
  const d = v as any;
  const mode = oneOf(MODES, d?.mode);
  if (!mode) return null;
  return { mode, systems: count(d.systems, 999) ?? 0, writes: d.writes === true, unattended: d.unattended === true, gaps: count(d.gaps, 99) ?? 0 };
}

// ---------- the profile of an item ----------

/** What the card functions need from a registry item (the registry item itself fits). */
export type CardItem = {
  id: string; type: 'agent' | 'workflow' | 'feature' | 'code'; name: string; owner: string; stage: string; archived: boolean; approved: string[];
  card: RegisterCard | null; policy: PolicyBrief | null;
};

/** "Little use": fewer runs in 30 days than this and fewer people than this. A weekly job that many people read is not underused. */
export const UNDERUSED_RUNS = 5;
export const UNDERUSED_USERS = 3;

/** Declared phase if there is one; else a derivation from the build steps. Agents are never derived as active: "live" is read from the Studio, not saved. */
export function phaseOf(i: CardItem): { phase: Phase | null; source: 'declared' | 'derived' | 'none' } {
  if (i.card?.phase) return { phase: i.card.phase, source: 'declared' };
  if (i.archived) return { phase: 'end-of-life', source: 'derived' };
  if (i.type === 'code') return { phase: null, source: 'none' };
  if (i.type === 'agent') return { phase: ['prd', 'tfd', 'arch', 'risk'].every((k) => i.approved.includes(k)) ? 'phase-in' : 'plan', source: 'derived' };
  if (i.type === 'workflow' && i.approved.includes('test')) return { phase: 'active', source: 'derived' };
  return { phase: i.stage === 'build' || i.stage === 'test' ? 'phase-in' : 'plan', source: 'derived' };
}

const isSolution = (i: CardItem) => i.type === 'agent' || i.type === 'workflow';
const inUse = (p: Phase | null) => p === 'active' || p === 'phase-out';
const SIMILAR_KINDS: RelKind[] = ['capability', 'process', 'system', 'data'];
/** lower case name -> name as written, so names compare without case but are shown the way they were typed. */
const named = (c: RegisterCard | null) => new Map((c?.relations ?? []).filter((r) => SIMILAR_KINDS.includes(r.kind)).map((r): [string, string] => [r.name.toLowerCase(), r.name]));

/** Active items of the same type that touch much of the same capabilities, processes, systems and data: candidates to consolidate (LeanIX flags redundant agents). */
export function similarItems<T extends CardItem>(items: T[], id: string, minShare = 0.5): Array<{ item: T; shared: string[] }> {
  const me = items.find((i) => i.id === id);
  if (!me) return [];
  const mine = named(me.card);
  if (mine.size === 0) return [];
  const out: Array<{ item: T; shared: string[]; share: number }> = [];
  for (const o of items) {
    if (o.id === id || o.type !== me.type || o.archived || phaseOf(o).phase === 'end-of-life') continue;
    const theirs = named(o.card);
    const shared = [...mine].filter(([k]) => theirs.has(k)).map(([, v]) => v);
    const share = shared.length / new Set([...mine.keys(), ...theirs.keys()]).size;
    if (shared.length >= 2 && share >= minShare) out.push({ item: o, shared, share });
  }
  return out.sort((a, b) => b.share - a.share).map(({ item, shared }) => ({ item, shared }));
}

export const FLAGS = ['no-owner', 'review-overdue', 'verification-open', 'risk-not-assessed', 'high-risk-autonomous', 'underused', 'overlaps'] as const;
export type FlagId = (typeof FLAGS)[number];
export const FLAG_LABEL: Record<FlagId, string> = {
  'no-owner': 'No owner', 'review-overdue': 'Review overdue', 'verification-open': 'Not verified', 'risk-not-assessed': 'Risk not assessed',
  'high-risk-autonomous': 'High risk, acts on its own', underused: 'Little use', overlaps: 'Overlaps with another',
};
export type Flag = { id: FlagId; label: string; why: string };

/** Day (YYYY-MM-DD) before the given moment, i.e. already over. */
const overdue = (due: string, now: number) => !!due && Date.parse(due) + 86_400_000 <= now;

/** Things worth a look. Only agents and workflows are judged; features and code are not run on their own. */
export function flagsOf<T extends CardItem>(i: T, all: T[], now: number): Flag[] {
  if (!isSolution(i) || i.archived) return [];
  const { phase } = phaseOf(i), c = i.card, out: Flag[] = [];
  const add = (id: FlagId, why: string) => out.push({ id, label: FLAG_LABEL[id], why });
  if (!i.owner.trim()) add('no-owner', 'Nobody is named as the responsible person.');
  if (c && overdue(c.reviewDue, now) && phase !== 'end-of-life') add('review-overdue', `The review was due on ${c.reviewDue}.`);
  if (inUse(phase) && (!c || c.verification !== 'verified')) add('verification-open', c && c.verification !== 'unverified' ? `Status: ${VERIFICATION_LABEL[c.verification].toLowerCase()}.` : 'Nobody has verified this entry yet.');
  if (inUse(phase) && (!c || c.risk === 'not-assessed')) add('risk-not-assessed', 'It is in use, but nobody has placed it in a risk class.');
  if (c?.risk === 'high' && (i.policy?.mode === 'autonomous' || i.policy?.unattended)) add('high-risk-autonomous', i.policy?.mode === 'autonomous' ? 'High risk and allowed to act on its own.' : 'High risk and it can run without a person.');
  const runs = c?.telemetry.runs30, users = c?.telemetry.users30 ?? 0;
  if (phase === 'active' && runs !== null && runs !== undefined && runs < UNDERUSED_RUNS && users < UNDERUSED_USERS) add('underused', `${runs} run${runs === 1 ? '' : 's'} and ${users} user${users === 1 ? '' : 's'} in the last 30 days.`);
  if (inUse(phase)) {
    const twins = similarItems(all, i.id).filter((s) => inUse(phaseOf(s.item).phase));
    if (twins.length) add('overlaps', `Shares ${twins[0].shared.join(', ')} with ${twins[0].item.name}.`);
  }
  return out;
}

export type Profile = {
  phase: Phase | null; phaseSource: 'declared' | 'derived' | 'none';
  criticality: Criticality | null; verification: Verification; risk: RiskClass; flags: Flag[];
};

export function profileOf<T extends CardItem>(i: T, all: T[], now: number): Profile {
  const p = phaseOf(i);
  return { phase: p.phase, phaseSource: p.source, criticality: i.card?.criticality ?? null, verification: i.card?.verification ?? 'unverified', risk: i.card?.risk ?? 'not-assessed', flags: flagsOf(i, all, now) };
}

// ---------- the numbers on top of the register ----------

export type Summary = {
  items: number; solutions: number; byPhase: Record<Phase, number>; verified: number; flagged: number;
  byFlag: Record<FlagId, number>; costEur: number | null; valueEur: number | null; measured: number;
};

/** Agents and workflows are counted as solutions; archived items are not counted. Cost and value are summed only over items that report them (null if none does). */
export function summarize<T extends CardItem>(items: T[], now: number): Summary {
  const live = items.filter((i) => !i.archived);
  const sol = live.filter(isSolution);
  const byPhase = Object.fromEntries(PHASES.map((p) => [p, 0])) as Record<Phase, number>;
  const byFlag = Object.fromEntries(FLAGS.map((f) => [f, 0])) as Record<FlagId, number>;
  let verified = 0, flagged = 0, cost = 0, value = 0, measured = 0;
  for (const i of sol) {
    const ph = phaseOf(i).phase;
    if (ph) byPhase[ph]++;
    if (i.card?.verification === 'verified') verified++;
    const fl = flagsOf(i, items, now);
    if (fl.length) flagged++;
    for (const f of fl) byFlag[f.id]++;
    const t = i.card?.telemetry;
    if (t && (t.costEur !== null || t.valueEur !== null)) { measured++; cost += t.costEur ?? 0; value += t.valueEur ?? 0; }
  }
  return { items: live.length, solutions: sol.length, byPhase, verified, flagged, byFlag, costEur: measured ? cost : null, valueEur: measured ? value : null, measured };
}

/** The words a search should find on a card (beside name, owner and tickets). */
export function cardWords(c: RegisterCard | null): string[] {
  if (!c) return [];
  return [c.purpose, c.organization, c.steward, c.provider, ...c.tags, ...c.relations.map((r) => r.name)];
}

export const euro = (n: number | null) => (n === null ? '–' : `${Math.round(n).toLocaleString('en-US')} EUR`);
