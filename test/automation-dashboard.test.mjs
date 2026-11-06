import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeMetrics } from '../connectors/_lib/server/automation-metrics.mjs';
import { buildDashboardData, categorize, deriveNodes, embeddedData, fetchN8n, installLive, loadCategories, normalizeStatus, sampleData } from '../scripts/sync-automation-dashboard.mjs';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/automation-dashboard/index.html'), 'utf8');

test('n8n statuses are normalized', () => {
  assert.deepEqual(['success', 'error', 'crashed', 'canceled', 'running', 'waiting', 'new', undefined].map(normalizeStatus), ['success', 'error', 'error', 'canceled', 'running', 'running', 'running', 'running']);
});

test('aggregation counts per day and workflow, ignores executions outside the window and drops payloads', () => {
  const data = buildDashboardData({
    asOf: '2026-10-18',
    source: 'n8n',
    instance: 'acme.app.n8n.cloud',
    windowDays: 3,
    workflows: [{ id: 1, name: 'A', active: true, tags: [{ name: 'Finance' }] }, { id: 2, name: 'B', active: false, tags: [] }],
    executions: [
      { id: 1, workflowId: 1, status: 'success', mode: 'trigger', startedAt: '2026-10-18T10:00:00.000Z', stoppedAt: '2026-10-18T10:00:04.000Z', data: { secret: 'x' } },
      { id: 2, workflowId: 1, status: 'error', mode: 'trigger', startedAt: '2026-10-17T10:00:00.000Z', stoppedAt: '2026-10-17T10:00:02.000Z' },
      { id: 3, workflowId: 1, status: 'running', mode: 'manual', startedAt: '2026-10-16T23:59:59.000Z' },
      { id: 4, workflowId: 1, status: 'success', mode: 'trigger', startedAt: '2026-10-15T23:59:59.000Z', stoppedAt: '2026-10-16T00:00:01.000Z' },
      { id: 5, workflowId: 1, status: 'success', mode: 'trigger', startedAt: '2026-10-19T00:00:00.000Z' },
      { id: 6, workflowId: 99, status: 'success', mode: 'trigger', startedAt: '2026-10-18T09:00:00.000Z', stoppedAt: '2026-10-18T09:00:01.000Z' },
    ],
  });
  assert.deepEqual(data.days.map((d) => [d.date, d.success, d.error, d.other]), [['2026-10-16', 0, 0, 1], ['2026-10-17', 0, 1, 0], ['2026-10-18', 2, 0, 0]]);
  const a = data.workflows.find((w) => w.id === '1');
  assert.deepEqual([a.executions, a.success, a.error, a.lastStatus, a.tags], [3, 1, 1, 'success', ['Finance']]);
  assert.equal(a.avgSeconds, 3);
  assert.equal(data.workflows.find((w) => w.id === '2').lastRun, null);
  assert.equal(data.executions[0].id, '1');
  assert.equal(data.executions.find((e) => e.id === '6').workflowName, 'Workflow 99');
  assert.ok(!JSON.stringify(data).includes('secret'));
});

test('sample data is deterministic and the embedded page data is in sync with the generator', () => {
  assert.deepEqual(sampleData('2026-10-18'), sampleData('2026-10-18'));
  const embedded = embeddedData(page);
  assert.equal(embedded.source, 'sample');
  assert.deepEqual(embedded, sampleData(embedded.asOf));
  assert.ok(embedded.workflows.length >= 8 && embedded.days.length === 14);
  assert.ok(embedded.workflows.every((w) => w.category && w.daily.length === 14 && Array.isArray(w.apps)));
});

function fakeN8n({ status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    if (status !== 200) return { status, ok: false, json: async () => ({}) };
    const u = new URL(url);
    if (u.pathname.endsWith('/workflows')) return { status: 200, ok: true, json: async () => ({ data: [{ id: 'w1', name: 'Flow', active: true, tags: [{ name: 'T' }] }], nextCursor: null }) };
    const cursor = u.searchParams.get('cursor');
    const make = (id, startedAt) => ({ id, workflowId: 'w1', status: 'success', mode: 'trigger', startedAt, stoppedAt: startedAt });
    return {
      status: 200,
      ok: true,
      json: async () => cursor
        ? { data: [make('old', '2026-09-01T00:00:00.000Z')], nextCursor: 'never-followed' }
        : { data: [make('new', '2026-10-18T08:00:00.000Z')], nextCursor: 'c2' },
    };
  };
  return { calls, fetchImpl };
}

test('live fetch pages with the API key header, stops past the window and never asks for payloads', async () => {
  const { calls, fetchImpl } = fakeN8n();
  const data = await fetchN8n({ url: 'acme.app.n8n.cloud', key: 'K-123', asOf: '2026-10-18', fetchImpl });
  assert.equal(data.source, 'n8n');
  assert.equal(data.instance, 'acme.app.n8n.cloud');
  assert.deepEqual(data.workflows.map((w) => [w.id, w.executions]), [['w1', 1]]);
  assert.ok(calls.every((c) => c.headers['X-N8N-API-KEY'] === 'K-123' && !c.url.includes('K-123')));
  assert.ok(calls.filter((c) => c.url.includes('/executions')).every((c) => c.url.includes('includeData=false')));
  assert.equal(calls.filter((c) => c.url.includes('/executions')).length, 2, 'stops after the page that reaches past the window');
});

test('live fetch reports a rejected key and a missing key without echoing it', async () => {
  await assert.rejects(fetchN8n({ url: 'acme.app.n8n.cloud', key: 'SECRET-KEY', asOf: '2026-10-18', fetchImpl: fakeN8n({ status: 401 }).fetchImpl }), (e) => /rejected/.test(e.message) && !e.message.includes('SECRET-KEY'));
  await assert.rejects(fetchN8n({ url: 'acme.app.n8n.cloud', key: '', asOf: '2026-10-18' }), /N8N_API_KEY/);
  await assert.rejects(fetchN8n({ url: 'http://acme.app.n8n.cloud', key: 'k', asOf: '2026-10-18' }), /https/);
});

test('live data goes only into the installed copy, the repository page stays untouched', () => {
  const spacesDir = mkdtempSync(join(tmpdir(), 'aut-'));
  const data = { ...sampleData('2026-10-18'), source: 'n8n', instance: 'acme.app.n8n.cloud' };
  const written = installLive({ data, spacesDir });
  assert.ok(existsSync(join(spacesDir, 'automation-dashboard/space.json')));
  assert.equal(embeddedData(readFileSync(written, 'utf8')).source, 'n8n');
  assert.equal(embeddedData(readFileSync(join(ROOT, 'examples/automation-dashboard/index.html'), 'utf8')).source, 'sample');
});

test('page: tokens only, escapes data, labels sample data', () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(page)[1];
  assert.ok(!/background:\s*#[0-9a-f]{3,8}/i.test(css) && !/background:\s*rgb/i.test(css), 'no literal backgrounds');
  assert.ok(page.includes('id="sample"') && page.includes('Sample data'));
  assert.ok(/esc\(w\.name\)/.test(page) && /esc\(e\.workflowName\)/.test(page));
  assert.ok(!/<script src=|https?:\/\/(?!n8n)/.test(page.replace(/placeholder="https:\/\/firma[^"]*"/g, '').replace(/N8N_URL=https:\/\/your-instance\.app\.n8n\.cloud/g, '').replace('xmlns="http://www.w3.org/2000/svg"', '')), 'no external resources');
});

test('the supplied n8n logo is embedded unchanged on a dark badge', () => {
  assert.ok(page.includes('class="n8n-logo"') && page.includes('fill="#EA4B71"'), 'logo with its original colours');
  assert.ok(page.includes('fill="white"') && /\.badge\{[^}]*background:var\(--logo-bg\)/.test(page), 'white letters need the dark badge');
});

test('categories: first matching rule wins, cat: tag pins, unknown tags fall back', () => {
  const config = loadCategories();
  assert.equal(categorize(['SAP', 'Lead-to-Cash'], config), 'Lead-to-Cash', 'order is the priority, not tag order');
  assert.equal(categorize(['sap'], config), 'Platform & Monitoring');
  assert.equal(categorize(['Procurement', 'cat:Reporting'], config), 'Reporting', 'pin beats rules');
  assert.equal(categorize(['cat: finance & procurement'], config), 'Finance & Procurement', 'pin is case-insensitive and canonicalised');
  assert.equal(categorize(['cat:Something new'], config), 'Something new', 'unknown pin is kept as its own label');
  assert.equal(categorize(['Knowledge'], config), 'Uncategorized');
  assert.equal(categorize([], config), 'Uncategorized');
  assert.ok(config.categories.every((c) => c.name && c.tags.length && c.minutesPerRun > 0));
});

test('trigger and apps are derived from node types', () => {
  const t = (...types) => deriveNodes(types.map((type) => ({ type: `n8n-nodes-base.${type}` })));
  assert.deepEqual(t('webhook', 'salesforce', 'if', 'set', 'httpRequest'), { trigger: 'Webhook', apps: ['Salesforce', 'HTTP'], nodeCount: 5 });
  assert.equal(t('scheduleTrigger', 'slack').trigger, 'Schedule');
  assert.equal(t('manualTrigger').trigger, 'Manual');
  assert.deepEqual(t('gmailTrigger', 'concur'), { trigger: 'App event', apps: ['Gmail', 'Concur'], nodeCount: 2 });
  assert.deepEqual(deriveNodes(undefined), { trigger: 'Unknown', apps: [], nodeCount: 0 });
});

test('time saved uses the category assumption and only counts successful runs', () => {
  const data = buildDashboardData({
    asOf: '2026-10-18', source: 'n8n', instance: 'x', windowDays: 2,
    workflows: [{ id: 1, name: 'A', active: true, tags: [{ name: 'finance' }] }],
    executions: [
      { id: 1, workflowId: 1, status: 'success', startedAt: '2026-10-18T10:00:00.000Z', stoppedAt: '2026-10-18T10:00:01.000Z' },
      { id: 2, workflowId: 1, status: 'success', startedAt: '2026-10-18T11:00:00.000Z', stoppedAt: '2026-10-18T11:00:01.000Z' },
      { id: 3, workflowId: 1, status: 'error', startedAt: '2026-10-18T12:00:00.000Z', stoppedAt: '2026-10-18T12:00:01.000Z' },
    ],
  });
  assert.equal(data.workflows[0].category, 'Finance & Procurement');
  assert.equal(data.workflows[0].minutesSaved, 16);
  assert.equal(data.categories.at(-1).name, 'Uncategorized');
  assert.deepEqual(data.workflows[0].daily.map((d) => [d.success, d.error]), [[0, 0], [2, 1]]);
  assert.equal(data.workflows[0].recent.length, 3);
});

test('page logic is the same code as the metrics module', () => {
  const m = /\/\/ @logic-start\n([\s\S]*?)\n\s*\/\/ @logic-end/.exec(page);
  assert.ok(m, 'logic markers');
  assert.equal(m[1].trim(), makeMetrics.toString().trim());
});

test('page: six KPIs open a detail page with a single click, no storage, no network, people switch is off', () => {
  for (const k of ['active', 'executions', 'rate', 'failed', 'duration', 'saved']) assert.ok(page.includes(`'${k}'`) && new RegExp(`kpiCard\\('${k}'`).test(page), k);
  assert.ok(!/dblclick/.test(page) && !/localStorage|sessionStorage|fetch\(|XMLHttpRequest/.test(page));
  assert.ok(/data-people aria-pressed="' \+ state\.people/.test(page) && /people: false/.test(page));
  assert.ok(page.includes('Estimate.') && page.includes('(estimate)'));
  for (const id of ['pg-errors', 'pg-connections', 'pg-schedules', 'pg-capacity', 'pg-llm', 'pg-builders', 'pg-governance']) assert.ok(page.includes(`id="${id}"`), id);
});

test('metrics: period change, attention, estimates and governance behave', () => {
  const D = sampleData('2026-11-06');
  const M = makeMetrics(D);
  assert.equal(M.kpis(14).hasPrevious, false);
  assert.equal(M.kpis(7).hasPrevious, true);
  const att = M.attention(14, 10);
  assert.ok(att.items.some((i) => i.title === 'Invoice intake and OCR routing' && i.key === 'target'));
  const llm = M.llm(14);
  assert.ok(llm.total > 0 && llm.rows.every((r) => r.providers.length && r.cost >= 0));
  const g = M.governance();
  assert.ok(g.rows.every((r) => r.score === null || (r.score >= 0 && r.score <= 100)));
  const b = M.builders(14);
  assert.equal(b.projects.reduce((s, r) => s + r.count, 0), D.workflows.length);
  assert.deepEqual(b.people.map((r) => r.owner), b.people.map((r) => r.owner).slice().sort());
});

test('owner names stay out unless asked for, hours and buckets add up', () => {
  const input = { asOf: '2026-10-18', source: 'n8n', instance: 'x', windowDays: 3,
    workflows: [{ id: 1, name: 'A', active: true, tags: [{ name: 'owner:Pat' }, { name: 'project:P1' }] }],
    executions: [{ id: 1, workflowId: 1, status: 'success', startedAt: '2026-10-18T10:00:00.000Z', stoppedAt: '2026-10-18T10:00:04.000Z' }] };
  const off = buildDashboardData(input), on = buildDashboardData({ ...input, includeOwners: true });
  assert.equal(off.workflows[0].owner, null); assert.equal(off.workflows[0].hasOwner, true); assert.equal(off.workflows[0].project, 'P1');
  assert.ok(!JSON.stringify(off).includes('Pat'));
  assert.equal(on.workflows[0].owner, 'Pat');
  const w = on.workflows[0];
  assert.equal(w.hours.reduce((a, b) => a + b, 0), 1);
  assert.equal(w.buckets.reduce((a, b) => a + b, 0), 1);
});
