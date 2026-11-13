/**
 * Running the source of a data set and applying the answer: shared by the Designer (Fill now / Choose file / Load view) and by
 * "Refresh data" on a finished page. Nothing here writes: `runSource` only fetches a proposal, `applyProposal` returns the changed
 * data set, and the caller decides when to save. Each source is run only on a click, never by the page itself.
 */
import { dbView } from '../shared/designer-db-views.mjs';
import type { Dataset, Layout } from './space-layout.ts';
import { dataPrompt, nowMinute, parseDataAnswer, type DataAnswer } from './space-designer-data.ts';
import { parseDataFile } from './space-designer-file.ts';

export type Generate = (prompt: string, title: string, session?: string) => Promise<string>;
export type RefreshHost = {
  generate?: Generate;
  pickFile?: () => Promise<{ ok: boolean; canceled?: boolean; detail?: string; name?: string; text?: string } | undefined>;
  dataView?: (id: string, days: number) => Promise<{ ok: boolean; detail?: string; table?: { columns: string[]; rows: string[][]; sources: string; notes: string[] } } | undefined>;
};
/** A proposal, or a sentence for the person (empty when they cancelled). */
export type RunResult = { proposal: DataAnswer } | { note: string };

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What happens when this data set is refreshed, in plain words, and what the confirm button says. Null when it has no source. */
export function describeSource(ds: Dataset): { kind: 'joule' | 'file' | 'database'; what: string; detail: string; button: string; reads: string } | null {
  const s = ds.source;
  if (!s) return null;
  if (s.kind === 'joule') return { kind: 'joule', what: 'Joule query', detail: s.prompt || '(no question)', button: 'Ask Joule', reads: 'Joule answers this question with the tools of its connected systems. It is asked to read only, and the connectors are not restricted.' };
  if (s.kind === 'file') return { kind: 'file', what: `File${s.name ? ` ${s.name}` : ''}`, detail: 'You choose the file again.', button: 'Choose file…', reads: 'The app reads the file you choose, nothing else.' };
  const v = dbView(s.view);
  return { kind: 'database', what: 'Database view', detail: `${v?.title ?? s.view}${v?.days ? `, last ${s.days} days` : ''}`, button: 'Load view', reads: 'The app reads a fixed, read-only view of the shared database.' };
}

/** Fetch the new numbers for a data set from its source. Does not change anything. */
export async function runSource(ds: Dataset, host: RefreshHost, title: string): Promise<RunResult> {
  const s = ds.source;
  if (!s) return { note: 'This data set has no source.' };
  try {
    if (s.kind === 'joule') {
      if (!host.generate) return { note: 'Joule is not connected.' };
      if (!s.prompt.trim()) return { note: 'The question is empty.' };
      const text = await host.generate(dataPrompt(title, ds.name, ds.columns, s.prompt), 'Space Designer data', 'space-designer-data');
      if (!text) return { note: 'Stopped.' };
      const answer = parseDataAnswer(text, ds.columns);
      if (!answer) return { note: 'Joule did not send a table I can read. Ask again, or say in other words which data you want.' };
      if ('error' in answer) return { note: `Joule could not get the data: ${answer.error}` };
      return { proposal: answer };
    }
    if (s.kind === 'file') {
      const r = await host.pickFile?.();
      if (!r || r.canceled) return { note: '' };
      if (!r.ok || typeof r.text !== 'string') return { note: r.detail || 'The file could not be read.' };
      const answer = parseDataFile(r.name ?? 'file', r.text);
      if ('error' in answer) return { note: answer.error };
      return { proposal: { ...answer, sources: `File ${r.name ?? ''}`.trim() } };
    }
    const r = await host.dataView?.(s.view, s.days);
    if (!r?.ok || !r.table) return { note: r?.detail || 'The view could not be read.' };
    if (!r.table.rows.length) return { note: 'The view has no rows for this period.' };
    return { proposal: { columns: r.table.columns, rows: r.table.rows, sources: r.table.sources, notes: r.table.notes } };
  } catch (e) {
    return { note: message(e) };
  }
}

/** The data set with the proposal in it and "as of" set to now. */
export function applyProposal(ds: Dataset, proposal: DataAnswer, now?: Date): Dataset {
  const s = ds.source;
  if (!s) return ds;
  const asOf = nowMinute(now);
  const source: NonNullable<Dataset['source']> = s.kind === 'file'
    ? { kind: 'file', name: proposal.sources.replace(/^File /, '').replace(/[\\/]/g, '').slice(0, 120), asOf, note: proposal.notes[0] ?? '' }
    : { ...s, asOf, note: proposal.sources };
  return { ...ds, columns: proposal.columns, rows: proposal.rows, source };
}

/** The data sets of a layout that have a source, in order. */
export const refreshable = (layout: Layout): Dataset[] => layout.datasets.filter((d) => d.source);
