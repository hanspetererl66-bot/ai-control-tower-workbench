import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const dir = join(import.meta.dirname, '..', 'examples/n8n-workflows');
const load = (file) => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const FILES = ['01-simple-contract-notice-check.json', '02-complex-communication-digest.json', '03-sales-pipeline-digest.json', '04-it-operations-alert-triage.json', '05-vm-maintenance-plan.json', '06-vm-operator-runbook.json', '07-vm-maintenance-approval.json'];

for (const file of FILES) {
  test(`${file} is a valid importable n8n workflow without credentials`, () => {
    const wf = load(file);
    assert.ok(wf.name && Array.isArray(wf.nodes) && wf.connections && wf.settings);
    const names = wf.nodes.map((n) => n.name);
    assert.equal(new Set(names).size, names.length, 'unique node names');
    assert.equal(new Set(wf.nodes.map((n) => n.id)).size, names.length, 'unique node ids');
    for (const n of wf.nodes) {
      assert.match(n.type, /^n8n-nodes-base\./);
      assert.ok(Number.isFinite(n.typeVersion) && n.position.length === 2, n.name);
      assert.equal(n.credentials, undefined, `${n.name} needs no credentials`);
    }
    for (const [from, outputs] of Object.entries(wf.connections)) {
      assert.ok(names.includes(from), from);
      for (const output of outputs.main) for (const t of output) assert.ok(names.includes(t.node), `${from} -> ${t.node}`);
    }
    // every non-note node is reachable from a trigger
    const triggers = wf.nodes.filter((n) => /(Trigger|webhook)$/.test(n.type)).map((n) => n.name);
    assert.ok(triggers.length > 0);
    const seen = new Set(triggers);
    for (let grew = true; grew;) {
      grew = false;
      for (const [from, outputs] of Object.entries(wf.connections)) if (seen.has(from)) for (const o of outputs.main) for (const t of o) if (!seen.has(t.node)) { seen.add(t.node); grew = true; }
    }
    for (const n of wf.nodes.filter((x) => !/stickyNote$/.test(x.type))) assert.ok(seen.has(n.name), `${n.name} is reachable`);
    assert.doesNotMatch(JSON.stringify(wf), /\b(fetch|require)\(|httpRequest|child_process/);
  });
}

test('simple workflow: the notice deadline logic gives the expected alerts, also from the webhook', async () => {
  const wf = load(FILES[0]);
  assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === 'contract-notice-check'), 'callable through a webhook');
  const run = async (name, items, first = {}) => {
    const js = wf.nodes.find((n) => n.name === name).parameters.jsCode;
    return [...(await vm.runInNewContext(`(async()=>{${js}})`, { $input: { all: () => items, first: () => ({ json: first }) } })())];
  };
  const items = await run('Sample contracts', []);
  const days = Object.fromEntries(items.map(({ json: c }) => [c.id, Math.round((Date.parse(c.end) - c.noticeDays * 864e5 - Date.parse(c.asOf)) / 864e5)]));
  assert.deepEqual(days, { 'C-2023-0390': 14, 'C-2025-0041': -17, 'C-2026-0012': 13, 'C-2024-0233': 73, 'C-2024-0187': 624 });
  assert.ok(items.every((i) => i.json.withinDays === 30 && i.json.asOf === '2026-10-19'));
  const custom = await run('Sample contracts', [], { body: { asOf: '2026-10-24', withinDays: 60, contracts: [{ id: 'X-1', product: 'P', end: '2027-01-31', noticeDays: 30 }, { id: 'bad', product: 'P', end: 'soon', noticeDays: 30 }] } });
  assert.deepEqual(custom.map((i) => i.json.id), ['X-1'], 'contracts from the webhook body are used, invalid ones are dropped');
  assert.equal(custom[0].json.withinDays, 60);
  assert.equal(custom[0].json.asOf, '2026-10-24');
  assert.equal(wf.nodes.find((n) => n.name === 'Within the window?').parameters.conditions.conditions[0].rightValue, '={{ $json.withinDays }}');
  // the report sorts by urgency and counts alerts
  const rows = items.map(({ json: c }) => { const daysLeft = days[c.id]; return { json: { ...c, noticeDeadline: 'x', daysLeft, status: daysLeft <= c.withinDays ? 'alert' : 'ok', message: `${c.id} in ${daysLeft}` } }; });
  const [report] = await run('Build report', rows);
  assert.equal(report.json.total, 5);
  assert.equal(report.json.alerts, 3);
  assert.equal(report.json.passed, 1);
  assert.deepEqual(report.json.contracts.map((c) => c.id).slice(0, 3), ['C-2025-0041', 'C-2026-0012', 'C-2023-0390']);
  assert.match(report.json.digest, /Draft only: nothing is sent/);
});

test('complex workflow: guardrail quarantines the injected mail, target and overdue checks, digest', async () => {
  const wf = load(FILES[1]);
  assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === 'communication-digest'), 'callable through a webhook');
  const run = async (name, items, first = {}) => {
    const js = wf.nodes.find((n) => n.name === name).parameters.jsCode;
    return [...(await vm.runInNewContext(`(async()=>{${js}})`, { $input: { all: () => items, first: () => ({ json: first }) } })())];
  };
  const data = await run('Sample data', []);
  const own = await run('Sample data', [], { body: { customer: 'Acme', asOf: '2026-10-24', ownDomains: ['acme.example'], mails: [{ id: 'M-1', subject: 'Offer', from: 'a@acme.example', receivedAt: '2026-10-20T10:00:00+02:00', waitingForUs: true, body: 'Hello' }], actions: [{ id: 'A-1', text: 'Send quote', owner: 'Mara', due: '2026-10-23', status: 'open' }] } });
  assert.deepEqual(own.map((i) => [i.json.kind, i.json.customer, i.json.today]), [['mail', 'Acme', '2026-10-24'], ['action', 'Acme', '2026-10-24']], 'mails and actions from the webhook body replace the sample');
  const ownClass = await run('Classify and check target', own.filter((i) => i.json.kind === 'mail'));
  assert.equal(ownClass[0].json.pastSla, true, 'the 48 h target is measured against the given date');
  assert.equal((await run('Sample data', [], { body: { customer: 'Acme', mails: [] } })).length, 0, 'an empty custom list is not replaced by the sample');
  const mails = data.filter((i) => i.json.kind === 'mail');
  const actions = data.filter((i) => i.json.kind === 'action');
  const guarded = await run('Guardrail: untrusted mail text', mails);
  const flagged = guarded.filter((i) => i.json.flagged);
  assert.deepEqual(flagged.map((i) => i.json.id), ['T-104']);
  assert.equal(flagged[0].json.body, '[withheld: untrusted content]', 'untrusted text is not passed on');
  assert.match(flagged[0].json.flagReason, /external-audit\.example/);
  const classified = await run('Classify and check target', guarded.filter((i) => !i.json.flagged));
  assert.deepEqual(classified.filter((i) => i.json.pastSla).map((i) => i.json.id), ['T-101', 'T-102']);
  assert.equal(classified.find((i) => i.json.id === 'T-103').json.intent, 'Escalation');
  const quarantined = flagged.map((i) => ({ json: { ...i.json, intent: 'Quarantined', attention: true } }));
  const prioritised = actions.map((i) => ({ json: { ...i.json, priority: i.json.status !== 'done' && i.json.due < i.json.today ? 'overdue' : 'other' } }));
  assert.equal(wf.nodes.find((n) => n.name === 'Overdue?').parameters.conditions.conditions[0].leftValue, "={{ $json.status !== 'done' && $json.due < $json.today }}");
  const [digest] = await run('Build digest', [...quarantined, ...classified, ...prioritised]);
  assert.equal(digest.json.mails, 4);
  assert.equal(digest.json.overdue, 2);
  assert.equal(digest.json.quarantined, 1);
  assert.equal(digest.json.attention, true);
});

test('sales workflow: injected text is quarantined, scores are transparent, routes and digest add up', async () => {
  const wf = load(FILES[2]);
  assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === 'sales-pipeline-digest'), 'callable through a webhook');
  const run = async (name, items, first = {}) => {
    const js = wf.nodes.find((n) => n.name === name).parameters.jsCode;
    return [...(await vm.runInNewContext(`(async()=>{${js}})`, { $input: { all: () => items, first: () => ({ json: first }) } })())];
  };
  const signals = await run('Sample signals', []);
  assert.equal(signals.length, 6);
  const given = await run('Sample signals', [], { body: { asOf: '2026-10-24', signals: [{ id: 'S-1', account: 'Acme', text: 'hi' }] } });
  assert.deepEqual(given.map((i) => [i.json.id, i.json.asOf]), [['S-1', '2026-10-24']], 'signals from the webhook body are used');
  const guarded = await run('Guardrail: untrusted text', signals);
  const flagged = guarded.filter((i) => i.json.flagged);
  assert.deepEqual(flagged.map((i) => i.json.id), ['INT-206']);
  assert.equal(flagged[0].json.text, '[withheld: untrusted content]', 'untrusted text is not passed on');
  const scored = await run('Score lead', guarded.filter((i) => !i.json.flagged));
  for (const { json } of scored) assert.equal(json.score, Object.values(json.parts).reduce((a, b) => a + b, 0), `${json.id}: the score is the sum of its parts`);
  const score = Object.fromEntries(scored.map((i) => [i.json.id, i.json.score]));
  assert.ok(score['INT-203'] >= 70 && score['INT-204'] >= 70, 'Muster expansion and Nordwind are opportunities');
  assert.ok(score['INT-201'] >= 40 && score['INT-201'] < 70, 'Kranich is nurtured');
  assert.ok(score['INT-202'] < 40 && score['INT-205'] < 40, 'weak signals are only watched');
  const route = (r) => (r >= 70 ? 'Opportunity: plan it' : r >= 40 ? 'Nurture: ask two questions' : 'Watch: no time yet');
  const routed = scored.map((i) => ({ json: { ...i.json, route: route(i.json.score) } }));
  const quarantined = flagged.map((i) => ({ json: { ...i.json, route: 'Quarantined', score: 0 } }));
  const [digest] = await run('Build digest', [...routed, ...quarantined]);
  assert.equal(digest.json.total, 6);
  assert.equal(digest.json.opportunity + digest.json.nurture + digest.json.watch + digest.json.quarantined, 6);
  assert.equal(digest.json.quarantined, 1);
  assert.equal(digest.json.topAccount, 'Muster Industrie AG');
  assert.match(digest.json.digest, /nothing is sent/i);
  assert.match(digest.json.digest, /^Pipeline digest, 2026-10-19:/);
  // the Switch thresholds in the workflow match the routes used here
  const rules = wf.nodes.find((n) => n.name === 'Route by score').parameters.rules.values;
  assert.deepEqual(rules.map((r) => [r.outputKey, r.conditions.conditions[0].operator.operation, r.conditions.conditions[0].rightValue]), [['opportunity', 'gte', 70], ['nurture', 'gte', 40], ['watch', 'lt', 40]]);
});

test('IT operations workflow: webhook and manual start, injected alert quarantined, priorities add up and route', async () => {
  const wf = load(FILES[3]);
  assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === 'it-ops-triage'), 'callable through a webhook');
  const run = async (name, items, first = {}) => {
    const js = wf.nodes.find((n) => n.name === name).parameters.jsCode;
    return [...(await vm.runInNewContext(`(async()=>{${js}})`, { $input: { all: () => items, first: () => ({ json: first }) } })())];
  };
  const alerts = await run('Alerts', []);
  assert.equal(alerts.length, 7);
  const custom = await run('Alerts', [], { body: { alerts: [{ id: 'X-1', service: 'S', severity: 'low', text: 'ok' }] } });
  assert.deepEqual(custom.map((i) => i.json.id), ['X-1'], 'alerts from the webhook body are used');
  const guarded = await run('Guardrail: untrusted text', alerts);
  assert.deepEqual(guarded.filter((i) => i.json.flagged).map((i) => i.json.id), ['A-507']);
  const ok = guarded.filter((i) => !i.json.flagged);
  const prio = await run('Priority', ok);
  const p = Object.fromEntries(prio.map((i) => [i.json.id, i.json.priority]));
  assert.ok(p['A-501'] >= 70 && p['A-502'] >= 70, 'customer facing critical alerts are P1');
  assert.ok(p['A-503'] >= 35 && p['A-503'] < 70 && p['A-504'] >= 35 && p['A-504'] < 70, 'P2');
  assert.ok(p['A-505'] < 35 && p['A-506'] < 35, 'P3');
  const route = (v) => (v >= 70 ? 'P1: page on-call (draft)' : v >= 35 ? 'P2: open a ticket (draft)' : 'P3: watch, no action');
  const routed = prio.map((i) => ({ json: { ...i.json, route: route(i.json.priority) } }));
  const quarantined = guarded.filter((i) => i.json.flagged).map((i) => ({ json: { ...i.json, route: 'Quarantined', priority: 0 } }));
  const [digest] = await run('Build digest', [...routed, ...quarantined]);
  assert.deepEqual({ ...digest.json.counts }, { p1: 2, p2: 2, p3: 2, quarantined: 1 });
  assert.match(digest.json.digest, /Nothing was paged/);
  const rules = wf.nodes.find((n) => n.name === 'Route by priority').parameters.rules.values;
  assert.deepEqual(rules.map((r) => [r.outputKey, r.conditions.conditions[0].operator.operation, r.conditions.conditions[0].rightValue]), [['p1', 'gte', 70], ['p2', 'gte', 35], ['p3', 'lt', 35]]);
});

test('approval workflow 07: roles, four-eyes rule, expiry and the prepared runbook calls', async () => {
  const wf = load('07-vm-maintenance-approval.json');
  assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.wait' && n.parameters.resume === 'webhook'), 'waits for the approver');
  assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === 'vm-maintenance-approval'));
  const js = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;
  const run = async (name, ctx) => JSON.parse(JSON.stringify(await vm.runInNewContext(`(async()=>{${js(name)}})`, ctx)()));
  const first = (json) => ({ first: () => ({ json }), all: () => [{ json }] });
  const [plan] = await run('Plan and requests', { $input: first({}) });
  assert.equal(plan.json.demo, true);
  assert.deepEqual(plan.json.requests.map((r) => [r.id, r.approver, r.urgency]), [
    ['AP-sap-prd-app01-patch', 'Change board', 'urgent'], ['AP-proxy-edge-01-cert', 'Security', 'urgent'], ['AP-proxy-edge-01-backup', 'Backup owner', 'planned'],
  ]);
  const evaluate = (planned, body) => run('Evaluate decisions', { $: () => ({ first: () => ({ json: planned }) }), $input: first({ body }) });
  const demo = await evaluate(plan.json, undefined);
  assert.deepEqual(demo.map((i) => i.json.status), ['approved', 'invalid', 'rejected']);
  assert.match(demo[1].json.reason, /four-eyes/);
  // live call: wrong role is invalid, no answer stays pending and expires later, nobody is approved automatically
  const live = { ...plan.json, demo: false, sampleDecisions: null };
  const wrongRole = await evaluate(live, { decisions: [{ id: 'AP-sap-prd-app01-patch', decision: 'approved', by: 'x', role: 'Security' }] });
  assert.deepEqual(wrongRole.map((i) => i.json.status), ['invalid', 'pending', 'pending']);
  const late = await evaluate({ ...live, now: '2026-11-30T00:00:00Z' }, { decisions: [] });
  assert.ok(late.every((i) => i.json.status === 'expired' && i.json.go === false));
  // release: only approved tasks become a runbook call with approved: true
  const [rel] = await run('Release to runbook', { $input: { all: () => demo } });
  assert.deepEqual(rel.json.released.map((c) => [c.vm, c.task, c.approved]), [['sap-prd-app01', 'patch', true]]);
  const [none] = await run('Release to runbook', { $input: { all: () => late } });
  assert.deepEqual(none.json.released, []);
  const [report] = await run('Approval report', { $: () => ({ all: () => demo }), $input: first(rel.json) });
  assert.deepEqual(report.json.counts, { requests: 3, approved: 1, rejected: 1, pending: 0, invalid: 1, expired: 0 });
  assert.match(report.json.digest, /Nothing was run by this workflow/);
});
