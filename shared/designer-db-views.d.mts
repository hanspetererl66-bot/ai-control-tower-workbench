export const DAY_CHOICES: number[];
export interface DbView { id: string; title: string; view: string; days: boolean; path: string; limit?: number; columns: [string, string, ((v: unknown) => unknown)?][] }
export const DB_VIEWS: DbView[];
export function dbView(id: string): DbView | null;
export function dayChoice(days: unknown): number;
export function viewParams(id: string, days: unknown): { view: string; params: Record<string, unknown> } | null;
export function viewTable(id: string, data: unknown, days?: unknown): { columns: string[]; rows: string[][]; sources: string; notes: string[] };
