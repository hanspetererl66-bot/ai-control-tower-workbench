import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ORCHESTRATION, PLAYBOOKS, STEPS_DONE, canApprove, certStatus, dependents, findings, planTask, simulateRun } from '../connectors/control-tower/server/infra-ops.mjs';
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
  assert.deepEqual([at(-1).status, at(5).status, at(20).status, at(60).status, at(200).status], ['expired', 'critical', 'soon', 'watch', 'ok']);
});

test('findings put expired and soon-expiring certificates and critical patches first', () => {
  const f = findings(data);
  assert.ok(f.some((x) => x.target === 'nl-cc' && x.severity === 'red' && x.template === 'renew-certificate'));
  assert.ok(f.some((x) => x.target === 'bp-s4-prd'));
  assert.ok(f.some((x) => x.template === 'patch-vm' && x.severity === 'red'));
  assert.ok(f.some((x) => x.target === 'ke-prd-app01' && x.template === null), 'stale backup is reported without a task');
  assert.deepEqual(f.map((x) => x.severity), [...f.map((x) => x.severity)].sort((a, b) => (a === 'red' ? 0 : 1) - (b === 'red' ? 0 : 1)));
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
  assert.match(err({ template: 'rotate-secret', target: 'mi-prd-db01' }), /draft/);
  assert.match(err({ template: 'renew-certificate', target: 'gibt-es-nicht' }), /not in the inventory|unknown/i);
  assert.match(err({ template: 'renew-certificate', target: 'bp-s4-prd', window: ['2026-10-20T22:00', '2026-10-21T00:00'] }), /future/);
  assert.match(err({ template: 'renew-certificate', target: 'bp-s4-prd', window: ['2026-11-10T20:00', '2026-11-11T06:00'] }), /8 hours at most/);
  assert.match(err({ template: 'renew-certificate', target: 'bp-s4-prd', window: ['2026-10-27T22:00', '2026-10-28T00:00'] }), /freeze.*GxP/i);
  assert.match(err({ template: 'renew-certificate', target: 'mi-s4-prd', window: ['2026-12-20T22:00', '2026-12-21T00:00'] }), /freeze.*year/i);
  assert.match(err({ template: 'move-vm', target: 'mi-qas-app01', targetRegion: 'westeurope' }), /hyperscaler/i);
  assert.match(err({ template: 'move-vm', target: 'mi-qas-app01', targetRegion: 'mars-1' }), /target region is not allowed/);
  assert.match(err({ template: 'move-vm', target: 'mi-qas-app01', targetRegion: 'eu-central-1' }), /same as the current/);
  assert.match(err({ template: 'patch-vm', target: 'ke-prd-app01' }), /backup is too old/);
  assert.match(err({ template: 'update-dns-record', target: 'mi-s4', newValue: 'kein-ip', ttl: 5 }), /IPv4|TTL/);
});

test('a VM move creates the DNS follow-up steps and lists dependent systems', () => {
  const p = planTask(data, { template: 'move-vm', target: 'nl-qas-app01', targetRegion: 'europe-west1', window: win() });
  assert.equal(p.ok, true, p.errors.join());
  assert.ok(p.steps.some((s) => s.id.startsWith('dns-')) && p.steps.some((s) => s.id.startsWith('ttl-')));
  assert.equal(p.approvalsNeeded, 1, 'QAS with medium risk needs one approval');
  assert.deepEqual(dependents(data, 'mi-prd-db01'), ['mi-prd-app01', 'mi-prd-wd01']);
  const db = planTask(data, { template: 'patch-vm', target: 'mi-prd-db01', window: win() });
  assert.deepEqual(db.checks.find((c) => c.label === 'Dependent systems').status, 'warn');
  assert.equal(db.downtime.minutes, 25);
});

test('conflicts with other open tasks of the same customer are reported', () => {
  const p = planTask(data, { template: 'patch-vm', target: 'bp-prd-db01', window: ['2026-10-24T21:00', '2026-10-24T23:00'] });
  assert.ok(p.conflicts.includes('CHG-1039'));
  assert.equal(p.checks.find((c) => c.label.startsWith('Conflicts')).status, 'warn');
});

test('four-eyes rule is enforced technically', () => {
  const task = data.tasks.find((t) => t.id === 'CHG-1040');
  assert.equal(task.state, 'in_review');
  assert.match(canApprove(task, task.requester, data).reason, /must not approve/);
  assert.match(canApprove(task, 'mo', data).reason, /already approved/);
  assert.match(canApprove(task, 'nb', data).reason, /different/);
  assert.equal(canApprove(task, 'jb', data).ok, true);
  assert.match(canApprove({ ...task, state: 'planned' }, 'jb', data).reason, /In review/);
  assert.equal(canApprove(task, 'unbekannt', data).ok, false);
  const blocked = { ...data.tasks.find((t) => t.id === 'CHG-1043'), state: 'in_review' };
  assert.match(canApprove(blocked, 'jb', data).reason, /plan has errors/);
});

test('the simulated run only reports additions and never claims a failure', () => {
  const p = planTask(data, { template: 'renew-certificate', target: 'bp-s4-prd', window: win() });
  const run = simulateRun(p);
  assert.equal(run.recap.failed, 0);
  assert.equal(run.recap.changed, p.diff.filter((d) => d.sign === '+').length);
  assert.ok(run.lines.at(-1).startsWith('PLAY RECAP'));
  assert.ok(STEPS_DONE.done === ORCHESTRATION.length);
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

/* ---------- connector tools: plan_infra_change / submit_infra_change ---------- */
import { INFRA_TOOL_DEFINITIONS, createInfraOpsHandlers } from '../connectors/control-tower/server/infra-ops.mjs';

class ToolError extends Error {}
const okArgs = { template: 'renew-certificate', target: 'bp-s4-prd', window_start: '2026-11-10T22:00', window_end: '2026-11-11T00:00' };
const handlers = (env = {}, fetchImpl = async () => { throw new Error('no network expected'); }) => createInfraOpsHandlers({ ToolError, env, fetchImpl, load: () => data });

test('both tools are declared, only submit needs confirm, and submit is described as check-mode only', () => {
  assert.deepEqual(INFRA_TOOL_DEFINITIONS.map((t) => t.name), ['plan_infra_change', 'submit_infra_change']);
  assert.ok(!INFRA_TOOL_DEFINITIONS[0].inputSchema.required.includes('confirm'));
  assert.ok(INFRA_TOOL_DEFINITIONS[1].inputSchema.required.includes('confirm'));
  assert.match(INFRA_TOOL_DEFINITIONS[1].description, /check mode/);
});

test('plan_infra_change is read-only, returns the plan and never calls the network', () => {
  const plan = handlers().plan_infra_change(okArgs);
  assert.equal(plan.ok, true);
  assert.ok(plan.steps.every((s) => typeof s === 'string'));
  assert.equal(handlers().plan_infra_change({ ...okArgs, target: 'unknown-id' }).ok, false);
  assert.throws(() => handlers().plan_infra_change({ ...okArgs, window_start: '10 Nov 22:00' }), ToolError);
});

test('submit_infra_change needs confirm and a valid plan', async () => {
  await assert.rejects(() => handlers().submit_infra_change(okArgs), /confirm/);
  await assert.rejects(() => handlers().submit_infra_change({ ...okArgs, confirm: false }), /confirm/);
  await assert.rejects(() => handlers().submit_infra_change({ ...okArgs, template: 'rotate-secret', target: 'mi-prd-db01', confirm: true }), /blocked/);
});

test('without a webhook the tool returns what it would send and does not submit', async () => {
  const out = await handlers().submit_infra_change({ ...okArgs, confirm: true });
  assert.equal(out.submitted, false);
  assert.equal(out.wouldSend.mode, 'check');
  assert.equal(out.wouldSend.source, 'werkbank-infra-ops');
  assert.match(out.reason, /N8N_INFRA_WEBHOOK_URL/);
});

test('with a webhook the request is posted in check mode, with the token header, and the token never comes back', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return { ok: true, status: 200, text: async () => '{"accepted":true}' }; };
  const out = await handlers({ N8N_INFRA_WEBHOOK_URL: 'https://n8n.example/webhook/infra', N8N_INFRA_WEBHOOK_TOKEN: 's3cret-token' }, fetchImpl).submit_infra_change({ ...okArgs, confirm: true });
  assert.equal(out.submitted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://n8n.example/webhook/infra');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-infra-token'], 's3cret-token');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.mode, 'check');
  assert.equal(body.request.target, 'bp-s4-prd');
  assert.ok(body.plan.diff.length > 0);
  assert.doesNotMatch(JSON.stringify(out), /s3cret-token/);
});

test('webhook address must be https (plain http only for localhost) and errors do not leak the token', async () => {
  await assert.rejects(() => handlers({ N8N_INFRA_WEBHOOK_URL: 'http://n8n.example/hook' }).submit_infra_change({ ...okArgs, confirm: true }), /https/);
  await assert.rejects(() => handlers({ N8N_INFRA_WEBHOOK_URL: 'not a url' }).submit_infra_change({ ...okArgs, confirm: true }), /valid URL/);
  const local = await handlers({ N8N_INFRA_WEBHOOK_URL: 'http://localhost:5678/webhook/x' }, async () => ({ ok: true, status: 200, text: async () => 'ok' })).submit_infra_change({ ...okArgs, confirm: true });
  assert.equal(local.submitted, true);
  const failing = handlers({ N8N_INFRA_WEBHOOK_URL: 'https://n8n.example/hook', N8N_INFRA_WEBHOOK_TOKEN: 'topsecret' }, async () => ({ ok: false, status: 403, text: async () => 'denied topsecret' }));
  await assert.rejects(() => failing.submit_infra_change({ ...okArgs, confirm: true }), (e) => e instanceof ToolError && /403/.test(e.message) && !/topsecret/.test(e.message));
  const down = handlers({ N8N_INFRA_WEBHOOK_URL: 'https://n8n.example/hook', N8N_INFRA_WEBHOOK_TOKEN: 'topsecret' }, async () => { throw new Error('ECONNREFUSED topsecret'); });
  await assert.rejects(() => down.submit_infra_change({ ...okArgs, confirm: true }), (e) => /could not be reached/.test(e.message) && !/topsecret/.test(e.message));
});

test('the page offers the n8n hand-off through Joule, in English, and the workflow file is importable', () => {
  assert.match(page, /plan_infra_change/);
  assert.match(page, /submit_infra_change/);
  assert.doesNotMatch(page.replace(/<script id="io-(data|model)">[\s\S]*?<\/script>/g, ''), /\b(Aufgabe|Bestand|Freigabe|Zertifikat|Übersicht)\b/);
  const wf = JSON.parse(readFileSync(new URL('../examples/n8n-workflows/08-infra-change-request.json', import.meta.url), 'utf8'));
  const types = wf.nodes.map((n) => n.type);
  assert.ok(types.includes('n8n-nodes-base.webhook') && types.includes('n8n-nodes-base.respondToWebhook'));
  const hook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  assert.equal(hook.parameters.authentication, 'headerAuth');
  assert.match(JSON.stringify(wf), /--check/);
  assert.doesNotMatch(JSON.stringify(wf), /"--check"\s*:\s*false|job_type["']?\s*:\s*["']run/);
  for (const [from, outs] of Object.entries(wf.connections)) { assert.ok(wf.nodes.some((n) => n.name === from), from); for (const o of outs.main.flat()) assert.ok(wf.nodes.some((n) => n.name === o.node), o.node); }
});
