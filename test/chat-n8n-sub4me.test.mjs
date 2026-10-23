import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createN8nHandlers } from '../connectors/control-tower/server/n8n.mjs';
import { createSub4MeHandlers } from '../connectors/control-tower/server/sub4me.mjs';
import { buildControlTowerBundle } from '../scripts/build-control-tower-mcpb.mjs';

const ROOT = join(import.meta.dirname, '..');

/* ---------------- Sub4Me 360 degree tools ---------------- */

test('customer overview combines master data, contracts, offers, AI units and tickets', async () => {
  const h = createSub4MeHandlers();
  const o = await h.get_customer_overview();
  assert.equal(o.customer.name, 'Muster Industrie AG');
  assert.equal(o.contracts.total, 6);
  assert.equal(o.contracts.byStatus.Expired, 1);
  assert.equal(o.offers.open.length, 3);
  assert.equal(o.offers.openValueEur, 861000);
  assert.ok(o.aiUnits.allotment > 0 && o.aiUnits.productsForecastOverAllotment.length > 0);
  assert.equal(o.tickets.total, 5);
  assert.match(o.dataSource, /Supabase not connected/);
  assert.ok(o.highlights.some((line) => /expired/.test(line)));
  assert.ok(o.highlights.some((line) => /notice deadline/.test(line)));
});

test('tickets come from Supabase when connected and fall back to the sample when the call fails', async () => {
  const live = createSub4MeHandlers(undefined, async () => [{ id: 'TKT-1', title: 'Live', product: 'Ariba AI', priority: 'High', status: 'New' }]);
  const o = await live.get_customer_overview();
  assert.deepEqual([o.tickets.total, o.tickets.latest[0].id, /supabase/.test(o.dataSource)], [1, 'TKT-1', true]);
  const broken = createSub4MeHandlers(undefined, async () => { throw new Error('down'); });
  assert.equal((await broken.get_customer_overview()).tickets.total, 5);
});

test('product, contract, offer and search views', async () => {
  const h = createSub4MeHandlers();
  const p = await h.get_product_overview({ product: 'ariba' });
  assert.equal(p.product, 'Ariba AI');
  assert.ok(p.consumption.allotment > 0);
  assert.ok(p.contracts.every((c) => /ariba/i.test(c.product)) && p.offers.every((o) => /ariba/i.test(o.product)));
  await assert.rejects(h.get_product_overview({ product: 'nope' }), /Unknown product/);
  await assert.rejects(h.get_product_overview({}), /product is required/);

  const c = await h.get_contract({ id: 'c-2025-0041' });
  assert.equal(c.contract.id, 'C-2025-0041');
  assert.equal(c.contract.noticeDeadline, '2026-10-02');
  assert.ok(Array.isArray(c.renewalOffers) && c.renewalOffers.every((o) => o.contractId === 'C-2025-0041'));
  await assert.rejects(h.get_contract({ id: 'X' }), /Known ids/);

  const offer = await h.get_offer({ id: 'OFF-2026-0311' });
  assert.equal(offer.renewsContract.id, offer.offer.contractId);
  assert.equal(offer.offer.daysUntilExpiry, 28);
  await assert.rejects(async () => h.get_offer({ id: '' }), /id is required/);

  const found = await h.search_sub4me({ query: 'joule' });
  assert.ok(found.products.includes('Joule copilots') && found.tickets.length > 0 && found.offers.length > 0);
  await assert.rejects(h.search_sub4me({ query: 'x' }), /at least 2/);
});

/* ---------------- n8n tools ---------------- */

function fakeFetch() {
  const calls = [];
  const now = Date.parse('2026-10-18T12:00:00Z');
  const exec = (id, workflowId, status, hoursAgo, seconds = 4) => {
    const started = now - hoursAgo * 3600e3;
    return { id, workflowId, status, mode: 'trigger', startedAt: new Date(started).toISOString(), stoppedAt: new Date(started + seconds * 1000).toISOString() };
  };
  const workflows = [
    { id: 'w1', name: 'Invoice intake', active: true, tags: [{ name: 'Finance' }], nodes: [{ type: 'n8n-nodes-base.webhook' }, { type: 'n8n-nodes-base.slack' }] },
    { id: 'w2', name: 'Lead sync', active: true, tags: [{ name: 'Lead-to-Cash' }], nodes: [{ type: 'n8n-nodes-base.scheduleTrigger' }] },
    { id: 'w3', name: 'Lead export (old)', active: false, tags: [], nodes: [] },
  ];
  const executions = [exec(1, 'w1', 'success', 1), exec(2, 'w1', 'error', 2), exec(3, 'w1', 'success', 30), exec(4, 'w2', 'success', 3), exec(5, 'w2', 'error', 5)];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), key: init.headers['X-N8N-API-KEY'] });
    const path = new URL(url).pathname;
    return { status: 200, ok: true, json: async () => ({ data: path.endsWith('/workflows') ? workflows : executions, nextCursor: null }) };
  };
  return { fetchImpl, calls };
}

const env = { N8N_URL: 'https://acme.app.n8n.cloud', N8N_API_KEY: 'k-1' };
const make = (extra = {}) => {
  const f = fakeFetch();
  return { ...f, h: createN8nHandlers({ env, fetchImpl: f.fetchImpl, now: () => new Date('2026-10-18T12:00:00Z'), ...extra }) };
};

test('n8n tools explain what is missing when the connection is not configured', async () => {
  const h = createN8nHandlers({ env: {}, fetchImpl: async () => { throw new Error('must not be called'); } });
  for (const name of ['get_n8n_overview', 'list_n8n_workflows', 'list_n8n_categories']) await assert.rejects(h[name]({}), /not connected.*N8N_URL/);
});

test('overview: totals, categories, needs attention and uncategorized', async () => {
  const { h, calls } = make();
  const o = await h.get_n8n_overview();
  assert.deepEqual([o.workflows.total, o.workflows.active, o.executions.total, o.executions.success, o.executions.error, o.executions.successRatePct], [3, 2, 5, 3, 2, 60]);
  assert.deepEqual(o.byCategory.map((c) => c.category).sort(), ['Finance & Procurement', 'Lead-to-Cash', 'Uncategorized']);
  assert.equal(o.needsAttention[0].name, 'Lead sync', '1 of 2 failed beats 1 of 3');
  assert.deepEqual(o.notCategorized.map((w) => w.id), ['w3']);
  assert.ok(calls.every((c) => c.key === 'k-1' && !c.url.includes('k-1')));
  assert.ok(calls.filter((c) => c.url.includes('/executions')).every((c) => c.url.includes('includeData=false')));
  assert.equal(o.dataSource, 'n8n Cloud (acme.app.n8n.cloud), last 14 days');
});

test('results are cached briefly so follow-up questions cost no new API calls', async () => {
  const { h, calls } = make();
  await h.get_n8n_overview();
  const first = calls.length;
  await h.list_n8n_workflows({});
  await h.list_n8n_executions({});
  assert.equal(calls.length, first);
});

test('workflow list filters and validates', async () => {
  const { h } = make();
  assert.deepEqual((await h.list_n8n_workflows({ search: 'lead' })).workflows.map((w) => w.id).sort(), ['w2', 'w3']);
  assert.deepEqual((await h.list_n8n_workflows({ active: false })).workflows.map((w) => w.id), ['w3']);
  assert.deepEqual((await h.list_n8n_workflows({ failing: true })).workflows.map((w) => w.id).sort(), ['w1', 'w2']);
  assert.deepEqual((await h.list_n8n_workflows({ category: 'finance & procurement' })).workflows.map((w) => w.id), ['w1']);
  assert.equal((await h.list_n8n_workflows({ limit: 1 })).returned, 1);
  await assert.rejects(h.list_n8n_workflows({ category: 'Nope' }), /Known:/);
  await assert.rejects(h.list_n8n_workflows({ limit: 0 }), /limit/);
  await assert.rejects(h.list_n8n_workflows({ active: 'yes' }), /true or false/);
});

test('workflow detail by id or partial name, ambiguity is reported', async () => {
  const { h } = make();
  const w = await h.get_n8n_workflow({ workflow: 'invoice' });
  assert.deepEqual([w.workflow.id, w.workflow.trigger, w.workflow.apps, w.workflow.executions], ['w1', 'Webhook', ['Slack'], 3]);
  assert.equal(w.perDay.length, 14);
  assert.ok(w.latestExecutions.length >= 2);
  assert.equal((await h.get_n8n_workflow({ workflow: 'w2' })).workflow.name, 'Lead sync');
  await assert.rejects(h.get_n8n_workflow({ workflow: 'lead' }), /matches 2 workflows/);
  await assert.rejects(h.get_n8n_workflow({ workflow: 'zzz' }), /No workflow matches/);
  await assert.rejects(h.get_n8n_workflow({}), /required/);
});

test('executions: filters by status, workflow and category; contents are never part of the answer', async () => {
  const { h } = make();
  assert.deepEqual((await h.list_n8n_executions({ status: 'error' })).executions.map((e) => e.id), ['2', '5']);
  assert.deepEqual((await h.list_n8n_executions({ workflow: 'lead sync' })).executions.map((e) => e.id), ['4', '5']);
  assert.deepEqual((await h.list_n8n_executions({ category: 'Finance & Procurement' })).executions.map((e) => e.id), ['1', '2', '3']);
  const all = await h.list_n8n_executions({ limit: 2 });
  assert.equal(all.returned, 2);
  assert.ok(all.executions.every((e) => e.category && !('data' in e)));
  await assert.rejects(h.list_n8n_executions({ status: 'weird' }), /status must be/);
});

test('categories list rules and members', async () => {
  const { h } = make();
  const c = await h.list_n8n_categories();
  assert.deepEqual(c.categories.find((x) => x.name === 'Finance & Procurement').workflows.map((w) => w.id), ['w1']);
  assert.deepEqual(c.categories.find((x) => x.name === 'Uncategorized').workflows.map((w) => w.id), ['w3']);
  assert.ok(c.categories[0].matchingTags.length > 0);
});

test('a rejected key surfaces as a readable tool error without the key', async () => {
  const h = createN8nHandlers({ env: { ...env, N8N_API_KEY: 'SECRET' }, fetchImpl: async () => ({ status: 401, ok: false, json: async () => ({}) }) });
  await assert.rejects(h.get_n8n_overview(), (e) => /rejected/.test(e.message) && !e.message.includes('SECRET'));
});

test('the bundle carries the sample data and category rules the tools need', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'bundle-')), 'x.mcpb');
  buildControlTowerBundle(out);
  const list = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' });
  for (const file of ['data/sub4me.json', 'data/n8n-categories.json', 'server/n8n.mjs']) assert.ok(list.includes(file), file);
  const manifest = JSON.parse(execFileSync('unzip', ['-p', out, 'manifest.json'], { encoding: 'utf8' }));
  assert.equal(manifest.user_config.n8n_api_key.sensitive, true);
  assert.equal(manifest.server.mcp_config.env.N8N_API_KEY, '${user_config.n8n_api_key}');
});

test('the app prepares the same data files when it stages the connector itself', () => {
  const main = readFileSync(join(ROOT, 'electron/main.mjs'), 'utf8');
  assert.ok(main.includes("'data/sub4me.json'") && main.includes("'data/n8n-categories.json'"));
});

test('contracts and offers carry the extended attributes and come live from Supabase when connected', async () => {
  const embedded = createSub4MeHandlers();
  const c = await embedded.get_contract({ id: 'C-2024-0187' });
  assert.equal(c.contract.sla.tier, 'Premium Plus');
  assert.equal(c.contract.paymentTerms, '30 days net');
  assert.ok(c.contract.lines.length >= 3);
  const list = await embedded.list_contracts({});
  assert.ok(list.contracts.every((x) => !('lines' in x) && x.lineCount > 0), 'lists stay compact');
  const o = await embedded.get_offer({ id: 'OFF-2026-0324' });
  assert.equal(o.offer.stage, 'Negotiation');
  assert.ok(o.offer.lines.length === 3 && o.offer.owner.name);

  const calls = [];
  const live = createSub4MeHandlers(undefined, async (fn) => {
    calls.push(fn);
    if (fn === 'sub4me_portfolio') return { contracts: [{ id: 'C-LIVE-1', product: 'Live Product', status: 'Active', start: '2026-01-01', end: '2027-01-01', annualEur: 1000, noticeDays: 30, lines: [] }], offers: [] };
    return [];
  });
  const lc = await live.list_contracts({});
  assert.equal(lc.contracts[0].id, 'C-LIVE-1');
  assert.match(lc.dataSource, /supabase/);
  assert.ok(calls.includes('sub4me_portfolio'));

  const broken = createSub4MeHandlers(undefined, async () => { throw new Error('function does not exist'); });
  const fallback = await broken.list_contracts({});
  assert.equal(fallback.totalContracts, 6);
  assert.match(fallback.dataSource, /sample data/);
});

test('run_it_ops_triage: calls only the fixed webhook path, validates alerts and explains missing setup', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify([{ counts: { p1: 2 }, digest: 'ok' }]), { status: 200 }); };
  const h = createN8nHandlers({ env: { N8N_URL: 'https://firma.app.n8n.cloud' }, fetchImpl });
  const r = await h.run_it_ops_triage({});
  assert.equal(calls[0].url, 'https://firma.app.n8n.cloud/webhook/it-ops-triage');
  assert.deepEqual(calls[0].body, {}, 'no alerts: the workflow uses its sample alerts');
  assert.equal(r.result.digest, 'ok');
  assert.match(r.note, /Nothing was paged/);
  await h.run_it_ops_triage({ mode: 'test', alerts: [{ id: 'X', service: 'S', severity: 'high', text: 'Disk full', customerFacing: true }] });
  assert.equal(calls[1].url, 'https://firma.app.n8n.cloud/webhook-test/it-ops-triage');
  assert.deepEqual(calls[1].body.alerts[0], { id: 'X', service: 'S', severity: 'high', impact: 'low', customerFacing: true, repeat24h: 0, text: 'Disk full' });
  for (const bad of [{ alerts: [] }, { alerts: [{ id: 'X', service: 'S', severity: 'urgent', text: 't' }] }, { alerts: [{ id: 'X', service: 'S', severity: 'low' }] }, { mode: 'live' }]) {
    await assert.rejects(() => h.run_it_ops_triage(bad), /alert|mode|severity/);
  }
  await assert.rejects(() => createN8nHandlers({ env: {}, fetchImpl }).run_it_ops_triage({}), /not connected/);
  const notFound = createN8nHandlers({ env: { N8N_URL: 'https://firma.app.n8n.cloud' }, fetchImpl: async () => new Response('', { status: 404 }) });
  await assert.rejects(() => notFound.run_it_ops_triage({}), /Import the workflow/);
  await assert.rejects(() => notFound.run_it_ops_triage({ mode: 'test' }), /Execute workflow/);
  assert.equal(calls.length, 2);
});

test('run_vm_maintenance_plan: calls only the fixed webhook path, validates VMs and explains missing setup', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify([{ counts: { tasks: 11 }, digest: 'ok' }]), { status: 200 }); };
  const h = createN8nHandlers({ env: { N8N_URL: 'https://firma.app.n8n.cloud' }, fetchImpl });
  const r = await h.run_vm_maintenance_plan({});
  assert.equal(calls[0].url, 'https://firma.app.n8n.cloud/webhook/vm-maintenance-plan');
  assert.deepEqual(calls[0].body, {}, 'no vms: the workflow uses its sample VMs');
  assert.equal(r.result.digest, 'ok');
  assert.match(r.note, /Nothing was run/);
  await h.run_vm_maintenance_plan({ mode: 'test', vms: [{ id: 'x', name: 'web-01', cpuPct: 140, diskPct: 91, certExpiresInDays: 12, backupAgeHours: null, junk: 1 }] });
  assert.equal(calls[1].url, 'https://firma.app.n8n.cloud/webhook-test/vm-maintenance-plan');
  assert.deepEqual(calls[1].body.vms[0], { id: 'x', name: 'web-01', role: '', env: 'prod', reachable: true, cpuPct: 100, diskPct: 91, certExpiresInDays: 12, backupAgeHours: null });
  for (const bad of [{ vms: [] }, { vms: [{ id: 'x' }] }, { vms: [{ id: 'x', name: 'n', env: 'qa' }] }, { mode: 'live' }]) await assert.rejects(() => h.run_vm_maintenance_plan(bad), /vm|mode/);
  await assert.rejects(() => createN8nHandlers({ env: {}, fetchImpl }).run_vm_maintenance_plan({}), /not connected/);
  const notFound = createN8nHandlers({ env: { N8N_URL: 'https://firma.app.n8n.cloud' }, fetchImpl: async () => new Response('', { status: 404 }) });
  await assert.rejects(() => notFound.run_vm_maintenance_plan({}), /Import the workflow/);
  await assert.rejects(() => notFound.run_vm_maintenance_plan({ mode: 'test' }), /Execute workflow/);
  assert.equal(calls.length, 2);
});
