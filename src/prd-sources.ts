/**
 * Sources for the PRD Builder besides Jira: Linear (tickets), Slack (messages of a channel) and Notion (the sections of a page).
 * The connectors answer in their own shapes; this turns every answer into the one shape the PRD model reads (a Jira-like issue).
 * Slack messages and Notion sections are "notes": quotes that someone still has to phrase as a requirement. Pure functions, no network.
 */
export type PrdSource = 'jira' | 'linear' | 'slack' | 'notion';
export type PrdIssue = {
  key: string;
  summary: string;
  /** Epic (a group), Story (a requirement) or Note (a quote from Slack or Notion). */
  type: 'Epic' | 'Story' | 'Note' | string;
  status: string;
  priority: string;
  parentKey: string | null;
  parentSummary: string | null;
  labels: string[];
  description: string;
  source: PrdSource;
  url: string;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const strings = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, n).map((x) => x.slice(0, 60)) : []);
/** A short, safe piece of an id for keys: letters, digits and dashes only. */
const bit = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export const MAX_ISSUES = 100;
export const TEAM_KEY = /^[A-Za-z][A-Za-z0-9]{0,9}$/;
export const SLACK_CHANNEL_ID = /^[CG][A-Z0-9]{6,20}$/;
export const SLACK_CHANNEL_NAME = /^#?[a-z0-9][a-z0-9._-]{0,79}$/;

/** The 32-character id of a Notion page from a bare id (with or without dashes) or from a notion.so link; null when there is none. */
export function notionId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text || text.length > 400) return null;
  if (/^https?:\/\//i.test(text) && !/^https:\/\/([a-z0-9-]+\.)?notion\.(so|site)\//i.test(text)) return null;
  const m = /([0-9a-f]{32})(?:[^0-9a-f]|$)/i.exec(text.replace(/-/g, '')) ;
  return m ? m[1].toLowerCase() : null;
}

/** Linear priority labels onto the scale of the PRD model. */
const LINEAR_PRIORITY: Record<string, string> = { Urgent: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low' };

/** Linear: the issues of a team, grouped under their project (the project becomes the epic). */
export function fromLinear(rows: unknown): PrdIssue[] {
  const list = (Array.isArray(rows) ? rows : []).filter(isObject).slice(0, MAX_ISSUES);
  const epics = new Map<string, PrdIssue>();
  const out: PrdIssue[] = [];
  for (const r of list) {
    const project = str(r.project, 120);
    let parentKey: string | null = null;
    if (project) {
      const ek = `LIN-P-${bit(project) || 'project'}`;
      if (!epics.has(ek)) epics.set(ek, { key: ek, summary: project, type: 'Epic', status: '', priority: '', parentKey: null, parentSummary: null, labels: [], description: '', source: 'linear', url: '' });
      parentKey = ek;
    }
    const key = str(r.id, 30);
    if (!key) continue;
    out.push({
      key, summary: str(r.title, 300), type: 'Story', status: str(r.state, 40), priority: LINEAR_PRIORITY[str(r.priority, 20)] ?? '',
      parentKey, parentSummary: project || null, labels: strings(r.labels, 10), description: str(r.description, 1800), source: 'linear', url: str(r.url, 300),
    });
  }
  return [...epics.values(), ...out];
}

/** Slack text into plain text: mentions, links and channel references become readable, entities are decoded. */
export function slackPlain(text: string): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (_m, id, name) => `@${name || id}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<(https?:[^|>]+)\|([^>]*)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/<!(here|channel|everyone)[^>]*>/g, '@$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+\n/g, '\n').trim();
}

/** The first sentence or line of a text, at most `n` characters, for the headline of a note. */
const headline = (text: string, n = 100) => {
  const one = text.replace(/\s+/g, ' ').trim();
  const cut = /^(.{20,}?[.!?])(\s|$)/.exec(one)?.[1] ?? one;
  return cut.length > n ? `${cut.slice(0, n - 1).trimEnd()}…` : cut;
};

const MIN_NOTE = 20;
/** Slack: the top-level messages of a channel as notes (short chatter and thread replies are left out), under the channel as the group. */
export function fromSlack(messages: unknown, channelName: string): PrdIssue[] {
  const name = bit(channelName.replace(/^#/, '')).toLowerCase() || 'channel';
  const ek = `SLACK-C-${name}`;
  const notes: PrdIssue[] = [];
  for (const m of (Array.isArray(messages) ? messages : []).filter(isObject).slice(0, 50)) {
    const ts = str(m.ts, 30);
    if (!/^\d{9,12}\.\d{1,8}$/.test(ts) || str(m.thread_ts, 30)) continue;
    const text = slackPlain(str(m.text, 3500));
    if (text.length < MIN_NOTE) continue;
    notes.push({
      key: `SLACK-${ts}`, summary: headline(text), type: 'Note', status: '', priority: '', parentKey: ek, parentSummary: `Slack #${name}`,
      labels: ['slack', `#${name}`], description: text.slice(0, 1800), source: 'slack', url: '',
    });
  }
  if (!notes.length) return [];
  return [{ key: ek, summary: `Slack #${name}`, type: 'Epic', status: '', priority: '', parentKey: null, parentSummary: null, labels: [], description: '', source: 'slack', url: '' }, ...notes];
}

/** Notion: a page read by the connector (text with "#" headings) as notes, one per section, under the page as the group. */
export function fromNotion(page: unknown): PrdIssue[] {
  if (!isObject(page)) return [];
  const id = notionId(str(page.id, 60)) ?? '';
  const title = str(page.title, 160) || 'Notion page';
  const ek = `NOTION-${id.slice(0, 8) || bit(title) || 'page'}`;
  const url = str(page.url, 300);
  const sections: Array<{ head: string; body: string[] }> = [];
  for (const line of str(page.text, 6000).split('\n')) {
    const h = /^#{1,3}\s+(.*\S)\s*$/.exec(line);
    if (h) { sections.push({ head: h[1].slice(0, 120), body: [] }); continue; }
    if (!sections.length) sections.push({ head: title, body: [] });
    sections[sections.length - 1].body.push(line);
  }
  const notes: PrdIssue[] = [];
  sections.forEach((s, i) => {
    const body = s.body.join('\n').trim();
    if (body.length < MIN_NOTE) return;
    notes.push({
      key: `${ek}-${i + 1}`, summary: s.head, type: 'Note', status: '', priority: '', parentKey: ek, parentSummary: title,
      labels: ['notion'], description: body.slice(0, 1800), source: 'notion', url,
    });
  });
  if (!notes.length) return [];
  return [{ key: ek, summary: title, type: 'Epic', status: '', priority: '', parentKey: null, parentSummary: null, labels: [], description: '', source: 'notion', url }, ...notes];
}

/** Notion search results for the person to choose from. */
export function notionChoices(res: unknown): Array<{ id: string; title: string; url: string }> {
  const list = isObject(res) && Array.isArray(res.results) ? res.results : [];
  return list.filter(isObject).filter((r) => r.type === 'page').slice(0, 10)
    .map((r) => ({ id: str(r.id, 60), title: str(r.title, 160) || 'Untitled', url: str(r.url, 300) })).filter((r) => notionId(r.id));
}
