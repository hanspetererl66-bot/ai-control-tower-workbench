import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { embedFleet, repoFleet } from '../scripts/sync-it-fleet.mjs';
import { repoVms } from '../scripts/sync-it-infrastructure.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('examples/it-fleet/index.html');
const fleet = repoFleet();
const toVm = ([name, env, cpu, mem, disk, backup, patch, cert, reach]) => ({ name, env, cpuPct: cpu, memPct: mem, diskPct: disk, backupAgeHours: backup, patchLagDays: patch, certExpiresInDays: cert, reachable: !!reach });
const { assess } = vm.runInNewContext(`${/<script id="fleet-logic">([\s\S]*?)<\/script>/.exec(page)[1]}; ({ assess })`);
const infra = vm.runInNewContext(`${/<script id="vm-logic">([\s\S]*?)<\/script>/.exec(read('examples/it-infrastructure/index.html'))[1]}; ({ assess })`);

test('the page is in sync with the data and the design system, and the Space is registered', () => {
  assert.equal(embedFleet(page, fleet, read('examples/shared/design-system.css')), page);
  assert.equal(EXAMPLE_SPACES['it-fleet'], 'it-fleet');
  assert.ok(SPACE_PAGES.includes('examples/it-fleet/index.html'));
  const space = JSON.parse(read('examples/it-fleet/space.json'));
  assert.ok(space.title && space.insights.length >= 3);
});

test('rules and task definitions are the ones of the IT Infrastructure Space, and the logic gives the same colour', () => {
  const base = repoVms();
  assert.deepEqual(fleet.rules, base.rules);
  assert.deepEqual(fleet.tasks, base.tasks);
  for (const c of fleet.customers) for (const row of c.vms) {
    const v = toVm(row);
    assert.deepEqual(JSON.parse(JSON.stringify(assess(v, fleet.rules))), JSON.parse(JSON.stringify(infra.assess(v, base.rules))), `${c.id}/${v.name}`);
  }
});

test('customers: unique ids and SAP customer IDs, the two Sub4Me customers match, VM names unique per customer', () => {
  const ids = fleet.customers.map((c) => c.id), saps = fleet.customers.map((c) => c.sapCustomerId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(saps).size, saps.length);
  for (const s of saps) assert.match(s, /^00\d{8}$/);
  const bySap = Object.fromEntries(fleet.customers.map((c) => [c.name, c.sapCustomerId]));
  const sales = JSON.parse(read('examples/sales/pipeline.json')).accounts;
  for (const [name, a] of Object.entries(sales)) assert.equal(bySap[name], a.sapCustomerId, name);
  for (const c of fleet.customers) {
    assert.equal(new Set(c.vms.map((v) => v[0])).size, c.vms.length, `${c.id}: VM names`);
    assert.equal(c.trend.length, 14);
  }
});

test('the fleet is big enough and shows all three colours, with a shared certificate cause across customers', () => {
  assert.ok(fleet.customers.length >= 40);
  assert.ok(fleet.customers.reduce((n, c) => n + c.vms.length, 0) >= 1000);
  const status = (c) => { const s = c.vms.filter((r) => r[1] === 'prod').map((r) => assess(toVm(r), fleet.rules)); return s.some((x) => x.status === 'red') ? 'red' : s.some((x) => x.status === 'yellow') ? 'yellow' : 'green'; };
  const counts = { red: 0, yellow: 0, green: 0 };
  for (const c of fleet.customers) counts[status(c)]++;
  assert.ok(counts.red >= 4 && counts.yellow >= 10 && counts.green >= 15, JSON.stringify(counts));
  const certCustomers = fleet.customers.filter((c) => c.vms.some((r) => assess(toVm(r), fleet.rules).reasons.some((x) => x.key === 'cert'))).length;
  assert.ok(certCustomers >= 6, `certificate affects ${certCustomers} customers`);
});

test('page: three views, filters, drill-down with ticket button, demo with five steps, chat prompts in English, no network', () => {
  for (const id of ['kpis', 'guide', 'view', 'drill', 'prod', 'region', 'q', 'reset']) assert.match(page, new RegExp(`id="${id}"`));
  for (const v of ['map', 'heat', 'inbox']) assert.match(page, new RegExp(`data-view="${v}"`));
  assert.match(page, /create_ticket/);
  assert.equal((page.match(/\{ t: '/g) || []).length, 5);
  assert.match(page, /Please answer in English/);
  assert.doesNotMatch(page, /answer in German/);
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage/);
});
