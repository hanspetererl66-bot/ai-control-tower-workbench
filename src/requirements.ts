/**
 * Requirements from the tools people already use (Jira, Slack, Notion): load them, cluster them, classify each cluster and hand it over.
 * Pure functions only: prompts for the agent, tolerant reading of its JSON answers, validation, and the hand-over text.
 * The agent reads the sources with the connectors that exist (jira_*, slack_*; a Notion tool if one is installed) and answers
 * with JSON, the same pattern as the process interview. Nothing is written back to the sources here.
 */

export type SourceKind = 'jira' | 'slack' | 'notion';

export const SOURCES: Array<{ id: SourceKind; label: string; query: string; placeholder: string; help: string }> = [
  { id: 'jira', label: 'Jira', query: 'Project key, JQL or search words', placeholder: 'e.g. ABC, or: project = ABC AND labels = joule ORDER BY updated DESC', help: 'Uses the Jira connector (read only).' },
  { id: 'slack', label: 'Slack', query: 'Channel, thread link or search words', placeholder: 'e.g. #requirements, or a link to a thread', help: 'Uses the Slack connector (read only).' },
  { id: 'notion', label: 'Notion', query: 'Page, database or search words', placeholder: 'e.g. the name of your requirements database', help: 'Needs a Notion connector in the agent. This repository has none yet; without one the agent says so.' },
];

export type Requirement = { id: string; source: SourceKind; key: string; title: string; text: string; url: string; author: string; date: string };
/** The link from a project or feature back to what it came from. Small on purpose: it is stored with every revision. */
export type SourceRef = { source: SourceKind; key: string; title: string; url: string };
export type ExtendsRef = { id: string; name: string };

export const MAX_ITEMS = 40;
const cut = (v: unknown, n: number) => String(v ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const urlOf = (v: unknown) => { const s = cut(v, 400); return /^https?:\/\/\S+$/i.test(s) ? s : ''; };
const isSource = (v: unknown): v is SourceKind => v === 'jira' || v === 'slack' || v === 'notion';

/** What to ask Jira: a bare project key, a JQL query (has an operator) or free text. */
export function jqlOf(query: string): string {
  const q = query.trim();
  if (!q) return '';
  if (/\b(project|status|statusCategory|labels?|issuetype|type|assignee|reporter|priority|sprint|epic|parent|created|updated|resolution|component|fixVersion|text|summary|description)\b\s*(=|!=|~|!~|in\b|not\s+in\b|is\b|>|<)/i.test(q)) return q;
  if (/^[A-Z][A-Z0-9_]{1,9}$/.test(q)) return `project = ${q} AND statusCategory != Done ORDER BY updated DESC`;
  return `text ~ "${q.replace(/["\\]/g, ' ')}" ORDER BY updated DESC`;
}

const JSON_ONLY = 'Answer with one JSON object only, inside a ```json block. No other text. Use read-only tools only: never create, change, comment on or post anything.';

export function fetchPrompt(source: SourceKind, query: string): string {
  const shape = `{"items":[{"key":"<id in the source, e.g. ABC-12>","title":"<one line>","text":"<the requirement in at most 500 characters, in the original language>","url":"<link or empty>","author":"<name or empty>","date":"<YYYY-MM-DD or empty>"}],"error":"<empty, or why nothing could be read>"}`;
  const limit = `Return at most ${MAX_ITEMS} items. Shorten long texts; do not invent anything. If you cannot read the source (no tool, no access, nothing found), return an empty list and say why in "error".`;
  if (source === 'jira') {
    return ['Read requirements from Jira.', `Run jira_search_issues with this JQL: ${jqlOf(query)}`, 'Use jira_get_issue only where the description is needed to understand the requirement (at most 10 issues).', limit, `Format: ${shape}`, JSON_ONLY].join('\n');
  }
  if (source === 'slack') {
    return ['Read requirements from Slack.', `Source: ${query.trim()}`, 'Use slack_read_channel or slack_read_thread for a channel or thread, slack_search_messages for search words. Keep messages that state a need, a wish, a problem or a rule; skip chatter. As key use the channel and the message time (for example "#req 1730640000").', limit, `Format: ${shape}`, JSON_ONLY].join('\n');
  }
  return ['Read requirements from Notion.', `Source: ${query.trim()}`, 'Use notion_search and notion_get_page (the Notion connector); if they are not installed, use whichever other Notion tool you have (search, fetch a page, query a database). Each page or row that states a requirement becomes one item; the page title is the title, the page id the key.', limit, `Format: ${shape}`, JSON_ONLY].join('\n');
}

function jsonOf(text: string): any | null {
  const fence = /```[\w-]*[^\n]*\n([\s\S]*?)\n```/.exec(text);
  const start = text.search(/[{[]/);
  const body = fence ? fence[1] : start >= 0 ? text.slice(start, Math.max(text.lastIndexOf('}'), text.lastIndexOf(']')) + 1) : '';
  try { return JSON.parse(body); } catch { return null; }
}

/** The items of an answer. null = the answer was not readable at all (ask again); an empty list with an error is a valid answer. */
export function parseRequirements(text: string, source: SourceKind): { items: Requirement[]; error: string } | null {
  const raw = jsonOf(text);
  if (!raw || typeof raw !== 'object') return null;
  const list: unknown = Array.isArray(raw) ? raw : raw.items;
  if (!Array.isArray(list)) return typeof raw.error === 'string' ? { items: [], error: cut(raw.error, 300) } : null;
  const items: Requirement[] = [];
  const seen = new Set<string>();
  list.forEach((r: any, i: number) => {
    if (!r || typeof r !== 'object') return;
    const title = cut(r.title, 160), body = cut(r.text, 600);
    if (!title && !body) return;
    const key = cut(r.key, 60) || `n${i + 1}`;
    const id = `${source}:${key}`;
    if (seen.has(id) || items.length >= MAX_ITEMS) return;
    seen.add(id);
    items.push({ id, source, key, title: title || body.slice(0, 80), text: body, url: urlOf(r.url), author: cut(r.author, 80), date: cut(r.date, 20) });
  });
  return { items, error: cut(raw.error, 300) };
}

/** Adds newly loaded requirements to the list; the same source and key replaces the older entry. */
export function mergeRequirements(list: Requirement[], more: Requirement[]): Requirement[] {
  const byId = new Map(list.map((r) => [r.id, r]));
  for (const r of more) byId.set(r.id, r);
  return [...byId.values()];
}

export const refOf = (r: Requirement): SourceRef => ({ source: r.source, key: r.key, title: r.title.slice(0, 120), url: r.url });

export function sanitizeRefs(v: unknown): SourceRef[] {
  if (!Array.isArray(v)) return [];
  const out: SourceRef[] = [];
  for (const r of v as any[]) {
    if (!r || !isSource(r.source) || !cut(r.key, 60)) continue;
    if (out.some((o) => o.source === r.source && o.key === cut(r.key, 60))) continue;
    out.push({ source: r.source, key: cut(r.key, 60), title: cut(r.title, 120), url: urlOf(r.url) });
    if (out.length >= 60) break;
  }
  return out;
}

export function sanitizeExtends(v: any): ExtendsRef | undefined {
  const id = cut(v?.id, 60), name = cut(v?.name, 120);
  return id && name ? { id, name } : undefined;
}

/** The part of a project that goes into the intent of its work item: where it came from and what it extends (read by the registry). */
export function sourcesOf(p: { sources?: SourceRef[]; extends?: ExtendsRef }): Record<string, unknown> {
  return { ...(p.sources?.length ? { sources: p.sources } : {}), ...(p.extends ? { extends: p.extends } : {}) };
}

// ---------- clusters ----------

export type ReqClass = 'agent' | 'agent-extension' | 'workflow' | 'workflow-extension' | 'feature';
export const CLASSES: ReqClass[] = ['agent', 'agent-extension', 'workflow', 'workflow-extension', 'feature'];
export const CLASS_LABEL: Record<ReqClass, string> = {
  agent: 'Agent', 'agent-extension': 'Agent extension', workflow: 'Workflow', 'workflow-extension': 'Workflow extension', feature: 'Feature development',
};
/** The decision rule per class: shown to the person and given to the agent. */
export const CLASS_RULE: Record<ReqClass, string> = {
  agent: 'A new goal that needs reasoning and a choice of tools.',
  'agent-extension': 'A new tool, skill or piece of knowledge for an agent that already exists.',
  workflow: 'Fixed steps, started by a trigger, the same every time.',
  'workflow-extension': 'A new step, branch or trigger in a workflow that already exists.',
  feature: 'A change to an application (screen, backend, interface) that is neither an agent nor a workflow.',
};
export const classBase = (c: ReqClass): 'agent' | 'workflow' | 'feature' => (c.startsWith('agent') ? 'agent' : c.startsWith('workflow') ? 'workflow' : 'feature');
export const isExtension = (c: ReqClass) => c === 'agent-extension' || c === 'workflow-extension';

/** What the registry offers as targets for an extension (id, kind, name). */
export type RegistryRef = { id: string; kind: 'agent' | 'workflow' | 'feature' | 'code'; name: string };

export type Cluster = {
  id: string; title: string; summary: string;
  /** Requirement ids in this cluster. */
  reqIds: string[];
  /** Requirements that were not ticked but may belong here; the person decides. */
  suggestions: Array<{ reqId: string; reason: string }>;
  cls: ReqClass; confidence: number; reason: string;
  target: { id: string; name: string } | null;
  /** The class the agent proposed, when the person changed it. */
  overriddenFrom?: ReqClass;
  /** Set when the agent proposed an extension without naming an existing agent or workflow. */
  warning?: string;
};

const entry = (r: Requirement) => `- ${r.id} | ${r.title}${r.text ? ` | ${r.text.slice(0, 300)}` : ''}`;

export function clusterPrompt(selected: Requirement[], others: Requirement[], registry: RegistryRef[]): string {
  const known = registry.filter((r) => r.kind === 'agent' || r.kind === 'workflow');
  return [
    'You are a senior business analyst. Group the selected requirements into clusters by topic and classify each cluster.',
    '',
    '## Classes (choose exactly one per cluster)',
    ...CLASSES.map((c) => `- ${c}: ${CLASS_RULE[c]}`),
    'For agent-extension and workflow-extension name the existing agent or workflow in target_id, taken from the list below. If none of them fits, the cluster is a new agent or workflow, not an extension.',
    '',
    '## Existing agents and workflows',
    ...(known.length ? known.map((r) => `- ${r.id} | ${r.kind} | ${r.name}`) : ['(none)']),
    '',
    '## Selected requirements (id | title | text)',
    ...selected.map(entry),
    '',
    '## Other requirements that were loaded but not selected',
    ...(others.length ? others.map(entry) : ['(none)']),
    '',
    '## Rules',
    '- Every selected requirement belongs to exactly one cluster. Use the ids exactly as given.',
    '- Give each cluster a short title and a summary of one or two sentences.',
    '- Check the not selected requirements: if one belongs to a cluster (duplicate, overlap, dependency), list it in also_consider with a short reason. Never put it in requirements.',
    '- confidence is a number from 0 to 1 for how sure you are of the class. Say honestly when a cluster could be two classes.',
    '- reason names the rule that decided the class, in one or two sentences.',
    '',
    'Answer with one JSON object only, inside a ```json block, no other text:',
    '{"clusters":[{"title":"","summary":"","requirements":["id"],"also_consider":[{"id":"","reason":""}],"class":"agent|agent-extension|workflow|workflow-extension|feature","confidence":0.0,"reason":"","target_id":""}]}',
  ].join('\n');
}

export function commentOf(c: Cluster): string {
  const parts = [`Class: ${CLASS_LABEL[c.cls]}`, `Confidence ${Math.round(c.confidence * 100)} %`];
  if (c.target && isExtension(c.cls)) parts.push(`Extends: ${c.target.name}`);
  const head = parts.join(' · ');
  const why = c.reason ? `\nWhy: ${c.reason}` : '';
  const changed = c.overriddenFrom ? `\nChanged by you from ${CLASS_LABEL[c.overriddenFrom]} (the agent proposed that).` : '';
  return `${head}${why}${changed}`;
}

const clamp01 = (v: unknown, fallback: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback; };

/** Reads and checks the cluster answer. Every selected requirement ends up in exactly one cluster; nothing unknown gets through. */
export function parseClusters(text: string, selected: Requirement[], others: Requirement[], registry: RegistryRef[]): { clusters: Cluster[]; warnings: string[] } | null {
  const raw = jsonOf(text);
  const list: unknown = Array.isArray(raw) ? raw : raw?.clusters;
  if (!Array.isArray(list)) return null;
  const sel = new Set(selected.map((r) => r.id)), oth = new Set(others.map((r) => r.id));
  const placed = new Set<string>();
  const warnings: string[] = [];
  const clusters: Cluster[] = [];
  list.slice(0, 20).forEach((c: any, i: number) => {
    if (!c || typeof c !== 'object') return;
    const reqIds: string[] = [];
    for (const id of Array.isArray(c.requirements) ? c.requirements : []) {
      if (typeof id !== 'string' || !sel.has(id) || placed.has(id)) continue;
      placed.add(id); reqIds.push(id);
    }
    if (!reqIds.length) return;
    const suggestions: Cluster['suggestions'] = [];
    for (const s of Array.isArray(c.also_consider) ? c.also_consider : []) {
      const id = typeof s?.id === 'string' ? s.id : '';
      if (!oth.has(id) || sel.has(id) || suggestions.some((x) => x.reqId === id)) continue;
      suggestions.push({ reqId: id, reason: cut(s.reason, 200) });
      if (suggestions.length >= 5) break;
    }
    let cls: ReqClass = CLASSES.includes(c.class) ? c.class : 'feature';
    let confidence = clamp01(c.confidence, 0.5), reason = cut(c.reason, 400), warning = '';
    if (!CLASSES.includes(c.class)) { confidence = Math.min(confidence, 0.2); warning = 'The agent gave no valid class; please choose one.'; }
    let target: Cluster['target'] = null;
    if (isExtension(cls)) {
      const want = classBase(cls);
      const hit = registry.find((r) => r.id === String(c.target_id ?? '') && r.kind === want);
      if (hit) target = { id: hit.id, name: hit.name };
      else warning = `No existing ${want} was named for this extension. Choose one, or change the class to a new ${want}.`;
    }
    if (warning) warnings.push(`${cut(c.title, 60) || `Cluster ${i + 1}`}: ${warning}`);
    clusters.push({ id: `c${i + 1}`, title: cut(c.title, 100) || `Cluster ${i + 1}`, summary: cut(c.summary, 400), reqIds, suggestions, cls, confidence, reason, target, ...(warning ? { warning } : {}) });
  });
  if (!clusters.length) return null; // the agent placed nothing: not an answer, ask again instead of showing one big "Not placed"
  const missing = selected.filter((r) => !placed.has(r.id)).map((r) => r.id);
  if (missing.length) {
    clusters.push({ id: `c${clusters.length + 1}`, title: 'Not placed', summary: 'The agent did not place these requirements. Decide yourself.', reqIds: missing, suggestions: [], cls: 'feature', confidence: 0.1, reason: 'Left over after clustering; no class was proposed.', target: null, warning: 'Left over after clustering.' });
    warnings.push(`${missing.length} requirement${missing.length > 1 ? 's' : ''} not placed by the agent; collected in "Not placed".`);
  }
  return clusters.length ? { clusters, warnings } : null;
}

// ---------- editing a cluster by hand ----------

/** The person changes the class. The first proposal of the agent stays visible. A class without an extension target drops the target. */
export function overrideClass(c: Cluster, cls: ReqClass, registry: RegistryRef[] = []): Cluster {
  if (cls === c.cls) return c;
  const from = c.overriddenFrom ?? c.cls;
  const keep = isExtension(cls) && c.target && registry.some((r) => r.id === c.target!.id && r.kind === classBase(cls)) ? c.target : null;
  const warning = isExtension(cls) && !keep ? `Choose the existing ${classBase(cls)} this extends.` : undefined;
  const { warning: _old, overriddenFrom: _from, ...rest } = c;
  return { ...rest, cls, target: keep, ...(from === cls ? {} : { overriddenFrom: from }), ...(warning ? { warning } : {}) };
}

export function setTarget(c: Cluster, target: { id: string; name: string } | null): Cluster {
  const { warning: _old, ...rest } = c;
  return { ...rest, target, ...(isExtension(c.cls) && !target ? { warning: `Choose the existing ${classBase(c.cls)} this extends.` } : {}) };
}

/** Puts a requirement into a cluster (from another cluster or from the suggestions). Empty clusters disappear. */
export function moveRequirement(clusters: Cluster[], reqId: string, toId: string): Cluster[] {
  if (!clusters.some((c) => c.id === toId)) return clusters;
  return clusters
    .map((c) => ({
      ...c,
      reqIds: c.id === toId ? (c.reqIds.includes(reqId) ? c.reqIds : [...c.reqIds, reqId]) : c.reqIds.filter((x) => x !== reqId),
      suggestions: c.suggestions.filter((s) => s.reqId !== reqId),
    }))
    .filter((c) => c.reqIds.length > 0);
}

export function dismissSuggestion(clusters: Cluster[], clusterId: string, reqId: string): Cluster[] {
  return clusters.map((c) => (c.id === clusterId ? { ...c, suggestions: c.suggestions.filter((s) => s.reqId !== reqId) } : c));
}

// ---------- hand-over ----------

export type Handover = {
  /** Which door it goes through. Extensions start a normal agent or workflow project and keep the link to the one they extend. */
  base: 'agent' | 'workflow' | 'feature';
  name: string;
  /** At most 400 characters: the goal field of the Develop tiles. */
  goal: string;
  refs: SourceRef[];
  extends?: ExtendsRef;
  /** The full text: cluster, requirements with their sources, the comment. Goes into the feature brief and the project. */
  brief: string;
};

export function handover(c: Cluster, reqs: Requirement[]): Handover {
  const mine = c.reqIds.map((id) => reqs.find((r) => r.id === id)).filter((r): r is Requirement => Boolean(r));
  const ext = isExtension(c.cls) && c.target ? { id: c.target.id, name: c.target.name } : undefined;
  const lead = ext ? `Extend "${ext.name}": ` : '';
  const goal = `${lead}${c.summary || c.title}`.replace(/\s+/g, ' ').trim().slice(0, 400);
  const brief = [
    `# ${c.title}`,
    '',
    c.summary,
    '',
    `**${commentOf(c).split('\n').join('  \n')}**`,
    '',
    '## Requirements',
    ...mine.map((r) => `- **${r.key}** (${r.source}) ${r.title}${r.text && r.text !== r.title ? `: ${r.text}` : ''}${r.url ? ` ${r.url}` : ''}`),
  ].join('\n');
  return { base: classBase(c.cls), name: c.title.slice(0, 80), goal, refs: mine.map(refOf), ...(ext ? { extends: ext } : {}), brief };
}

/** The requirement lines of a hand-over, for the goal of a workflow project (which has room for them). */
export const requirementLines = (h: Handover): string => (h.brief.split('## Requirements\n')[1] ?? '').trim();

export const CAN_HAND_OVER = (c: Cluster) => !(isExtension(c.cls) && !c.target) && c.reqIds.length > 0;
