import assert from 'node:assert/strict';
import test from 'node:test';
import * as ap from '../src/agent-project.ts';
import * as dv from '../src/develop.ts';
import * as ws from '../src/work-sync.ts';
import { rollbackArgs, diffRevisions } from '../src/registry.ts';
import {
  MODES, POLICY_FILE, POLICY_FORMAT, deriveAgentPolicy, deriveWorkflowPolicy, diffPolicy, policyFile, policyGaps, policyOf, policySummary, revisionPolicy,
  sanitizePolicy, widens,
} from '../src/policy-manifest.ts';

const agent = (answers = {}) => ap.setAnswers(ap.newProject('Watch renewals and tell me which are at risk', 1000), { name: 'Renewal watch', ...answers }, 1000);
const flow = (intent = {}) => dv.changeIntent(dv.newProject('workflow', 500), { name: 'Notice check', goal: 'Warn owners', ...intent }, 600);
const change = (changes, field) => changes.find((c) => c.field === field);

// ---------- derive ----------

test('agent: read rights are read only, propose rights are draft only, a person always approves', () => {
  const r = deriveAgentPolicy(agent({ rights: 'read' }));
  assert.equal(r.mode, 'read-only');
  assert.equal(r.humanApproval, true);
  const d = deriveAgentPolicy(agent({ rights: 'propose' }));
  assert.equal(d.mode, 'draft');
  assert.ok(d.systems.every((s) => s.access === 'read'), 'an agent that only proposes never gets write access to a system');
});

test('agent: sources, step limit, sensitivity, trigger and owner come from the answers', () => {
  const m = deriveAgentPolicy(agent({ sources: ['s4', 'crm'], otherSystems: 'Icertis', volume: 'large', sensitivity: 'personal', trigger: 'daily', owner: 'Sam' }));
  assert.deepEqual(m.systems.map((s) => s.id), ['s4', 'crm', 'icertis']);
  assert.equal(m.limits.maxSteps, ap.VOLUME.find((v) => v.id === 'large').steps);
  assert.equal(m.data, 'personal');
  assert.deepEqual(m.run, { trigger: 'schedule', unattended: true });
  assert.equal(m.owner, 'Sam');
  assert.equal(deriveAgentPolicy(agent({ trigger: 'manual' })).run.unattended, false);
});

test('workflow: each guardrail maps to its mode, only the wider ones get write access', () => {
  dv.GUARDRAILS.forEach((g, i) => {
    const m = deriveWorkflowPolicy(flow({ guardrail: g, systems: ['SAP S/4HANA'] }));
    assert.equal(m.mode, MODES[i], g);
    assert.equal(m.systems[0].access, i >= 2 ? 'write' : 'read', g);
    assert.equal(m.humanApproval, i !== 3, g);
  });
});

test('workflow: an unrecognised guardrail falls back to draft only (the form default), a trigger text maps to its kind', () => {
  assert.equal(deriveWorkflowPolicy(flow({ guardrail: 'whatever the person typed' })).mode, 'draft');
  const kinds = dv.TRIGGERS.map((t) => deriveWorkflowPolicy(flow({ trigger: t })).run);
  assert.deepEqual(kinds, [
    { trigger: 'manual', unattended: false }, { trigger: 'schedule', unattended: true }, { trigger: 'event', unattended: true }, { trigger: 'chained', unattended: true },
  ]);
});

test('what the forms do not ask stays undeclared and is named as a gap, never filled in', () => {
  const m = deriveAgentPolicy(agent({ owner: 'Sam' }));
  assert.equal(m.tools, null);
  assert.equal(m.egressHosts, null);
  assert.deepEqual(policyGaps(m), ['tool allow-list', 'network targets']);
  assert.deepEqual(policyGaps(deriveWorkflowPolicy(flow())), ['tool allow-list', 'network targets', 'step limit', 'data sensitivity', 'owner']);
});

// ---------- read and write ----------

test('the file round-trips and the reader falls back to the narrowest value', () => {
  const m = deriveAgentPolicy(agent({ sources: ['s4'], trigger: 'daily', owner: 'Sam' }));
  assert.deepEqual(policyOf([policyFile(m)]), m);
  assert.equal(sanitizePolicy({ format: 'something.else' }), null);
  assert.equal(sanitizePolicy(null), null);
  const odd = sanitizePolicy({ format: POLICY_FORMAT, mode: 'god', systems: [{ id: 's', access: 'root' }, 'junk'], run: { trigger: 'weird' }, limits: { maxSteps: -3 }, data: 'secret', tools: 'x' });
  assert.equal(odd.mode, 'read-only');
  assert.deepEqual(odd.systems.map((s) => s.access), ['read']);
  assert.equal(odd.run.trigger, 'manual');
  assert.equal(odd.run.unattended, false);
  assert.equal(odd.limits.maxSteps, null);
  assert.equal(odd.data, 'unspecified');
  assert.equal(odd.tools, null);
  assert.equal(policyOf([{ path: POLICY_FILE, content: '{not json' }]), null);
  assert.equal(policyOf([{ path: 'project.json', content: '{}' }]), null);
});

test('summary for the item list', () => {
  const s = policySummary(deriveWorkflowPolicy(flow({ guardrail: dv.GUARDRAILS[2], systems: ['SAP S/4HANA'], trigger: dv.TRIGGERS[1] })));
  assert.deepEqual(s, { mode: 'act-after-approval', systems: 1, writes: true, unattended: true, gaps: 5 });
});

// ---------- differences ----------

const base = () => deriveWorkflowPolicy(flow({ guardrail: dv.GUARDRAILS[1], systems: ['SAP S/4HANA'] }));

test('nothing changed, nothing reported', () => assert.deepEqual(diffPolicy(base(), base()), []));

test('mode, systems and write access that grow are wider; the reverse is narrower', () => {
  const a = base();
  const wider = deriveWorkflowPolicy(flow({ guardrail: dv.GUARDRAILS[2], systems: ['SAP S/4HANA', 'Salesforce'] }));
  const up = diffPolicy(a, wider);
  assert.equal(change(up, 'mode').direction, 'wider');
  assert.equal(change(up, 'system:sap-s-4hana').direction, 'wider', 'read to write on an existing system');
  assert.equal(change(up, 'system:salesforce').from, 'no access');
  assert.equal(change(up, 'system:salesforce').direction, 'wider');
  assert.ok(widens(up));
  const down = diffPolicy(wider, a);
  assert.ok(down.every((c) => c.direction === 'narrower'));
  assert.ok(!widens(down));
});

test('approval removed, unattended runs, a higher or removed step limit are wider', () => {
  const a = deriveAgentPolicy(agent({ volume: 'small', trigger: 'manual' }));
  const b = { ...a, humanApproval: false, run: { trigger: 'schedule', unattended: true }, limits: { maxSteps: 20 } };
  const c = diffPolicy(a, b);
  assert.equal(change(c, 'humanApproval').direction, 'wider');
  assert.equal(change(c, 'unattended').direction, 'wider');
  assert.equal(change(c, 'trigger').direction, 'neutral');
  assert.equal(change(c, 'maxSteps').direction, 'wider');
  assert.equal(change(diffPolicy(a, { ...a, limits: { maxSteps: null } }), 'maxSteps').direction, 'wider');
  assert.equal(change(diffPolicy(a, { ...a, limits: { maxSteps: 4 } }), 'maxSteps').direction, 'narrower');
});

test('a declared tool or network list narrows "anything"; growing or dropping the list widens', () => {
  const a = base();
  assert.equal(change(diffPolicy(a, { ...a, tools: ['jira_get_issue'] }), 'tools').direction, 'narrower');
  assert.equal(change(diffPolicy({ ...a, tools: ['jira_get_issue'] }, { ...a, tools: ['jira_get_issue', 'jira_add_comment'] }), 'tools').direction, 'wider');
  assert.equal(change(diffPolicy({ ...a, tools: ['jira_get_issue', 'jira_add_comment'] }, { ...a, tools: ['jira_get_issue'] }), 'tools').direction, 'narrower');
  assert.equal(change(diffPolicy({ ...a, egressHosts: ['sandbox.api.sap.com'] }, { ...a, egressHosts: null }), 'egressHosts').direction, 'wider');
  assert.deepEqual(diffPolicy({ ...a, tools: ['x', 'y'] }, { ...a, tools: ['y', 'x'] }), [], 'order does not matter');
});

test('data class, owner and trigger changes are shown as neutral', () => {
  const a = deriveAgentPolicy(agent({ sensitivity: 'internal', owner: 'Sam' }));
  const c = diffPolicy(a, { ...a, data: 'personal', owner: 'Kim' });
  assert.deepEqual(c.map((x) => [x.field, x.direction]), [['data', 'neutral'], ['owner', 'neutral']]);
  assert.ok(!widens(c));
});

test('a revision without a manifest is neither "nothing allowed" nor "everything allowed"', () => {
  const m = policyFile(base());
  const none = revisionPolicy([m], [{ path: 'project.json', content: '{}' }]);
  assert.equal(none.policy, null);
  assert.match(none.note, /no policy manifest/);
  const first = revisionPolicy([{ path: 'project.json', content: '{}' }], [m]);
  assert.ok(first.policy);
  assert.deepEqual(first.changes, []);
  assert.match(first.note, /nothing to compare/);
  assert.equal(revisionPolicy([], [m]).note, '', 'the first revision has no earlier one to explain');
});

// ---------- in the sync and the registry ----------

test('every unit carries policy.json and a summary; the project hash does not depend on it', () => {
  const a = ws.agentUnit(agent({ rights: 'propose', trigger: 'daily' }));
  const f = a.files.find((x) => x.path === POLICY_FILE);
  assert.ok(f);
  assert.equal(policyOf(a.files).mode, 'draft');
  assert.equal(a.intent.policy.mode, 'draft');
  assert.equal(a.intent.policy.unattended, true);
  assert.equal(a.hash, ws.hashOf(a.files.find((x) => x.path === 'project.json').content), 'the hash still covers only the project, so no existing item is re-saved because of this change');
  const w = ws.developUnit(flow({ guardrail: dv.GUARDRAILS[3] }));
  assert.equal(policyOf(w.files).mode, 'autonomous');
  assert.equal(w.intent.policy.mode, 'autonomous');
  assert.equal(w.hash, ws.hashOf(w.files.find((x) => x.path === 'project.json').content));
});

test('the policy shown for a revision follows the rights that were declared in it', () => {
  const narrow = ws.developUnit(flow({ guardrail: dv.GUARDRAILS[1], systems: ['SAP S/4HANA'] }));
  const wide = ws.developUnit(flow({ guardrail: dv.GUARDRAILS[2], systems: ['SAP S/4HANA'] }));
  const r = revisionPolicy(narrow.files, wide.files);
  assert.equal(r.policy.mode, 'act-after-approval');
  assert.ok(widens(r.changes));
  assert.ok(diffRevisions(narrow.files, wide.files).some((d) => d.path === POLICY_FILE && d.status === 'changed'), 'it also shows up as an ordinary file difference');
});

test('restoring an old revision brings its policy back with it', () => {
  const old = ws.developUnit(flow({ guardrail: dv.GUARDRAILS[0], systems: ['SAP S/4HANA'] }));
  const args = rollbackArgs({ id: 'i1', kind: 'workflow', name: 'Notice check', currentRev: 4 }, old.files, 2);
  assert.equal(policyOf(args.files).mode, 'read-only');
  assert.equal(args.intent.policy.mode, 'read-only');
  assert.equal(args.note, 'Restored revision 2');
});

test('a registry item with a wider current revision is flagged when the history is read in order', () => {
  // The same walk the registry does for each revision: compare with the one before.
  const units = [dv.GUARDRAILS[0], dv.GUARDRAILS[1], dv.GUARDRAILS[1], dv.GUARDRAILS[3]].map((g) => ws.developUnit(flow({ guardrail: g, systems: ['SAP S/4HANA'] })));
  const flags = units.map((u, i) => widens(revisionPolicy(i ? units[i - 1].files : [], u.files).changes));
  assert.deepEqual(flags, [false, true, false, true]);
});
