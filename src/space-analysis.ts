/**
 * Space Analysis (Admin console): checks every installed Space against the rules a Space has to keep (docs/decisions/004:
 * one page, no network, no localStorage, colours only as tokens) and against basic hygiene (cards, size, description,
 * group, age of the data). Pure functions over the Space's metadata and its HTML; the view fetches the HTML.
 * It only reads. Nothing is changed in a Space, and the findings are hints from text patterns, not a proof.
 */
import type { Space } from './spaces';

export type Severity = 'high' | 'medium' | 'low';
export type RuleId = 'network' | 'storage' | 'colors' | 'size' | 'empty' | 'metadata' | 'stale' | 'idle';
export type Finding = { rule: RuleId; severity: Severity; title: string; detail: string; fix: string; count: number };
/** fix: a high finding; review: a medium one; minor: only low ones; ok: none. */
export type Health = 'fix' | 'review' | 'minor' | 'ok';
export type SpaceReport = {
  slug: string; title: string; domain: string; bytes: number; cards: number; asOf: string | null; updatedAt: number;
  findings: Finding[]; health: Health; score: number; error: string; features: FeatureCounts;
};
export type HealthFilter = 'all' | Health;

/** The functions a Space can offer, found by patterns in its page (not by running it). `total` of a function is how often it appears. */
export const FEATURES = [
  { id: 'tabs', label: 'Tabs', hint: 'Views to switch between', re: /role=["']tab["']|class=["'][^"']*\btab(?:-btn|-button|s-btn)?\b[^"']*["']/gi },
  { id: 'kpis', label: 'Key figures', hint: 'KPI tiles with numbers', re: /class=["'][^"']*\b(?:kpi|stat|metric)s?(?:-\w+)?\b/gi },
  { id: 'tables', label: 'Tables', hint: 'Rows and columns', re: /<table\b/gi },
  { id: 'charts', label: 'Charts', hint: 'Inline SVG or canvas drawings', re: /<canvas\b|<svg\b[^>]*\b(?:viewBox|width)=/gi },
  { id: 'search', label: 'Search', hint: 'A search field', re: /type=["']search["']|<input\b[^>]*placeholder=["'][^"']*(?:search|suche|find)/gi },
  { id: 'filters', label: 'Filters', hint: 'Drop-downs and filter buttons', re: /<select\b|class=["'][^"']*\b(?:filter|chip|seg)\b/gi },
  { id: 'detail', label: 'Detail panel', hint: 'Drawer, dialog or side panel', re: /<dialog\b|role=["']dialog["']|class=["'][^"']*\b(?:drawer|modal|detail|panel-side)\b/gi },
  { id: 'actions', label: 'Actions', hint: 'Buttons that do something', re: /<button\b/gi },
  { id: 'chat', label: 'Hand-over to the chat', hint: 'Sends a message to the Werkbank', re: /postMessage\s*\(|ct:open|Ask the agent|Open in (?:the )?chat/gi },
  { id: 'export', label: 'Export', hint: 'Download or copy', re: /\bdownload\b|\.csv\b|navigator\.clipboard|Export\b/g },
  { id: 'keyboard', label: 'Keyboard use', hint: 'Responds to keys', re: /addEventListener\(\s*["']key(?:down|up)["']|\bonkey(?:down|up)=/gi },
  { id: 'dark', label: 'Dark mode', hint: 'Follows the theme', re: /data-theme=["']dark["']|prefers-color-scheme:\s*dark|:root\[data-theme/gi },
] as const;
export type FeatureId = (typeof FEATURES)[number]['id'];
export type FeatureCounts = Record<FeatureId, number>;
const noFeatures = (): FeatureCounts => Object.fromEntries(FEATURES.map((f) => [f.id, 0])) as FeatureCounts;
export function detectFeatures(html: string): FeatureCounts {
  const code = html.replace(/<script[^>]*type=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi, '');
  const out = noFeatures();
  for (const f of FEATURES) out[f.id] = (code.match(f.re) ?? []).length;
  return out;
}
export type FeatureFilter = { id: FeatureId; has: boolean } | null;

export const HEALTH_LABEL: Record<Health, string> = { fix: 'Must fix', review: 'Review', minor: 'Minor', ok: 'Clean' };
export const RULE_LABEL: Record<RuleId, string> = {
  network: 'Network access', storage: 'Browser storage', colors: 'Fixed colours', size: 'Size', empty: 'No cards', metadata: 'Description and group', stale: 'Old data', idle: 'Not touched',
};
const WEIGHT: Record<Severity, number> = { high: 25, medium: 10, low: 3 };
const DAY = 86_400_000;

/** JSON data blocks hold text, not code: URLs, dates and colour names in them are not findings. */
const stripData = (html: string) => html.replace(/<script[^>]*type=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi, '');

const count = (re: RegExp, text: string) => (text.match(re) ?? []).length;

/** Only the first match line, short, for the detail text. */
const sample = (re: RegExp, text: string): string => {
  const m = re.exec(text);
  return m ? m[0].replace(/\s+/g, ' ').slice(0, 60) : '';
};

export function analyzeSpace(space: Space, html: string, now = Date.now()): SpaceReport {
  const code = stripData(html);
  const findings: Finding[] = [];
  const add = (f: Finding) => { if (f.count > 0) findings.push(f); };

  const callRe = /\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|\bEventSource\b|sendBeacon|\bimport\s*\(/g;
  const extRe = /<(?:script|img|link|iframe|source|video|audio|embed)\b[^>]*\b(?:src|href)=["']https?:\/\/[^"']+|@import\s+(?:url\()?["']?https?:|url\(\s*["']?https?:/gi;
  const calls = count(callRe, code), ext = count(extRe, code);
  add({
    rule: 'network', severity: 'high', count: calls + ext, title: 'Reaches for the network',
    detail: `${calls ? `${calls} call${calls === 1 ? '' : 's'} such as ${sample(callRe, code) || 'fetch('}` : ''}${calls && ext ? '; ' : ''}${ext ? `${ext} external file${ext === 1 ? '' : 's'} such as ${sample(extRe, code)}` : ''}.`,
    fix: 'A Space runs in a sandbox without network. Embed the data in the page (data.json, then npm run sync:mockups) and draw charts as inline SVG.',
  });

  const storeRe = /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\.cookie/g;
  const store = count(storeRe, code);
  add({
    rule: 'storage', severity: 'high', count: store, title: 'Uses browser storage',
    detail: `${store} use${store === 1 ? '' : 's'}, for example ${sample(storeRe, code)}.`,
    fix: 'Keep state in memory while the page is open, or send a message to the Werkbank. Spaces keep nothing in the browser.',
  });

  // Colours: a literal hex colour is fine where a token is defined (--name: #hex) or used as the fallback of var(--name, #hex).
  const hexRe = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b(?![0-9a-fA-F])/g;
  const noTokens = code.replace(/--[\w-]+\s*:\s*[^;}\n]+/g, '').replace(/var\(\s*--[\w-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g, '').replace(/&#\d+;|href=["']#[^"']*["']|id=["']#[^"']*["']|url\(#[^)]*\)|["']#[\w-]+["']/g, '');
  const colors = count(hexRe, noTokens);
  add({
    rule: 'colors', severity: colors > 12 ? 'medium' : 'low', count: colors, title: 'Fixed colours instead of tokens',
    detail: `${colors} colour${colors === 1 ? '' : 's'} written as #hex, for example ${sample(hexRe, noTokens)}. In dark mode they do not change.`,
    fix: 'Use the tokens (var(--surface), var(--ink), var(--accent) …) so that the Space follows the theme.',
  });

  const bytes = html.length;
  add({
    rule: 'size', severity: bytes > 1_000_000 ? 'medium' : 'low', count: bytes > 400_000 ? 1 : 0, title: 'Large page',
    detail: `${Math.round(bytes / 1024)} KB. The page is loaded as a whole each time the Space opens.`,
    fix: 'Trim the embedded data to what the page shows, or split the Space into subspaces.',
  });

  const cards = space.cardCount ?? count(/class=["'][^"']*\bcard\b/g, code);
  add({
    rule: 'empty', severity: 'medium', count: cards === 0 ? 1 : 0, title: 'No cards',
    detail: 'The page has no element with the class "card", so the overview cannot report its content.',
    fix: 'Give every top-level visual block the class "card".',
  });

  const missing = [!space.description?.trim() && 'a description', !(space.insights ?? []).length && 'insights', !space.domain?.trim() && 'a group (domain)'].filter(Boolean) as string[];
  add({
    rule: 'metadata', severity: 'low', count: missing.length, title: 'Incomplete description',
    detail: `Missing: ${missing.join(', ')}.`, fix: 'Fill title, description, insights and domain in space.json so that the overview and the search can describe the Space.',
  });

  const asOf = /"asOf"\s*:\s*"(\d{4}-\d{2}-\d{2})"/.exec(html)?.[1] ?? null;
  const age = asOf ? Math.floor((now - Date.parse(asOf)) / DAY) : 0;
  add({
    rule: 'stale', severity: 'low', count: asOf && age > 45 ? 1 : 0, title: 'Data is old',
    detail: `The data is as of ${asOf}, ${age} days ago.`, fix: 'Refresh data.json and run npm run sync:mockups, or say in the Space that it is a fixed example.',
  });

  const idle = space.updatedAt ? Math.floor((now - space.updatedAt) / DAY) : 0;
  add({
    rule: 'idle', severity: 'low', count: idle > 90 ? 1 : 0, title: 'Not touched for a long time',
    detail: `The page was last changed ${idle} days ago.`, fix: 'Check that it still matches the process it shows, or retire it.',
  });

  findings.sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity] || b.count - a.count);
  const score = Math.max(0, 100 - findings.reduce((n, f) => n + WEIGHT[f.severity], 0));
  const health: Health = findings.some((f) => f.severity === 'high') ? 'fix' : findings.some((f) => f.severity === 'medium') ? 'review' : findings.length ? 'minor' : 'ok';
  return { slug: space.slug, title: space.title, domain: space.domain ?? '', bytes, cards, asOf, updatedAt: space.updatedAt, findings, health, score, error: '', features: detectFeatures(html) };
}

/** A Space whose page could not be read is reported as such, never as clean. */
export function failedReport(space: Space, why: string): SpaceReport {
  return { slug: space.slug, title: space.title, domain: space.domain ?? '', bytes: 0, cards: space.cardCount ?? 0, asOf: null, updatedAt: space.updatedAt, findings: [], health: 'review', score: 0, error: why, features: noFeatures() };
}

export type AnalysisSummary = { spaces: number; clean: number; minor: number; review: number; fix: number; findings: number; byRule: Array<{ rule: RuleId; spaces: number }>; features: Array<{ id: FeatureId; label: string; hint: string; spaces: number; share: number; total: number }> };
export function summarize(reports: SpaceReport[]): AnalysisSummary {
  const byRule = new Map<RuleId, number>();
  for (const r of reports) for (const f of r.findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  return {
    spaces: reports.length, clean: reports.filter((r) => r.health === 'ok').length, minor: reports.filter((r) => r.health === 'minor').length, review: reports.filter((r) => r.health === 'review').length, fix: reports.filter((r) => r.health === 'fix').length,
    findings: reports.reduce((n, r) => n + r.findings.length, 0),
    features: FEATURES.map((f) => {
      const read = reports.filter((r) => !r.error), has = read.filter((r) => r.features[f.id] > 0);
      return { id: f.id, label: f.label, hint: f.hint, spaces: has.length, share: read.length ? has.length / read.length : 0, total: has.reduce((n, r) => n + r.features[f.id], 0) };
    }),
    byRule: [...byRule].map(([rule, spaces]) => ({ rule, spaces })).sort((a, b) => b.spaces - a.spaces),
  };
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Worst first, then by name. Filter by health, domain and a search over title, slug and findings. */
export function filterReports(reports: SpaceReport[], health: HealthFilter, domain: string, query: string, fn: FeatureFilter = null): SpaceReport[] {
  const q = norm(query).split(/\s+/).filter(Boolean), order: Record<Health, number> = { fix: 0, review: 1, minor: 2, ok: 3 };
  return reports
    .filter((r) => (health === 'all' || r.health === health) && (!domain || r.domain === domain) && (!fn || (!r.error && (r.features[fn.id] > 0) === fn.has)))
    .filter((r) => { const hay = norm(`${r.title} ${r.slug} ${r.domain} ${r.findings.map((f) => `${f.title} ${RULE_LABEL[f.rule]}`).join(' ')}`); return q.every((w) => hay.includes(w)); })
    .sort((a, b) => order[a.health] - order[b.health] || a.score - b.score || a.title.localeCompare(b.title));
}

/** Text to paste into the chat so that the agent fixes one Space; it names the rules and asks for nothing else. */
export function fixRequest(r: SpaceReport): string {
  if (!r.findings.length) return `The Space "${r.title}" (${r.slug}) has no findings.`;
  return [
    `Please fix these findings in the Space "${r.title}" (${r.slug}). Change only what is needed and keep the data and the look.`,
    ...r.findings.map((f, i) => `${i + 1}. ${f.title}: ${f.detail} ${f.fix}`),
  ].join('\n');
}
