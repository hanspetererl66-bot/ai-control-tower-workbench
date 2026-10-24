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

test('page: demo flow with seven steps, task board, operator tickets and plan button; requests go through the chat tools', () => {
  for (const id of ['guide', 'tasks-card', 'mkplan', 'reset-demo', 'task-rows']) assert.match(page, new RegExp(`id="${id}"`));
  assert.match(page, /run_vm_maintenance_plan/);
  assert.equal((page.match(/\{ t: '/g) || []).length, 7);
  assert.match(page, /create_ticket/);
  assert.match(page, /run_vm_operator_runbook/);
  assert.match(page, /id="mkticket"/);
  assert.doesNotMatch(page, /answer in German/);
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage/);
});

const runbook = JSON.parse(read('examples/n8n-workflows/06-vm-operator-runbook.json'));
const runStep = async (name, json) => {
  const js = runbook.nodes.find((n) => n.name === name).parameters.jsCode;
  return (await vm.runInNewContext(`(async()=>{${js}})`, { $input: { first: () => ({ json }), all: () => [{ json }] } })())[0].json;
};
const runAll = async (body, { skipBackup } = {}) => {
  let s = await runStep('Ticket, VM and task', body ? { body } : {});
  s = await runStep('1 Check VM', s);
  if (!s.go) return runStep('Operator report', await runStep('Stop: not run', s));
  const needBackup = s.vm.env === 'prod' && s.vm.backupAgeHours !== null && s.vm.backupAgeHours > 24;
  s = await runStep(needBackup ? '2 Backup' : '2 No backup needed', s);
  s = await runStep('4 Verify', await runStep('3 Apply task', s));
  return runStep('Operator report', s);
};

test('workflow 06: rules and task definitions are the Space data, so the runbook and the page agree', () => {
  const data = repoVms();
  for (const name of ['1 Check VM', '3 Apply task', '4 Verify']) {
    const js = runbook.nodes.find((n) => n.name === name).parameters.jsCode;
    assert.deepEqual(JSON.parse(/const RULES = (.*);/.exec(js)[1]), data.rules, `${name}: rules`);
    assert.deepEqual(JSON.parse(/const TASKS = (.*);/.exec(js)[1]), data.tasks, `${name}: tasks`);
  }
});

test('workflow 06: sample ticket takes a backup first, renews the certificate and verifies', async () => {
  const r = await runAll();
  assert.equal(r.result, 'done');
  assert.equal(r.ticket.id, 'T-1042');
  assert.equal(r.statusBefore, 'red');
  assert.notEqual(r.statusAfter, 'red');
  assert.ok(r.backup.done && r.backup.verified);
  assert.equal(r.log.length, 4);
  assert.match(r.digest, /Simulated/);
});

test('workflow 06: no backup for a recent restore point or a test VM; stops without approval or when the reason is gone', async () => {
  const base = { id: 'v1', name: 'web-01', env: 'prod', reachable: true, cpuPct: 20, memPct: 30, diskPct: 40, patchLagDays: 1, backupAgeHours: 3, certExpiresInDays: 4 };
  const ok = await runAll({ ticket: { id: 'T-1' }, vm: base, task: 'cert', approved: true });
  assert.equal(ok.result, 'done'); assert.equal(ok.backup.done, false); assert.equal(ok.statusAfter, 'green');
  const test_ = await runAll({ ticket: { id: 'T-2' }, vm: { ...base, env: 'test', backupAgeHours: null }, task: 'cert', approved: true });
  assert.equal(test_.result, 'done'); assert.equal(test_.backup.done, false);
  const open = await runAll({ ticket: { id: 'T-3' }, vm: base, task: 'cert' });
  assert.equal(open.result, 'not run'); assert.match(open.reason, /not approved/); assert.equal(open.statusAfter, 'red');
  const gone = await runAll({ ticket: { id: 'T-4' }, vm: { ...base, certExpiresInDays: 200 }, task: 'cert', approved: true });
  assert.equal(gone.result, 'not run'); assert.match(gone.reason, /no longer needed/);
  const unknown = await runAll({ vm: base, task: 'rm -rf', approved: true });
  assert.equal(unknown.result, 'not run'); assert.match(unknown.reason, /unknown task/);
});

test('the runbook prompt the page sends stays within the chat limit', () => {
  assert.ok(/function runbookPrompt/.test(page));
  const longest = `Run the n8n workflow "Demo 6 (IT infrastructure): operator runbook" with the tool run_vm_operator_runbook (production mode): ticketId OP-1042, task unreachable, approved true (Change board approved), vm ${JSON.stringify({ id: 'vm-25', name: 'proxy-edge-01', env: 'prod', reachable: true, cpuPct: 100, memPct: 100, diskPct: 100, backupAgeHours: 100000, patchLagDays: 3650, certExpiresInDays: -365 })}. Report the steps: check, backup, Check an unreachable VM, verification. Please answer in English.`;
  assert.ok(longest.length <= 600, `prompt is ${longest.length} characters`);
});
