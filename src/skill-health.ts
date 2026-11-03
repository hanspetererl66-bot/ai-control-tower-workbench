/**
 * Skill health: how a company keeps thousands of skills under control. Pure logic, no UI.
 * It finds near-duplicates (tf-idf cosine), classifies each skill by usage and ownership, proposes actions a manager
 * confirms with one click, applies manual actions, and writes an append-only log.
 */
export type Level = 0 | 1 | 2; // Individual, Department, Organization
export const LEVEL_NAMES = ['Individual', 'Department', 'Organization'] as const;
export type SkillState = 'active' | 'deprecated' | 'retired';
export type Health = 'active' | 'rare' | 'unused' | 'orphan' | 'broken' | 'deprecated' | 'retired';

export type CSkill = {
  id: string;
  name: string;
  description: string;
  owner: string;
  department: string;
  level: Level;
  createdAt: number;
  lastUsed: number | null;
  uses30: number;
  uses90: number;
  users90: number;
  /** Share of runs that ended well, 0..1. */
  success: number;
  /** Connectors the skill needs. */
  deps: string[];
  state: SkillState;
  replacedBy?: string;
  sunsetAt?: number;
  reviewedAt?: number;
  remindedAt?: number;
  promotionRequested?: Level;
  example?: boolean;
  installed?: boolean;
};

export type Policy = {
  /** Days without use until a skill counts as unused. */
  unusedDays: number;
  /** Fewer runs than this in 90 days = rarely used. */
  rareUses: number;
  /** Owner has to confirm the skill every N days. */
  reviewDays: number;
  /** Days a deprecated skill stays usable before it can be retired. */
  sunsetDays: number;
  /** Similarity from which two skills count as duplicates (0..1). */
  similarity: number;
  /** Distinct users in 90 days from which a skill is proposed for the next level. */
  promoteUsers: number;
};
export const DEFAULT_POLICY: Policy = { unusedDays: 90, rareUses: 3, reviewDays: 180, sunsetDays: 30, similarity: 0.45, promoteUsers: 8 };

export type LogEntry = { id: string; at: number; actor: string; action: string; ids: string[]; note: string };

export type Catalog = {
  skills: CSkill[];
  log: LogEntry[];
  policy: Policy;
  /** Connectors that exist; a skill needing another one is broken. */
  available: string[];
  /** People who still work here; a skill of anyone else has no owner. */
  people: string[];
  /** Who takes over a skill whose owner left, per department. */
  stewards: Record<string, string>;
  /** Proposal ids and duplicate groups the manager turned down. */
  dismissed: string[];
};

const DAY = 86_400_000;
export const MAX_LOG = 300;

/* ---------- Similarity ---------- */
const STOP = new Set('the and for with from into that this are was were has have not you your our can will all any per use used uses using skill skills agent agents get gets new out via based about when then than also each such more most over only very'.split(' '));
const norm = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);
const SYNONYMS: Array<[RegExp, string]> = [
  [/summari[sz]e|summary|summaries|digest|overview/g, 'summar'], [/e-?mails?|mails?/g, 'mail'], [/follow[- ]?ups?/g, 'followup'],
  [/forecast|predict(?:ion)?s?/g, 'predict'], [/late|overdue|delay(?:ed)?/g, 'late'], [/draft|write|writer|compose/g, 'draft'], [/ads?\b|advertisement|posts?\b|descriptions?/g, 'post'],
  [/triage|prioriti[sz]e|sort/g, 'triage'], [/checklists?/g, 'checklist'], [/compar(?:e|ison)|finder|find/g, 'compar'],
];
export function tokens(text: string): string[] {
  let t = text.toLowerCase();
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  return t.normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map(norm);
}

type Vec = { w: Map<string, number>; norm: number };
function vectors(skills: CSkill[]): Map<string, Vec> {
  const docs = skills.map((s) => ({ id: s.id, t: tokens(`${s.name} ${s.name} ${s.description}`) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.t)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(1, docs.length);
  const out = new Map<string, Vec>();
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const t of d.t) tf.set(t, (tf.get(t) ?? 0) + 1);
    const w = new Map<string, number>();
    let sq = 0;
    for (const [t, c] of tf) { const v = (1 + Math.log(c)) * (Math.log((1 + n) / (1 + (df.get(t) ?? 0))) + 1); w.set(t, v); sq += v * v; }
    out.set(d.id, { w, norm: Math.sqrt(sq) || 1 });
  }
  return out;
}
const cosine = (a: Vec, b: Vec): number => {
  const [s, l] = a.w.size <= b.w.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, v] of s.w) { const o = l.w.get(t); if (o) dot += v * o; }
  return dot / (a.norm * b.norm);
};

/** How alike two skills are, 0..1. */
export function similarity(a: CSkill, b: CSkill): number {
  const v = vectors([a, b]);
  return cosine(v.get(a.id)!, v.get(b.id)!);
}

const rank = (s: CSkill) => s.level * 1e9 + s.users90 * 1e5 + s.uses90 * 100 + Math.round(s.success * 100);
export type Cluster = { key: string; ids: string[]; master: string; score: number };

/** Groups of active skills that do nearly the same thing. The master is the one most worth keeping. */
export function clusters(cat: Pick<Catalog, 'skills' | 'policy' | 'dismissed'>): Cluster[] {
  const live = cat.skills.filter((s) => s.state === 'active');
  const vec = vectors(live);
  const parent = new Map<string, string>(live.map((s) => [s.id, s.id]));
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  const best = new Map<string, number>();
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const sim = cosine(vec.get(live[i].id)!, vec.get(live[j].id)!);
      if (sim >= cat.policy.similarity) {
        parent.set(find(live[i].id), find(live[j].id));
        best.set(live[i].id, Math.max(best.get(live[i].id) ?? 0, sim)); best.set(live[j].id, Math.max(best.get(live[j].id) ?? 0, sim));
      }
    }
  }
  const groups = new Map<string, CSkill[]>();
  for (const s of live) { const r = find(s.id); groups.set(r, [...(groups.get(r) ?? []), s]); }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => {
    const sorted = [...g].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
    const ids = sorted.map((s) => s.id);
    return { key: `dup:${[...ids].sort().join('+')}`, ids, master: ids[0], score: Math.round((g.reduce((n, s) => n + (best.get(s.id) ?? 0), 0) / g.length) * 100) / 100 };
  }).filter((c) => !cat.dismissed.includes(c.key)).sort((a, b) => b.ids.length - a.ids.length || b.score - a.score);
}

/* ---------- Health ---------- */
export const daysSince = (t: number | null | undefined, now: number): number => (t == null ? Infinity : Math.floor((now - t) / DAY));

export function healthOf(s: CSkill, cat: Pick<Catalog, 'policy' | 'available' | 'people'>, now: number): Health {
  if (s.state === 'retired') return 'retired';
  if (s.state === 'deprecated') return 'deprecated';
  if (s.deps.some((d) => !cat.available.includes(d))) return 'broken';
  if (!cat.people.includes(s.owner)) return 'orphan';
  if (Math.min(daysSince(s.lastUsed, now), daysSince(s.createdAt, now)) >= cat.policy.unusedDays) return 'unused';
  if (s.uses90 < cat.policy.rareUses) return 'rare';
  return 'active';
}
export const HEALTH_LABEL: Record<Health, string> = { active: 'Active', rare: 'Rarely used', unused: 'Unused', orphan: 'No owner', broken: 'Broken', deprecated: 'Phasing out', retired: 'Retired' };
export const reviewDue = (s: CSkill, cat: Pick<Catalog, 'policy'>, now: number): boolean =>
  s.state === 'active' && daysSince(s.reviewedAt ?? s.createdAt, now) >= cat.policy.reviewDays;

/* ---------- Actions ---------- */
export type ActionKind = 'deprecate' | 'retire' | 'restore' | 'reassign' | 'review' | 'remind' | 'promote' | 'notify';
export type ActOptions = { replacedBy?: string; owner?: string; note?: string };

export const ACTION_LABEL: Record<ActionKind, string> = {
  deprecate: 'Phase out', retire: 'Retire', restore: 'Restore', reassign: 'Reassign owner', review: 'Mark as reviewed', remind: 'Ask owner to confirm', promote: 'Request next level', notify: 'Notify owner',
};

let counter = 0;
const logId = (now: number) => `log-${now.toString(36)}-${(counter++ % 1296).toString(36)}`;

export function act(cat: Catalog, kind: ActionKind, ids: string[], opt: ActOptions, now: number, actor: string): Catalog {
  const set = new Set(ids);
  const changed: string[] = [];
  const skills = cat.skills.map((s) => {
    if (!set.has(s.id)) return s;
    let n: CSkill = s;
    switch (kind) {
      case 'deprecate': if (s.state !== 'active') return s; n = { ...s, state: 'deprecated', sunsetAt: now + cat.policy.sunsetDays * DAY, ...(opt.replacedBy && opt.replacedBy !== s.id ? { replacedBy: opt.replacedBy } : {}) }; break;
      case 'retire': if (s.state === 'retired') return s; n = { ...s, state: 'retired' }; break;
      case 'restore': if (s.state === 'active') return s; { const { sunsetAt: _a, replacedBy: _b, ...rest } = s; n = { ...rest, state: 'active', reviewedAt: now }; } break;
      case 'reassign': if (!opt.owner) return s; n = { ...s, owner: opt.owner, remindedAt: undefined }; break;
      case 'review': n = { ...s, reviewedAt: now, remindedAt: undefined }; break;
      case 'remind': case 'notify': n = { ...s, remindedAt: now }; break;
      case 'promote': if (s.level >= 2) return s; n = { ...s, promotionRequested: (s.level + 1) as Level }; break;
    }
    changed.push(s.id);
    return n;
  });
  if (changed.length === 0) return cat;
  const note = [kind === 'deprecate' && opt.replacedBy ? `replaced by ${cat.skills.find((s) => s.id === opt.replacedBy)?.name ?? opt.replacedBy}` : '', kind === 'reassign' ? `new owner ${opt.owner}` : '', opt.note ?? ''].filter(Boolean).join('; ');
  return { ...cat, skills, log: [{ id: logId(now), at: now, actor, action: ACTION_LABEL[kind], ids: changed, note }, ...cat.log].slice(0, MAX_LOG) };
}

/* ---------- Proposals ---------- */
export type Proposal = {
  id: string;
  kind: 'merge' | 'sunset' | 'retire' | 'reassign' | 'remind' | 'promote' | 'fix';
  title: string;
  detail: string;
  ids: string[];
  /** What confirming does. */
  steps: Array<{ kind: ActionKind; ids: string[]; opt: ActOptions }>;
  /** How many skills this removes from daily use (for the headline number). */
  effect: number;
};
export const PROPOSAL_LABEL: Record<Proposal['kind'], string> = { merge: 'Merge duplicates', sunset: 'Phase out unused', retire: 'Retire', reassign: 'Reassign', remind: 'Confirm with owner', promote: 'Promote', fix: 'Fix broken' };

const nameOf = (cat: Catalog, id: string) => cat.skills.find((s) => s.id === id)?.name ?? id;

export function proposals(cat: Catalog, now: number): Proposal[] {
  const out: Proposal[] = [];
  const byId = new Map(cat.skills.map((s) => [s.id, s]));
  const handled = new Set<string>();
  for (const c of clusters(cat)) {
    const rest = c.ids.filter((i) => i !== c.master);
    const m = byId.get(c.master)!;
    out.push({ id: `merge:${c.master}:${rest.join('+')}`, kind: 'merge', title: `Merge ${c.ids.length} similar skills into "${m.name}"`, detail: `${rest.map((i) => byId.get(i)!.name).join(', ')} do almost the same (similarity ${Math.round(c.score * 100)} %). "${m.name}" is used by ${m.users90} people.`, ids: c.ids, steps: [{ kind: 'deprecate', ids: rest, opt: { replacedBy: c.master } }], effect: rest.length });
    rest.forEach((i) => handled.add(i));
  }
  for (const s of cat.skills) {
    if (handled.has(s.id)) continue;
    const h = healthOf(s, cat, now);
    if (s.state === 'deprecated' && s.sunsetAt && s.sunsetAt <= now) {
      out.push({ id: `retire:${s.id}`, kind: 'retire', title: `Retire "${s.name}"`, detail: `The phase-out period ended ${daysSince(s.sunsetAt, now)} days ago.${s.replacedBy ? ` Use "${nameOf(cat, s.replacedBy)}" instead.` : ''}`, ids: [s.id], steps: [{ kind: 'retire', ids: [s.id], opt: {} }], effect: 1 });
    } else if (h === 'broken') {
      const missing = s.deps.filter((d) => !cat.available.includes(d)).join(', ');
      out.push({ id: `fix:${s.id}`, kind: 'fix', title: `Fix "${s.name}"`, detail: `Needs ${missing}, which does not exist (any more). Ask the owner to repair it or phase it out.`, ids: [s.id], steps: [{ kind: 'notify', ids: [s.id], opt: { note: `missing ${missing}` } }], effect: 0 });
    } else if (h === 'orphan') {
      const steward = cat.stewards[s.department] ?? cat.people[0] ?? '';
      if (steward) out.push({ id: `reassign:${s.id}`, kind: 'reassign', title: `Give "${s.name}" a new owner`, detail: `${s.owner} is no longer in the company. Proposed: ${steward} (steward of ${s.department}).`, ids: [s.id], steps: [{ kind: 'reassign', ids: [s.id], opt: { owner: steward } }], effect: 0 });
    } else if (s.state === 'active' && s.remindedAt && s.remindedAt < now - 14 * DAY && (s.reviewedAt ?? 0) < s.remindedAt) {
      out.push({ id: `sunset:${s.id}`, kind: 'sunset', title: `Phase out "${s.name}"`, detail: `No answer to the reminder for ${daysSince(s.remindedAt, now)} days.`, ids: [s.id], steps: [{ kind: 'deprecate', ids: [s.id], opt: { note: 'no reply to reminder' } }], effect: 1 });
    } else if (h === 'unused') {
      out.push({ id: `sunset:${s.id}`, kind: 'sunset', title: `Phase out "${s.name}"`, detail: s.lastUsed ? `Not used for ${daysSince(s.lastUsed, now)} days (limit ${cat.policy.unusedDays}).` : `Never used since it was created ${daysSince(s.createdAt, now)} days ago.`, ids: [s.id], steps: [{ kind: 'deprecate', ids: [s.id], opt: {} }], effect: 1 });
    } else if (reviewDue(s, cat, now) && !s.remindedAt) {
      out.push({ id: `remind:${s.id}`, kind: 'remind', title: `Ask ${s.owner} to confirm "${s.name}"`, detail: `Last confirmed ${Number.isFinite(daysSince(s.reviewedAt ?? s.createdAt, now)) ? daysSince(s.reviewedAt ?? s.createdAt, now) : '?'} days ago (every ${cat.policy.reviewDays} days).`, ids: [s.id], steps: [{ kind: 'remind', ids: [s.id], opt: {} }], effect: 0 });
    }
    if (s.state === 'active' && s.level < 2 && !s.promotionRequested && s.users90 >= cat.policy.promoteUsers && s.success >= 0.8 && h !== 'broken') {
      out.push({ id: `promote:${s.id}`, kind: 'promote', title: `Offer "${s.name}" to the ${LEVEL_NAMES[s.level + 1].toLowerCase()} level`, detail: `${s.users90} people used it in 90 days, ${Math.round(s.success * 100)} % of the runs succeeded. It then goes through the normal review.`, ids: [s.id], steps: [{ kind: 'promote', ids: [s.id], opt: {} }], effect: 0 });
    }
  }
  return out.filter((p) => !cat.dismissed.includes(p.id));
}

export function applyProposal(cat: Catalog, p: Proposal, now: number, actor: string): Catalog {
  return p.steps.reduce((c, s) => act(c, s.kind, s.ids, s.opt, now, actor), cat);
}
export function dismiss(cat: Catalog, key: string): Catalog { return cat.dismissed.includes(key) ? cat : { ...cat, dismissed: [...cat.dismissed, key] }; }

/* ---------- Key figures ---------- */
export type Metrics = {
  total: number; live: number; byHealth: Record<Health, number>;
  duplicateSkills: number; duplicateRate: number; unusedShare: number; reviewDue: number; pendingPromotions: number; openProposals: number; potential: number;
  runs30: number; users90: number; avgSuccess: number;
  byDepartment: Array<{ department: string; total: number; live: number; unused: number; duplicates: number; uses30: number }>;
  top: CSkill[]; flop: CSkill[];
};

export function metrics(cat: Catalog, now: number): Metrics {
  const byHealth: Record<Health, number> = { active: 0, rare: 0, unused: 0, orphan: 0, broken: 0, deprecated: 0, retired: 0 };
  const health = new Map<string, Health>();
  for (const s of cat.skills) { const h = healthOf(s, cat, now); health.set(s.id, h); byHealth[h] += 1; }
  const live = cat.skills.filter((s) => s.state === 'active');
  const cl = clusters(cat);
  const dupIds = new Set(cl.flatMap((c) => c.ids.filter((i) => i !== c.master)));
  const open = proposals(cat, now);
  const depts = [...new Set(cat.skills.map((s) => s.department))].sort();
  const stat = (h: Health) => cat.skills.filter((s) => health.get(s.id) === h).length;
  const used = live.filter((s) => s.uses90 > 0);
  return {
    total: cat.skills.length, live: live.length, byHealth,
    duplicateSkills: dupIds.size, duplicateRate: live.length ? dupIds.size / live.length : 0,
    unusedShare: live.length ? (stat('unused') + stat('rare')) / live.length : 0,
    reviewDue: live.filter((s) => reviewDue(s, cat, now)).length,
    pendingPromotions: cat.skills.filter((s) => s.promotionRequested).length,
    openProposals: open.length, potential: open.reduce((n, p) => n + p.effect, 0),
    runs30: live.reduce((n, s) => n + s.uses30, 0), users90: live.reduce((n, s) => Math.max(n, s.users90), 0),
    avgSuccess: used.length ? used.reduce((n, s) => n + s.success, 0) / used.length : 0,
    byDepartment: depts.map((d) => {
      const own = cat.skills.filter((s) => s.department === d);
      return { department: d, total: own.length, live: own.filter((s) => s.state === 'active').length, unused: own.filter((s) => ['unused', 'rare'].includes(health.get(s.id)!)).length, duplicates: own.filter((s) => dupIds.has(s.id)).length, uses30: own.reduce((n, s) => n + s.uses30, 0) };
    }),
    top: [...live].sort((a, b) => b.uses30 - a.uses30 || b.users90 - a.users90).slice(0, 5),
    flop: [...live].sort((a, b) => a.uses90 - b.uses90 || (a.lastUsed ?? 0) - (b.lastUsed ?? 0)).slice(0, 5),
  };
}

/* ---------- Installed skills join the catalog ---------- */
export type InstalledSkill = { name: string; description: string; updatedAt?: number };
export type UseEntry = { label: string; count: number; last: number };

export function syncInstalled(cat: Catalog, installed: InstalledSkill[], use: Record<string, UseEntry>, me: string, now: number): Catalog {
  const uses = new Map(Object.values(use).map((u) => [u.label.toLowerCase(), u]));
  let changed = false;
  const skills = cat.skills.map((s) => {
    if (!s.installed) return s;
    const u = uses.get(s.name.toLowerCase());
    if (u && (u.last !== s.lastUsed || u.count !== s.uses90)) { changed = true; return { ...s, lastUsed: u.last, uses90: u.count, uses30: u.last > now - 30 * DAY ? u.count : 0, users90: Math.max(1, s.users90) }; }
    return s;
  });
  const known = new Set(cat.skills.map((s) => s.name.toLowerCase()));
  const added: CSkill[] = installed.filter((i) => !known.has(i.name.toLowerCase())).map((i) => {
    const u = uses.get(i.name.toLowerCase());
    return { id: `inst-${i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`, name: i.name, description: i.description, owner: me, department: 'Personal', level: 0, createdAt: i.updatedAt ?? now, lastUsed: u?.last ?? null, uses30: u && u.last > now - 30 * DAY ? u.count : 0, uses90: u?.count ?? 0, users90: u ? 1 : 0, success: 1, deps: [], state: 'active', installed: true } as CSkill;
  }).filter((s) => !cat.skills.some((x) => x.id === s.id));
  if (!changed && added.length === 0) return cat;
  return { ...cat, skills: [...skills, ...added], people: cat.people.includes(me) ? cat.people : [...cat.people, me] };
}

/* ---------- Example catalog ---------- */
export const CONNECTORS = ['sap-mock', 'n8n-automation', 'sub4me', 'jira', 'gmail', 'databricks', 'knowledge-graph', 'web-sources', 'slack', 'ai-control-tower'];

const TOPICS: Array<{ dept: string; deps: string[]; variants: Array<[string, string]> }> = [
  { dept: 'Finance', deps: ['sap-mock'], variants: [
    ['Invoice summary', 'Summarise open supplier invoices by entity and due date, flag anything overdue.'],
    ['Summarize supplier invoices', 'Short summary of open supplier invoices per entity with due dates and overdue items.'],
    ['Open invoice digest', 'Digest of open supplier invoices by due date, overdue ones highlighted.'],
    ['Invoice overview Q4', 'Overview of supplier invoices for the quarter, entity and due date.'],
  ] },
  { dept: 'Finance', deps: ['sap-mock', 'databricks'], variants: [
    ['GR/IR clearing check', 'Find open goods receipt invoice receipt items older than 60 days and propose an accrual.'],
    ['Open GR/IR items', 'List open GR/IR items older than 60 days and propose the accrual posting.'],
    ['Accrual proposal GR/IR', 'Propose accruals for open goods receipt / invoice receipt items older than two months.'],
  ] },
  { dept: 'Finance', deps: ['databricks'], variants: [
    ['Margin analysis', 'Explain the margin by product line and region, compare with last quarter.'],
    ['Margin by product', 'Margin per product line and region compared with the previous quarter.'],
  ] },
  { dept: 'Sales', deps: ['sub4me'], variants: [
    ['Late payment risk', 'Predict which open invoices of a customer will be paid late.'],
    ['Payment delay forecast', 'Forecast which open customer invoices will be paid late and how likely.'],
    ['Overdue prediction customer', 'Predict overdue risk for the open invoices of one customer.'],
  ] },
  { dept: 'Sales', deps: ['gmail'], variants: [
    ['Customer follow-up mail', 'Draft a polite follow-up e-mail to a customer after a meeting, with next steps.'],
    ['Follow up email after meeting', 'Write a follow-up email to the customer after a meeting including next steps.'],
    ['Meeting follow-up draft', 'Draft the follow-up mail after a customer meeting with the agreed next steps.'],
    ['Thank you note customer', 'Short thank-you note to a customer after a meeting.'],
  ] },
  { dept: 'HR', deps: [], variants: [
    ['Job description writer', 'Write a job description from a short role profile in the company tone.'],
    ['Draft job ad', 'Draft a job advertisement from a role profile in the company tone of voice.'],
    ['Role profile to job post', 'Turn a role profile into a job post.'],
  ] },
  { dept: 'HR', deps: [], variants: [
    ['Onboarding checklist', 'Create an onboarding checklist for a new employee by role and start date.'],
    ['New hire checklist', 'Checklist for a new hire by role and start date.'],
  ] },
  { dept: 'IT', deps: ['jira'], variants: [
    ['Ticket triage', 'Sort new Jira tickets by priority and suggest the owning team.'],
    ['Triage Jira tickets', 'Prioritise new Jira tickets and propose the owning team.'],
    ['Incident summary', 'Summarise an incident from its Jira tickets and Slack thread.'],
  ] },
  { dept: 'IT', deps: ['slack'], variants: [
    ['Slack thread summary', 'Summarise a long Slack thread into decisions and open questions.'],
    ['Summarise Slack discussion', 'Summary of a Slack discussion: decisions and open questions.'],
  ] },
  { dept: 'Procurement', deps: ['sap-mock'], variants: [
    ['PO delay risk', 'Find purchase orders at risk of late delivery and suggest expediting.'],
    ['Late purchase orders', 'Purchase orders at risk of late delivery with expedite suggestion.'],
    ['Supplier delivery watch', 'Watch supplier deliveries and flag orders likely to arrive late.'],
  ] },
  { dept: 'Procurement', deps: ['web-sources'], variants: [
    ['Supplier news scan', 'Scan the web for news about key suppliers and flag risks.'],
    ['Supplier risk news', 'Find news about key suppliers and flag risks.'],
  ] },
  { dept: 'Legal', deps: ['knowledge-graph'], variants: [
    ['Contract clause finder', 'Find a clause in the contract library and compare it with the standard wording.'],
    ['Clause comparison', 'Compare a contract clause with the standard wording from the library.'],
  ] },
];
const UNIQUE: Array<[string, string, string, string[]]> = [
  ['Board briefing', 'Finance', 'One-page board briefing from risks, agents and budget.', ['ai-control-tower']],
  ['Meeting notes to actions', 'Sales', 'Turn raw meeting notes into action items with owners.', []],
  ['SAP role check', 'IT', 'Check an SAP role for segregation-of-duties conflicts.', ['sap-mock']],
  ['Travel policy answers', 'HR', 'Answer questions about the travel policy with quotes.', ['knowledge-graph']],
  ['Quarter close calendar', 'Finance', 'Show the close calendar with owners and open tasks.', ['sap-mock']],
  ['Lead scoring explainer', 'Sales', 'Explain why a lead got its score.', ['sub4me']],
  ['Release notes writer', 'IT', 'Write release notes from merged pull requests.', ['jira']],
  ['Translate to German', 'Legal', 'Translate a clause into German keeping the legal meaning.', []],
];

/** Small deterministic generator so the example catalog is the same on every start. */
function rng(seed: number) { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }

export function exampleCatalog(now: number): Catalog {
  const r = rng(20261103);
  const people = ['anna.keller@example.com', 'ben.huber@example.com', 'chris.meier@example.com', 'dana.roth@example.com', 'eli.schmid@example.com', 'fabian.wolf@example.com'];
  const gone = ['former.employee1@example.com', 'former.employee2@example.com'];
  const stewards: Record<string, string> = { Finance: people[0], Sales: people[1], HR: people[2], IT: people[3], Procurement: people[4], Legal: people[5] };
  const skills: CSkill[] = [];
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const add = (name: string, description: string, dept: string, deps: string[], role: 'best' | 'dup' | 'solo') => {
    const owner = r() < 0.12 ? pick(gone) : pick(people);
    const created = now - Math.floor((30 + r() * 420) * DAY);
    const idle = role === 'dup' && r() < 0.5 ? 95 + r() * 200 : r() * 40;
    const uses90 = role === 'best' ? 60 + Math.floor(r() * 160) : role === 'solo' ? Math.floor(r() * 50) : Math.floor(r() * 7);
    const dead = role !== 'best' && r() < 0.25;
    const lastUsed = dead || uses90 === 0 ? (r() < 0.5 ? null : now - Math.floor((100 + r() * 300) * DAY)) : now - Math.floor(idle * DAY);
    const level: Level = role === 'best' ? (r() < 0.5 ? 2 : 1) : r() < 0.2 ? 1 : 0;
    const brokenDeps = r() < 0.05 ? [...deps, 'legacy-erp'] : deps;
    const uses30 = dead ? 0 : Math.round(uses90 * (0.25 + r() * 0.2));
    skills.push({
      id: `ex-${skills.length + 1}`, name, description, owner, department: dept, level, createdAt: created, lastUsed: dead ? null : lastUsed,
      uses30, uses90: dead ? 0 : uses90, users90: dead ? 0 : role === 'best' ? 9 + Math.floor(r() * 30) : Math.max(0, Math.min(uses90, 1 + Math.floor(r() * 4))),
      success: Math.round((0.6 + r() * 0.4) * 100) / 100, deps: brokenDeps, state: 'active', example: true,
      ...(r() < 0.6 ? { reviewedAt: now - Math.floor(r() * 150 * DAY) } : {}),
    });
  };
  for (const t of TOPICS) t.variants.forEach(([n, d], i) => add(n, d, t.dept, t.deps, i === 0 ? 'best' : 'dup'));
  for (const [n, dept, d, deps] of UNIQUE) add(n, d, dept, deps, 'solo');
  // two skills that were already phased out, one of them past its end date
  skills.push({ ...skills[1], id: 'ex-old-1', name: 'Invoice list (old)', description: 'Old list of supplier invoices.', state: 'deprecated', sunsetAt: now - 12 * DAY, replacedBy: 'ex-1', uses30: 0, uses90: 2, example: true });
  skills.push({ ...skills[5], id: 'ex-old-2', name: 'Margin quick view (old)', description: 'Obsolete margin view.', state: 'deprecated', sunsetAt: now + 9 * DAY, replacedBy: 'ex-8', uses30: 0, uses90: 1, example: true });
  // one skill whose owner was asked to confirm two weeks ago and never answered
  skills.push({ id: 'ex-quiet', name: 'Supplier scorecard', description: 'Score suppliers by delivery and quality.', owner: people[4], department: 'Procurement', level: 0, createdAt: now - 300 * DAY, lastUsed: now - 20 * DAY, uses30: 1, uses90: 4, users90: 2, success: 0.9, deps: ['sap-mock'], state: 'active', remindedAt: now - 20 * DAY, reviewedAt: now - 260 * DAY, example: true });
  return { skills, log: [], policy: { ...DEFAULT_POLICY }, available: [...CONNECTORS], people, stewards, dismissed: [] };
}

/* ---------- Storage ---------- */
export const CATALOG_KEY = 'werkbank.skillcatalog.v1';
export const emptyCatalog = (): Catalog => ({ skills: [], log: [], policy: { ...DEFAULT_POLICY }, available: [...CONNECTORS], people: [], stewards: {}, dismissed: [] });

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, n) : '');
const num = (v: unknown, d = 0) => (Number.isFinite(v) ? (v as number) : d);
const clampPolicy = (p: any): Policy => ({
  unusedDays: Math.min(730, Math.max(7, Math.round(num(p?.unusedDays, DEFAULT_POLICY.unusedDays)))), rareUses: Math.min(100, Math.max(1, Math.round(num(p?.rareUses, DEFAULT_POLICY.rareUses)))),
  reviewDays: Math.min(730, Math.max(30, Math.round(num(p?.reviewDays, DEFAULT_POLICY.reviewDays)))), sunsetDays: Math.min(365, Math.max(1, Math.round(num(p?.sunsetDays, DEFAULT_POLICY.sunsetDays)))),
  similarity: Math.min(0.95, Math.max(0.3, num(p?.similarity, DEFAULT_POLICY.similarity))), promoteUsers: Math.min(500, Math.max(2, Math.round(num(p?.promoteUsers, DEFAULT_POLICY.promoteUsers)))),
});

export function sanitizeCatalog(value: unknown): Catalog {
  const v = (value ?? {}) as Record<string, any>;
  const seen = new Set<string>();
  const skills: CSkill[] = [];
  for (const r of Array.isArray(v.skills) ? v.skills : []) {
    const id = str(r?.id, 60), name = str(r?.name, 80);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const level = (r.level === 1 || r.level === 2 ? r.level : 0) as Level;
    skills.push({
      id, name, description: str(r.description, 400), owner: str(r.owner, 120), department: str(r.department, 40) || 'Other', level,
      createdAt: num(r.createdAt, Date.now()), lastUsed: Number.isFinite(r.lastUsed) ? r.lastUsed : null,
      uses30: Math.max(0, num(r.uses30)), uses90: Math.max(0, num(r.uses90)), users90: Math.max(0, num(r.users90)), success: Math.min(1, Math.max(0, num(r.success, 1))),
      deps: (Array.isArray(r.deps) ? r.deps : []).map((d: unknown) => str(d, 60)).filter(Boolean).slice(0, 12),
      state: r.state === 'deprecated' || r.state === 'retired' ? r.state : 'active',
      ...(typeof r.replacedBy === 'string' ? { replacedBy: r.replacedBy.slice(0, 60) } : {}), ...(Number.isFinite(r.sunsetAt) ? { sunsetAt: r.sunsetAt } : {}),
      ...(Number.isFinite(r.reviewedAt) ? { reviewedAt: r.reviewedAt } : {}), ...(Number.isFinite(r.remindedAt) ? { remindedAt: r.remindedAt } : {}),
      ...(r.promotionRequested === 1 || r.promotionRequested === 2 ? { promotionRequested: r.promotionRequested } : {}),
      ...(r.example === true ? { example: true } : {}), ...(r.installed === true ? { installed: true } : {}),
    });
    if (skills.length >= 5000) break;
  }
  const list = (a: unknown, n: number) => (Array.isArray(a) ? a.map((x) => str(x, 120)).filter(Boolean).slice(0, n) : []);
  return {
    skills, policy: clampPolicy(v.policy), available: list(v.available, 80).length ? list(v.available, 80) : [...CONNECTORS], people: list(v.people, 5000), dismissed: list(v.dismissed, 2000),
    stewards: Object.fromEntries(Object.entries(v.stewards ?? {}).filter(([k, x]) => typeof k === 'string' && typeof x === 'string').slice(0, 40).map(([k, x]) => [str(k, 40), str(x, 120)])),
    log: (Array.isArray(v.log) ? v.log : []).flatMap((l: any): LogEntry[] => (Number.isFinite(l?.at) && typeof l?.action === 'string' ? [{ id: str(l.id, 60) || logId(l.at), at: l.at, actor: str(l.actor, 120), action: str(l.action, 60), ids: list(l.ids, 200), note: str(l.note, 300) }] : [])).slice(0, MAX_LOG),
  };
}

export function loadCatalog(storage?: Pick<Storage, 'getItem'>): Catalog | null {
  try { const raw = storage?.getItem(CATALOG_KEY); return raw ? sanitizeCatalog(JSON.parse(raw)) : null; } catch { return null; }
}
export function saveCatalog(cat: Catalog, storage?: Pick<Storage, 'setItem'>): void {
  try { storage?.setItem(CATALOG_KEY, JSON.stringify(cat)); } catch { /* kept in memory only */ }
}
