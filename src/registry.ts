/**
 * Registry: one list of everything the person has built (agents, workflows, features), with the history of every item.
 * It is a view on the work items of the shared database (migration 021): every save there is a new revision with author,
 * note and time, nothing is overwritten. So no new tables: this module reads the list, the history and the files of a
 * revision, shows differences and restores an old revision as a new one (the history stays complete).
 *
 * A feature has no definition like an agent or a workflow. It is a work item of kind "code" whose intent says
 * source = "feature"; its revisions are the events (created, stage changed, link added).
 */
import { FLOW, FLOW_LABEL, type FlowStep } from './flow.ts';
import { agentUnit, developUnit, restore } from './work-sync.ts';
import { sanitizeExtends, sanitizeRefs, sourcesOf, type ExtendsRef, type SourceRef } from './requirements.ts';

export type Api = { call: (tool: string, args: Record<string, unknown>) => Promise<any> };
export type RType = 'agent' | 'workflow' | 'feature' | 'code';
export const TYPE_LABEL: Record<RType, string> = { agent: 'Agent', workflow: 'Workflow', feature: 'Feature', code: 'Code' };
export const TYPES: RType[] = ['agent', 'workflow', 'feature', 'code'];

export type RItem = {
  id: string; type: RType; name: string; owner: string; stage: string; visibility: string; archived: boolean;
  rev: number; updatedAt: number; files: number; approved: string[];
  /** Where it came from (Jira, Slack, Notion), as far as the current revision knows. */
  refs: SourceRef[];
  /** The agent or workflow this one extends. */
  extendsItem?: ExtendsRef;
};

const str = (v: unknown, n = 200) => String(v ?? '').slice(0, n);
const time = (v: unknown) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : 0; };

export const typeOf = (kind: unknown, intent: any): RType => (kind === 'agent' ? 'agent' : kind === 'workflow' ? 'workflow' : intent?.source === 'feature' ? 'feature' : 'code');

/** A row of list_work_items, completed with the intent of get_work_item (the list has no intent). */
export function itemFrom(row: any, detail: any = null): RItem {
  const intent = detail?.intent ?? {};
  const ext = sanitizeExtends(intent.extends);
  return {
    id: str(row.id, 60), type: typeOf(row.kind, intent), name: str(row.name, 120), owner: str(row.owner, 120), stage: str(row.stage ?? detail?.stage, 40),
    visibility: str(row.visibility, 20), archived: row.archived === true, rev: Number(row.current_rev) || 0, updatedAt: time(row.updated_at), files: Number(row.files) || 0,
    approved: Array.isArray(detail?.approved) ? detail.approved.filter((s: unknown) => typeof s === 'string').slice(0, 20) : [],
    refs: sanitizeRefs(intent.sources), ...(ext ? { extendsItem: ext } : {}),
  };
}

/** "Where is it": a workflow or feature by its step, an agent by the number of confirmed steps. */
export function stageText(i: Pick<RItem, 'type' | 'stage' | 'approved'>): string {
  if (i.type === 'agent') return i.approved.length ? `${i.approved.length} step${i.approved.length > 1 ? 's' : ''} confirmed` : 'Draft';
  if (i.type === 'code') return '';
  return (FLOW as readonly string[]).includes(i.stage) ? FLOW_LABEL[i.stage as FlowStep] : i.stage || 'Draft';
}

export type Filter = { type: RType | 'all'; status: 'active' | 'archived' | 'all'; query: string };
export const noFilter = (): Filter => ({ type: 'all', status: 'active', query: '' });

export function filterItems(items: RItem[], f: Filter): RItem[] {
  const q = f.query.trim().toLowerCase();
  return items
    .filter((i) => (f.type === 'all' || i.type === f.type) && (f.status === 'all' || (f.status === 'archived') === i.archived))
    .filter((i) => !q || [i.name, i.owner, TYPE_LABEL[i.type], i.extendsItem?.name ?? '', ...i.refs.flatMap((r) => [r.key, r.title])].some((t) => t.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** From a ticket (or message, page) to what became of it. */
export const itemsForRef = (items: RItem[], source: string, key: string): RItem[] => items.filter((i) => i.refs.some((r) => r.source === source && r.key === key));

/** The agents and workflows an extension can point at. */
export const targetsOf = (items: RItem[]) => items.filter((i) => !i.archived && (i.type === 'agent' || i.type === 'workflow')).map((i) => ({ id: i.id, kind: i.type as 'agent' | 'workflow', name: i.name }));

// ---------- history ----------

export type Rev = { rev: number; author: string; note: string; at: number; files: number };
export function revsFrom(rows: unknown): Rev[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r: any) => ({ rev: Number(r?.rev) || 0, author: str(r?.author, 120), note: str(r?.note, 300), at: time(r?.created_at), files: Number(r?.files) || 0 })).filter((r) => r.rev >= 1).sort((a, b) => b.rev - a.rev);
}

export type RevFile = { path: string; language?: string; content: string };

// ---------- differences ----------

export type DiffLine = { t: ' ' | '+' | '-' | '…'; s: string };
const MAX_CELLS = 2_000_000;

/** Line by line difference (longest common subsequence). Very large inputs fall back to "same start, same end, the middle changed". */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.split('\n'), y = b.split('\n');
  let lo = 0;
  while (lo < x.length && lo < y.length && x[lo] === y[lo]) lo++;
  let hx = x.length, hy = y.length;
  while (hx > lo && hy > lo && x[hx - 1] === y[hy - 1]) { hx--; hy--; }
  const head: DiffLine[] = x.slice(0, lo).map((s) => ({ t: ' ', s }));
  const tail: DiffLine[] = x.slice(hx).map((s) => ({ t: ' ', s }));
  const mx = x.slice(lo, hx), my = y.slice(lo, hy);
  let mid: DiffLine[];
  if (mx.length * my.length > MAX_CELLS) {
    mid = [...mx.map((s): DiffLine => ({ t: '-', s })), ...my.map((s): DiffLine => ({ t: '+', s }))];
  } else {
    const w = my.length + 1;
    const L = new Uint32Array((mx.length + 1) * w);
    for (let i = mx.length - 1; i >= 0; i--) for (let j = my.length - 1; j >= 0; j--) L[i * w + j] = mx[i] === my[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    mid = [];
    let i = 0, j = 0;
    while (i < mx.length && j < my.length) {
      if (mx[i] === my[j]) { mid.push({ t: ' ', s: mx[i] }); i++; j++; }
      else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) mid.push({ t: '-', s: mx[i++] });
      else mid.push({ t: '+', s: my[j++] });
    }
    while (i < mx.length) mid.push({ t: '-', s: mx[i++] });
    while (j < my.length) mid.push({ t: '+', s: my[j++] });
  }
  return [...head, ...mid, ...tail];
}

/** Long runs of unchanged lines become one "… n unchanged lines" line, with some context kept around each change. */
export function collapse(lines: DiffLine[], context = 2): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => { if (l.t !== ' ') for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true; });
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) { if (skipped) { out.push({ t: '…', s: `${skipped} unchanged line${skipped > 1 ? 's' : ''}` }); skipped = 0; } out.push(l); }
    else skipped++;
  });
  if (skipped) out.push({ t: '…', s: `${skipped} unchanged line${skipped > 1 ? 's' : ''}` });
  return out;
}

/** JSON files are shown pretty-printed; project.json is one long line otherwise. */
export function readable(f: RevFile): string {
  if (/\.json$/i.test(f.path)) { try { return JSON.stringify(JSON.parse(f.content), null, 2); } catch { /* show as is */ } }
  return f.content;
}

export type FileDiff = { path: string; status: 'added' | 'removed' | 'changed' | 'same'; lines: DiffLine[] };
const ORDER = { changed: 0, added: 1, removed: 2, same: 3 } as const;

export function diffRevisions(from: RevFile[], to: RevFile[]): FileDiff[] {
  const a = new Map(from.map((f) => [f.path, f])), b = new Map(to.map((f) => [f.path, f]));
  const out: FileDiff[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const fa = a.get(path), fb = b.get(path);
    if (fa && !fb) out.push({ path, status: 'removed', lines: [] });
    else if (!fa && fb) out.push({ path, status: 'added', lines: [] });
    else if (fa && fb) {
      if (fa.content === fb.content) out.push({ path, status: 'same', lines: [] });
      else out.push({ path, status: 'changed', lines: collapse(diffLines(readable(fa), readable(fb))) });
    }
  }
  return out.sort((p, q) => ORDER[p.status] - ORDER[q.status] || p.path.localeCompare(q.path));
}

// ---------- restore an old revision as a new one ----------

/**
 * Arguments for save_work_item that make an old revision the newest one. The files are copied exactly; stage, approvals and intent
 * are read back from them, so the item looks the way it did then. The history keeps every revision in between.
 */
export function rollbackArgs(cur: { id: string; kind: string; name: string; currentRev: number; intent?: Record<string, unknown> }, files: RevFile[], toRev: number): Record<string, unknown> {
  let stage = '', approved: string[] = [], intent: Record<string, unknown> = cur.intent ?? {};
  const r = restore(files);
  if (r?.agent) { const u = agentUnit(r.agent); stage = u.stage; approved = u.approved; intent = { ...u.intent, ...sourcesOf(r.agent) }; }
  else if (r?.dev) { const u = developUnit(r.dev); stage = u.stage; approved = u.approved; intent = { ...u.intent, ...sourcesOf(r.dev) }; }
  else {
    const f = parseFeature(files);
    if (f) { const a = featureArgs(f, { note: '' }); stage = String(a.stage); approved = a.approved as string[]; intent = a.intent as Record<string, unknown>; }
  }
  return {
    id: cur.id, expected_rev: cur.currentRev, kind: cur.kind, name: cur.name, stage, approved, intent,
    files: files.map((f) => ({ path: f.path, language: f.language ?? '', content: f.content })), note: `Restored revision ${toRev}`,
  };
}

// ---------- features ----------

export const FEATURE_FORMAT = 'werkbank.feature.v1';
export type FeatureDoc = {
  format: typeof FEATURE_FORMAT; name: string; goal: string; refs: SourceRef[]; links: Array<{ label: string; url: string }>;
  stage: FlowStep; approved: FlowStep[]; brief: string;
};

export function newFeature(h: { name: string; goal: string; refs: SourceRef[]; brief: string }): FeatureDoc {
  return { format: FEATURE_FORMAT, name: str(h.name, 120).trim() || 'New feature', goal: str(h.goal, 400), refs: sanitizeRefs(h.refs), links: [], stage: 'intent', approved: [], brief: str(h.brief, 60_000) };
}

/** project.json holds the data, brief.md the text of the brief (once: so a change shows up as a readable difference, not as one long line). */
export function featureFiles(doc: FeatureDoc): RevFile[] {
  const { brief: _brief, ...data } = doc;
  return [
    { path: 'project.json', language: 'json', content: JSON.stringify(data) },
    { path: 'brief.md', language: 'markdown', content: doc.brief || `# ${doc.name}\n\n${doc.goal}` },
  ];
}

export function parseFeature(files: Array<{ path: string; content?: string }>): FeatureDoc | null {
  const text = files.find((f) => f.path === 'project.json')?.content;
  if (!text) return null;
  try {
    const d = JSON.parse(text);
    if (d?.format !== FEATURE_FORMAT) return null;
    const stage: FlowStep = (FLOW as readonly string[]).includes(d.stage) ? d.stage : 'intent';
    return {
      format: FEATURE_FORMAT, name: str(d.name, 120) || 'Feature', goal: str(d.goal, 400), refs: sanitizeRefs(d.refs), brief: str(files.find((f) => f.path === 'brief.md')?.content ?? d.brief, 60_000), stage,
      links: (Array.isArray(d.links) ? d.links : []).filter((l: any) => /^https?:\/\/\S+$/i.test(String(l?.url ?? ''))).slice(0, 20).map((l: any) => ({ label: str(l.label, 60), url: str(l.url, 400) })),
      approved: (Array.isArray(d.approved) ? d.approved : []).filter((s: unknown) => (FLOW as readonly string[]).includes(s as string)),
    };
  } catch { return null; }
}

/** Moving to a step approves the steps before it; moving back takes the later approvals back. */
export function setStage(doc: FeatureDoc, stage: FlowStep): FeatureDoc {
  return { ...doc, stage, approved: FLOW.slice(0, FLOW.indexOf(stage)) };
}

export function addLink(doc: FeatureDoc, label: string, url: string): FeatureDoc | null {
  const u = url.trim();
  if (!/^https?:\/\/\S+$/i.test(u) || doc.links.some((l) => l.url === u)) return null;
  return { ...doc, links: [...doc.links, { label: str(label, 60).trim() || 'Link', url: u.slice(0, 400) }] };
}

/** save_work_item arguments for a feature: first save without id, later saves with id and the revision they are based on. */
export function featureArgs(doc: FeatureDoc, o: { id?: string; expectedRev?: number; note: string }): Record<string, unknown> {
  return {
    ...(o.id ? { id: o.id, expected_rev: o.expectedRev ?? 0 } : {}),
    kind: 'code', name: doc.name, stage: doc.stage, approved: doc.approved, files: featureFiles(doc),
    intent: { source: 'feature', goal: doc.goal, ...(doc.refs.length ? { sources: doc.refs } : {}) }, note: o.note.slice(0, 300),
  };
}

// ---------- loading (async, through the same five tools as the sync) ----------

/** The five work item tools through the desktop app (the key and the person stay in the main process). null in a plain browser. */
export function hostApi(): Api | null {
  const host = typeof window === 'undefined' ? undefined : window.host;
  if (!host?.workCall) return null;
  return { call: async (tool, args) => { const res = await host.workCall!(tool, args); if (!res.ok) throw new Error(res.error); return res.data; } };
}


/** The whole registry: the list, completed with intent and approvals of every item (a few at a time). One item failing does not stop the rest. */
export async function loadRegistry(api: Api, parallel = 4): Promise<RItem[]> {
  const rows: any[] = await api.call('list_work_items', { include_archived: true });
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.id === 'string');
  const out: RItem[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < list.length; i = next++) {
      let detail: any = null;
      try { detail = await api.call('get_work_item', { id: list[i].id, include_content: false }); } catch { /* shown without links */ }
      out[i] = itemFrom(list[i], detail);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, list.length) }, worker));
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadHistory(api: Api, id: string): Promise<Rev[]> { return revsFrom(await api.call('work_item_history', { id })); }

export async function loadRevFiles(api: Api, id: string, rev: number): Promise<RevFile[]> {
  const item = await api.call('get_work_item', { id, rev, include_content: true });
  return (Array.isArray(item?.files) ? item.files : []).filter((f: any) => typeof f?.path === 'string' && typeof f?.content === 'string').map((f: any) => ({ path: f.path, language: str(f.language, 30), content: f.content }));
}

/** Restore revision `rev` as the newest one. Returns the new revision number. */
export async function restoreRevision(api: Api, item: Pick<RItem, 'id' | 'type' | 'name' | 'rev'>, rev: number): Promise<number> {
  const [files, cur] = await Promise.all([loadRevFiles(api, item.id, rev), api.call('get_work_item', { id: item.id, include_content: false })]);
  if (!files.length) throw new Error('That revision has no files.');
  const kind = item.type === 'agent' ? 'agent' : item.type === 'workflow' ? 'workflow' : 'code';
  const res = await api.call('save_work_item', rollbackArgs({ id: item.id, kind, name: item.name, currentRev: Number(cur?.current_rev) || item.rev, intent: cur?.intent }, files, rev));
  return Number(res?.rev) || 0;
}
