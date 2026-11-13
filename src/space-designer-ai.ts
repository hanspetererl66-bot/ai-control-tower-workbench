/**
 * "Change with Joule" inside the Designer: the agent gets the current layout and a request and answers with the new
 * layout. The answer is only a proposal. It is checked like any stored layout, compared with the current one, and
 * applied (as one step that can be undone) only after the person agrees. Pure functions; the Designer calls the agent.
 */
import { BLOCK_INFO, normalizeLayout, type Layout } from './space-layout.ts';

const MAX_LAYOUT_CHARS = 30_000;

/** Fields of every block, for the agent. Kept in step with space-layout.ts by a test. */
export const SCHEMA_HELP = `Layout = { "version": 1, "datasets": [Dataset], "blocks": [Block] }
Dataset = { "id": "d1", "name": "…", "columns": ["Month","Plan"], "rows": [["Jan","40"]] }  (all cells are strings; the first column is the label)
  A dataset may have "source": {"kind":"joule","prompt":"…","asOf":"…","note":"…"} (the question Joule answered with this table): keep it exactly as it is, never make one up.
In any text (also in key figures) a figure from a dataset can stand as a token {{d1.Plan:sum}} (dataset id, column name, then first|last|sum|count|max|min|avg): keep existing tokens as they are.
Every block has "id" (keep the ids of blocks you do not change) and "type":
- heading: text, sub, level (1 or 2)
- text: title, text (blank line = new paragraph, "- " = bullet, **bold**)
- quote: text, by
- callout: tone (info|ok|warn|bad), title, text
- columns: title, count (2|3|4), boxes [{title,text}] (exactly count boxes, shown side by side)
- compare: title, left {title,tone,lines}, right {title,tone,lines}
- accordion: title, items [{title,text}]
- kpis: items [{label,value,delta,tone,trend}] (trend = up to 12 numbers separated by commas)
- table: title, dataset (a dataset id), sortable, totals; in a cell "{ok} Done", "{warn} …", "{bad} …", "{info} …" becomes a coloured status
- chart: title, sub, kind (bar|stacked|line|area|donut), dataset (first column = labels, other columns = series)
- progress: title, mode (progress|limit), items [{label,value,max}]
- matrix: title, xLabel, yLabel, points [{label,x,y}] (x and y from 0 to 100)
- steps: title, items [{title,text}]
- timeline: title, items [{when,title,text}]
- ask: label, prompt (a button that sends the prompt to Joule)
- divider`;

export function layoutPrompt(title: string, layout: Layout, request: string): string {
  const json = JSON.stringify(layout);
  const current = json.length > MAX_LAYOUT_CHARS ? JSON.stringify({ ...layout, datasets: layout.datasets.map((d) => ({ ...d, rows: d.rows.slice(0, 20) })) }) : json;
  return `You edit the page layout of the Werkbank Space "${title.replace(/"/g, "'").slice(0, 120)}". The page is a list of building blocks; the person looks at the result next to this chat.

Current layout:
\`\`\`json
${current}
\`\`\`

Block types (use only these):
${SCHEMA_HELP}

Request: ${request.trim().slice(0, 1500)}

Rules:
- Answer with the COMPLETE new layout in one \`\`\`json block, then one or two sentences on what you changed. No other text before the block.
- Keep the ids of blocks and datasets you do not change. New blocks get new ids (b<number>, d<number>).
- Do not invent figures. If the person gave no numbers, keep the existing ones or use clearly labelled sample values and say so in your sentence.
- Do not exceed 40 blocks. English texts unless the existing page is in another language.`;
}

export type LayoutAnswer = { layout: Layout; notes: string[]; message: string };

/** The layout in an answer (last ```json block, or the first {...} that parses), checked; null when there is none. */
export function parseLayoutAnswer(text: string): LayoutAnswer | null {
  const body = String(text ?? '');
  const candidates: string[] = [];
  for (const m of body.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(m[1]);
  const open = body.indexOf('{');
  const close = body.lastIndexOf('}');
  if (open >= 0 && close > open) candidates.push(body.slice(open, close + 1));
  for (const candidate of candidates.reverse()) {
    let raw: unknown;
    try { raw = JSON.parse(candidate); } catch { continue; }
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { blocks?: unknown }).blocks)) continue;
    const notes: string[] = [];
    const layout = normalizeLayout(raw, notes);
    const message = body.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
    return { layout, notes, message };
  }
  return null;
}

export type LayoutDiff = { added: string[]; removed: string[]; changed: string[]; same: boolean };

const label = (type: string) => BLOCK_INFO.find((i) => i.type === type)?.label.toLowerCase() ?? type;

/** What a proposal changes, in words, by block id; a changed dataset counts as a change of the blocks that show it. */
export function diffLayouts(before: Layout, after: Layout): LayoutDiff {
  const dataOf = (layout: Layout, id: string) => JSON.stringify(layout.datasets.find((d) => d.id === id) ?? null);
  const key = (layout: Layout, b: Layout['blocks'][number]) => JSON.stringify(b) + (b.type === 'table' || b.type === 'chart' ? dataOf(layout, b.dataset) : '');
  const was = new Map(before.blocks.map((b) => [b.id, b]));
  const now = new Map(after.blocks.map((b) => [b.id, b]));
  const added = after.blocks.filter((b) => !was.has(b.id)).map((b) => label(b.type));
  const removed = before.blocks.filter((b) => !now.has(b.id)).map((b) => label(b.type));
  const changed = after.blocks.filter((b) => was.has(b.id) && key(before, was.get(b.id)!) !== key(after, b)).map((b) => label(b.type));
  const order = before.blocks.map((b) => b.id).filter((id) => now.has(id)).join() !== after.blocks.map((b) => b.id).filter((id) => was.has(id)).join();
  if (order) changed.push('order of blocks');
  return { added, removed, changed, same: !added.length && !removed.length && !changed.length };
}

export function diffText(diff: LayoutDiff): string {
  if (diff.same) return 'No change.';
  const part = (name: string, items: string[]) => (items.length ? `${name} ${items.join(', ')}` : '');
  return [part('Adds', diff.added), part('removes', diff.removed), part('changes', diff.changed)].filter(Boolean).join('; ').replace(/^./, (c) => c.toUpperCase()) + '.';
}
