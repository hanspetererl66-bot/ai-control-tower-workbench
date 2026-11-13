/**
 * "Fill from a file" for a data set in the Designer: a JSON or CSV file the person chose. The file is read once, in the main process,
 * and the text is checked here like any stored layout; the numbers are copied into the data set (the finished page never reads the file).
 * Only the file name is kept, never the path. Pure functions.
 */
import { MAX_COLUMNS, MAX_ROWS, parseTable } from './space-layout.ts';
import type { DataAnswer, DataFailure } from './space-designer-data.ts';

const cell = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return '';
};
const tidy = (v: unknown, max: number): string => cell(v).replace(/\s*\n+\s*/g, ' ').trim().slice(0, max);

function build(head: unknown[], body: unknown[][], notes: string[]): DataAnswer | DataFailure {
  if (head.length > MAX_COLUMNS) notes.push(`Only the first ${MAX_COLUMNS} of ${head.length} columns are kept.`);
  const columns = head.slice(0, MAX_COLUMNS).map((h, i) => tidy(h, 40) || `Column ${i + 1}`);
  if (!columns.length) return { error: 'The file has no columns.' };
  if (body.length > MAX_ROWS) notes.push(`Only the first ${MAX_ROWS} of ${body.length} rows are kept.`);
  const rows = body.slice(0, MAX_ROWS).map((r) => {
    const cells = (Array.isArray(r) ? r : []).slice(0, columns.length).map((c) => tidy(c, 200));
    while (cells.length < columns.length) cells.push('');
    return cells;
  });
  if (!rows.length) notes.push('The file has no rows.');
  return { columns, rows, sources: '', notes };
}

/** The table in a file: .json (list of objects, list of lists, or {columns, rows}) or .csv/.tsv/.txt. */
export function parseDataFile(name: string, text: string): DataAnswer | DataFailure {
  const body = String(text ?? '').replace(/^﻿/, '');
  if (!body.trim()) return { error: 'The file is empty.' };
  const notes: string[] = [];
  if (/\.json$/i.test(name) || /^\s*[[{]/.test(body)) {
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return { error: 'The file is not valid JSON.' }; }
    if (Array.isArray(raw)) {
      if (!raw.length) return { error: 'The list in the file is empty.' };
      if (raw.every((r) => Array.isArray(r))) return build(raw[0] as unknown[], (raw as unknown[][]).slice(1), notes);
      if (raw.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
        const keys: string[] = [];
        for (const r of raw as Record<string, unknown>[]) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
        return build(keys, (raw as Record<string, unknown>[]).map((r) => keys.map((k) => r[k])), notes);
      }
      return { error: 'A JSON list must hold only objects or only lists.' };
    }
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (Array.isArray(o.columns) && Array.isArray(o.rows)) return build(o.columns, o.rows.filter(Array.isArray) as unknown[][], notes);
      return { error: 'Expected a list of objects, a list of lists, or {"columns": […], "rows": […]}.' };
    }
    return { error: 'Expected a table in the JSON file.' };
  }
  const lines = body.split(/\r\n?|\n/).filter((l) => l.trim() !== '').length;
  const parsed = parseTable(body);
  if (!parsed) return { error: 'Nothing to read in the file.' };
  if (lines - 1 > MAX_ROWS) notes.push(`Only the first ${MAX_ROWS} of ${lines - 1} rows are kept.`);
  return build(parsed.columns, parsed.rows, notes);
}
