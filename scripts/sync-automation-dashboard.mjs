/**
 * Embeds n8n automation data into the n8n Performance Dashboard Space (a sandboxed page cannot fetch data).
 * Default: fictional sample data, so the Space works without n8n. The page marks it as "Sample".
 * With --live the workflows and executions are read from the n8n Cloud public API
 * (N8N_URL = instance address, N8N_API_KEY = key from Settings -> n8n API) and written into the INSTALLED copy
 * (workspace/spaces/automation-dashboard); the files in the repository stay untouched.
 * Add --people to embed the owner names from the owner:<name> tags (off by default; the page still hides them behind a switch).
 * Only ids, names, tags, status and timings are read. Execution payloads are never requested or stored.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMetrics } from '../connectors/_lib/server/automation-metrics.mjs';
import { installExampleSpace } from './install-example-space.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'examples/automation-dashboard');
const PAGE = join(DIR, 'index.html');
const BLOCK = /(<script type="application\/json" id="aut-data">)([\s\S]*?)(<\/script>)/;

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

/** The page's number logic is `makeMetrics` from the connector module: the code between the markers is copied from it (the page cannot import). */
const LOGIC = /\/\/ @logic-start\n[\s\S]*?\n\s*\/\/ @logic-end/;
export function embedLogic(html, source = makeMetrics.toString()) {
  if (!LOGIC.test(html)) throw new Error('index.html has no @logic-start / @logic-end markers');
  return html.replace(LOGIC, () => `// @logic-start\n${source}\n  // @logic-end`);
}

import { DAY, DURATION_EDGES, WINDOW_DAYS, buildDashboardData, categorize, deriveLlm, deriveNodes, fetchN8n, loadCategories as loadRules, normalizeInstanceUrl, normalizeStatus, tagValue } from '../connectors/_lib/server/n8n.mjs';
export { DURATION_EDGES, WINDOW_DAYS, buildDashboardData, categorize, deriveLlm, deriveNodes, fetchN8n, normalizeInstanceUrl, normalizeStatus, tagValue };
export const loadCategories = (dir = DIR) => loadRules(join(dir, 'categories.json'));

/** Assumptions (target, rate, plan limit, model prices) from settings.json; they travel with the data so the page can show them. */
export function loadSettings(dir = DIR) {
  const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
  const num = (value, name) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`settings.json: ${name} must be a number of zero or more`);
  };
  num(settings.successTargetPct, 'successTargetPct');
  num(settings.hourlyRateEur, 'hourlyRateEur');
  num(settings.plan?.executionsPerMonth, 'plan.executionsPerMonth');
  num(settings.llm?.tokensPerCall?.input, 'llm.tokensPerCall.input');
  num(settings.llm?.tokensPerCall?.output, 'llm.tokensPerCall.output');
  for (const [provider, price] of Object.entries(settings.llm?.pricePer1MTokensEur ?? {})) {
    num(price?.input, `llm.pricePer1MTokensEur.${provider}.input`);
    num(price?.output, `llm.pricePer1MTokensEur.${provider}.output`);
  }
  if (!settings.llm?.pricePer1MTokensEur?.Other) throw new Error('settings.json: llm.pricePer1MTokensEur needs an "Other" entry (used for unknown providers)');
  const { note: _note, ...rest } = settings;
  return { ...rest, llm: Object.fromEntries(Object.entries(settings.llm).filter(([key]) => key !== 'note')) };
}
export const withSettings = (data, dir = DIR) => ({ ...data, settings: loadSettings(dir) });


/* ---------------- fictional sample data ---------------- */

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const node = (type) => ({ type: /^lm[A-Z]/.test(type) ? `@n8n/n8n-nodes-langchain.${type}` : `n8n-nodes-base.${type}` });
// owner / project / reviewed become the n8n tags "owner:<name>", "project:<name>", "reviewed:<date>" (names are fictional).
// at = the UTC hour a scheduled workflow starts; createdDaysAgo / updatedDaysAgo give the workflow dates; errorWorkflow undefined = the API did not say.
const SAMPLE_WORKFLOWS = [
  { id: 's1', name: 'Lead-to-Cash: Quote to Order sync', active: true, tags: ['Lead-to-Cash', 'SAP'], owner: 'Anja Keller', project: 'Quote-to-Cash', reviewed: '2026-09-12', createdDaysAgo: 220, updatedDaysAgo: 12, errorWorkflow: true, nodes: ['webhook', 'sap', 'salesforce', 'if', 'set', 'slack'], perDay: 22, errorRate: 0.04, seconds: 6.2 },
  { id: 's2', name: 'Invoice intake and OCR routing', active: true, tags: ['Finance', 'Concur'], owner: 'Ben Okafor', project: 'Finance Close', reviewed: '2026-05-04', createdDaysAgo: 140, updatedDaysAgo: 9, errorWorkflow: true, nodes: ['gmailTrigger', 'httpRequest', 'code', 'lmChatAnthropic', 'concur', 'set', 'if'], perDay: 31, errorRate: 0.09, seconds: 11.8 },
  { id: 's3', name: 'New hire onboarding checklist', active: true, tags: ['HR', 'SuccessFactors'], owner: 'Carla Moreno', project: 'People Ops', reviewed: '2026-08-20', createdDaysAgo: 95, updatedDaysAgo: 40, errorWorkflow: true, nodes: ['webhook', 'successFactors', 'microsoftTeams', 'set'], perDay: 4, errorRate: 0.02, seconds: 3.4 },
  { id: 's4', name: 'Ticket triage to Sub4Me', active: true, tags: ['Service'], owner: 'Dmitri Volkov', project: 'Service Desk', createdDaysAgo: 60, updatedDaysAgo: 3, errorWorkflow: false, nodes: ['webhook', 'httpRequest', 'openAi', 'switch', 'slack'], perDay: 17, errorRate: 0.06, seconds: 2.1 },
  { id: 's5', name: 'Daily AI consumption report', active: true, tags: ['Reporting'], owner: 'Anja Keller', project: 'Platform & AI Ops', reviewed: '2026-10-02', createdDaysAgo: 300, updatedDaysAgo: 20, errorWorkflow: true, at: 6, nodes: ['scheduleTrigger', 'httpRequest', 'code', 'gmail'], perDay: 1, errorRate: 0, seconds: 24.5 },
  { id: 's6', name: 'Contract renewal reminder', active: true, tags: ['Sales'], owner: 'Eva Lindqvist', project: 'Renewals', createdDaysAgo: 180, updatedDaysAgo: 25, errorWorkflow: false, at: 7, nodes: ['scheduleTrigger', 'salesforce', 'if', 'gmail'], perDay: 3, errorRate: 0.12, seconds: 1.7 },
  { id: 's7', name: 'BTP service health check', active: true, tags: ['SAP', 'Engineering'], owner: 'Dmitri Volkov', project: 'Platform & AI Ops', reviewed: '2026-07-15', createdDaysAgo: 400, updatedDaysAgo: 70, errorWorkflow: true, at: 0, nodes: ['scheduleTrigger', 'httpRequest', 'if', 'slack'], perDay: 48, errorRate: 0.01, seconds: 0.9 },
  { id: 's8', name: 'CRM contact enrichment (paused)', active: false, tags: ['Sales'], createdDaysAgo: 500, updatedDaysAgo: 200, errorWorkflow: false, nodes: ['manualTrigger', 'salesforce', 'httpRequest'], perDay: 0, errorRate: 0, seconds: 0 },
  { id: 's9', name: 'Marketing campaign digest', active: true, tags: ['Marketing'], owner: 'Eva Lindqvist', project: 'Marketing Ops', createdDaysAgo: 45, updatedDaysAgo: 2, at: 7.5, nodes: ['scheduleTrigger', 'googleAnalytics', 'code', 'lmChatGoogleGemini', 'gmail'], perDay: 1, errorRate: 0.2, seconds: 8.3 },
  { id: 's10', name: 'Vendor onboarding checks', active: true, tags: ['Procurement', 'cat:Finance & Procurement'], project: 'Finance Close', createdDaysAgo: 30, updatedDaysAgo: 30, errorWorkflow: false, nodes: ['webhook', 'httpRequest', 'if', 'microsoftTeams'], perDay: 2, errorRate: 0.05, seconds: 5.1 },
  { id: 's11', name: 'Research notes archiver', active: true, tags: ['Knowledge'], createdDaysAgo: 120, updatedDaysAgo: 100, errorWorkflow: false, at: 22, nodes: ['scheduleTrigger', 'notion', 'lmChatOpenAi', 'googleDrive'], perDay: 1, errorRate: 0.03, seconds: 4.4 },
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
        const dayFactor = d === WINDOW_DAYS - 1 ? 0.7 : 1; // the last day is not over yet
        const r = random();
        // Scheduled workflows start at fixed times, event-driven ones during office hours (UTC), so the "when it runs" views have a shape.
        const position = workflow.at !== undefined ? (workflow.at / 24 + i / Math.max(count, 1)) % 1 : (8 + r * 10) / 24;
        const startedAt = end - (WINDOW_DAYS - d) * DAY + Math.floor(position * DAY * dayFactor);
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
  const ago = (days) => new Date(end - DAY - days * DAY).toISOString();
  return withSettings(buildDashboardData({
    workflows: SAMPLE_WORKFLOWS.map((w) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      tags: [...w.tags, w.owner && `owner:${w.owner}`, w.project && `project:${w.project}`, w.reviewed && `reviewed:${w.reviewed}`].filter(Boolean).map((tag) => ({ name: tag })),
      nodes: w.nodes.map(node),
      createdAt: ago(w.createdDaysAgo),
      updatedAt: ago(w.updatedDaysAgo),
      ...(w.errorWorkflow === undefined ? {} : { settings: w.errorWorkflow ? { errorWorkflow: 'err-handler' } : {} }),
    })),
    executions,
    asOf,
    source: 'sample',
    instance: 'sample',
    includeOwners: true,
  }));
}

export function installLive({ data, root = ROOT, spacesDir = join(root, 'workspace/spaces') }) {
  const dest = installExampleSpace('automation-dashboard', { root, spacesDir });
  const page = join(dest, 'index.html');
  writeFileSync(page, embedLogic(embedData(readFileSync(page, 'utf8'), data)));
  return page;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = readFileSync(PAGE, 'utf8');
  const check = process.argv.includes('--check');
  if (process.argv.includes('--live')) {
    if (!process.env.N8N_URL) throw new Error('Set N8N_URL (for example https://firma.app.n8n.cloud) first.');
    // Person names from the "owner:" tags are only embedded with --people (otherwise the page shows projects and counts only).
    const people = process.argv.includes('--people');
    const data = withSettings(await fetchN8n({ url: process.env.N8N_URL, key: process.env.N8N_API_KEY, asOf: new Date().toISOString().slice(0, 10), includeOwners: people }));
    const total = data.workflows.reduce((sum, workflow) => sum + workflow.executions, 0);
    console.log(`Wrote ${data.workflows.length} workflows and ${total} executions (last ${data.windowDays} days${people ? ', with owner names' : ', without owner names'}) to ${installLive({ data })}`);
  } else {
    const asOf = check ? embeddedData(html).asOf : new Date().toISOString().slice(0, 10);
    const next = embedLogic(embedData(html, sampleData(asOf)));
    if (check) {
      if (next !== html) {
        console.error('n8n Performance Dashboard data or logic is out of sync — run: npm run sync:automation');
        process.exit(1);
      }
      console.log('n8n Performance Dashboard data and logic are in sync.');
    } else {
      writeFileSync(PAGE, next);
      console.log('Embedded the sample data and the number logic.');
    }
  }
}
