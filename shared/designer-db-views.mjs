/**
 * The fixed list of read-only database views that a data set in the Space Designer may be filled from (Agent Observability).
 * The window names a view id and a number of days, nothing else: no SQL, no function name, no table. The main process looks the id up
 * here, asks the existing reading function and turns the answer into a table (`viewTable`) with the columns listed here.
 * Pure functions, shared by the main process and the window.
 */
export const DAY_CHOICES = [7, 14, 30, 90];
const MAX_ROWS = 200;
const MAX_COLUMNS = 12;

const OUTCOME = (v) => (v === true ? 'met' : v === false ? 'missed' : 'not sampled');
const WHEN = (v) => (typeof v === 'string' ? v.replace('T', ' ').slice(0, 16) : v);

/** id → what to ask (`view`, `days`), where the rows are in the answer (`path`) and the columns (header, key or function). */
export const DB_VIEWS = [
  { id: 'observability.fleet', title: 'Agents: runs, outcome, cost', view: 'fleet', days: true, path: 'agents', columns: [
    ['Agent', 'name'], ['Department', 'department'], ['Rights', 'mode'], ['Runs', 'runs'], ['Green %', 'okPct'], ['Outcome %', 'goalPct'], ['Escalated %', 'escalatedPct'], ['p95 ms', 'p95ms'], ['Cost EUR', 'costEur'],
  ] },
  { id: 'observability.runs', title: 'Latest runs', view: 'runs', days: true, path: 'runs', limit: 200, columns: [
    ['Run', 'id'], ['Agent', 'name'], ['Version', 'version'], ['When', 'at', WHEN], ['Status', 'status'], ['Steps', 'steps'], ['Duration ms', 'ms'], ['Tokens', 'tokens'], ['Cost EUR', 'costEur'], ['Outcome', 'goalMet', OUTCOME],
  ] },
  { id: 'observability.cost-agents', title: 'Cost per agent', view: 'cost', days: true, path: 'agents', columns: [
    ['Agent', 'name'], ['Department', 'department'], ['Runs', 'runs'], ['Cost EUR', 'costEur'], ['Per run EUR', 'perRun'], ['Waste EUR', 'wasteEur'],
  ] },
  { id: 'observability.cost-days', title: 'Cost per day', view: 'cost', days: true, path: 'daily', columns: [
    ['Day', 'd', WHEN], ['Cost EUR', 'cost'],
  ] },
  { id: 'observability.alerts', title: 'Open and recent alerts', view: 'alerts', days: false, path: 'alerts', columns: [
    ['Severity', 'severity'], ['Agent', 'agent'], ['Rule', 'rule'], ['When', 'at', WHEN], ['Status', 'status'], ['Message', 'message'],
  ] },
];

export const dbView = (id) => DB_VIEWS.find((v) => v.id === id) ?? null;
export const dayChoice = (days) => (DAY_CHOICES.includes(days) ? days : 30);

/** What the reading function is asked, for a view id and days: only listed parameters. */
export function viewParams(id, days) {
  const v = dbView(id);
  if (!v) return null;
  const p = {};
  if (v.days) p.days = dayChoice(days);
  if (v.limit) p.limit = v.limit;
  return { view: v.view, params: p };
}

const text = (x) => (typeof x === 'string' ? x : typeof x === 'number' && Number.isFinite(x) ? String(Math.round(x * 1000) / 1000) : typeof x === 'boolean' ? String(x) : '');

/** The answer of a view as a table: columns by the list above, text cells, at most 200 rows, long texts cut. Throws when the answer has no rows list. */
export function viewTable(id, data, days) {
  const v = dbView(id);
  if (!v) throw new Error('Unknown view.');
  const list = data && typeof data === 'object' ? data[v.path] : null;
  if (!Array.isArray(list)) throw new Error('The database answered in a form I do not know.');
  const cols = v.columns.slice(0, MAX_COLUMNS);
  const rows = list.slice(0, MAX_ROWS).map((r) => cols.map(([, key, fmt]) => {
    const raw = r && typeof r === 'object' ? r[key] : undefined;
    return text(fmt ? fmt(raw) : raw).replace(/\s*\n+\s*/g, ' ').trim().slice(0, 200);
  }));
  const notes = list.length > MAX_ROWS ? [`Only the first ${MAX_ROWS} of ${list.length} rows are kept.`] : [];
  return { columns: cols.map(([h]) => h), rows, sources: `Agent Observability · ${v.title}${v.days ? `, last ${dayChoice(days)} days` : ''}`, notes };
}
