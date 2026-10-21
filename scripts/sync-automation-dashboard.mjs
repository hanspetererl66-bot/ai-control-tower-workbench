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

import { DAY, WINDOW_DAYS, buildDashboardData, categorize, deriveNodes, fetchN8n, loadCategories as loadRules, normalizeInstanceUrl, normalizeStatus } from '../connectors/control-tower/server/n8n.mjs';
export { WINDOW_DAYS, buildDashboardData, categorize, deriveNodes, fetchN8n, normalizeInstanceUrl, normalizeStatus };
export const loadCategories = (dir = DIR) => loadRules(join(dir, 'categories.json'));


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
  { id: 's12', name: 'Infra: Zertifikat läuft ab, Aufgabe anlegen', active: true, tags: ['Infrastruktur', 'cat:Infrastructure Operations'], nodes: ['scheduleTrigger', 'httpRequest', 'if', 'microsoftTeams'], perDay: 2, errorRate: 0.02, seconds: 3.1 },
  { id: 's13', name: 'Infra: Freigabe einholen und Playbook starten', active: true, tags: ['Infrastruktur', 'cat:Infrastructure Operations'], nodes: ['webhook', 'microsoftTeams', 'if', 'httpRequest'], perDay: 3, errorRate: 0.04, seconds: 8.6 },
  { id: 's14', name: 'Infra: Beleg ablegen und Kunde informieren', active: true, tags: ['Infrastruktur', 'cat:Infrastructure Operations'], nodes: ['webhook', 'set', 'notion', 'gmail'], perDay: 3, errorRate: 0.01, seconds: 4.7 },
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
