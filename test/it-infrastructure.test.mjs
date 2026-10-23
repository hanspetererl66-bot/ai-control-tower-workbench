import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { embedVms, repoVms } from '../scripts/sync-it-infrastructure.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('examples/it-infrastructure/index.html');
const assess = vm.runInNewContext(`${/<script id="vm-logic">([\s\S]*?)<\/script>/.exec(page)[1]}; assess`);

test('page embeds the current VMs and design system, is installable, and has no network access', () => {
  assert.equal(embedVms(page, repoVms(), read('examples/shared/design-system.css')), page, 'run npm run sync:it-infrastructure');
  assert.equal(EXAMPLE_SPACES['it-infrastructure'], 'it-infrastructure');
  assert.ok(SPACE_PAGES.includes('examples/it-infrastructure/index.html'));
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage/);
  const meta = JSON.parse(read('examples/it-infrastructure/space.json'));
  assert.equal(meta.title, 'IT Infrastructure');
});

test('25 VMs with unique names, each colour is explained by its reasons', () => {
  const data = repoVms();
  assert.equal(data.vms.length, 25);
  assert.equal(new Set(data.vms.map((v) => v.name)).size, 25);
  const count = { green: 0, yellow: 0, red: 0 };
  for (const v of data.vms) {
    const a = assess(v, data.rules);
    count[a.status]++;
    if (a.status === 'green') assert.equal(a.reasons.length, 0, `${v.name}: green has no reasons`);
    else assert.ok(a.reasons.length > 0 && a.reasons[0].level === a.status, `${v.name}: ${a.status} is explained by its worst reason first`);
  }
  assert.deepEqual(count, { green: 15, yellow: 6, red: 4 });
});

test('rules: unreachable is red, test VMs need no backup, limits are inclusive', () => {
  const { rules } = repoVms();
  const base = { env: 'prod', reachable: true, cpuPct: 10, memPct: 10, diskPct: 10, backupAgeHours: 1, patchLagDays: 0, certExpiresInDays: 200 };
  assert.equal(assess({ ...base, reachable: false }, rules).status, 'red');
  assert.equal(assess({ ...base, env: 'test', backupAgeHours: 200 }, rules).status, 'green');
  assert.equal(assess({ ...base, backupAgeHours: 200 }, rules).status, 'red');
  assert.equal(assess({ ...base, cpuPct: 75 }, rules).status, 'yellow');
  assert.equal(assess({ ...base, cpuPct: 90 }, rules).status, 'red');
  assert.equal(assess({ ...base, diskPct: 94 }, rules).status, 'yellow');
  assert.equal(assess({ ...base, certExpiresInDays: 30 }, rules).status, 'yellow');
  assert.equal(assess({ ...base, certExpiresInDays: 31 }, rules).status, 'green');
  assert.equal(assess({ ...base, certExpiresInDays: 7 }, rules).status, 'red');
});

const wf = JSON.parse(read('examples/n8n-workflows/05-vm-maintenance-plan.json'));
const runNode = async (name, items) => {
  const js = wf.nodes.find((n) => n.name === name).parameters.jsCode;
  return [...(await vm.runInNewContext(`(async()=>{${js}})`, { $input: { all: () => items, first: () => ({ json: {} }) } })())].map((i) => i.json);
};
const planLogic = vm.runInNewContext(`${/<script id="vm-logic">([\s\S]*?)<\/script>/.exec(page)[1]}; ({ plan, tasksFor, assess })`);

test('every reason maps to a task definition with three steps, approver and a fix that clears the reason', () => {
  const data = repoVms();
  for (const key of ['cert', 'patch', 'disk', 'backup', 'unreachable', 'cpu', 'mem']) {
    const t = data.tasks[key];
    assert.ok(t.title && t.approver && t.steps.length === 3 && typeof t.reboot === 'boolean' && t.fix, key);
  }
  for (const v of data.vms) for (const r of assess(v, data.rules).reasons) {
    assert.ok(data.tasks[r.key], `${v.name}: task for ${r.key}`);
    const fixed = { ...v, ...data.tasks[r.key].fix };
    assert.ok(!assess(fixed, data.rules).reasons.some((x) => x.key === r.key), `${v.name}: ${r.key} fix clears the reason`);
  }
});

test('workflow 05: the samples are the Space VMs, and workflow and page give the same plan', async () => {
  const data = repoVms();
  const sample = await runNode('VMs', []);
  assert.deepEqual(JSON.parse(JSON.stringify(sample)), data.vms);
  const assessed = await runNode('Assess and recommend tasks', sample.map((json) => ({ json })));
  const [result] = await runNode('Build plan', assessed.map((json) => ({ json })));
  const pagePlan = JSON.parse(JSON.stringify(planLogic.plan(data.vms, data.rules, data.tasks)));
  assert.deepEqual(JSON.parse(JSON.stringify(result.plan)), pagePlan);
  assert.equal(result.counts.tasks, pagePlan.reduce((n, p) => n + p.tasks.length, 0));
  assert.match(result.digest, /Proposal only\. Nothing was run/);
  assert.ok(result.plan[0].status === 'red' && result.plan.some((p) => p.bundle) && result.plan.some((p) => p.window.startsWith('Maintenance window')));
});

test('page: demo flow with six steps, task board and plan button; the plan request goes through the chat tool', () => {
  for (const id of ['guide', 'tasks-card', 'mkplan', 'reset-demo', 'task-rows']) assert.match(page, new RegExp(`id="${id}"`));
  assert.match(page, /run_vm_maintenance_plan/);
  assert.equal((page.match(/\{ t: '/g) || []).length, 6);
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage/);
});
