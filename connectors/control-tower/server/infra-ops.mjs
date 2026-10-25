/**
 * Infrastructure Operations: planning rules for certificate, VM and DNS changes, plus the two chat tools that
 * plan a change (read-only) and hand it to n8n (the only write, always as a check-mode request).
 *
 * The rules are a transparent model over the sample inventory (examples/infra-ops/data.json); no system is touched.
 * The code between BEGIN-MODEL and END-MODEL is embedded verbatim into the Space page by scripts/sync-infra-ops.mjs,
 * so the page, the tools and the tests run the same rules.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// BEGIN-MODEL
const DAY_MS = 86400000;
const PLAYBOOKS = {
  'renew-certificate': { title: 'Renew and deploy a certificate', status: 'approved', kind: 'cert', base: 1 },
  'update-dns-record': { title: 'Change a DNS record', status: 'approved', kind: 'dns', base: 1 },
  'patch-vm': { title: 'Patch and restart a VM', status: 'approved', kind: 'vm', base: 2 },
  'move-vm': { title: 'Move a VM to another region', status: 'approved', kind: 'vm', base: 3 },
  'rotate-secret': { title: 'Rotate a secret', status: 'draft', kind: 'vm', base: 2 },
};
const STATES = ['planned', 'in_review', 'approved', 'in_window', 'done'];
const ORCHESTRATION = [
  { id: 'trigger', title: 'Trigger', tool: 'n8n', detail: 'Webhook or schedule (for example: certificate expires in 30 days)' },
  { id: 'ticket', title: 'Create task and ticket', tool: 'n8n', detail: 'Change ticket in the ITSM, task in the Space' },
  { id: 'check', title: 'Pre-check in check mode', tool: 'AWX', detail: 'Playbook with --check --diff, dependencies, conflicts' },
  { id: 'approve', title: 'Approval (four eyes)', tool: 'n8n', detail: 'Request to the approvers in Teams; the answer starts the next step' },
  { id: 'window', title: 'Wait for the change window', tool: 'n8n', detail: 'Start only inside the approved window' },
  { id: 'run', title: 'Run the playbook', tool: 'AWX', detail: 'Job template with checked parameters, snapshot first' },
  { id: 'verify', title: 'Verification', tool: 'AWX', detail: 'Health and certificate checks, rollback on failure' },
  { id: 'evidence', title: 'Evidence and notification', tool: 'n8n', detail: 'File the log, inform customer and team' },
];
/** How many orchestration steps are done in each task state. */
const STEPS_DONE = { planned: 2, in_review: 3, approved: 5, in_window: 6, done: 8 };

const toDay = (iso) => String(iso).slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(toDay(b)) - Date.parse(toDay(a))) / DAY_MS);
const hoursOf = (win) => (Date.parse(win[1] + ':00Z') - Date.parse(win[0] + ':00Z')) / 3600000;
const by = (list) => new Map(list.map((x) => [x.id, x]));

function certStatus(cert, asOf) {
  const left = daysBetween(asOf, cert.notAfter);
  const status = left < 0 ? 'expired' : left <= 7 ? 'critical' : left <= 30 ? 'soon' : left <= 90 ? 'watch' : 'ok';
  return { daysLeft: left, status };
}

/** Everything that runs on top of a VM (reverse dependencies, transitive). */
function dependents(data, vmId) {
  const out = [];
  const seen = new Set([vmId]);
  const queue = [vmId];
  while (queue.length) {
    const cur = queue.shift();
    for (const v of data.vms) if (v.dependsOn === cur && !seen.has(v.id)) { seen.add(v.id); out.push(v.id); queue.push(v.id); }
  }
  return out;
}

function findings(data) {
  const out = [];
  for (const c of data.certs) {
    const s = certStatus(c, data.asOf);
    if (s.status === 'expired') out.push({ severity: 'red', kind: 'cert', target: c.id, template: 'renew-certificate', title: `${c.name} has expired`, detail: `Invalid for ${-s.daysLeft} days (${c.notAfter}).` });
    else if (s.status === 'critical' || s.status === 'soon') out.push({ severity: s.status === 'critical' ? 'red' : 'amber', kind: 'cert', target: c.id, template: 'renew-certificate', title: `${c.name} expires in ${s.daysLeft} days`, detail: `Valid until ${c.notAfter}.` });
  }
  for (const v of data.vms) {
    if (v.criticalPatches > 0) out.push({ severity: 'red', kind: 'vm', target: v.id, template: 'patch-vm', title: `${v.id}: ${v.criticalPatches} critical patches open`, detail: `${v.pendingPatches} patches in total, last patch ${v.lastPatch}.` });
    if (daysBetween(v.lastBackup, data.asOf) >= 2) out.push({ severity: 'amber', kind: 'vm', target: v.id, template: null, title: `${v.id}: backup is ${daysBetween(v.lastBackup, data.asOf)} days old`, detail: 'Make sure there is a fresh backup before any change.' });
  }
  const rank = { red: 0, amber: 1 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function overlaps(a, b) { return a[0] < b[1] && b[0] < a[1]; }

/** Validate a change request and plan it. Returns { ok, errors, ... }. */
function planTask(data, req) {
  const errors = [];
  const pb = PLAYBOOKS[req.template];
  if (!pb) return { ok: false, errors: ['Unknown task template.'] };
  if (pb.status !== 'approved') errors.push(`The playbook "${req.template}" is a draft and not approved for production.`);
  const inventory = { cert: data.certs, dns: data.dns, vm: data.vms }[pb.kind];
  const target = by(inventory).get(req.target);
  if (!target) return { ok: false, errors: [...errors, `Target "${req.target}" is not in the inventory (only known targets are allowed).`] };
  const vmMap = by(data.vms);
  const customer = by(data.customers).get(target.customer);
  const win = req.window;
  if (!win || !win[0] || !win[1] || win[0] >= win[1]) errors.push('The change window is invalid.');
  else {
    if (toDay(win[0]) <= data.asOf && !['in_window', 'done'].includes(req.state)) errors.push('The window must be in the future.');
    if (hoursOf(win) > 8) errors.push('A change window may last 8 hours at most.');
    for (const f of data.freezes) {
      if ((f.customer === null || f.customer === target.customer) && toDay(win[0]) <= f.to && toDay(win[1]) >= f.from) errors.push(`The window falls into a freeze: ${f.reason} (${f.from} to ${f.to}).`);
    }
  }
  const affectedVmIds = pb.kind === 'cert' ? [...target.vmIds] : pb.kind === 'dns' ? (target.vmId ? [target.vmId] : []) : [target.id];
  const primaryVm = vmMap.get(affectedVmIds[0]);
  const env = primaryVm ? primaryVm.env : 'PRD';
  const checks = [];
  const diff = [];
  const downtime = { minutes: 0, note: '' };
  const extraSteps = [];
  let risk = pb.base + (env === 'PRD' ? 1 : 0) + (primaryVm && primaryVm.role === 'HANA database' ? 1 : 0);

  if (pb.kind === 'cert') {
    const s = certStatus(target, data.asOf);
    checks.push({ label: 'Remaining validity', status: s.status === 'ok' ? 'warn' : 'ok', detail: s.daysLeft < 0 ? `Expired ${-s.daysLeft} days ago.` : `${s.daysLeft} days left, renewal ${s.status === 'ok' ? 'not needed yet' : 'makes sense'}.` });
    checks.push({ label: 'Certificate chain', status: 'ok', detail: `Issuer ${target.issuer}, intermediate certificates complete.` });
    checks.push({ label: 'Key', status: 'ok', detail: `New key ${target.key}, fits the purpose.` });
    const names = data.dns.filter((d) => affectedVmIds.includes(d.vmId)).map((d) => d.name);
    checks.push({ label: 'Names in the certificate', status: 'ok', detail: names.length ? `Covers ${names.join(', ')}.` : 'No DNS names linked.' });
    diff.push({ sign: ' ', text: `certificate: ${target.name}` }, { sign: '-', text: `not_after: ${target.notAfter}` }, { sign: '+', text: `not_after: ${new Date(Date.parse(toDay(win && win[0] ? win[0] : data.asOf) + 'T00:00:00Z') + 365 * DAY_MS).toISOString().slice(0, 10)}` }, { sign: ' ', text: `deploy_to: ${affectedVmIds.join(', ')}` }, { sign: '+', text: 'reload: web dispatcher / application server (no restart)' });
    downtime.minutes = 0; downtime.note = 'No outage: the services reload the certificate.';
  } else if (pb.kind === 'dns') {
    const nv = req.newValue || (req.params && req.params.newValue) || '';
    const ttl = Number(req.ttl ?? (req.params && req.params.ttl) ?? target.ttl);
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(nv) && target.type === 'A') errors.push('The new value must be a valid IPv4 address.');
    if (!Number.isFinite(ttl) || ttl < 60 || ttl > 86400) errors.push('The TTL must be between 60 and 86400 seconds.');
    const users = data.dns.filter((d) => d.type === 'CNAME' && d.value === target.name);
    checks.push({ label: 'Users of the name', status: users.length ? 'warn' : 'ok', detail: users.length ? `${users.length} alias records point to ${target.name}: ${users.map((u) => u.name).join(', ')}.` : 'No alias records.' });
    checks.push({ label: 'TTL before the switch', status: target.ttl > 300 ? 'warn' : 'ok', detail: target.ttl > 300 ? `Current TTL ${target.ttl} s: lower it to 300 s first, otherwise the old address stays visible for up to ${Math.round(target.ttl / 60)} minutes.` : 'The TTL is already low.' });
    diff.push({ sign: ' ', text: `record: ${target.name} (${target.type})` }, { sign: '-', text: `value: ${target.value}   ttl: ${target.ttl}` }, { sign: '+', text: `value: ${nv || '(new)'}   ttl: ${ttl}` });
    downtime.minutes = 0; downtime.note = `Name resolution switches within up to ${Math.round(target.ttl / 60)} minutes (TTL).`;
    if (target.ttl > 300) extraSteps.push({ id: 'ttl', title: 'Lower the TTL to 300 s beforehand', when: 'at least one TTL before the window', playbook: 'update-dns-record' });
    risk += users.length ? 1 : 0;
  } else if (req.template === 'patch-vm') {
    const backupAge = daysBetween(target.lastBackup, data.asOf);
    checks.push({ label: 'Backup', status: backupAge >= 2 ? 'fail' : 'ok', detail: backupAge >= 2 ? `Last backup ${backupAge} days ago: take a new backup before patching.` : `Last backup ${target.lastBackup}.` });
    checks.push({ label: 'Open patches', status: target.criticalPatches ? 'warn' : 'ok', detail: `${target.pendingPatches} open, ${target.criticalPatches} of them critical.` });
    const dep = dependents(data, target.id);
    checks.push({ label: 'Dependent systems', status: dep.length ? 'warn' : 'ok', detail: dep.length ? `${dep.join(', ')} stop while this VM restarts.` : 'No dependent systems.' });
    diff.push({ sign: ' ', text: `vm: ${target.id} (${target.os})` }, { sign: '-', text: `patches_pending: ${target.pendingPatches}` }, { sign: '+', text: 'patches_pending: 0' }, { sign: '+', text: 'reboot: required' });
    downtime.minutes = target.role === 'HANA database' ? 25 : 10; downtime.note = `Restart, about ${downtime.minutes} minutes${dep.length ? ' (dependent systems affected)' : ''}.`;
    if (backupAge >= 2) errors.push('The backup is too old: the playbook only runs with a backup from the last 24 hours.');
  } else {
    const region = by(data.regions).get(req.targetRegion || (req.params && req.params.targetRegion));
    if (!region) errors.push('The target region is not allowed (only regions from the list).');
    else {
      const cross = region.hyperscaler !== target.hyperscaler;
      checks.push({ label: 'Capacity in the target region', status: region.freePct < 20 ? 'warn' : 'ok', detail: `${region.label}: ${region.freePct} % free${region.freePct < 20 ? ', tight' : ''}.` });
      checks.push({ label: 'Hyperscaler', status: cross ? 'fail' : 'ok', detail: cross ? 'Changing the hyperscaler is a migration project, not a standard playbook.' : 'Move within the same hyperscaler.' });
      if (cross) errors.push('Changing the hyperscaler is not allowed with this playbook.');
      if (region.id === target.region) errors.push('The target region is the same as the current region.');
      diff.push({ sign: ' ', text: `vm: ${target.id}` }, { sign: '-', text: `region: ${target.region}` }, { sign: '+', text: `region: ${region.id}` }, { sign: '+', text: 'snapshot: before the change' });
    }
    const backupAge = daysBetween(target.lastBackup, data.asOf);
    checks.push({ label: 'Backup', status: backupAge >= 2 ? 'fail' : 'ok', detail: backupAge >= 2 ? `Last backup ${backupAge} days ago.` : `Last backup ${target.lastBackup}.` });
    if (backupAge >= 2) errors.push('The backup is too old: the playbook only runs with a backup from the last 24 hours.');
    const dep = dependents(data, target.id);
    checks.push({ label: 'Dependent systems', status: dep.length ? 'warn' : 'ok', detail: dep.length ? `${dep.join(', ')} depend on this VM.` : 'No dependent systems.' });
    const recs = data.dns.filter((d) => d.vmId === target.id);
    checks.push({ label: 'DNS', status: recs.length ? 'warn' : 'ok', detail: recs.length ? `${recs.map((r) => r.name).join(', ')} must point to the new address after the move.` : 'No DNS records affected.' });
    downtime.minutes = 90; downtime.note = 'About 90 minutes (snapshot, move, start, verification).';
    for (const r of recs) {
      if (r.ttl > 300) extraSteps.push({ id: `ttl-${r.id}`, title: `Lower the TTL of ${r.name} to 300 s beforehand`, when: 'one day before the window', playbook: 'update-dns-record' });
      extraSteps.push({ id: `dns-${r.id}`, title: `Point ${r.name} to the new address after the move`, when: 'right after the move', playbook: 'update-dns-record' });
    }
  }

  // conflicts with other open tasks of the same customer
  const conflicts = win && win[0] && win[1] ? (data.tasks ?? []).filter((t) => t.id !== req.id && t.customer === target.customer && t.state !== 'done' && overlaps(win, t.window)) : [];
  checks.push({ label: 'Conflicts in the change calendar', status: conflicts.length ? 'warn' : 'ok', detail: conflicts.length ? `Overlaps with ${conflicts.map((c) => c.id).join(', ')}.` : 'No overlap with other tasks of this customer.' });

  const affectedVmsAll = [...new Set(affectedVmIds.flatMap((id) => [id, ...(pb.kind === 'cert' || pb.kind === 'dns' ? [] : dependents(data, id))]))];
  const affectedDns = data.dns.filter((d) => affectedVmsAll.includes(d.vmId)).map((d) => d.name);
  const riskLevel = risk >= 5 ? 'high' : risk >= 3 ? 'medium' : 'low';
  const approvalsNeeded = env === 'PRD' || riskLevel === 'high' ? 2 : 1;
  return {
    ok: errors.length === 0,
    errors,
    template: req.template,
    playbook: { id: req.template, title: pb.title },
    target: target.id,
    customer: customer ? customer.name : target.customer,
    env,
    risk: riskLevel,
    riskScore: risk,
    approvalsNeeded,
    approvalReason: approvalsNeeded === 2 ? (env === 'PRD' ? 'Production: two approvals (four eyes plus change manager).' : 'High risk: two approvals.') : 'One approval is enough (no production system, low risk).',
    checks,
    diff,
    downtime,
    blast: { vms: affectedVmsAll, dns: affectedDns, customers: [customer ? customer.name : target.customer] },
    conflicts: conflicts.map((c) => c.id),
    steps: [...extraSteps, ...ORCHESTRATION.map((s) => ({ id: s.id, title: s.title, tool: s.tool, detail: s.detail }))],
  };
}

/** May this person approve? Technical enforcement of the four-eyes rule. */
function canApprove(task, personId, data) {
  const person = by(data.people).get(personId);
  if (!person) return { ok: false, reason: 'Unknown person.' };
  if (task.state !== 'in_review') return { ok: false, reason: 'Approval is only possible in the "In review" phase.' };
  if (task.requester === personId) return { ok: false, reason: 'The requester must not approve their own change.' };
  if ((task.approvals ?? []).includes(personId)) return { ok: false, reason: 'This person has already approved.' };
  const plan = planTask(data, { ...task, ...(task.params ?? {}) });
  if (!plan.ok) return { ok: false, reason: `The plan has errors: ${plan.errors[0]}` };
  const have = (task.approvals ?? []).map((id) => by(data.people).get(id));
  if (plan.approvalsNeeded === 2 && have.length === 1 && have[0].role === person.role && person.role !== 'Change Manager') return { ok: false, reason: 'The second approval must come from a different role than the first, for example the change manager.' };
  return { ok: true, reason: '' };
}

/** A simulated playbook run: Ansible-style output and a recap. No system is touched. */
function simulateRun(plan) {
  const tasks = plan.diff.filter((d) => d.sign === '+').map((d) => d.text.replace(/\s{2,}/g, ' '));
  const lines = [`PLAY [${plan.playbook.title}] ${'*'.repeat(20)}`, 'TASK [Snapshot and health check before] ok'];
  tasks.forEach((t) => lines.push(`TASK [${t}] changed`));
  lines.push('TASK [Verification after the change] ok', '', `PLAY RECAP  ok=2  changed=${tasks.length}  failed=0  rolled_back=0`);
  return { lines, recap: { ok: 2, changed: tasks.length, failed: 0 } };
}
// END-MODEL

export { PLAYBOOKS, STATES, ORCHESTRATION, STEPS_DONE, certStatus, dependents, findings, planTask, canApprove, simulateRun };

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/** Bundled copy first, then the repository's sample inventory when running from a checkout. */
export function loadInfraData(env = process.env) {
  const candidates = [env.INFRA_OPS_DATA, here('../data/infra-ops.json'), here('../../../examples/infra-ops/data.json')].filter(Boolean);
  const file = candidates.find((path) => existsSync(path));
  if (!file) throw new Error('Infrastructure Operations sample data not found.');
  return JSON.parse(readFileSync(file, 'utf8'));
}

const WINDOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const REQUEST_PROPERTIES = {
  template: { type: 'string', enum: Object.keys(PLAYBOOKS), description: 'Which kind of change: renew-certificate, update-dns-record, patch-vm or move-vm (rotate-secret is a draft and is rejected).' },
  target: { type: 'string', description: 'Id from the inventory, for example "bp-s4-prd" (certificate), "nl-qas-app01" (VM) or "ke-s4" (DNS record).' },
  window_start: { type: 'string', description: 'Start of the change window, local time, format YYYY-MM-DDTHH:MM.' },
  window_end: { type: 'string', description: 'End of the change window, format YYYY-MM-DDTHH:MM, at most 8 hours after the start.' },
  new_value: { type: 'string', description: 'update-dns-record only: the new IPv4 address.' },
  ttl: { type: 'number', description: 'update-dns-record only: TTL in seconds (60 to 86400).' },
  target_region: { type: 'string', description: 'move-vm only: id of the target region within the same hyperscaler, for example "europe-west1".' },
};

export const INFRA_TOOL_DEFINITIONS = [
  {
    name: 'plan_infra_change',
    description:
      'Plan an infrastructure change (renew a certificate, patch or move a VM, change a DNS record) without changing anything: validates the request against the inventory, freeze periods, backup age and region rules, and returns the pre-checks, a simulated Ansible check-mode diff, blast radius, expected downtime, risk and how many approvals are needed. Read-only. Sample inventory, simulated plan. Use it for "Can we renew the certificate for bp-s4-prd on 10 November?" before submit_infra_change.',
    inputSchema: { type: 'object', properties: REQUEST_PROPERTIES, required: ['template', 'target', 'window_start', 'window_end'], additionalProperties: false },
  },
  {
    name: 'submit_infra_change',
    description:
      'Hand a planned infrastructure change to the n8n workflow that orchestrates it (ticket, check-mode run in AWX, approval in Teams). The only write of this tool group, and it never executes a change: the request is always sent in check mode and approval happens in n8n. Call plan_infra_change first, show the plan to the person and set confirm to true only after they agree. Needs the n8n webhook address in the connector settings; without it the tool returns the payload it would send.',
    inputSchema: { type: 'object', properties: { ...REQUEST_PROPERTIES, confirm: { type: 'boolean', description: 'Must be true, and only after the person has seen the plan and agreed to submit it.' } }, required: ['template', 'target', 'window_start', 'window_end', 'confirm'], additionalProperties: false },
  },
];

/** `env` supplies N8N_INFRA_WEBHOOK_URL and the optional N8N_INFRA_WEBHOOK_TOKEN; `load` returns the inventory. */
export function createInfraOpsHandlers({ ToolError, env = process.env, fetchImpl = fetch, load = () => loadInfraData(env) } = {}) {
  const inventory = () => {
    try {
      return load();
    } catch (error) {
      throw new ToolError(`Infrastructure Operations sample data unavailable: ${error.message}`);
    }
  };
  const request = (args) => {
    for (const key of ['window_start', 'window_end']) if (typeof args[key] !== 'string' || !WINDOW.test(args[key])) throw new ToolError(`${key} must look like 2026-11-10T22:00`);
    if (typeof args.template !== 'string' || typeof args.target !== 'string') throw new ToolError('template and target are required');
    return { template: args.template, target: args.target, window: [args.window_start, args.window_end], newValue: args.new_value, ttl: args.ttl, targetRegion: args.target_region };
  };
  const view = { space: 'infra-ops', tab: 'tasks' };
  const webhook = () => {
    const raw = env.N8N_INFRA_WEBHOOK_URL?.trim();
    if (!raw) return null;
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new ToolError('The n8n webhook address (N8N_INFRA_WEBHOOK_URL) is not a valid URL.');
    }
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new ToolError('The n8n webhook address must use https.');
    return url;
  };
  return {
    plan_infra_change(args) {
      const plan = planTask(inventory(), request(args));
      return { ...plan, steps: (plan.steps ?? []).map((s) => (s.tool ? `${s.title} (${s.tool})` : s.title)), view, dataSource: 'sample inventory (Infrastructure Operations example Space), simulated plan' };
    },
    async submit_infra_change(args) {
      if (args.confirm !== true) throw new ToolError('Set confirm to true only after the person has seen the plan and agreed to submit it.');
      const req = request(args);
      const plan = planTask(inventory(), req);
      if (!plan.ok) throw new ToolError(`The change is blocked: ${plan.errors.join(' ')}`);
      const payload = {
        source: 'werkbank-infra-ops',
        mode: 'check',
        request: { template: req.template, target: req.target, window: req.window, newValue: req.newValue ?? null, ttl: req.ttl ?? null, targetRegion: req.targetRegion ?? null },
        plan: { customer: plan.customer, risk: plan.risk, approvalsNeeded: plan.approvalsNeeded, downtimeMinutes: plan.downtime.minutes, diff: plan.diff, checks: plan.checks.map((c) => ({ label: c.label, status: c.status })), steps: plan.steps.map((s) => s.id) },
      };
      const url = webhook();
      if (!url) return { submitted: false, reason: 'The n8n webhook is not configured: enter its address (N8N_INFRA_WEBHOOK_URL) in the connector settings. Import examples/n8n-workflows/08-infra-change-request.json into n8n and copy the production webhook URL.', wouldSend: payload, view };
      const headers = { 'content-type': 'application/json' };
      if (env.N8N_INFRA_WEBHOOK_TOKEN) headers['x-infra-token'] = env.N8N_INFRA_WEBHOOK_TOKEN;
      let res;
      try {
        res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
      } catch (error) {
        throw new ToolError(`n8n could not be reached: ${error.name === 'TimeoutError' ? 'timeout after 10 seconds' : 'network error'}.`);
      }
      const text = (await res.text()).slice(0, 500);
      if (!res.ok) throw new ToolError(`n8n answered with status ${res.status}. Check the workflow and the webhook address.`);
      return { submitted: true, status: res.status, mode: 'check', note: 'Handed to n8n in check mode. Nothing was changed; approval and execution stay in n8n and AWX.', response: text, view };
    },
  };
}
