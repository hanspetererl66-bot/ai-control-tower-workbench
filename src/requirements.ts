/**
 * Requirements from the tools people already use (Jira, Linear, Figma, Slack, Teams, Notion): load them, cluster them, classify each cluster and hand it over.
 * Pure functions only: prompts for the agent, tolerant reading of its JSON answers, validation, and the hand-over text.
 * The agent reads the sources with the connectors that exist (jira_*, slack_*; a Notion tool if one is installed) and answers
 * with JSON, the same pattern as the process interview. Nothing is written back to the sources here.
 */

export type SourceKind = 'jira' | 'linear' | 'figma' | 'slack' | 'teams' | 'notion';

/** What kind of thing a source holds: tickets are already requirements, conversations and design comments have to be judged. */
export type SourceNature = 'ticket' | 'conversation' | 'design comment' | 'page';
export const NATURE: Record<SourceKind, SourceNature> = { jira: 'ticket', linear: 'ticket', figma: 'design comment', slack: 'conversation', teams: 'conversation', notion: 'page' };
export const NATURE_HINT: Record<SourceNature, string> = {
  ticket: 'Already written as work items.', conversation: 'Talk, so Joule picks out what is a requirement.', 'design comment': 'Open comments on a design.', page: 'Pages and databases, read as written.',
};
export const SOURCES: Array<{ id: SourceKind; label: string; query: string; placeholder: string; help: string }> = [
  { id: 'jira', label: 'Jira', query: 'Project key, JQL or search words', placeholder: 'e.g. ABC, or: project = ABC AND labels = joule ORDER BY updated DESC', help: 'Uses the Jira connector (read only).' },
  { id: 'linear', label: 'Linear', query: 'Team key (e.g. ENG), an issue link or search words', placeholder: 'e.g. ENG, or: renewal reminder', help: 'Uses the Linear connector (read only).' },
  { id: 'figma', label: 'Figma', query: 'A file or frame link, or a file key', placeholder: 'e.g. a link from Figma (Share, Copy link), with ?node-id= for one frame', help: 'Uses the Figma connector (read only). Reads open comments and the text in frames; it does not look at the pictures.' },
  { id: 'slack', label: 'Slack', query: 'Channel, thread link or search words', placeholder: 'e.g. #requirements, or a link to a thread', help: 'Uses the Slack connector (read only).' },
  { id: 'teams', label: 'Microsoft Teams', query: 'Team and channel, a message link or search words', placeholder: 'e.g. Sales / Requirements, or a link from "Copy link to message"', help: 'Uses the Microsoft Teams connector (read only). The app needs permission to read channel messages.' },
  { id: 'notion', label: 'Notion', query: 'Page, database or search words', placeholder: 'e.g. the name of your requirements database', help: 'Uses the Notion connector (read only). Share the pages with its integration first.' },
];

export type Requirement = {
  id: string; source: SourceKind; key: string; title: string; text: string; url: string; author: string; date: string;
  /** How many distinct messages or pages said the same thing (counted by the agent; 1 when unknown). */
  mentions?: number;
  /** Up to three short verbatim quotes that back the count. */
  quotes?: string[];
};
/** The link from a project or feature back to what it came from. Small on purpose: it is stored with every revision. */
export type SourceRef = { source: SourceKind; key: string; title: string; url: string };
export type ExtendsRef = { id: string; name: string };

export const MAX_ITEMS = 40;

/**
 * Which source a pasted link or query belongs to, so the person does not have to choose first. Only what is clear: a link to one of
 * the six tools, a Slack #channel, a JQL query. A bare key such as ABC-12 could be Jira or Linear, so it is not guessed.
 */
export function detectSource(input: string): SourceKind | null {
  const q = input.trim();
  if (!q) return null;
  const url = /^https?:\/\/([^\s/]+)/i.exec(q)?.[1]?.toLowerCase() ?? '';
  if (url) {
    const on = (d: string) => url === d || url.endsWith(`.${d}`);
    if (on('atlassian.net') || on('jira.com')) return 'jira';
    if (url === 'linear.app') return 'linear';
    if (on('figma.com')) return 'figma';
    if (on('slack.com')) return 'slack';
    if (url === 'teams.microsoft.com' || on('teams.live.com')) return 'teams';
    if (on('notion.so') || on('notion.site')) return 'notion';
    return null;
  }
  if (/^#[\w-]{2,}$/.test(q)) return 'slack';
  if (/^[\w .-]+\s\/\s[\w .-]+$/.test(q)) return 'teams';
  if (/\b(project|status|statusCategory|labels?|issuetype|assignee|reporter|sprint|epic|resolution|component|fixVersion)\b\s*(=|!=|~|in\b|is\b)/i.test(q)) return 'jira';
  return null;
}

/** How many requirements each source brought into the list, in the order of the tabs. */
export function countBySource(list: Requirement[]): Array<{ source: SourceKind; count: number }> {
  return SOURCES.map((s) => ({ source: s.id, count: list.filter((r) => r.source === s.id).length })).filter((x) => x.count > 0);
}

const cut = (v: unknown, n: number) => String(v ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const urlOf = (v: unknown) => { const s = cut(v, 400); return /^https?:\/\/\S+$/i.test(s) ? s : ''; };
const isSource = (v: unknown): v is SourceKind => v === 'jira' || v === 'linear' || v === 'figma' || v === 'slack' || v === 'teams' || v === 'notion';

/** What to ask Jira: a bare project key, a JQL query (has an operator) or free text. */
export function jqlOf(query: string): string {
  const q = query.trim();
  if (!q) return '';
  if (/\b(project|status|statusCategory|labels?|issuetype|type|assignee|reporter|priority|sprint|epic|parent|created|updated|resolution|component|fixVersion|text|summary|description)\b\s*(=|!=|~|!~|in\b|not\s+in\b|is\b|>|<)/i.test(q)) return q;
  if (/^[A-Z][A-Z0-9_]{1,9}$/.test(q)) return `project = ${q} AND statusCategory != Done ORDER BY updated DESC`;
  return `text ~ "${q.replace(/["\\]/g, ' ')}" ORDER BY updated DESC`;
}

const JSON_ONLY = 'Answer with one JSON object only, inside a ```json block. No other text. Use read-only tools only: never create, change, comment on or post anything.';

/** What to ask Linear: a bare team key, an issue link or identifier, or free text. */
export function linearHint(query: string): string {
  const q = query.trim();
  if (/^[A-Za-z][A-Za-z0-9]{0,9}$/.test(q)) return `team ${q.toUpperCase()}`;
  if (/^https:\/\/linear\.app\/\S+$/i.test(q) || /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,7}$/.test(q)) return `issue ${q}`;
  return `search words: ${q}`;
}

export function fetchPrompt(source: SourceKind, query: string): string {
  const signal = source === 'jira' || source === 'linear' ? '' : ',"mentions":<whole number: how many different messages or pages say the same thing, 1 if only one>,"quotes":["<up to 3 short verbatim quotes, each with who and when if known, at most 160 characters>"]';
  const shape = `{"items":[{"key":"<id in the source, e.g. ABC-12>","title":"<one line>","text":"<the requirement in at most 500 characters, in the original language>","url":"<link or empty>","author":"<name or empty>","date":"<YYYY-MM-DD or empty>"${signal}}],"error":"<empty, or why nothing could be read>"}`;
  const merge = source === 'jira' || source === 'linear' ? '' : ' When several messages or pages state the same need, return ONE item for them, set "mentions" to the real number of different messages or pages and put up to three of them as verbatim quotes. Count only what you read; never estimate.';
  const limit = `Return at most ${MAX_ITEMS} items. Shorten long texts; do not invent anything. If you cannot read the source (no tool, no access, nothing found), return an empty list and say why in "error".${merge}`;
  if (source === 'jira') {
    return ['Read requirements from Jira.', `Run jira_search_issues with this JQL: ${jqlOf(query)}`, 'Use jira_get_issue only where the description is needed to understand the requirement (at most 10 issues).', limit, `Format: ${shape}`, JSON_ONLY].join('\n');
  }
  if (source === 'linear') {
    return ['Read requirements from Linear.', `Source: ${linearHint(query)}`, 'Use the Linear connector. For a team key use linear_read_backlog; for an issue link or identifier use linear_get_issue; for search words use linear_search_issues. Use linear_get_issue only where the description is needed to understand the requirement (at most 10 issues). Each issue that states a need, a wish, a problem or a rule becomes one item; the identifier (for example ENG-12) is the key, the issue link the url. If a Linear tool is not available to you, return an empty list and say so in "error".', limit, `Format: ${shape}`, JSON_ONLY].join('\n');
  }
  if (source === 'figma') {
    return ['Read requirements from Figma.', `Source: ${query.trim()}`, 'Use the Figma connector. Start with figma_list_comments (open comments are the main source: a comment that states a need, a change request or a question about behaviour is a requirement). Then, where the design itself states rules (labels, error messages, notes, annotations), use figma_get_file_outline to find the frames and figma_read_frame_text for the frame named in the link or the most relevant ones (at most 5 frames). You read text only: never claim what a screen looks like. Skip layout chatter, lorem ipsum and generic button labels. As key use the comment id (for example "c-123") or the frame id plus a number (for example "12:34 #2"), as url the link to the file or frame. If a Figma tool is not available to you, return an empty list and say so in "error".', limit, `Format: ${shape}`, JSON_ONLY].join('\n');
  }
  if (source === 'slack') {
    return ['Read requirements from Slack.', `Source: ${query.trim()}`, 'Use slack_read_channel or slack_read_thread for a channel or thread, slack_search_messages for search words. Keep messages that state a need, a wish, a problem or a rule; skip chatter. As key use the channel and the message time (for example "#req 1730640000").', limit, `Format: ${shape}`, JSON_ONLY].join('\n');
  }
  if (source === 'teams') {
    return ['Read requirements from Microsoft Teams.', `Source: ${query.trim()}`, 'Use the Microsoft Teams connector. If the source is a message link, give it as "link" to teams_read_channel (the channel) or teams_read_thread (the message with its replies). If it names a team and channel, find the ids with teams_list_teams and teams_list_channels, then read the channel with teams_read_channel; for search words use its "contains" parameter. Use teams_read_thread for messages that have replies and are worth reading in full (at most 10). Keep messages that state a need, a wish, a problem or a rule; skip chatter, greetings and system messages. As key use the channel name and the message id (for example "Requirements 1730640000123"), as url the link of the message. If a Teams tool is not available to you, return an empty list and say so in "error".', limit, `Format: ${shape}`, JSON_ONLY].join('\n');
  }
  return ['Read requirements from Notion.', `Source: ${query.trim()}`, 'Use the Notion connector: notion_search to find pages or databases (a link or id can go straight to notion_read_page or notion_query_database), notion_read_page for the text of a page, notion_query_database for the rows of a database. If a Notion tool is not available to you, return an empty list and say so in "error". Each page or row that states a requirement becomes one item; the page title is the title, the page id the key, the page link the url. A page that only holds several requirements as a list becomes one item per list entry (key: page id plus a number).', limit, `Format: ${shape}`, JSON_ONLY].join('\n');
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
    const quotes = Array.isArray(r.quotes) ? r.quotes.map((q: unknown) => cut(q, 200)).filter(Boolean).slice(0, 3) : [];
    const n = Math.floor(Number(r.mentions));
    const mentions = source === 'jira' || !Number.isFinite(n) || n < 1 ? 1 : Math.min(n, 99);
    items.push({ id, source, key, title: title || body.slice(0, 80), text: body, url: urlOf(r.url), author: cut(r.author, 80), date: cut(r.date, 20), ...(mentions > 1 ? { mentions } : {}), ...(quotes.length ? { quotes } : {}) });
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

const entry = (r: Requirement) => `- ${r.id} | ${r.title}${r.text ? ` | ${r.text.slice(0, 300)}` : ''}${r.mentions && r.mentions > 1 ? ` | said ${r.mentions} times` : ''}`;

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

// ---------- signals: how often a need was voiced, and where ----------

export type Signal = { total: number; bySource: Partial<Record<SourceKind, number>>; evidence: Array<{ source: SourceKind; key: string; quote: string; url: string }> };
export const mentionsOf = (r: Requirement): number => Math.max(1, r.mentions ?? 1);

/** What a cluster adds up to. Computed from its requirements, so it can never claim more than the agent reported for them. */
export function signalOf(c: Pick<Cluster, 'reqIds'>, reqs: Requirement[]): Signal {
  const bySource: Signal['bySource'] = {};
  const evidence: Signal['evidence'] = [];
  let total = 0;
  for (const id of c.reqIds) {
    const r = reqs.find((x) => x.id === id);
    if (!r) continue;
    const n = mentionsOf(r);
    total += n;
    bySource[r.source] = (bySource[r.source] ?? 0) + n;
    for (const q of r.quotes ?? []) if (evidence.length < 8) evidence.push({ source: r.source, key: r.key, quote: q, url: r.url });
  }
  return { total, bySource, evidence };
}

/** One line for the card: "7 mentions · Slack 5 · Notion 2". Empty for a single mention from a single source. */
export function signalLine(s: Signal): string {
  const parts = SOURCES.filter((x) => s.bySource[x.id]).map((x) => `${x.label} ${s.bySource[x.id]}`);
  if (s.total < 2 && parts.length < 2) return '';
  return `${s.total} mention${s.total === 1 ? '' : 's'} · ${parts.join(' · ')}`;
}

export type Handover = {
  /** Which door it goes through. Extensions start a normal agent or workflow project and keep the link to the one they extend. */
  base: 'agent' | 'workflow' | 'feature';
  name: string;
  /** At most 400 characters: the goal field of the Develop tiles. */
  goal: string;
  /** What the cluster is about, without the "Extend ..." lead. */
  summary: string;
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
    ...(signalLine(signalOf(c, reqs)) ? ['', `**Signals:** ${signalLine(signalOf(c, reqs))} (counted by the agent from what it read)`] : []),
    '',
    '## Requirements',
    ...mine.map((r) => `- **${r.key}** (${r.source}) ${r.title}${r.text && r.text !== r.title ? `: ${r.text}` : ''}${r.url ? ` ${r.url}` : ''}${r.mentions && r.mentions > 1 ? ` [${r.mentions} mentions]` : ''}`),
  ].join('\n');
  return { base: classBase(c.cls), name: c.title.slice(0, 80), goal, summary: (c.summary || c.title).replace(/\s+/g, ' ').trim().slice(0, 400), refs: mine.map(refOf), ...(ext ? { extends: ext } : {}), brief };
}

/** The requirement lines of a hand-over, for the goal of a workflow project (which has room for them). */
export const requirementLines = (h: Handover): string => (h.brief.split('## Requirements\n')[1] ?? '').trim();

export const CAN_HAND_OVER = (c: Cluster) => !(isExtension(c.cls) && !c.target) && c.reqIds.length > 0;

// ---------- extension of an existing agent or workflow ----------

/** One extension that was added to an existing project: it becomes a new revision of the same registry item. */
export type Extension = { at: number; title: string; summary: string; refs: SourceRef[]; lines: string };
export const MAX_EXTENSIONS = 20;

export function sanitizeExtensions(v: any): Extension[] {
  if (!Array.isArray(v)) return [];
  const out: Extension[] = [];
  for (const e of v) {
    if (!e || typeof e !== 'object') continue;
    const title = cut(e.title, 120);
    if (!title) continue;
    out.push({ at: Number.isFinite(e.at) ? e.at : 0, title, summary: cut(e.summary, 400), refs: sanitizeRefs(e.refs).slice(0, 40), lines: String(e.lines ?? '').trim().slice(0, 3000) });
    if (out.length >= MAX_EXTENSIONS) break;
  }
  return out;
}

export function newExtension(h: Handover, now = Date.now()): Extension {
  return { at: now, title: h.name.slice(0, 120), summary: h.summary, refs: h.refs.slice(0, 40), lines: requirementLines(h).slice(0, 3000) };
}

/** The extensions as text for prompts and documents: oldest first, each with its requirements. */
export function extensionText(list: Extension[]): string {
  return list.map((e, i) => [`Extension ${i + 1}: ${e.title}${e.at ? ` (${new Date(e.at).toISOString().slice(0, 10)})` : ''}`, e.summary, e.lines].filter(Boolean).join('\n')).join('\n\n').slice(0, 4000);
}

/** The note of the revision that an extension causes (shown in the registry timeline). */
export function extensionNote(e: Extension): string {
  const keys = e.refs.map((r) => r.key).slice(0, 6).join(', ');
  return `Extended: ${e.title.slice(0, 80)}${keys ? ` (${keys}${e.refs.length > 6 ? ', …' : ''})` : ''}`.slice(0, 200);
}

/** Existing sources plus the new ones, without duplicates. */
export function mergeRefs(have: SourceRef[] | undefined, add: SourceRef[]): SourceRef[] {
  return sanitizeRefs([...(have ?? []), ...add]);
}

/**
 * Where the registry item of an extension lives on this computer: the sync map links work item ids to local projects
 * ("a:<id>" agent project, "d:<id>" Develop project). null = not here (another computer, or never synced).
 */
export function localTarget(map: Record<string, { itemId: string }>, itemId: string): { kind: 'agent' | 'dev'; id: string } | null {
  for (const [key, entry] of Object.entries(map)) {
    if (entry.itemId !== itemId) continue;
    if (key.startsWith('a:')) return { kind: 'agent', id: key.slice(2) };
    if (key.startsWith('d:')) return { kind: 'dev', id: key.slice(2) };
  }
  return null;
}
