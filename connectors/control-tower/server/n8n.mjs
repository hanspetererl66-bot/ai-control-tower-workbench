/**
 * n8n Cloud data for the AI Control Tower connector and the Automation Dashboard Space.
 * Self-contained (no imports from outside this folder) so it ships inside the .mcpb bundle.
 * Reads workflows and executions from the n8n public API (X-N8N-API-KEY): names, tags, active state, node types,
 * status, mode and timings. Execution payloads are never requested or stored.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from './tools.mjs';

const here = (path) => join(dirname(fileURLToPath(import.meta.url)), path);
export const DAY = 864e5;
export const WINDOW_DAYS = 14;
const RECENT = 60;
const MAX_PAGES = 20;

/** Accepts "acme.app.n8n.cloud" or a full https URL; returns the bare origin. Throws a readable error otherwise. */
export function normalizeInstanceUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('Bitte die n8n-Adresse eintragen, z. B. https://firma.app.n8n.cloud');
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error('Die n8n-Adresse ist keine gültige URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Die n8n-Adresse muss mit https:// beginnen.');
  if (url.username || url.password) throw new Error('Die n8n-Adresse darf keine Zugangsdaten enthalten.');
  if (!url.hostname.includes('.')) throw new Error('Die n8n-Adresse braucht einen vollständigen Hostnamen.');
  return url.origin;
}

/** Category rules: N8N_CATEGORIES, the bundled copy, or the example Space's file in the repository. */
export function loadCategories(file) {
  const candidates = [file, process.env.N8N_CATEGORIES, here('../data/n8n-categories.json'), here('../../../examples/automation-dashboard/categories.json')].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('n8n category rules not found');
  return JSON.parse(readFileSync(found, 'utf8'));
}

/** Explicit pin "cat:<name>" wins; otherwise the first category (in file order) with a matching tag; otherwise the fallback. */
export function categorize(tags, config) {
  const pinned = tags.map((tag) => /^cat:\s*(.+)$/i.exec(tag)?.[1]?.trim()).find(Boolean);
  if (pinned) return config.categories.find((c) => c.name.toLowerCase() === pinned.toLowerCase())?.name ?? pinned;
  const lower = new Set(tags.map((tag) => tag.toLowerCase()));
  return config.categories.find((c) => c.tags.some((tag) => lower.has(tag.toLowerCase())))?.name ?? config.fallback;
}

const GENERIC_NODES = new Set(['set', 'if', 'switch', 'merge', 'code', 'function', 'functionitem', 'noop', 'stickynote', 'wait', 'splitinbatches', 'respondtowebhook', 'executeworkflow', 'executeworkflowtrigger', 'filter', 'aggregate', 'splitout', 'sort', 'limit', 'removeduplicates', 'datetime', 'editfields', 'comparedatasets', 'summarize', 'itemlists']);

const APP_NAMES = { sap: 'SAP', openAi: 'OpenAI', httpRequest: 'HTTP', successFactors: 'SuccessFactors', concur: 'Concur', salesforce: 'Salesforce', gmail: 'Gmail', slack: 'Slack', notion: 'Notion', emailReadImap: 'Email (IMAP)' };
const prettyApp = (type) => APP_NAMES[type] ?? type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** Trigger kind and connected apps from the node types (what the public API returns with each workflow). */
export function deriveNodes(nodes = []) {
  const types = nodes.map((node) => String(node.type ?? '').split('.').pop());
  const triggerType = types.find((type) => /trigger|webhook|cron|schedule/i.test(type));
  const trigger = !triggerType ? 'Unknown' : /manual/i.test(triggerType) ? 'Manual' : /schedule|cron/i.test(triggerType) ? 'Schedule' : /webhook/i.test(triggerType) ? 'Webhook' : 'App event';
  const plainTrigger = (type) => /^(webhook|cron|schedule|scheduletrigger|manualtrigger|workflowtrigger|executeworkflowtrigger)$/i.test(type);
  const apps = [...new Set(types.filter((type) => type && !GENERIC_NODES.has(type.toLowerCase()) && !plainTrigger(type)).map((type) => prettyApp(type.replace(/(Trigger|Tool)$/, ''))))];
  return { trigger, apps: apps.slice(0, 6), nodeCount: nodes.length };
}

/** n8n statuses -> success | error | running | canceled */
export function normalizeStatus(status) {
  const value = String(status ?? '').toLowerCase();
  if (value === 'success') return 'success';
  if (value === 'error' || value === 'crashed' || value === 'failed') return 'error';
  if (value === 'canceled' || value === 'cancelled') return 'canceled';
  return 'running'; // running, waiting, new
}

const dateKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Pure aggregation: raw n8n workflows + executions -> the shape the Space renders. */
export function buildDashboardData({ workflows, executions, asOf, source, instance, windowDays = WINDOW_DAYS, categories = loadCategories() }) {
  const end = Date.parse(`${asOf}T00:00:00Z`) + DAY; // exclusive: the whole of asOf counts
  const start = end - windowDays * DAY;
  const days = Array.from({ length: windowDays }, (_, i) => ({ date: dateKey(start + i * DAY), success: 0, error: 0, other: 0 }));
  const byDay = new Map(days.map((day) => [day.date, day]));
  const names = new Map(workflows.map((workflow) => [String(workflow.id), workflow.name]));

  const inWindow = executions
    .map((execution) => {
      const started = Date.parse(execution.startedAt);
      const stopped = Date.parse(execution.stoppedAt);
      return {
        id: String(execution.id),
        workflowId: String(execution.workflowId),
        status: normalizeStatus(execution.status),
        mode: String(execution.mode ?? 'unknown'),
        startedAt: Number.isFinite(started) ? new Date(started).toISOString() : '',
        seconds: Number.isFinite(started) && Number.isFinite(stopped) && stopped >= started ? Math.round((stopped - started) / 100) / 10 : null,
        started,
      };
    })
    .filter((execution) => Number.isFinite(execution.started) && execution.started >= start && execution.started < end)
    .sort((a, b) => b.started - a.started);

  for (const execution of inWindow) {
    const day = byDay.get(dateKey(execution.started));
    if (!day) continue;
    if (execution.status === 'success') day.success += 1;
    else if (execution.status === 'error') day.error += 1;
    else day.other += 1;
  }

  const stats = workflows.map((workflow) => {
    const mine = inWindow.filter((execution) => execution.workflowId === String(workflow.id));
    const finished = mine.filter((execution) => execution.seconds !== null && execution.status !== 'running');
    const tags = (workflow.tags ?? []).map((tag) => (typeof tag === 'string' ? tag : tag.name)).filter(Boolean);
    const category = categorize(tags, categories);
    const rule = categories.categories.find((c) => c.name === category);
    const daily = days.map((day) => {
      const ofDay = mine.filter((execution) => dateKey(execution.started) === day.date);
      return { success: ofDay.filter((e) => e.status === 'success').length, error: ofDay.filter((e) => e.status === 'error').length, other: ofDay.filter((e) => e.status !== 'success' && e.status !== 'error').length };
    });
    const success = mine.filter((execution) => execution.status === 'success').length;
    return {
      ...deriveNodes(workflow.nodes),
      category,
      daily,
      minutesSaved: Math.round(success * (rule?.minutesPerRun ?? categories.fallbackMinutesPerRun)),
      recent: mine.slice(0, 8).map(({ id, status, mode, startedAt, seconds }) => ({ id, status, mode, startedAt, seconds })),
      id: String(workflow.id),
      name: workflow.name,
      active: workflow.active === true,
      tags,
      executions: mine.length,
      success,
      error: mine.filter((execution) => execution.status === 'error').length,
      lastRun: mine[0]?.startedAt ?? null,
      lastStatus: mine[0]?.status ?? null,
      avgSeconds: finished.length ? Math.round((finished.reduce((sum, execution) => sum + execution.seconds, 0) / finished.length) * 10) / 10 : null,
    };
  });

  return {
    source,
    instance,
    asOf,
    windowDays,
    days,
    categories: categories.categories.map(({ name, tags: ruleTags, minutesPerRun }) => ({ name, tags: ruleTags, minutesPerRun })).concat([{ name: categories.fallback, tags: [], minutesPerRun: categories.fallbackMinutesPerRun }]),
    workflows: stats.sort((a, b) => b.executions - a.executions || a.name.localeCompare(b.name)),
    executions: inWindow.slice(0, RECENT).map(({ started: _started, ...execution }) => ({
      ...execution,
      workflowName: names.get(execution.workflowId) ?? `Workflow ${execution.workflowId}`,
    })),
  };
}

/* ---------------- n8n Cloud public API ---------------- */

async function getAll({ origin, key, path, params, fetchImpl, stop }) {
  const rows = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ ...params, ...(cursor ? { cursor } : {}) });
    let response;
    try {
      response = await fetchImpl(`${origin}/api/v1/${path}?${query}`, { headers: { 'X-N8N-API-KEY': key, Accept: 'application/json' } });
    } catch {
      throw new Error('n8n is not reachable.');
    }
    if (response.status === 401 || response.status === 403) throw new Error('n8n rejected the API key.');
    if (!response.ok) throw new Error(`n8n API error (HTTP ${response.status}).`);
    const body = await response.json();
    rows.push(...(body.data ?? []));
    cursor = body.nextCursor;
    if (!cursor || stop?.(body.data ?? [])) break;
  }
  return rows;
}

export async function fetchN8n({ url, key, asOf, fetchImpl = fetch, windowDays = WINDOW_DAYS, categories = loadCategories() }) {
  if (!key) throw new Error('Set N8N_API_KEY first (n8n: Settings -> n8n API).');
  const origin = normalizeInstanceUrl(url);
  const start = Date.parse(`${asOf}T00:00:00Z`) + DAY - windowDays * DAY;
  const workflows = await getAll({ origin, key, path: 'workflows', params: { limit: '250' }, fetchImpl });
  // Executions come newest first: stop as soon as a page reaches back past the window.
  const executions = await getAll({
    origin,
    key,
    path: 'executions',
    params: { limit: '250', includeData: 'false' },
    fetchImpl,
    stop: (rows) => rows.length > 0 && rows.every((row) => Date.parse(row.startedAt) < start),
  });
  return buildDashboardData({ workflows, executions, asOf, source: 'n8n', instance: new URL(origin).host, windowDays, categories });
}

/* ---------------- chat tools ---------------- */

const STATUSES = ['success', 'error', 'running', 'canceled'];

const VM_TASKS = ['cert', 'patch', 'disk', 'backup', 'unreachable', 'cpu', 'mem'];

export const N8N_TOOL_DEFINITIONS = [
  {
    name: 'get_n8n_overview',
    description:
      'Overview of the n8n Cloud automation of the last 14 days: workflows (total, active), executions, success rate, failed runs, average duration, estimated time saved, executions per day, figures per category (by n8n tags), the workflows that need attention and the ones not categorized yet. Use it for broad questions such as "how is our automation doing?". Needs the n8n connection (instance address and API key in the connector settings).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_n8n_workflows',
    description:
      'List n8n workflows with category (from tags), tags, trigger, connected apps, runs, success, errors, last run and last status of the last 14 days. Filter by free text (name, tag, app), category, active state or "failing" (with errors). Busiest first; default 25 rows.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Matches name, tags, apps and category.' },
        category: { type: 'string', description: 'Category name, case-insensitive (see list_n8n_categories).' },
        active: { type: 'boolean', description: 'Only active (true) or inactive (false) workflows.' },
        failing: { type: 'boolean', description: 'Only workflows with failed runs.' },
        limit: { type: 'number', description: 'Maximum rows (1-200, default 25).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_n8n_workflow',
    description:
      'One n8n workflow in detail by id or (partial) name: category, tags, trigger, apps, node count, runs per day, success rate, average duration, estimated time saved and its latest executions.',
    inputSchema: {
      type: 'object',
      properties: { workflow: { type: 'string', description: 'Workflow id or part of its name.' } },
      required: ['workflow'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_n8n_executions',
    description:
      'Recent n8n executions (latest 60 of the last 14 days), newest first, with workflow, category, status, mode and duration. Filter by status (success, error, running, canceled), workflow (id or part of the name) or category. Execution contents are never loaded.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: STATUSES },
        workflow: { type: 'string', description: 'Workflow id or part of its name.' },
        category: { type: 'string' },
        limit: { type: 'number', description: 'Maximum rows (1-60, default 20).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_n8n_categories',
    description:
      'The categories n8n workflows are sorted into (by their tags): the matching tags, the workflows in each category and the ones that are not categorized yet. A workflow can be pinned with the n8n tag "cat:<Category name>".',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_it_ops_triage',
    description:
      'Run the demo n8n workflow "Demo 4 (IT operations): alert triage" through its webhook (/webhook/it-ops-triage). It checks alert text against instructions aimed at AI assistants, gives each alert a transparent priority (P1 page on-call, P2 ticket, P3 watch) and returns a digest. Without alerts it uses the seven fictional sample alerts of the workflow. It only computes: nothing is paged, restarted or changed. Needs N8N_URL and the workflow imported and active (mode "test" uses the test webhook after Execute workflow was clicked in the editor). Tell the person what you are about to run when they gave their own alerts.',
    inputSchema: {
      type: 'object',
      properties: {
        alerts: {
          type: 'array',
          maxItems: 50,
          description: 'Optional alerts. Omit to use the sample alerts.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, service: { type: 'string' }, text: { type: 'string', maxLength: 500 },
              severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              impact: { type: 'string', enum: ['high', 'medium', 'low'] },
              customerFacing: { type: 'boolean' }, repeat24h: { type: 'integer', minimum: 0, maximum: 99 },
            },
            required: ['id', 'service', 'severity', 'text'],
            additionalProperties: false,
          },
        },
        mode: { type: 'string', enum: ['production', 'test'], description: 'production (default, workflow must be active) or test.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'run_vm_maintenance_plan',
    description:
      'Run the demo n8n workflow "Demo 5 (IT infrastructure): VM maintenance plan" through its webhook (/webhook/vm-maintenance-plan). It checks virtual machines against fixed rules (CPU, memory, disk, backup, security patch, TLS certificate), turns every yellow or red reason into a recommended task (renew certificate, install patch, free up disk space, catch up backup, check an unreachable VM), proposes a maintenance window and bundles tasks per VM. Without vms it uses the 25 fictional VMs of the IT Infrastructure Space. It only proposes: nothing is run, restarted or changed. Needs N8N_URL; the workflow examples/n8n-workflows/05-vm-maintenance-plan.json must be imported and active.',
    inputSchema: {
      type: 'object',
      properties: {
        vms: {
          type: 'array',
          maxItems: 100,
          description: 'Optional VMs. Omit to use the sample VMs.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, env: { type: 'string', enum: ['prod', 'test', 'dev'] }, reachable: { type: 'boolean' },
              cpuPct: { type: 'number', minimum: 0, maximum: 100 }, memPct: { type: 'number', minimum: 0, maximum: 100 }, diskPct: { type: 'number', minimum: 0, maximum: 100 },
              backupAgeHours: { type: ['number', 'null'], minimum: 0 }, patchLagDays: { type: 'number', minimum: 0 }, certExpiresInDays: { type: 'number', minimum: -365 },
            },
            required: ['id', 'name'],
            additionalProperties: false,
          },
        },
        mode: { type: 'string', enum: ['production', 'test'], description: 'production (default, workflow must be active) or test.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'run_vm_operator_runbook',
    description:
      'Run the demo n8n workflow "Demo 6 (IT infrastructure): operator runbook" through its webhook (/webhook/vm-operator-runbook). It is the operator side of a VM ticket: 1 check the VM again, 2 take a backup if a production VM has no restore point from the last 24 h, 3 apply the task (for example install the renewed TLS certificate), 4 check again and report. Everything is simulated, no real VM is touched. It only runs when approved is true, which you set only after the person has said that the approver agreed; otherwise it stops after the check. Without vm it uses the sample ticket T-1042 (certificate of proxy-edge-01).',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: 'Ticket id, for example T-1042.' },
        ticketTitle: { type: 'string', description: 'Ticket title.' },
        vm: {
          type: 'object',
          description: 'The VM with its measurements. Omit to use the sample.',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, env: { type: 'string', enum: ['prod', 'test', 'dev'] }, reachable: { type: 'boolean' },
            cpuPct: { type: 'number', minimum: 0, maximum: 100 }, memPct: { type: 'number', minimum: 0, maximum: 100 }, diskPct: { type: 'number', minimum: 0, maximum: 100 },
            backupAgeHours: { type: ['number', 'null'], minimum: 0 }, patchLagDays: { type: 'number', minimum: 0 }, certExpiresInDays: { type: 'number', minimum: -365 },
          },
          required: ['id', 'name'],
          additionalProperties: false,
        },
        task: { type: 'string', enum: VM_TASKS, description: 'Which task to run on the VM. Default for the sample: cert.' },
        approved: { type: 'boolean', description: 'true only after the named approver agreed. Default false: the runbook stops after the check.' },
        mode: { type: 'string', enum: ['production', 'test'], description: 'production (default, workflow must be active) or test.' },
      },
      additionalProperties: false,
    },
  },
];

const round1 = (value) => Math.round(value * 10) / 10;
const ratePct = (ok, bad) => (ok + bad ? Math.round((ok / (ok + bad)) * 100) : null);
const sumOf = (list, pick) => list.reduce((total, item) => total + pick(item), 0);

function toolLimit(args, fallback, max) {
  if (args.limit === undefined) return fallback;
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > max) throw new ToolError(`limit must be an integer from 1 to ${max}`);
  return args.limit;
}

function findWorkflows(data, needle) {
  const text = String(needle ?? '').trim().toLowerCase();
  if (!text) throw new ToolError('workflow is required');
  const exact = data.workflows.filter((w) => w.id.toLowerCase() === text || w.name.toLowerCase() === text);
  return exact.length ? exact : data.workflows.filter((w) => w.name.toLowerCase().includes(text));
}

const brief = (w) => ({
  id: w.id,
  name: w.name,
  active: w.active,
  category: w.category,
  tags: w.tags,
  trigger: w.trigger,
  apps: w.apps,
  executions: w.executions,
  success: w.success,
  error: w.error,
  successRatePct: ratePct(w.success, w.error),
  avgSeconds: w.avgSeconds,
  lastRun: w.lastRun,
  lastStatus: w.lastStatus,
});

/** `env` supplies N8N_URL and N8N_API_KEY; the fetched data is cached briefly so a follow-up question costs no new API calls. */
export function createN8nHandlers({ env = process.env, fetchImpl = fetch, now = () => new Date(), ttlMs = 60_000 } = {}) {
  let cache = null;
  async function load() {
    if (!env.N8N_URL || !env.N8N_API_KEY) {
      throw new ToolError('n8n is not connected: enter the n8n address (N8N_URL) and an API key (N8N_API_KEY, n8n: Settings, n8n API) in the connector settings.');
    }
    if (cache && Date.now() - cache.at < ttlMs) return cache.data;
    let data;
    try {
      data = await fetchN8n({ url: env.N8N_URL, key: env.N8N_API_KEY, asOf: now().toISOString().slice(0, 10), fetchImpl, categories: loadCategories() });
    } catch (error) {
      throw new ToolError(`n8n: ${error.message}`);
    }
    cache = { at: Date.now(), data };
    return data;
  }
  const source = (data) => `n8n Cloud (${data.instance}), last ${data.windowDays} days`;
  const catOf = (data, id) => data.workflows.find((w) => w.id === id)?.category ?? null;

  return {
    async get_n8n_overview() {
      const data = await load();
      const workflows = data.workflows;
      const ok = sumOf(workflows, (w) => w.success);
      const bad = sumOf(workflows, (w) => w.error);
      const timed = workflows.filter((w) => w.avgSeconds !== null && w.executions);
      const runs = sumOf(timed, (w) => w.executions);
      const fallback = data.categories.at(-1).name;
      return {
        instance: data.instance,
        asOf: data.asOf,
        windowDays: data.windowDays,
        workflows: { total: workflows.length, active: workflows.filter((w) => w.active).length, inactive: workflows.filter((w) => !w.active).length },
        executions: {
          total: sumOf(workflows, (w) => w.executions),
          success: ok,
          error: bad,
          successRatePct: ratePct(ok, bad),
          avgSeconds: runs ? round1(sumOf(timed, (w) => w.avgSeconds * w.executions) / runs) : null,
        },
        estimatedTimeSavedHours: round1(sumOf(workflows, (w) => w.minutesSaved) / 60),
        perDay: data.days,
        byCategory: data.categories
          .map((c) => {
            const list = workflows.filter((w) => w.category === c.name);
            const cOk = sumOf(list, (w) => w.success);
            const cBad = sumOf(list, (w) => w.error);
            return { category: c.name, workflows: list.length, active: list.filter((w) => w.active).length, executions: sumOf(list, (w) => w.executions), success: cOk, error: cBad, successRatePct: ratePct(cOk, cBad), estimatedTimeSavedHours: round1(sumOf(list, (w) => w.minutesSaved) / 60) };
          })
          .filter((c) => c.workflows > 0),
        needsAttention: workflows
          .filter((w) => w.error > 0)
          .sort((a, b) => b.error / b.executions - a.error / a.executions || b.error - a.error)
          .slice(0, 6)
          .map((w) => ({ id: w.id, name: w.name, category: w.category, errors: w.error, runs: w.executions, errorRatePct: Math.round((w.error / w.executions) * 100) })),
        notCategorized: workflows.filter((w) => w.category === fallback).map((w) => ({ id: w.id, name: w.name, tags: w.tags })),
        view: { space: 'automation-dashboard', tab: 'overview' },
        dataSource: source(data),
      };
    },
    async list_n8n_workflows(args = {}) {
      const data = await load();
      const limit = toolLimit(args, 25, 200);
      for (const key of ['active', 'failing']) {
        if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new ToolError(`${key} must be true or false`);
      }
      const search = typeof args.search === 'string' ? args.search.trim().toLowerCase() : '';
      const category = typeof args.category === 'string' ? args.category.trim().toLowerCase() : '';
      if (category && !data.categories.some((c) => c.name.toLowerCase() === category)) {
        throw new ToolError(`Unknown category "${args.category}". Known: ${data.categories.map((c) => c.name).join(', ')}`);
      }
      const matches = data.workflows
        .filter((w) => !category || w.category.toLowerCase() === category)
        .filter((w) => args.active === undefined || w.active === args.active)
        .filter((w) => args.failing !== true || w.error > 0)
        .filter((w) => !search || `${w.name} ${w.tags.join(' ')} ${w.apps.join(' ')} ${w.category}`.toLowerCase().includes(search));
      return {
        instance: data.instance,
        totalWorkflows: data.workflows.length,
        matched: matches.length,
        returned: Math.min(limit, matches.length),
        sortedBy: 'executions (descending)',
        workflows: matches.slice(0, limit).map(brief),
        view: { space: 'automation-dashboard', tab: 'workflows' },
        dataSource: source(data),
      };
    },
    async get_n8n_workflow(args = {}) {
      const data = await load();
      const found = findWorkflows(data, args.workflow);
      if (!found.length) throw new ToolError(`No workflow matches "${args.workflow}". Try list_n8n_workflows.`);
      if (found.length > 1) throw new ToolError(`"${args.workflow}" matches ${found.length} workflows: ${found.slice(0, 8).map((w) => `${w.name} (${w.id})`).join('; ')}. Use the id.`);
      const w = found[0];
      return {
        instance: data.instance,
        workflow: { ...brief(w), nodeCount: w.nodeCount, estimatedTimeSavedHours: round1(w.minutesSaved / 60) },
        perDay: w.daily.map((d, i) => ({ date: data.days[i].date, ...d })),
        latestExecutions: w.recent,
        view: { space: 'automation-dashboard', tab: 'workflows' },
        dataSource: source(data),
      };
    },
    async list_n8n_executions(args = {}) {
      const data = await load();
      const limit = toolLimit(args, 20, 60);
      if (args.status !== undefined && !STATUSES.includes(args.status)) throw new ToolError(`status must be one of: ${STATUSES.join(', ')}`);
      let ids = null;
      if (args.workflow !== undefined) {
        const found = findWorkflows(data, args.workflow);
        if (!found.length) throw new ToolError(`No workflow matches "${args.workflow}".`);
        ids = new Set(found.map((w) => w.id));
      }
      const category = typeof args.category === 'string' ? args.category.trim().toLowerCase() : '';
      const matches = data.executions
        .filter((e) => !args.status || e.status === args.status)
        .filter((e) => !ids || ids.has(e.workflowId))
        .filter((e) => !category || String(catOf(data, e.workflowId)).toLowerCase() === category);
      return {
        instance: data.instance,
        window: `latest ${data.executions.length} executions of the last ${data.windowDays} days`,
        matched: matches.length,
        returned: Math.min(limit, matches.length),
        executions: matches.slice(0, limit).map((e) => ({ ...e, category: catOf(data, e.workflowId) })),
        view: { space: 'automation-dashboard', tab: 'runs' },
        dataSource: source(data),
      };
    },
    async list_n8n_categories() {
      const data = await load();
      return {
        instance: data.instance,
        howItWorks: 'Workflows are sorted by their n8n tags; the first category whose tags match wins. Pin a workflow with the n8n tag "cat:<Category name>".',
        categories: data.categories.map((c) => ({
          name: c.name,
          matchingTags: c.tags,
          assumedMinutesPerRun: c.minutesPerRun,
          workflows: data.workflows.filter((w) => w.category === c.name).map((w) => ({ id: w.id, name: w.name, tags: w.tags })),
        })),
        view: { space: 'automation-dashboard', tab: 'categories' },
        dataSource: source(data),
      };
    },
    async run_it_ops_triage(args = {}) {
      if (!env.N8N_URL) throw new ToolError('n8n is not connected: enter the n8n address (N8N_URL) in the connector settings. The workflow itself is examples/n8n-workflows/04-it-operations-alert-triage.json (import it and activate it).');
      const mode = args.mode ?? 'production';
      if (!['production', 'test'].includes(mode)) throw new ToolError('mode must be production or test');
      const body = {};
      if (args.alerts !== undefined) {
        if (!Array.isArray(args.alerts) || !args.alerts.length || args.alerts.length > 50) throw new ToolError('alerts must be a list of 1 to 50 alerts');
        body.alerts = args.alerts.map((a, i) => {
          if (!a || typeof a !== 'object') throw new ToolError(`alert ${i + 1} must be an object`);
          for (const key of ['id', 'service', 'text']) if (typeof a[key] !== 'string' || !a[key].trim()) throw new ToolError(`alert ${i + 1}: ${key} is required`);
          if (!['critical', 'high', 'medium', 'low'].includes(a.severity)) throw new ToolError(`alert ${i + 1}: severity must be critical, high, medium or low`);
          if (a.impact !== undefined && !['high', 'medium', 'low'].includes(a.impact)) throw new ToolError(`alert ${i + 1}: impact must be high, medium or low`);
          return { id: a.id.slice(0, 40), service: a.service.slice(0, 80), severity: a.severity, impact: a.impact ?? 'low', customerFacing: a.customerFacing === true, repeat24h: Number.isInteger(a.repeat24h) ? Math.max(0, Math.min(99, a.repeat24h)) : 0, text: a.text.slice(0, 500) };
        });
      }
      let origin;
      try { origin = normalizeInstanceUrl(env.N8N_URL); } catch (error) { throw new ToolError(`n8n: ${error.message}`); }
      const url = `${origin}/${mode === 'test' ? 'webhook-test' : 'webhook'}/it-ops-triage`;
      let response;
      try {
        response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        throw new ToolError(`n8n: the workflow did not answer (${error.message})`);
      }
      if (response.status === 404) throw new ToolError(mode === 'test' ? 'n8n: the test webhook is not listening. Open the workflow in n8n and click Execute workflow first, then ask again.' : 'n8n: webhook /webhook/it-ops-triage not found. Import the workflow and switch it to active (or use mode "test").');
      if (!response.ok) throw new ToolError(`n8n: the workflow answered with HTTP ${response.status}`);
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); } catch { result = text.slice(0, 4000); }
      const first = Array.isArray(result) ? result[0] : result;
      return {
        workflow: 'Demo 4 (IT operations): alert triage',
        mode,
        alertsSent: body.alerts ? body.alerts.length : 'sample alerts of the workflow',
        result: first ?? result,
        note: 'Computed only. Nothing was paged, restarted or changed; a person decides about paging, tickets and restarts.',
        view: { space: 'it-operations', tab: 'overview' },
      };
    },
    async run_vm_operator_runbook(args = {}) {
      if (!env.N8N_URL) throw new ToolError('n8n is not connected: enter the n8n address (N8N_URL) in the connector settings. The workflow itself is examples/n8n-workflows/06-vm-operator-runbook.json (import it and activate it).');
      const mode = args.mode ?? 'production';
      if (!['production', 'test'].includes(mode)) throw new ToolError('mode must be production or test');
      if (args.task !== undefined && !VM_TASKS.includes(args.task)) throw new ToolError(`task must be one of ${VM_TASKS.join(', ')}`);
      if (args.approved !== undefined && typeof args.approved !== 'boolean') throw new ToolError('approved must be true or false');
      const body = {};
      if (args.vm !== undefined) {
        const v = args.vm;
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ToolError('vm must be an object');
        for (const key of ['id', 'name']) if (typeof v[key] !== 'string' || !v[key].trim()) throw new ToolError(`vm: ${key} is required`);
        if (v.env !== undefined && !['prod', 'test', 'dev'].includes(v.env)) throw new ToolError('vm: env must be prod, test or dev');
        if (!args.task) throw new ToolError('task is required when a vm is given');
        const num = (x, lo, hi) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : undefined);
        const out = { id: v.id.slice(0, 40), name: v.name.slice(0, 80), role: typeof v.role === 'string' ? v.role.slice(0, 120) : '', env: v.env ?? 'prod', reachable: v.reachable !== false };
        for (const [key, lo, hi] of [['cpuPct', 0, 100], ['memPct', 0, 100], ['diskPct', 0, 100], ['patchLagDays', 0, 3650], ['certExpiresInDays', -365, 3650]]) { const n = num(v[key], lo, hi); if (n !== undefined) out[key] = n; }
        if (v.backupAgeHours === null) out.backupAgeHours = null; else { const n = num(v.backupAgeHours, 0, 100000); if (n !== undefined) out.backupAgeHours = n; }
        body.vm = out;
        body.task = args.task;
        body.ticket = { id: typeof args.ticketId === 'string' ? args.ticketId.slice(0, 40) : '', title: typeof args.ticketTitle === 'string' ? args.ticketTitle.slice(0, 120) : '' };
        body.approved = args.approved === true;
      }
      let origin;
      try { origin = normalizeInstanceUrl(env.N8N_URL); } catch (error) { throw new ToolError(`n8n: ${error.message}`); }
      const url = `${origin}/${mode === 'test' ? 'webhook-test' : 'webhook'}/vm-operator-runbook`;
      let response;
      try {
        response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        throw new ToolError(`n8n: the workflow did not answer (${error.message})`);
      }
      if (response.status === 404) throw new ToolError(mode === 'test' ? 'n8n: the test webhook is not listening. Open the workflow in n8n and click Execute workflow first, then ask again.' : 'n8n: webhook /webhook/vm-operator-runbook not found. Import the workflow 06-vm-operator-runbook.json and activate it, or use mode "test".');
      if (!response.ok) throw new ToolError(`n8n: the workflow answered with HTTP ${response.status}`);
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); } catch { result = text.slice(0, 4000); }
      const first = Array.isArray(result) ? result[0] : result;
      return {
        workflow: 'Demo 6 (IT infrastructure): operator runbook',
        mode,
        sent: body.vm ? { vm: body.vm.name, task: body.task, approved: body.approved } : 'sample ticket T-1042 of the workflow',
        result: first ?? result,
        note: 'Simulated. No real VM was backed up, changed or restarted. The runbook only runs when approved is true and the check still shows the reason.',
        view: { space: 'it-infrastructure', tab: 'overview' },
      };
    },
    async run_vm_maintenance_plan(args = {}) {
      if (!env.N8N_URL) throw new ToolError('n8n is not connected: enter the n8n address (N8N_URL) in the connector settings. The workflow itself is examples/n8n-workflows/05-vm-maintenance-plan.json (import it and activate it).');
      const mode = args.mode ?? 'production';
      if (!['production', 'test'].includes(mode)) throw new ToolError('mode must be production or test');
      const body = {};
      if (args.vms !== undefined) {
        if (!Array.isArray(args.vms) || !args.vms.length || args.vms.length > 100) throw new ToolError('vms must be a list of 1 to 100 virtual machines');
        const num = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
        body.vms = args.vms.map((v, i) => {
          if (!v || typeof v !== 'object') throw new ToolError(`vm ${i + 1} must be an object`);
          for (const key of ['id', 'name']) if (typeof v[key] !== 'string' || !v[key].trim()) throw new ToolError(`vm ${i + 1}: ${key} is required`);
          if (v.env !== undefined && !['prod', 'test', 'dev'].includes(v.env)) throw new ToolError(`vm ${i + 1}: env must be prod, test or dev`);
          const out = { id: v.id.slice(0, 40), name: v.name.slice(0, 80), role: typeof v.role === 'string' ? v.role.slice(0, 120) : '', env: v.env ?? 'prod', reachable: v.reachable !== false };
          for (const [key, lo, hi] of [['cpuPct', 0, 100], ['memPct', 0, 100], ['diskPct', 0, 100], ['patchLagDays', 0, 3650], ['certExpiresInDays', -365, 3650]]) { const n = num(v[key], lo, hi); if (n !== undefined) out[key] = n; }
          if (v.backupAgeHours === null) out.backupAgeHours = null; else { const n = num(v.backupAgeHours, 0, 100000); if (n !== undefined) out.backupAgeHours = n; }
          return out;
        });
      }
      let origin;
      try { origin = normalizeInstanceUrl(env.N8N_URL); } catch (error) { throw new ToolError(`n8n: ${error.message}`); }
      const url = `${origin}/${mode === 'test' ? 'webhook-test' : 'webhook'}/vm-maintenance-plan`;
      let response;
      try {
        response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        throw new ToolError(`n8n: the workflow did not answer (${error.message})`);
      }
      if (response.status === 404) throw new ToolError(mode === 'test' ? 'n8n: the test webhook is not listening. Open the workflow in n8n and click Execute workflow first, then ask again.' : 'n8n: webhook /webhook/vm-maintenance-plan not found. Import the workflow 05-vm-maintenance-plan.json and activate it, or use mode "test".');
      if (!response.ok) throw new ToolError(`n8n: the workflow answered with HTTP ${response.status}`);
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); } catch { result = text.slice(0, 4000); }
      const first = Array.isArray(result) ? result[0] : result;
      return {
        workflow: 'Demo 5 (IT infrastructure): VM maintenance plan',
        mode,
        vmsSent: body.vms ? body.vms.length : 'sample VMs of the workflow',
        result: first ?? result,
        note: 'Proposal only. Nothing was run, restarted or changed; the named approver decides about every task.',
        view: { space: 'it-infrastructure', tab: 'overview' },
      };
    },
  };
}
