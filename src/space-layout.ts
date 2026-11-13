/**
 * Space Designer: the layout of a Space as data.
 *
 * A designed Space is a list of building blocks (heading, text, boxes in two to four columns, KPIs, table, charts,
 * steps, comparison ...). The list is the source; the Space's index.html is generated from it
 * (space-layout-render.ts) and carries the list inside itself, so a copy, a shared file or an import can be
 * opened in the Designer again.
 *
 * Everything here is pure: the editor, the dev server and the tests use the same functions. Nothing a person or the
 * agent writes is trusted: `normalizeLayout` clamps lengths and counts, drops unknown blocks and repairs ids.
 */

export const LAYOUT_VERSION = 1;
export const MAX_BLOCKS = 60;
export const MAX_DATASETS = 12;
export const MAX_ROWS = 200;
export const MAX_COLUMNS = 12;
const MAX_TEXT = 4000;
const MAX_TITLE = 120;

export type Tone = 'info' | 'ok' | 'warn' | 'bad';
export const TONES: readonly Tone[] = ['info', 'ok', 'warn', 'bad'];

export const CHART_KINDS = ['bar', 'stacked', 'line', 'area', 'donut'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/** A table of text cells. Tables and charts point at a dataset, so several blocks can show the same numbers. */
/** Where the numbers of a data set come from. Only "joule": a question that Joule answered with a table, at the time `asOf`. */
export type DataSource = { kind: 'joule'; prompt: string; asOf: string; note: string };
export type Dataset = { id: string; name: string; columns: string[]; rows: string[][]; source?: DataSource };

export type Kpi = { label: string; value: string; delta: string; tone: Tone; trend: string };
export type Box = { title: string; text: string };
export type Item = { title: string; text: string };
export type TimelineItem = { when: string; title: string; text: string };
export type ProgressItem = { label: string; value: number; max: number };
export type MatrixPoint = { label: string; x: number; y: number };
export type CompareSide = { title: string; tone: Tone; lines: string };

export type Block =
  | { id: string; type: 'heading'; text: string; sub: string; level: 1 | 2 }
  | { id: string; type: 'text'; title: string; text: string }
  | { id: string; type: 'quote'; text: string; by: string }
  | { id: string; type: 'callout'; tone: Tone; title: string; text: string }
  | { id: string; type: 'columns'; title: string; count: 2 | 3 | 4; boxes: Box[] }
  | { id: string; type: 'kpis'; items: Kpi[] }
  | { id: string; type: 'table'; title: string; dataset: string; sortable: boolean; totals: boolean }
  | { id: string; type: 'chart'; title: string; sub: string; kind: ChartKind; dataset: string }
  | { id: string; type: 'progress'; title: string; mode: 'progress' | 'limit'; items: ProgressItem[] }
  | { id: string; type: 'steps'; title: string; items: Item[] }
  | { id: string; type: 'timeline'; title: string; items: TimelineItem[] }
  | { id: string; type: 'compare'; title: string; left: CompareSide; right: CompareSide }
  | { id: string; type: 'matrix'; title: string; xLabel: string; yLabel: string; points: MatrixPoint[] }
  | { id: string; type: 'accordion'; title: string; items: Item[] }
  | { id: string; type: 'divider' }
  | { id: string; type: 'ask'; label: string; prompt: string };

export type BlockType = Block['type'];
export type Layout = { version: 1; datasets: Dataset[]; blocks: Block[] };

export type BlockInfo = { type: BlockType; label: string; group: string; hint: string };

/** The palette of the Designer, in the order it is shown. */
export const BLOCK_INFO: readonly BlockInfo[] = [
  { type: 'heading', label: 'Heading', group: 'Text', hint: 'Title with a line below it' },
  { type: 'text', label: 'Text', group: 'Text', hint: 'Paragraphs and bullet points' },
  { type: 'quote', label: 'Quote', group: 'Text', hint: 'A statement with its source' },
  { type: 'callout', label: 'Note', group: 'Text', hint: 'Info, success, warning or problem' },
  { type: 'columns', label: 'Boxes side by side', group: 'Boxes', hint: 'Two, three or four boxes with parallel text' },
  { type: 'compare', label: 'Comparison', group: 'Boxes', hint: 'Two sides, for example pros and cons' },
  { type: 'accordion', label: 'Fold-out list', group: 'Boxes', hint: 'Questions and answers that open on click' },
  { type: 'kpis', label: 'Key figures', group: 'Data', hint: 'Big numbers with change and trend' },
  { type: 'table', label: 'Table', group: 'Data', hint: 'Rows and columns, sortable, with status colours' },
  { type: 'chart', label: 'Chart', group: 'Data', hint: 'Bars, stacked bars, line, area or donut' },
  { type: 'progress', label: 'Progress bars', group: 'Data', hint: 'Progress or use against a limit' },
  { type: 'matrix', label: 'Matrix', group: 'Data', hint: 'Points on two axes, for example impact and effort' },
  { type: 'steps', label: 'Steps', group: 'Process', hint: 'A numbered sequence' },
  { type: 'timeline', label: 'Timeline', group: 'Process', hint: 'Dated events' },
  { type: 'ask', label: 'Ask Joule button', group: 'Action', hint: 'A button that sends a question to Joule' },
  { type: 'divider', label: 'Divider', group: 'Action', hint: 'A thin line between sections' },
];

const clip = (value: unknown, max: number): string => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '').replace(/\r\n?/g, '\n').slice(0, max);
const line = (value: unknown, max = MAX_TITLE): string => clip(value, max).replace(/\s*\n+\s*/g, ' ').trim();
const toneOf = (value: unknown, fallback: Tone = 'info'): Tone => (TONES as readonly string[]).includes(value as string) ? (value as Tone) : fallback;
const num = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const arr = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** First `prefix<n>` that is not taken. */
export function freeId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; n < 10_000; n += 1) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
  throw new Error('too many blocks');
}

const ID = /^[a-z][a-z0-9-]{0,23}$/;
const AS_OF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function normalizeDataset(raw: unknown, taken: Set<string>): Dataset | null {
  const o = obj(raw);
  const columns = arr(o.columns, MAX_COLUMNS).map((c) => line(c, 40));
  if (columns.length === 0) return null;
  const rows = arr(o.rows, MAX_ROWS).map((r) => {
    const cells = arr(r, MAX_COLUMNS).map((c) => clip(c, 200).replace(/\n/g, ' ').trim());
    while (cells.length < columns.length) cells.push('');
    return cells.slice(0, columns.length);
  });
  const id = typeof o.id === 'string' && ID.test(o.id) && !taken.has(o.id) ? o.id : freeId('d', taken);
  taken.add(id);
  const src = obj(o.source);
  const source: DataSource | undefined = src.kind === 'joule'
    ? { kind: 'joule', prompt: clip(src.prompt, 600).trim(), asOf: typeof src.asOf === 'string' && AS_OF.test(src.asOf) ? src.asOf : '', note: line(src.note, 160) }
    : undefined;
  return { id, name: line(o.name, 60) || id, columns, rows, ...(source ? { source } : {}) };
}

function normalizeBlock(raw: unknown, taken: Set<string>, datasets: Dataset[], notes: string[]): Block | null {
  const o = obj(raw);
  const type = o.type as BlockType;
  if (!BLOCK_INFO.some((b) => b.type === type)) { notes.push(`Dropped a block of unknown type "${String(o.type).slice(0, 30)}".`); return null; }
  const id = typeof o.id === 'string' && ID.test(o.id) && !taken.has(o.id) ? o.id : freeId('b', taken);
  taken.add(id);
  const dataset = (): string => {
    const wanted = typeof o.dataset === 'string' ? o.dataset : '';
    if (datasets.some((d) => d.id === wanted)) return wanted;
    if (wanted) notes.push(`A ${type} pointed at the missing data "${wanted.slice(0, 20)}"; it now uses the first dataset.`);
    return datasets[0]?.id ?? '';
  };
  switch (type) {
    case 'heading': return { id, type, text: line(o.text), sub: line(o.sub, 300), level: o.level === 2 ? 2 : 1 };
    case 'text': return { id, type, title: line(o.title), text: clip(o.text, MAX_TEXT) };
    case 'quote': return { id, type, text: clip(o.text, 600), by: line(o.by, 80) };
    case 'callout': return { id, type, tone: toneOf(o.tone), title: line(o.title), text: clip(o.text, 1200) };
    case 'columns': {
      const count = o.count === 3 ? 3 : o.count === 4 ? 4 : 2;
      const boxes = arr(o.boxes, 4).map((b) => ({ title: line(obj(b).title, 80), text: clip(obj(b).text, 1500) }));
      while (boxes.length < count) boxes.push({ title: '', text: '' });
      return { id, type, title: line(o.title), count, boxes: boxes.slice(0, count) };
    }
    case 'kpis': {
      const items = arr(o.items, 8).map((k) => ({ label: line(obj(k).label, 60), value: line(obj(k).value, 24), delta: line(obj(k).delta, 40), tone: toneOf(obj(k).tone, 'info'), trend: clip(obj(k).trend, 120).replace(/\n/g, ' ') }));
      return { id, type, items: items.length ? items : [{ label: 'Key figure', value: '0', delta: '', tone: 'info', trend: '' }] };
    }
    case 'table': return { id, type, title: line(o.title), dataset: dataset(), sortable: o.sortable !== false, totals: o.totals === true };
    case 'chart': return { id, type, title: line(o.title), sub: line(o.sub, 200), kind: (CHART_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as ChartKind) : 'bar', dataset: dataset() };
    case 'progress': {
      const items = arr(o.items, 12).map((p) => ({ label: line(obj(p).label, 60), value: num(obj(p).value, 0, 0, 1e12), max: num(obj(p).max, 100, 0.0001, 1e12) }));
      return { id, type, title: line(o.title), mode: o.mode === 'limit' ? 'limit' : 'progress', items };
    }
    case 'steps':
    case 'accordion': {
      const items = arr(o.items, 12).map((s) => ({ title: line(obj(s).title, 80), text: clip(obj(s).text, 1200) }));
      return { id, type, title: line(o.title), items };
    }
    case 'timeline': {
      const items = arr(o.items, 12).map((s) => ({ when: line(obj(s).when, 30), title: line(obj(s).title, 80), text: clip(obj(s).text, 800) }));
      return { id, type, title: line(o.title), items };
    }
    case 'compare': {
      const side = (raw2: unknown, tone: Tone): CompareSide => ({ title: line(obj(raw2).title, 80), tone: toneOf(obj(raw2).tone, tone), lines: clip(obj(raw2).lines, 1500) });
      return { id, type, title: line(o.title), left: side(o.left, 'ok'), right: side(o.right, 'bad') };
    }
    case 'matrix': {
      const points = arr(o.points, 20).map((p) => ({ label: line(obj(p).label, 40), x: num(obj(p).x, 50, 0, 100), y: num(obj(p).y, 50, 0, 100) }));
      return { id, type, title: line(o.title), xLabel: line(o.xLabel, 40) || 'Effort', yLabel: line(o.yLabel, 40) || 'Impact', points };
    }
    case 'divider': return { id, type };
    case 'ask': return { id, type, label: line(o.label, 60) || 'Ask Joule', prompt: clip(o.prompt, 600).trim() };
  }
}

/**
 * A checked layout from anything: a stored one, a pasted one, an answer from the agent.
 * `notes` receives what had to be changed, so the person is told instead of surprised.
 */
export function normalizeLayout(raw: unknown, notes: string[] = []): Layout {
  const o = obj(raw);
  const taken = new Set<string>();
  const datasets: Dataset[] = [];
  for (const d of arr(o.datasets, MAX_DATASETS)) {
    const n = normalizeDataset(d, taken);
    if (n) datasets.push(n);
  }
  const blockIds = new Set<string>();
  const blocks: Block[] = [];
  const rawBlocks = Array.isArray(o.blocks) ? o.blocks : [];
  if (rawBlocks.length > MAX_BLOCKS) notes.push(`Only the first ${MAX_BLOCKS} blocks are kept.`);
  for (const b of rawBlocks.slice(0, MAX_BLOCKS)) {
    const n = normalizeBlock(b, blockIds, datasets, notes);
    if (n) blocks.push(n);
  }
  return pruneDatasets({ version: LAYOUT_VERSION, datasets, blocks });
}

export const emptyLayout = (): Layout => ({ version: LAYOUT_VERSION, datasets: [], blocks: [] });

/** Datasets that no table, chart or value in a text uses are not kept. */
export function pruneDatasets(layout: Layout): Layout {
  const used = new Set([...layout.blocks.flatMap((b) => (b.type === 'table' || b.type === 'chart' ? [b.dataset] : [])), ...tokenDatasets(layout.blocks)]);
  return { ...layout, datasets: layout.datasets.filter((d) => used.has(d.id)) };
}

/* ---------------------------------------------------------------- values from data in texts */
/**
 * A value from a data set inside any text of a block: {{d1.Amount:sum}}. The column is the name in the header row,
 * the function is first (default), last, sum, count, max, min or avg. The page shows the figure; the layout keeps the token,
 * so a new Fill from Joule changes every place at once.
 */
export const AGGREGATES = ['first', 'last', 'sum', 'count', 'max', 'min', 'avg'] as const;
export type Aggregate = (typeof AGGREGATES)[number];
const TOKEN = () => /\{\{\s*([a-z][a-z0-9-]{0,23})\.([^:{}]{1,40}?)\s*(?::\s*([a-z]+))?\s*\}\}/g;
export const makeToken = (dataset: string, column: string, agg: Aggregate = 'first'): string => `{{${dataset}.${column}${agg === 'first' ? '' : ':' + agg}}}`;

const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** The value of one column of a data set as text, or null when the column is unknown or the function needs numbers the column does not hold. */
export function datasetValue(ds: Dataset, column: string, agg: Aggregate = 'first'): string | null {
  const c = ds.columns.findIndex((x) => x.trim().toLowerCase() === column.trim().toLowerCase());
  if (c < 0) return null;
  const cells = ds.rows.map((r) => r[c] ?? '');
  if (agg === 'count') return fmt(cells.filter((x) => x.trim() !== '').length);
  if (agg === 'first') return cells.find((x) => x.trim() !== '')?.replace(/\{(ok|warn|bad|info)\}\s*/i, '') ?? null;
  if (agg === 'last') return [...cells].reverse().find((x) => x.trim() !== '')?.replace(/\{(ok|warn|bad|info)\}\s*/i, '') ?? null;
  const nums = cells.map(cellNumber).filter((n): n is number => n !== null);
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return fmt(agg === 'sum' ? sum : agg === 'max' ? Math.max(...nums) : agg === 'min' ? Math.min(...nums) : sum / nums.length);
}

/** The data sets named by tokens anywhere in the blocks. */
export function tokenDatasets(blocks: Block[]): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') { for (const m of v.matchAll(TOKEN())) ids.add(m[1]); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  blocks.forEach(walk);
  return [...ids];
}

/**
 * The layout with every token replaced by its figure (for the page). A token whose data set, column or function does not work
 * becomes "n/a" and is reported in `issues`, so the person sees what is wrong instead of a broken page.
 */
export function resolveLayout(layout: Layout): { layout: Layout; issues: string[] } {
  const issues: string[] = [];
  const byId = new Map(layout.datasets.map((d) => [d.id, d]));
  const fill = (text: string): string => text.replace(TOKEN(), (whole, id: string, column: string, fn?: string) => {
    const agg = (fn ?? 'first') as Aggregate;
    const ds = byId.get(id);
    if (!(AGGREGATES as readonly string[]).includes(agg)) { issues.push(`${whole}: "${fn}" is not a function (use ${AGGREGATES.join(', ')}).`); return 'n/a'; }
    if (!ds) { issues.push(`${whole}: there is no data set "${id}".`); return 'n/a'; }
    const value = datasetValue(ds, column, agg);
    if (value === null) { issues.push(`${whole}: ${ds.columns.some((x) => x.trim().toLowerCase() === column.trim().toLowerCase()) ? `the column "${column}" has no numbers or no values for ${agg}` : `the data set "${ds.name}" has no column "${column}"`}.`); return 'n/a'; }
    return value;
  });
  const map = (v: unknown): unknown => (typeof v === 'string' ? fill(v) : Array.isArray(v) ? v.map(map) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x)])) : v);
  return { layout: { ...layout, blocks: layout.blocks.map((b) => map(b) as Block) }, issues: [...new Set(issues)] };
}

/* ---------------------------------------------------------------- editing (immutable) */

const SAMPLE: Record<'table' | 'chart', { name: string; columns: string[]; rows: string[][] }> = {
  table: { name: 'Table data', columns: ['Name', 'Owner', 'Status', 'Amount'], rows: [['Item one', 'Ana', '{ok} Done', '1200'], ['Item two', 'Ben', '{warn} At risk', '850'], ['Item three', 'Chen', '{bad} Blocked', '430']] },
  chart: { name: 'Chart data', columns: ['Month', 'Plan', 'Actual'], rows: [['Jan', '40', '36'], ['Feb', '44', '47'], ['Mar', '48', '51'], ['Apr', '52', '49'], ['May', '57', '61'], ['Jun', '60', '66']] },
};

/** A new block of a type, with sample content a person can overwrite. May add a dataset. */
export function blockDefaults(type: BlockType, layout: Layout): { block: Block; dataset?: Dataset } {
  const id = freeId('b', layout.blocks.map((b) => b.id));
  const newDataset = (kind: 'table' | 'chart'): Dataset => ({ id: freeId('d', layout.datasets.map((d) => d.id)), ...structuredClone(SAMPLE[kind]) });
  switch (type) {
    case 'heading': return { block: { id, type, text: 'New heading', sub: 'A short line that says what this page is for.', level: 2 } };
    case 'text': return { block: { id, type, title: 'Summary', text: 'Write the key message here.\n\n- Point one\n- Point two' } };
    case 'quote': return { block: { id, type, text: 'A short statement worth reading twice.', by: 'Source' } };
    case 'callout': return { block: { id, type, tone: 'info', title: 'Good to know', text: 'One sentence the reader should not miss.' } };
    case 'columns': return { block: { id, type, title: '', count: 3, boxes: [{ title: 'First', text: 'Text for the first box.' }, { title: 'Second', text: 'Text for the second box.' }, { title: 'Third', text: 'Text for the third box.' }] } };
    case 'kpis': return { block: { id, type, items: [{ label: 'Revenue', value: '4.2M', delta: '+6% vs last month', tone: 'ok', trend: '3.1, 3.4, 3.3, 3.8, 4.0, 4.2' }, { label: 'Open cases', value: '38', delta: '-5 this week', tone: 'ok', trend: '' }, { label: 'At risk', value: '7', delta: '+2 this week', tone: 'bad', trend: '' }] } };
    case 'table': { const dataset = newDataset('table'); return { block: { id, type, title: 'Overview', dataset: dataset.id, sortable: true, totals: false }, dataset }; }
    case 'chart': { const dataset = newDataset('chart'); return { block: { id, type, title: 'Plan and actual', sub: 'Per month', kind: 'bar', dataset: dataset.id }, dataset }; }
    case 'progress': return { block: { id, type, title: 'Progress', mode: 'progress', items: [{ label: 'Build', value: 80, max: 100 }, { label: 'Test', value: 45, max: 100 }, { label: 'Go live', value: 10, max: 100 }] } };
    case 'steps': return { block: { id, type, title: 'How it works', items: [{ title: 'Collect', text: 'Gather the input.' }, { title: 'Check', text: 'Compare it with the rules.' }, { title: 'Decide', text: 'A person approves.' }] } };
    case 'timeline': return { block: { id, type, title: 'Timeline', items: [{ when: 'Q1', title: 'Start', text: 'Kick-off and scope.' }, { when: 'Q2', title: 'Pilot', text: 'First users.' }, { when: 'Q3', title: 'Roll-out', text: 'All teams.' }] } };
    case 'compare': return { block: { id, type, title: 'Option A or option B', left: { title: 'Pros', tone: 'ok', lines: '- Fast to start\n- Low cost' }, right: { title: 'Cons', tone: 'bad', lines: '- Limited reach\n- Manual steps' } } };
    case 'matrix': return { block: { id, type, title: 'Impact and effort', xLabel: 'Effort', yLabel: 'Impact', points: [{ label: 'Idea A', x: 20, y: 80 }, { label: 'Idea B', x: 70, y: 70 }, { label: 'Idea C', x: 35, y: 30 }] } };
    case 'accordion': return { block: { id, type, title: 'Questions', items: [{ title: 'What is this?', text: 'A short answer.' }, { title: 'Who owns it?', text: 'Name the owner.' }] } };
    case 'divider': return { block: { id, type } };
    case 'ask': return { block: { id, type, label: 'Ask Joule', prompt: 'Summarise what changed on this page and what I should look at first.' } };
  }
}

/** Insert a new block after `afterId` (at the end when it is missing or unknown). */
export function addBlock(layout: Layout, type: BlockType, afterId?: string | null): { layout: Layout; id: string } {
  if (layout.blocks.length >= MAX_BLOCKS) return { layout, id: '' };
  const made = blockDefaults(type, layout);
  const at = afterId ? layout.blocks.findIndex((b) => b.id === afterId) : -1;
  const blocks = layout.blocks.slice();
  blocks.splice(at < 0 ? blocks.length : at + 1, 0, made.block);
  return { layout: { ...layout, datasets: made.dataset && layout.datasets.length < MAX_DATASETS ? [...layout.datasets, made.dataset] : layout.datasets, blocks }, id: made.block.id };
}

export function moveBlock(layout: Layout, id: string, toIndex: number): Layout {
  const from = layout.blocks.findIndex((b) => b.id === id);
  if (from < 0) return layout;
  const to = Math.max(0, Math.min(layout.blocks.length - 1, toIndex));
  if (to === from) return layout;
  const blocks = layout.blocks.slice();
  const [item] = blocks.splice(from, 1);
  blocks.splice(to, 0, item);
  return { ...layout, blocks };
}

export function removeBlock(layout: Layout, id: string): Layout {
  return pruneDatasets({ ...layout, blocks: layout.blocks.filter((b) => b.id !== id) });
}

/** Copy of a block right behind it. A table or chart gets its own copy of the data, so the two can differ. */
export function duplicateBlock(layout: Layout, id: string): { layout: Layout; id: string } {
  const at = layout.blocks.findIndex((b) => b.id === id);
  if (at < 0 || layout.blocks.length >= MAX_BLOCKS) return { layout, id: '' };
  const source = layout.blocks[at];
  const copy = structuredClone(source) as Block;
  copy.id = freeId('b', layout.blocks.map((b) => b.id));
  let datasets = layout.datasets;
  if ((copy.type === 'table' || copy.type === 'chart') && datasets.length < MAX_DATASETS) {
    const original = datasets.find((d) => d.id === copy.dataset);
    if (original) {
      const dataset = { ...structuredClone(original), id: freeId('d', datasets.map((d) => d.id)) };
      copy.dataset = dataset.id;
      datasets = [...datasets, dataset];
    }
  }
  const blocks = layout.blocks.slice();
  blocks.splice(at + 1, 0, copy);
  return { layout: { ...layout, datasets, blocks }, id: copy.id };
}

/** Change fields of one block; the result is checked again, so an invalid value is repaired, not stored. */
export function updateBlock(layout: Layout, id: string, patch: Record<string, unknown>): Layout {
  const at = layout.blocks.findIndex((b) => b.id === id);
  if (at < 0) return layout;
  const merged = { ...layout.blocks[at], ...patch, id, type: layout.blocks[at].type };
  const next = normalizeLayout({ ...layout, blocks: layout.blocks.map((b, i) => (i === at ? merged : b)) });
  return next;
}

export function setDataset(layout: Layout, dataset: Dataset): Layout {
  const exists = layout.datasets.some((d) => d.id === dataset.id);
  if (!exists) return layout;
  return normalizeLayout({ ...layout, datasets: layout.datasets.map((d) => (d.id === dataset.id ? dataset : d)) });
}

/** Give a table or chart another dataset, or a fresh one made from sample data. */
export function pointBlockAt(layout: Layout, blockId: string, datasetId: string | 'new'): Layout {
  const block = layout.blocks.find((b) => b.id === blockId);
  if (!block || (block.type !== 'table' && block.type !== 'chart')) return layout;
  if (datasetId === 'new') {
    if (layout.datasets.length >= MAX_DATASETS) return layout;
    const dataset: Dataset = { id: freeId('d', layout.datasets.map((d) => d.id)), ...structuredClone(SAMPLE[block.type]) };
    return pruneDatasets({ ...layout, datasets: [...layout.datasets, dataset], blocks: layout.blocks.map((b) => (b.id === blockId ? { ...b, dataset: dataset.id } : b)) });
  }
  if (!layout.datasets.some((d) => d.id === datasetId)) return layout;
  return pruneDatasets({ ...layout, blocks: layout.blocks.map((b) => (b.id === blockId ? { ...b, dataset: datasetId } : b)) });
}

/* ---------------------------------------------------------------- data helpers */

/** Pasted text from a spreadsheet (tabs) or a CSV file (commas or semicolons) as columns and rows. */
export function parseTable(text: string): { columns: string[]; rows: string[][] } | null {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  const sep = lines[0].includes('\t') ? '\t' : (lines[0].match(/;/g) ?? []).length >= (lines[0].match(/,/g) ?? []).length && lines[0].includes(';') ? ';' : ',';
  const split = (l: string): string[] => {
    const out: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < l.length; i += 1) {
      const c = l[i];
      if (quoted) { if (c === '"' && l[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c; }
      else if (c === '"' && cell === '') quoted = true;
      else if (c === sep) { out.push(cell.trim()); cell = ''; }
      else cell += c;
    }
    out.push(cell.trim());
    return out;
  };
  const grid = lines.slice(0, MAX_ROWS + 1).map(split);
  const width = Math.min(MAX_COLUMNS, Math.max(...grid.map((r) => r.length)));
  if (width < 1) return null;
  const pad = (r: string[]) => { const c = r.slice(0, width); while (c.length < width) c.push(''); return c; };
  const [head, ...rows] = grid.map(pad);
  return { columns: head.map((h, i) => h || `Column ${i + 1}`), rows };
}

/** A number from a cell: "1,234.5", "12 %", "€ 40", "1.234,5" and "-3" all work; anything else is null. */
export function cellNumber(cell: string): number | null {
  let s = String(cell ?? '').replace(/\{(?:ok|warn|bad|info)\}/g, '').trim().replace(/[%€$£\s ]/g, '');
  if (!s || !/^[-+]?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastComma >= 0) s = /^[-+]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Slug for the folder of a new Space: lower case, letters and digits, at most 40 characters. */
export function slugFromTitle(title: string): string {
  const base = String(title ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return base || 'new-space';
}

/** One line per block type used, for the Space's overview tile. */
export function layoutSummary(layout: Layout): string {
  const labels = BLOCK_INFO.filter((i) => i.type !== 'divider' && layout.blocks.some((b) => b.type === i.type)).map((i) => i.label.toLowerCase());
  return layout.blocks.length === 0 ? 'Empty page' : `${layout.blocks.length} blocks: ${labels.slice(0, 5).join(', ')}${labels.length > 5 ? ' …' : ''}`;
}
