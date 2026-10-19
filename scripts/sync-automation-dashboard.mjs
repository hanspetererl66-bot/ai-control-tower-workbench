/**
 * Embeds n8n automation data into the Automation Dashboard Space (a sandboxed page cannot fetch data).
 * Default: fictional sample data, so the Space works without n8n. The page marks it as "Sample".
 * With --live the workflows and executions are read from the n8n Cloud public API
 * (N8N_URL = instance address, N8N_API_KEY = key from Settings -> n8n API) and written into the INSTALLED copy
 * (workspace/spaces/automation-dashboard); the files in the repository stay untouched.
 * Only ids, names, tags, status and timings are read. Execution payloads are never requested or stored.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeInstanceUrl } from '../electron/n8n.mjs';
import { installExampleSpace } from './install-example-space.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'examples/automation-dashboard');
const PAGE = join(DIR, 'index.html');
const BLOCK = /(<script type="application\/json" id="aut-data">)([\s\S]*?)(<\/script>)/;
const DAY = 864e5;
export const WINDOW_DAYS = 14;
const RECENT = 60;
const MAX_PAGES = 20;

export const serialise = (data) => JSON.stringify(data, null, 2).replaceAll('<', '\\u003c');

export function embeddedData(html) {
  const match = BLOCK.exec(html);
  if (!match) throw new Error('index.html has no <script id="aut-data"> block');
  return JSON.parse(match[2]);
}

export function embedData(html, data) {
  if (!BLOCK.test(html)) throw new Error('index.html has no <script id="aut-data"> block');
  return html.replace(BLOCK, (_m, open, _body, close) => `${open}\n${serialise(data)}\n${close}`);
}

export const loadCategories = (dir = DIR) => JSON.parse(readFileSync(join(dir, 'categories.json'), 'utf8'));

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

/* ---------------- fictional sample data ---------------- */

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const node = (type) => ({ type: `n8n-nodes-base.${type}` });
const SAMPLE_WORKFLOWS = [
  { id: 's1', name: 'Lead-to-Cash: Quote to Order sync', active: true, tags: ['Lead-to-Cash', 'SAP'], nodes: ['webhook', 'sap', 'salesforce', 'if', 'set', 'slack'], perDay: 22, errorRate: 0.04, seconds: 6.2 },
  { id: 's2', name: 'Invoice intake and OCR routing', active: true, tags: ['Finance', 'Concur'], nodes: ['gmailTrigger', 'httpRequest', 'code', 'concur', 'set', 'if'], perDay: 31, errorRate: 0.09, seconds: 11.8 },
  { id: 's3', name: 'New hire onboarding checklist', active: true, tags: ['HR', 'SuccessFactors'], nodes: ['webhook', 'successFactors', 'microsoftTeams', 'set'], perDay: 4, errorRate: 0.02, seconds: 3.4 },
  { id: 's4', name: 'Ticket triage to Sub4Me', active: true, tags: ['Service'], nodes: ['webhook', 'httpRequest', 'openAi', 'switch', 'slack'], perDay: 17, errorRate: 0.06, seconds: 2.1 },
  { id: 's5', name: 'Daily AI consumption report', active: true, tags: ['Reporting'], nodes: ['scheduleTrigger', 'httpRequest', 'code', 'gmail'], perDay: 1, errorRate: 0, seconds: 24.5 },
  { id: 's6', name: 'Contract renewal reminder', active: true, tags: ['Sales'], nodes: ['scheduleTrigger', 'salesforce', 'if', 'gmail'], perDay: 3, errorRate: 0.12, seconds: 1.7 },
  { id: 's7', name: 'BTP service health check', active: true, tags: ['SAP', 'Engineering'], nodes: ['scheduleTrigger', 'httpRequest', 'if', 'slack'], perDay: 48, errorRate: 0.01, seconds: 0.9 },
  { id: 's8', name: 'CRM contact enrichment (paused)', active: false, tags: ['Sales'], nodes: ['manualTrigger', 'salesforce', 'httpRequest'], perDay: 0, errorRate: 0, seconds: 0 },
  { id: 's9', name: 'Marketing campaign digest', active: true, tags: ['Marketing'], nodes: ['scheduleTrigger', 'googleAnalytics', 'code', 'gmail'], perDay: 1, errorRate: 0.2, seconds: 8.3 },
  { id: 's10', name: 'Vendor onboarding checks', active: true, tags: ['Procurement', 'cat:Finance & Procurement'], nodes: ['webhook', 'httpRequest', 'if', 'microsoftTeams'], perDay: 2, errorRate: 0.05, seconds: 5.1 },
  { id: 's11', name: 'Research notes archiver', active: true, tags: ['Knowledge'], nodes: ['scheduleTrigger', 'notion', 'googleDrive'], perDay: 1, errorRate: 0.03, seconds: 4.4 },
];

export function sampleData(asOf) {
  const random = seeded(Date.parse(`${asOf}T00:00:00Z`) / DAY);
  const end = Date.parse(`${asOf}T00:00:00Z`) + DAY;
  const executions = [];
  let id = 41000;
  for (let d = 0; d < WINDOW_DAYS; d++) {
    for (const workflow of SAMPLE_WORKFLOWS) {
      const weekend = [0, 6].includes(new Date(end - (WINDOW_DAYS - d) * DAY).getUTCDay());
      const count = Math.round(workflow.perDay * (weekend ? 0.3 : 1) * (0.8 + random() * 0.4));
      for (let i = 0; i < count; i++) {
        const startedAt = end - (WINDOW_DAYS - d) * DAY + Math.floor(random() * DAY * (d === WINDOW_DAYS - 1 ? 0.7 : 1));
        const failed = random() < workflow.errorRate;
        const duration = workflow.seconds * (0.6 + random() * 0.8) * 1000;
        executions.push({
          id: ++id,
          workflowId: workflow.id,
          status: failed ? 'error' : 'success',
          mode: workflow.id === 's5' ? 'trigger' : random() < 0.1 ? 'manual' : 'trigger',
          startedAt: new Date(startedAt).toISOString(),
          stoppedAt: new Date(startedAt + duration).toISOString(),
        });
      }
    }
  }
  return buildDashboardData({
    workflows: SAMPLE_WORKFLOWS.map(({ id: wid, name, active, tags, nodes }) => ({ id: wid, name, active, tags: tags.map((tag) => ({ name: tag })), nodes: nodes.map(node) })),
    executions,
    asOf,
    source: 'sample',
    instance: 'sample',
  });
}

export function installLive({ data, root = ROOT, spacesDir = join(root, 'workspace/spaces') }) {
  const dest = installExampleSpace('automation-dashboard', { root, spacesDir });
  const page = join(dest, 'index.html');
  writeFileSync(page, embedData(readFileSync(page, 'utf8'), data));
  return page;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = readFileSync(PAGE, 'utf8');
  const check = process.argv.includes('--check');
  if (process.argv.includes('--live')) {
    if (!process.env.N8N_URL) throw new Error('Set N8N_URL (for example https://firma.app.n8n.cloud) first.');
    const data = await fetchN8n({ url: process.env.N8N_URL, key: process.env.N8N_API_KEY, asOf: new Date().toISOString().slice(0, 10) });
    const total = data.workflows.reduce((sum, workflow) => sum + workflow.executions, 0);
    console.log(`Wrote ${data.workflows.length} workflows and ${total} executions (last ${data.windowDays} days) to ${installLive({ data })}`);
  } else {
    const asOf = check ? embeddedData(html).asOf : new Date().toISOString().slice(0, 10);
    const next = embedData(html, sampleData(asOf));
    if (check) {
      if (next !== html) {
        console.error('Automation Dashboard data is out of sync — run: npm run sync:automation');
        process.exit(1);
      }
      console.log('Automation Dashboard data is in sync.');
    } else {
      writeFileSync(PAGE, next);
      console.log('Embedded the sample data.');
    }
  }
}
