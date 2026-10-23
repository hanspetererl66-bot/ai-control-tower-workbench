/**
 * Mock of the SAP Cloud ALM MCP server (github.com/consetto/calmcp, MIT) over fictional sample data.
 * It mirrors the tool names, parameters, codes and result shapes of calm_resources, calm_list, calm_get and
 * calm_analytics closely enough to show how a conversation with Joule would look; it never calls Cloud ALM.
 * The code between BEGIN-MODEL and END-MODEL is embedded verbatim into the Space page by scripts/sync-calm-alm.mjs.
 */

// BEGIN-MODEL
const TASK_TYPES = [
  { code: 'CALMTASK', label: 'Project Task' }, { code: 'CALMUS', label: 'User Story' }, { code: 'CALMREQU', label: 'Requirement' },
  { code: 'CALMDEF', label: 'Defect' }, { code: 'CALMRISK', label: 'Risk' }, { code: 'CALMQGATE', label: 'Quality Gate' },
];
const STATUSES = {
  CIPTKOPEN: 'Open (Task)', CIPTKINP: 'In Progress (Task)', CIPTKBLK: 'Blocked (Task)', CIPTKCLOSE: 'Done (Task)',
  CIPUSOPEN: 'Open (User Story)', CIPUSINP: 'In Progress (User Story)', CIPUSBLK: 'Blocked (User Story)', CIPUSCLOSE: 'Done (User Story)',
  CIPREQUOPEN: 'Open (Requirement)', CIPREQUINP: 'In Progress (Requirement)', CIPREQUCLOSE: 'Done (Requirement)',
  CIPDFCTOPEN: 'Open (Defect)', CIPDFCTINP: 'In Progress (Defect)', CIPDFCTBLK: 'Blocked (Defect)', CIPDFCTDONE: 'Done (Defect)',
  CIPRIOPEN: 'Open (Risk)', CIPRIINP: 'In Progress (Risk)', CIPRIDONE: 'Done (Risk)',
  CIPQGOPEN: 'Open (Quality Gate)', CIPQGBLK: 'Blocked (Quality Gate)', CIPQGDONE: 'Done (Quality Gate)',
};
const PRIORITIES = { 10: 'Very High', 20: 'High', 30: 'Medium', 40: 'Low' };
const ANALYTICS_PROVIDERS = ['Tasks', 'Defects', 'Requirements', 'Tests', 'Projects'];
const ODATA_STATUS_DIM = { Tasks: 'status', Defects: 'defectStatus', Requirements: 'status', Tests: 'result', Projects: 'phase' };
const LIST_RESOURCES = ['projects', 'project_timeboxes', 'tasks', 'features'];
const GET_RESOURCES = ['project', 'task', 'feature'];

const ok = (data) => ({ isError: false, data });
const err = (message) => ({ isError: true, data: message });
const pick = (rec, fields) => {
  if (!fields) return rec;
  const out = {};
  for (const f of String(fields).split(',').map((x) => x.trim()).filter(Boolean)) if (f in rec) out[f] = rec[f];
  return out;
};
const tally = (rows, key) => {
  const m = new Map();
  for (const r of rows) { const v = String(r[key] ?? '(no value)'); m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
};
const GROUP_ALIASES = { timeboxId: 'timeboxId', assignee: 'assigneeName', team: 'team', priority: 'priority', status: 'status', projectName: 'projectName', statusText: 'statusText' };

/** calm_resources: the code lists and recipes a client needs before it queries. */
function calmResources(data, args = {}) {
  const topic = args.topic;
  if (topic === 'Defects' || topic === 'Tasks') return ok({ provider: topic, dimensions: ['projectName', 'statusText', 'priority', 'team', 'assignee'], statusDimension: ODATA_STATUS_DIM[topic], note: 'Analytics providers span the whole tenant; no project_id is needed.' });
  return ok({
    listResources: LIST_RESOURCES, getResources: GET_RESOURCES, analyticsProviders: ANALYTICS_PROVIDERS,
    taskTypes: TASK_TYPES, statuses: STATUSES, priorities: PRIORITIES,
    recipes: [
      { question: 'How many open defects are there per project?', steps: ["calm_analytics({ provider: 'Defects', filter: \"defectStatus eq 'CIPDFCTOPEN'\", group_by: 'projectName' })"] },
      { question: 'Which user stories are open in Sprint 5?', steps: ["calm_list({ resource: 'tasks', project_id, task_type: 'CALMUS', status: 'CIPUSOPEN', timebox_name: 'Sprint 5', fields: 'displayId,title,status,assigneeName,dueDate' })"] },
    ],
    writeEnabled: false,
  });
}

/** calm_list: list or count one collection. Tasks need a project_id, as in Cloud ALM. */
function calmList(data, args = {}) {
  const resource = args.resource;
  if (!LIST_RESOURCES.includes(resource)) return err(`Unknown resource '${resource}'. Use calm_resources to list valid ones.`);
  if (resource === 'projects') return ok(args.fields ? data.projects.map((p) => pick(p, args.fields)) : data.projects);
  if (resource === 'features') return ok((args.fields ? data.features.map((f) => pick(f, args.fields)) : data.features));
  if (!args.project_id) return err(`Resource '${resource}' needs project_id. Call calm_list({ resource: 'projects' }) first.`);
  const project = data.projects.find((p) => p.id === args.project_id);
  if (!project) return err(`Project '${args.project_id}' not found.`);
  if (resource === 'project_timeboxes') return ok(data.timeboxes.filter((t) => t.projectId === project.id));
  if (args.timebox_id !== undefined && args.timebox_name !== undefined) return err('Pass either timebox_id or timebox_name, not both.');
  let rows = data.tasks.filter((t) => t.projectId === project.id);
  if (args.task_type) rows = rows.filter((t) => t.type === args.task_type);
  if (args.status) rows = rows.filter((t) => t.status === args.status);
  if (args.assignee_id) rows = rows.filter((t) => t.assigneeId === args.assignee_id);
  let tb = args.timebox_id;
  if (args.timebox_name !== undefined) {
    const hit = data.timeboxes.find((t) => t.projectId === project.id && t.name.toLowerCase() === String(args.timebox_name).toLowerCase());
    if (!hit) return err(`No timebox named '${args.timebox_name}' in this project. Known: ${data.timeboxes.filter((t) => t.projectId === project.id).map((t) => t.name).join(', ')}.`);
    tb = hit.id;
  }
  if (tb !== undefined) rows = rows.filter((t) => t.timeboxId === tb);
  const subject = { resource, project_id: project.id, ...(args.task_type ? { task_type: args.task_type } : {}), ...(args.status ? { status: args.status } : {}) };
  if (args.group_by !== undefined || args.count_only === true) {
    if (args.fields !== undefined) return err('fields cannot be combined with count_only or group_by.');
    const base = { subject, total: rows.length, complete: true, method: 'client-paging', unit: 'entities' };
    if (args.group_by === undefined) return ok(base);
    const key = GROUP_ALIASES[args.group_by];
    if (!key) return err(`Cannot group tasks by '${args.group_by}'.`);
    return ok({ ...base, groupBy: args.group_by, groups: tally(rows, key) });
  }
  const offset = args.offset ?? 0, limit = args.limit ?? 50;
  const page = rows.slice(offset, offset + limit).map((t) => pick(t, args.fields));
  if (!page.length) return ok({ records: [], subject, note: 'No records matched. This covers only the resource, parent ids and filters in subject.' });
  const next = offset + page.length < rows.length ? { nextPage: { offset: offset + page.length } } : {};
  return ok({ records: page, ...next });
}

/** calm_get: one entity by id; features also by display id such as 6-123. */
function calmGet(data, args = {}) {
  const { resource, id } = args;
  if (!GET_RESOURCES.includes(resource)) return err(`Unknown resource '${resource}'. Use calm_resources to list valid ones.`);
  const list = resource === 'project' ? data.projects : resource === 'task' ? data.tasks : data.features;
  const hit = list.find((x) => x.id === id || (resource !== 'project' && x.displayId === id));
  return hit ? ok(hit) : err(`${resource} '${id}' not found.`);
}

/** calm_analytics: tenant-wide aggregation by provider. Only `<field> eq '<value>'` joined by `and` is understood here. */
function calmAnalytics(data, args = {}) {
  const provider = args.provider;
  if (!ANALYTICS_PROVIDERS.includes(provider)) return err(`Unknown provider '${provider}'. Known: ${ANALYTICS_PROVIDERS.join(', ')}.`);
  const projectName = (id) => (data.projects.find((p) => p.id === id) ?? {}).name;
  let rows;
  if (provider === 'Tasks') rows = data.tasks.map((t) => ({ ...t, typeID: t.type, projectName: projectName(t.projectId) }));
  else if (provider === 'Defects') rows = data.tasks.filter((t) => t.type === 'CALMDEF').map((t) => ({ ...t, defectStatus: t.status, projectName: projectName(t.projectId) }));
  else if (provider === 'Requirements') rows = data.tasks.filter((t) => t.type === 'CALMREQU').map((t) => ({ ...t, projectName: projectName(t.projectId) }));
  else if (provider === 'Tests') rows = data.tests.map((t) => ({ ...t, projectName: projectName(t.projectId) }));
  else rows = data.projects.map((p) => ({ ...p, projectName: p.name }));
  let applied;
  if (args.filter) {
    const parts = String(args.filter).split(/\s+and\s+/i);
    for (const part of parts) {
      const m = /^\s*(\w+)\s+eq\s+'([^']*)'\s*$/.exec(part);
      if (!m) return err(`Cannot read the filter "${part}". Use "<field> eq '<value>'", joined by and.`);
      if (rows.length && !(m[1] in rows[0])) return err(`The ${provider} provider has no field '${m[1]}'. Call calm_resources({ topic: '${provider}' }) for the fields.`);
      rows = rows.filter((r) => String(r[m[1]]) === m[2]);
    }
    applied = args.filter;
  }
  const out = { subject: { provider }, ...(applied ? { filter: applied } : {}), total: rows.length, complete: true, method: 'analytics-measure', unit: 'entities', snapshot: 'daily snapshot, not a live read' };
  if (args.group_by) {
    const keys = String(args.group_by).split(',').map((k) => k.trim());
    const bad = keys.find((k) => rows.length && !(k in rows[0]) && !GROUP_ALIASES[k]);
    if (bad) return err(`Cannot group ${provider} by '${bad}'.`);
    const m = new Map();
    for (const r of rows) { const v = keys.map((k) => String(r[GROUP_ALIASES[k] ?? k] ?? '(no value)')).join(' | '); m.set(v, (m.get(v) ?? 0) + 1); }
    out.groupBy = args.group_by;
    out.groups = [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  return ok(out);
}

/** The four read tools, dispatched by their MCP name. calm_create is deliberately absent: the mock is read-only. */
function callCalm(data, name, args) {
  if (name === 'calm_resources') return calmResources(data, args);
  if (name === 'calm_list') return calmList(data, args);
  if (name === 'calm_get') return calmGet(data, args);
  if (name === 'calm_analytics') return calmAnalytics(data, args);
  if (name === 'calm_create') return err('Write access is disabled. Set CALM_WRITE_ENABLED=true to allow calm_create (it can only create documents and library entries).');
  return err(`Unknown tool '${name}'.`);
}
// END-MODEL

export { calmResources, calmList, calmGet, calmAnalytics, callCalm };
