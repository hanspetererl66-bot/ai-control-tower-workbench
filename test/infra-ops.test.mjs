import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ORCHESTRATION, PLAYBOOKS, STEPS_DONE, canApprove, certStatus, dependents, findings, planTask, simulateRun } from '../shared/infra-ops.mjs';
import { embedInfraOps, modelSource, repoData } from '../scripts/sync-infra-ops.mjs';

const page = readFileSync(new URL('../examples/infra-ops/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../examples/shared/design-system.css', import.meta.url), 'utf8');
const data = repoData();
const win = (d = '2026-11-10', a = '22:00', b = '00:00', d2 = '2026-11-11') => [`${d}T${a}`, `${d2}T${b}`];

test('sample data is consistent: references resolve and dates are plausible', () => {
  const vm_ = new Set(data.vms.map((v) => v.id)), cu = new Set(data.customers.map((c) => c.id));
  for (const v of data.vms) { assert.ok(cu.has(v.customer), v.id); if (v.dependsOn) assert.ok(vm_.has(v.dependsOn), v.id); }
  for (const c of data.certs) { assert.ok(cu.has(c.customer)); c.vmIds.forEach((id) => assert.ok(vm_.has(id), `${c.id} -> ${id}`)); }
  for (const d of data.dns) { assert.ok(cu.has(d.customer)); assert.ok(vm_.has(d.vmId), d.id); assert.match(d.name, /\.example$/); }
  for (const t of data.tasks) { assert.ok(PLAYBOOKS[t.template], t.id); assert.ok(data.people.some((p) => p.id === t.requester)); }
  assert.equal(new Set(data.tasks.map((t) => t.id)).size, data.tasks.length);
});

test('certificate status follows the remaining days', () => {
  const at = (n) => certStatus({ notAfter: new Date(Date.parse(data.asOf) + n * 864e5).toISOString().slice(0, 10) }, data.asOf);
  assert.deepEqual([at(-1).status, at(5).status, at(20).status, at(60).status, at(200).status], ['abgelaufen', 'kritisch', 'bald', 'beobachten', 'ok']);
});

test('findings put expired and soon-expiring certificates and critical patches first', () => {
  const f = findings(data);
  assert.ok(f.some((x) => x.target === 'nl-cc' && x.severity === 'rot' && x.template === 'renew-certificate'));
  assert.ok(f.some((x) => x.target === 'bp-s4-prd'));
  assert.ok(f.some((x) => x.template === 'patch-vm' && x.severity === 'rot'));
  assert.ok(f.some((x) => x.target === 'ke-prd-app01' && x.template === null), 'stale backup is reported without a task');
  assert.deepEqual(f.map((x) => x.severity), [...f.map((x) => x.severity)].sort((a, b) => (a === 'rot' ? 0 : 1) - (b === 'rot' ? 0 : 1)));
});

test('a valid certificate renewal gets a plan, a diff, no downtime and two approvals in production', () => {
  const p = planTask(data, { template: 'renew-certificate', target: 'bp-s4-prd', window: win() });
  assert.equal(p.ok, true, p.errors.join());
  assert.equal(p.downtime.minutes, 0);
  assert.equal(p.approvalsNeeded, 2);
  assert.ok(p.diff.some((d) => d.sign === '-' && d.text.startsWith('not_after')) && p.diff.some((d) => d.sign === '+'));
  assert.deepEqual(p.steps.slice(-ORCHESTRATION.length).map((s) => s.id), ORCHESTRATION.map((s) => s.id));
});

test('guardrails block bad requests', () => {
  const err = (req) => planTask(data, { window: win(), ...req }).errors.join(' | ');
  assert.match(err({ template: 'rotate-secret', target: 'mi-prd-db01' }), /Entwurf/);
  assert.match(err({ template: 'renew-certificate', target: 'gibt-es-nicht' }), /nicht im Bestand/);
  assert.match(err({ template: 'renew-certificate', target: 'bp-s4-prd', window: ['2026-10-20T22:00', '2026-10-21T00:00'] }), /Zukunft/);
  assert.match(err({ template: 'renew-certificate', target: 'bp-s4-prd', window: ['2026-11-10T20:00', '2026-11-11T06:00'] }), /höchstens 8 Stunden/);
  assert.match(err({ template: 'renew-certificate', target: 'bp-s4-prd', window: ['2026-10-27T22:00', '2026-10-28T00:00'] }), /Freeze.*GxP/);
  assert.match(err({ template: 'renew-certificate', target: 'mi-s4-prd', window: ['2026-12-20T22:00', '2026-12-21T00:00'] }), /Jahresend-Freeze/);
  assert.match(err({ template: 'move-vm', target: 'mi-qas-app01', targetRegion: 'westeurope' }), /Hyperscaler/);
  assert.match(err({ template: 'move-vm', target: 'mi-qas-app01', targetRegion: 'mars-1' }), /Zielregion/);
  assert.match(err({ template: 'move-vm', target: 'mi-qas-app01', targetRegion: 'eu-central-1' }), /identisch/);
  assert.match(err({ template: 'patch-vm', target: 'ke-prd-app01' }), /Backup ist zu alt/);
  assert.match(err({ template: 'update-dns-record', target: 'mi-s4', newValue: 'kein-ip', ttl: 5 }), /IPv4.*TTL|TTL.*IPv4/);
});

test('a VM move creates the DNS follow-up steps and lists dependent systems', () => {
  const p = planTask(data, { template: 'move-vm', target: 'nl-qas-app01', targetRegion: 'europe-west1', window: win() });
  assert.equal(p.ok, true, p.errors.join());
  assert.ok(p.steps.some((s) => s.id.startsWith('dns-')) && p.steps.some((s) => s.id.startsWith('ttl-')));
  assert.equal(p.approvalsNeeded, 1, 'QAS with medium risk needs one approval');
  assert.deepEqual(dependents(data, 'mi-prd-db01'), ['mi-prd-app01', 'mi-prd-wd01']);
  const db = planTask(data, { template: 'patch-vm', target: 'mi-prd-db01', window: win() });
  assert.deepEqual(db.checks.find((c) => c.label === 'Abhängige Systeme').status, 'warn');
  assert.equal(db.downtime.minutes, 25);
});

test('conflicts with other open tasks of the same customer are reported', () => {
  const p = planTask(data, { template: 'patch-vm', target: 'bp-prd-db01', window: ['2026-10-24T21:00', '2026-10-24T23:00'] });
  assert.ok(p.conflicts.includes('CHG-1039'));
  assert.equal(p.checks.find((c) => c.label.startsWith('Konflikte')).status, 'warn');
});

test('four-eyes rule is enforced technically', () => {
  const task = data.tasks.find((t) => t.id === 'CHG-1040');
  assert.equal(task.state, 'in_pruefung');
  assert.match(canApprove(task, task.requester, data).reason, /nicht selbst/);
  assert.match(canApprove(task, 'mo', data).reason, /bereits/);
  assert.match(canApprove(task, 'nb', data).reason, /anderen Rolle/);
  assert.equal(canApprove(task, 'jb', data).ok, true);
  assert.match(canApprove({ ...task, state: 'geplant' }, 'jb', data).reason, /In Prüfung/);
  assert.equal(canApprove(task, 'unbekannt', data).ok, false);
  const blocked = { ...data.tasks.find((t) => t.id === 'CHG-1043'), state: 'in_pruefung' };
  assert.match(canApprove(blocked, 'jb', data).reason, /Plan hat Fehler/);
});

test('the simulated run only reports additions and never claims a failure', () => {
  const p = planTask(data, { template: 'renew-certificate', target: 'bp-s4-prd', window: win() });
  const run = simulateRun(p);
  assert.equal(run.recap.failed, 0);
  assert.equal(run.recap.changed, p.diff.filter((d) => d.sign === '+').length);
  assert.ok(run.lines.at(-1).startsWith('PLAY RECAP'));
  assert.ok(STEPS_DONE.erledigt === ORCHESTRATION.length);
});

test('the plan is deterministic', () => {
  const req = { template: 'move-vm', target: 'nl-qas-app01', targetRegion: 'europe-west1', window: win() };
  assert.deepEqual(planTask(data, req), planTask(data, req));
});

test('the page embeds exactly the shared model and data, is in sync, and runs the same rules', () => {
  assert.equal(embedInfraOps(page, data, undefined, css), page, 'run: npm run sync:infra-ops');
  const embedded = /<script id="io-model">([\s\S]*?)<\/script>/.exec(page)[1].trim();
  assert.equal(embedded, modelSource().trim());
  const ctx = vm.createContext({});
  vm.runInContext(`${embedded}\nthis.plan = planTask; this.find = findings;`, ctx);
  const clean = (x) => JSON.parse(JSON.stringify(x));
  for (const t of data.tasks) assert.deepEqual(clean(ctx.plan(data, { ...t, ...(t.params ?? {}) })), clean(planTask(data, { ...t, ...(t.params ?? {}) })), t.id);
  assert.deepEqual(clean(ctx.find(data)), clean(findings(data)));
});

test('the page is self-contained, escapes what it prints and offers Ask Joule within the host limit', () => {
  assert.doesNotMatch(page, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket|<form|https?:\/\/(?!www\.w3\.org)/);
  assert.match(page, /type: 'wb:ask'/);
  assert.match(page, /prompt\.slice\(0, 600\)/);
  assert.match(page, /class="card"/);
});
