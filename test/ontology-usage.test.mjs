import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyGovernance, exampleGovernance, exampleOntologies, mergeGovernance } from '../src/ontology-manager.ts';
import { extraExampleGovernance, extraExampleOntologies } from '../src/ontology-examples.ts';
import {
  CRITICAL, EXCERPT_CHARS, MAX_EVIDENCE, MAX_USAGES_PER_TERM, applyDecisions, declaredUsages, decide, fieldStrength, findUsages, mayApprove, norm, searchTerms,
  sourcesFromRegister, sourcesFromSkills, sourcesFromSpaces, summarize,
} from '../src/ontology-usage.ts';
import { exampleRegistry } from '../src/registry-examples.ts';

const term = (id, label, over = {}) => ({ id, label, kind: 'class', definition: '', formula: '', owner: '', members: [], membersKind: 'none', ...over });
const onto = (slug, terms) => ({ slug, title: slug, status: 'published', owner: '', domain: '', approver: '', properties: 0, openProposals: 0, example: false, terms, nodes: [], edges: [] });
const src = (kind, ref, name, fields, over = {}) => ({ kind, ref, name, owner: '', criticality: '', fields, ...over });
const gov = (termMeta = {}, bindings = []) => ({ ...emptyGovernance(), termMeta, bindings });
const T = (slug, id, label, synonyms = [], mappings = []) => ({ slug, id, label, synonyms, mappings });

test('norm folds case, umlauts, accents and sharp s and collapses white space', () => {
  assert.equal(norm('  Größe   DER Straße '), 'grosse der strasse');
  assert.equal(norm('Café Müller'), 'cafe muller');
  assert.equal(norm(null), '');
});

test('search terms carry the label, the synonyms and the names a term is mapped to', () => {
  const o = onto('fin', [term('CA', 'Contract asset')]);
  const g = gov({ 'fin|CA': { status: '', replacedBy: '', synonyms: ['unbilled revenue'], mappings: [{ system: 'IFRS 15', ref: 'Vertragsvermögenswert' }, { system: 'x', ref: '' }] } });
  assert.deepEqual(searchTerms([o], g), [{ slug: 'fin', id: 'CA', label: 'Contract asset', synonyms: ['unbilled revenue'], mappings: ['Vertragsvermögenswert'] }]);
});

test('a term is found by label, synonym and mapping, as a whole word, with the way it was found', () => {
  const t = T('fin', 'CA', 'Contract asset', ['unbilled revenue'], ['Vertragsvermögenswert']);
  const sources = [
    src('agent', 'a1', 'Closing agent', [{ field: 'relation.data', text: 'Contract asset schedule' }]),
    src('agent', 'a2', 'Billing agent', [{ field: 'relation.data', text: 'Unbilled   Revenue report' }]),
    src('agent', 'a3', 'DE agent', [{ field: 'relation.process', text: 'Ermittlung des Vertragsvermögenswert' }]),
    src('agent', 'a4', 'Other agent', [{ field: 'relation.data', text: 'Contract assets in the ledger' }]),
    src('agent', 'a5', 'Nope', [{ field: 'relation.data', text: 'Contract assetstock' }, { field: 'name', text: 'Contractasset' }]),
  ];
  const { usages } = findUsages([t], sources);
  const by = Object.fromEntries(usages.map((u) => [u.ref, u]));
  assert.equal(by.a1.evidence[0].via, 'label');
  assert.equal(by.a2.evidence[0].via, 'synonym');
  assert.equal(by.a3.evidence[0].via, 'mapping');
  assert.ok(by.a4, 'a plural still counts');
  assert.equal(by.a5, undefined, 'no word boundary, no hit');
  assert.ok(usages.every((u) => u.state === 'suspected'), 'found usages are only suspected');
  assert.equal(by.a1.key, 'fin|CA|agent:a1');
});

test('field strength: data and process relations are strong, purpose and text are weak; a usage takes its best evidence', () => {
  assert.equal(fieldStrength('relation.data'), 'strong');
  assert.equal(fieldStrength('relation.process'), 'strong');
  assert.equal(fieldStrength('tag'), 'medium');
  assert.equal(fieldStrength('relation.capability'), 'medium');
  assert.equal(fieldStrength('purpose'), 'weak');
  assert.equal(fieldStrength('body'), 'weak');
  const t = T('fin', 'CL', 'Contract liability');
  const { usages } = findUsages([t], [
    src('workflow', 'w1', 'W1', [{ field: 'purpose', text: 'Books the contract liability' }, { field: 'relation.data', text: 'Contract liability ledger' }]),
    src('workflow', 'w2', 'W2', [{ field: 'purpose', text: 'Books the contract liability' }]),
  ]);
  const by = Object.fromEntries(usages.map((u) => [u.ref, u]));
  assert.equal(by.w1.strength, 'strong');
  assert.equal(by.w1.evidence[0].field, 'relation.data', 'strongest evidence first');
  assert.equal(by.w2.strength, 'weak');
  assert.deepEqual(usages.map((u) => u.ref), ['w1', 'w2'], 'strong before weak');
});

test('generic and very short names count only in strong fields', () => {
  const generic = T('x', 'O', 'Order');
  const short = T('x', 'V', 'VAT');
  const { usages } = findUsages([generic, short], [
    src('agent', 'a', 'A', [{ field: 'purpose', text: 'Checks every order and the VAT' }]),
    src('agent', 'b', 'B', [{ field: 'relation.data', text: 'Order' }, { field: 'relation.data', text: 'VAT' }]),
  ]);
  assert.deepEqual(usages.map((u) => `${u.term}:${u.ref}`).sort(), ['O:b', 'V:b']);
});

test('the excerpt comes from the original text, keeps its case, stays short and marks the cut', () => {
  const long = `${'Vorspann '.repeat(30)}Die Größe der Contract Liability wird hier erklärt${' Nachspann'.repeat(30)}`;
  const { usages } = findUsages([T('fin', 'CL', 'Contract liability')], [src('skill', 's', 'S', [{ field: 'body', text: long }])]);
  const ex = usages[0].evidence[0].excerpt;
  assert.ok(ex.includes('Contract Liability'), 'original case');
  assert.ok(ex.length <= EXCERPT_CHARS + 2, `short enough (${ex.length})`);
  assert.ok(ex.startsWith('…') && ex.endsWith('…'));
  // a hit after ß and umlauts is cut at the right place
  const odd = findUsages([T('x', 'C', 'Kunde Straße')], [src('space', 'p', 'P', [{ field: 'relation.data', text: 'Größe: Kunde Straße im Feld' }])]).usages[0];
  assert.equal(odd.evidence[0].excerpt, 'Größe: Kunde Straße im Feld');
});

test('at most three places of evidence per usage', () => {
  const t = T('fin', 'CA', 'Contract asset');
  const fields = ['relation.data', 'relation.process', 'tag', 'name', 'purpose'].map((field) => ({ field, text: 'Contract asset' }));
  const u = findUsages([t], [src('agent', 'a', 'A', fields)]).usages[0];
  assert.equal(u.evidence.length, MAX_EVIDENCE);
  assert.deepEqual(u.evidence.map((e) => e.strength), ['strong', 'strong', 'medium']);
});

test('a phrase that belongs to terms of two ontologies is marked ambiguous', () => {
  const { usages } = findUsages([T('sales', 'C', 'Customer'), T('billing', 'C', 'Customer'), T('sales', 'Q', 'Quote')], [src('agent', 'a', 'A', [{ field: 'relation.data', text: 'Customer and Quote' }])]);
  const by = Object.fromEntries(usages.map((u) => [`${u.slug}|${u.term}`, u]));
  assert.equal(by['sales|C'].ambiguous, true);
  assert.equal(by['billing|C'].ambiguous, true);
  assert.equal(by['sales|Q'].ambiguous, false);
});

test('more than the limit per term are cut, strongest first, and the term is named', () => {
  const sources = Array.from({ length: MAX_USAGES_PER_TERM + 5 }, (_, i) => src('space', `s${String(i).padStart(3, '0')}`, `Space ${i}`, [{ field: i < 3 ? 'relation.data' : 'purpose', text: 'Contract asset' }]));
  const { usages, capped } = findUsages([T('fin', 'CA', 'Contract asset')], sources);
  assert.equal(usages.length, MAX_USAGES_PER_TERM);
  assert.deepEqual(capped, ['fin|CA']);
  assert.deepEqual(usages.slice(0, 3).map((u) => u.strength), ['strong', 'strong', 'strong']);
  assert.deepEqual(findUsages([T('fin', 'CA', 'Contract asset')], []), { usages: [], capped: [] });
});

test('people decide: confirmed becomes confirmed, dismissed disappears and is counted, declared wins, a decision can be taken back', () => {
  const t = T('fin', 'CA', 'Contract asset');
  const { usages } = findUsages([t], [
    src('agent', 'a1', 'Closing agent', [{ field: 'relation.data', text: 'Contract asset' }], { owner: 'Lena', criticality: 'critical' }),
    src('agent', 'a2', 'Billing agent', [{ field: 'relation.data', text: 'Contract asset' }]),
    src('skill', 's1', 'board-briefing', [{ field: 'body', text: 'Contract asset' }]),
  ]);
  const g = gov({}, [{ slug: 'fin', term: 'CA', kind: 'agent', name: 'closing  AGENT' }]);
  let dec = decide({}, 'fin|CA|agent:a2', 'confirmed', ' lena@example.com ', Date.UTC(2026, 10, 13));
  dec = decide(dec, 'fin|CA|skill:s1', 'dismissed', 'lena', 0);
  const out = applyDecisions(usages, declaredUsages(g), dec);
  const by = Object.fromEntries(out.usages.map((u) => [u.name, u]));
  assert.equal(out.dismissed, 1);
  assert.equal(by['board-briefing'], undefined);
  assert.equal(by['Billing agent'].state, 'confirmed');
  assert.equal(by['closing  AGENT'].state, 'declared', 'the declared usage wins over the found one with the same name');
  assert.equal(by['closing  AGENT'].owner, 'Lena', 'and keeps what the finder learned');
  assert.equal(by['closing  AGENT'].criticality, 'critical');
  assert.equal(out.usages.length, 2);
  assert.equal(dec['fin|CA|agent:a2'].by, 'lena@example.com');
  assert.equal(dec['fin|CA|agent:a2'].at, '2026-11-13T00:00:00.000Z');
  assert.equal(decide(dec, 'fin|CA|agent:a2', 'confirmed', 'lena', 1)['fin|CA|agent:a2'], undefined, 'the same decision again takes it back');
  assert.deepEqual(decide({}, 'k', 'confirmed', 'x', 0).k.decision, 'confirmed');
});

test('summary counts, owners and the critical users that are still only suspected', () => {
  const t = T('fin', 'CA', 'Contract asset');
  const { usages } = findUsages([t], [
    src('agent', 'a1', 'Closing agent', [{ field: 'relation.data', text: 'Contract asset' }], { owner: 'Lena', criticality: 'mission-critical' }),
    src('workflow', 'w1', 'Accrual flow', [{ field: 'purpose', text: 'Contract asset' }], { owner: 'Jonas', criticality: 'operational' }),
    src('space', 'p1', 'Space', [{ field: 'body', text: 'Contract asset' }]),
  ]);
  const s = summarize(applyDecisions(usages, [], {}));
  assert.equal(s.total, 3);
  assert.equal(s.suspected, 3);
  assert.equal(s.confirmed, 0);
  assert.equal(s.weak, 2);
  assert.deepEqual(s.owners, ['Jonas', 'Lena']);
  assert.deepEqual(s.openCritical.map((u) => u.name), ['Closing agent']);
  assert.deepEqual(s.byKind, { agent: 1, workflow: 1, space: 1 });
  const done = summarize(applyDecisions(usages, [], { 'fin|CA|agent:a1': { decision: 'confirmed', by: 'Lena', at: '' } }));
  assert.equal(done.openCritical.length, 0, 'once confirmed it is no longer open');
  assert.equal(done.confirmed, 1);
  assert.ok(CRITICAL.has('critical') && !CRITICAL.has('operational'));
});

test('approval: only the approver, never an AI actor, not while a critical user is still only suspected', () => {
  const open = { ...summarize({ usages: [], dismissed: 0 }), openCritical: [{ name: 'Closing agent' }] };
  const clear = summarize({ usages: [], dismissed: 0 });
  const ask = (over) => mayApprove({ approver: 'jonas@example.com', actor: 'jonas@example.com', actorIsAgent: false, summary: clear, ...over });
  assert.deepEqual(ask({}), { allowed: true, reason: '' });
  assert.equal(ask({ actor: 'JONAS@example.com ' }).allowed, true, 'the label is compared without case and spaces');
  assert.match(ask({ actorIsAgent: true }).reason, /AI actor/);
  assert.match(ask({ actor: 'lena@example.com' }).reason, /Only the approver \(jonas@example.com\)/);
  assert.match(ask({ approver: '  ' }).reason, /No approver/);
  assert.match(ask({ summary: open }).reason, /1 critical user is still only suspected \(Closing agent\)/);
  assert.equal(ask({ summary: open, settings: { blockOnCritical: false } }).allowed, true, 'the rule can be switched off');
  assert.equal(ask({ actorIsAgent: true, actor: 'jonas@example.com', settings: { blockOnCritical: false } }).allowed, false, 'switching the rule off never lets an agent approve');
});

test('sources: registry cards, skills and spaces become plain text fields; archived and code items are left out', () => {
  const card = { purpose: 'Books accruals', steward: 'Lena', criticality: 'critical', tags: ['Finance'], relations: [{ kind: 'data', name: 'Contract asset', access: 'read' }, { kind: 'mcp', name: 'ledger' }, { kind: 'process', name: 'Close' }] };
  const items = [
    { id: 'i1', type: 'agent', name: 'Closer', owner: 'Hans', archived: false, card },
    { id: 'i2', type: 'workflow', name: 'No card', owner: 'Hans', archived: false, card: null },
    { id: 'i3', type: 'agent', name: 'Old', owner: 'Hans', archived: true, card },
    { id: 'i4', type: 'code', name: 'Code', owner: 'Hans', archived: false, card },
  ];
  const regs = sourcesFromRegister(items);
  assert.deepEqual(regs.map((s) => s.ref), ['i1', 'i2']);
  assert.equal(regs[0].owner, 'Lena', 'the steward of the card, else the owner');
  assert.equal(regs[1].owner, 'Hans');
  assert.equal(regs[0].criticality, 'critical');
  assert.deepEqual(regs[0].fields.map((f) => f.field), ['name', 'purpose', 'tag', 'relation.data', 'relation.other', 'relation.process']);
  assert.deepEqual(regs[1].fields.map((f) => f.field), ['name']);
  const skills = sourcesFromSkills([{ name: 'board-briefing', description: 'A briefing', dir: 'd1' }, { name: 'x', description: '', dir: 'd2' }], { d1: 'Uses the contract asset' });
  assert.deepEqual(skills[0].fields.map((f) => f.field), ['name', 'purpose', 'body']);
  assert.deepEqual(skills[1].fields.map((f) => f.field), ['name']);
  const spaces = sourcesFromSpaces([{ slug: 'rr', title: 'Revenue Recognition', description: 'Contracts', insights: ['One', '', 'Two'] }], { rr: 'page text' });
  assert.deepEqual(spaces[0].fields.map((f) => f.field), ['name', 'purpose', 'body', 'body', 'body']);
  assert.equal(spaces[0].kind, 'space');
});

test('probe on the bundled example data: the example registry and the example ontologies run through without error, and Contract asset is found where it is written', () => {
  const ontologies = [...exampleOntologies(), ...extraExampleOntologies()];
  const terms = searchTerms(ontologies, mergeGovernance(exampleGovernance(), extraExampleGovernance()));
  assert.ok(terms.some((t) => t.label === 'Contract asset' && t.synonyms.includes('unbilled revenue')));
  const registry = sourcesFromRegister(exampleRegistry().items);
  const { usages } = findUsages(terms, registry);
  assert.ok(Array.isArray(usages));
  for (const u of usages) { assert.ok(u.evidence.length >= 1 && u.evidence.length <= MAX_EVIDENCE); assert.ok(u.key.startsWith(`${u.slug}|${u.term}|${u.kind}:`)); }
  const synthetic = findUsages(terms, [src('agent', 'x', 'Probe', [{ field: 'relation.data', text: 'Unbilled revenue per contract' }])]).usages;
  assert.ok(synthetic.some((u) => u.term === 'ContractAsset'), 'found by the synonym of the example data');
});

test('a single everyday word is searched in relations, tags and names, not in running text; a phrase of two words is searched everywhere', () => {
  const one = T('x', 'C', 'Customer');
  const two = T('x', 'CA', 'Contract asset');
  const { usages } = findUsages([one, two], [
    src('space', 'prose', 'Prose', [{ field: 'body', text: 'The customer sees the contract asset in the app' }, { field: 'purpose', text: 'Customer facing' }]),
    src('agent', 'tag', 'Tagged', [{ field: 'tag', text: 'Customer' }]),
  ]);
  assert.deepEqual(usages.map((u) => `${u.term}:${u.ref}`).sort(), ['C:tag', 'CA:prose']);
  assert.equal(usages.find((u) => u.term === 'C').strength, 'medium');
});

// ---------------------------------------------------------------- step 3: the plan, the approval

import { approvalRecord, approvePlan, approverMatches, ownerNotes, questionsAtRisk, setUsageDecision } from '../src/ontology-usage.ts';
import { normalizeGovernance } from '../electron/ontology-store.mjs';

const found = (over = {}) => {
  const { usages } = findUsages([T('fin', 'CA', 'Contract asset')], [
    src('agent', 'a1', 'Closing agent', [{ field: 'relation.data', text: 'Contract asset' }], { owner: 'Lena', criticality: 'critical' }),
    src('workflow', 'w1', 'Accrual flow', [{ field: 'relation.process', text: 'Contract asset' }], { owner: 'Lena' }),
    src('space', 'p1', 'Revenue Recognition', [{ field: 'body', text: 'The contract asset grows' }]),
  ]);
  return applyDecisions(usages, [], over);
};
const planGov = (extra = {}) => ({ ...emptyGovernance(), plans: [{ id: 'p1', slug: 'fin', term: 'CA', change: 'Rename to Contract liability', status: 'asked', createdAt: '2026-11-13T00:00:00.000Z', asked: [] }], questions: [{ id: 'q1', slug: 'fin', text: 'Which contract assets are unbilled?', terms: ['CA', 'X'] }, { id: 'q2', slug: 'fin', text: 'Other?', terms: ['Y'] }], ...extra });

test('the approver field may hold several names or e-mails; the actor is compared as a label', () => {
  assert.equal(approverMatches('Head of Revenue, jonas@example.com; lena@example.com', ' JONAS@example.com '), true);
  assert.equal(approverMatches('Group Controlling', 'jonas@example.com'), false);
  assert.equal(approverMatches('jonas@example.com', ''), false);
  assert.equal(approverMatches('', 'jonas@example.com'), false);
});

test('approval needs an identity, the approver, a search of the users, and no critical user that is only suspected', () => {
  const clear = summarize(found());
  const ask = (over) => mayApprove({ approver: 'jonas@example.com', actor: 'jonas@example.com', actorIsAgent: false, summary: clear, searched: true, ...over });
  assert.equal(ask({ summary: summarize({ usages: [], dismissed: 0 }) }).allowed, true);
  assert.match(ask({ actor: '' }).reason, /no identity/);
  assert.match(ask({ actor: 'lena@example.com' }).reason, /acts as lena@example.com/);
  assert.match(ask({ searched: false, summary: summarize({ usages: [], dismissed: 0 }) }).reason, /Find the probable users first/);
  assert.equal(ask({ searched: false, summary: summarize({ usages: [], dismissed: 0 }), settings: { requireSearch: false } }).allowed, true);
  assert.match(ask({}).reason, /1 critical user is still only suspected \(Closing agent\)/, 'the critical agent of the sample blocks');
  assert.equal(ask({ summary: summarize(found({ 'fin|CA|agent:a1': { decision: 'confirmed', by: 'x', at: '' } })) }).allowed, true, 'confirmed, it no longer blocks');
  assert.equal(ask({ summary: summarize(found({ 'fin|CA|agent:a1': { decision: 'dismissed', by: 'x', at: '' } })) }).allowed, true, 'dismissed, it no longer blocks');
});

test('competency questions that name the term are listed as depending on it', () => {
  assert.deepEqual(questionsAtRisk(planGov(), 'fin', 'CA').map((q) => q.id), ['q1']);
  assert.deepEqual(questionsAtRisk(planGov(), 'other', 'CA'), []);
});

test('the record keeps what the approver saw, with the same limits as the store', () => {
  const decided = found({ 'fin|CA|agent:a1': { decision: 'confirmed', by: 'x', at: '' } });
  const rec = approvalRecord(decided, summarize(decided), questionsAtRisk(planGov(), 'fin', 'CA'), ' jonas@example.com ', Date.UTC(2026, 10, 13));
  assert.equal(rec.by, 'jonas@example.com');
  assert.equal(rec.at, '2026-11-13T00:00:00.000Z');
  assert.equal(rec.users.length, 3);
  assert.deepEqual(rec.users.map((u) => u.state).sort(), ['confirmed', 'suspected', 'suspected']);
  assert.deepEqual(rec.owners, ['Lena']);
  assert.deepEqual(rec.questions, ['Which contract assets are unbilled?']);
  assert.equal(rec.confirmed, 1);
  const many = Array.from({ length: 80 }, (_, i) => ({ ...decided.usages[0], key: `k${i}`, name: `U${i}` }));
  assert.equal(approvalRecord({ usages: many, dismissed: 0 }, summarize({ usages: many, dismissed: 0 }), [], 'x', 0).users.length, 50);
});

test('one draft per owner, only their users, nothing sent; users without an owner are grouped last', () => {
  const notes = ownerNotes({ termLabel: 'Contract asset', ontologyTitle: 'Finance', slug: 'fin', change: ' Rename to Contract liability ', approver: 'jonas@example.com', usages: found().usages });
  assert.deepEqual(notes.map((n) => n.owner), ['Lena', 'No owner named']);
  assert.match(notes[0].text, /Proposed change to "Contract asset" in Finance \(fin\):\nRename to Contract liability/);
  assert.match(notes[0].text, /Your users of this term that this reaches:\n- Accrual flow \(workflow, suspected, please confirm or correct\)\n- Closing agent \(agent, suspected/);
  assert.doesNotMatch(notes[0].text, /Revenue Recognition/, 'only the users of this owner');
  assert.match(notes[1].text, /This user of this term that this reaches:/, 'one user without an owner reads correctly');
  assert.match(notes[1].text, /- Revenue Recognition \(space, suspected/);
  assert.match(notes[0].text, /Approver for this ontology: jonas@example.com\./);
});

test('approving a plan: allowed once, refused with the reason otherwise, and what the approver saw stays on the plan', () => {
  const decided = found({ 'fin|CA|agent:a1': { decision: 'confirmed', by: 'x', at: '' } });
  const args = { actor: 'jonas@example.com', actorIsAgent: false, approver: 'jonas@example.com', decided, summary: summarize(decided), searched: true, now: Date.UTC(2026, 10, 13) };
  const gov = planGov();
  const ok = approvePlan(gov, 'p1', args);
  assert.equal(ok.check.allowed, true);
  assert.equal(ok.gov.plans[0].status, 'approved');
  assert.equal(ok.gov.plans[0].approval.by, 'jonas@example.com');
  assert.equal(gov.plans[0].status, 'asked', 'the old governance is not changed');
  assert.equal(approvePlan(ok.gov, 'p1', args).check.reason, 'This plan is already approved.');
  assert.equal(approvePlan(gov, 'nope', args).check.reason, 'There is no such plan.');
  for (const [over, re] of [[{ actorIsAgent: true }, /AI actor/], [{ actor: 'lena@example.com' }, /Only the approver/], [{ searched: false }, /Find the probable users/], [{ summary: summarize(found()), decided: found() }, /critical user/]]) {
    const r = approvePlan(gov, 'p1', { ...args, ...over });
    assert.equal(r.gov, gov, 'refused: the governance is returned as it was');
    assert.match(r.check.reason, re);
  }
  // the store keeps the record, clips it, and drops it from a plan that is not approved
  const stored = normalizeGovernance(JSON.parse(JSON.stringify(ok.gov)));
  assert.deepEqual(stored.plans[0].approval, ok.gov.plans[0].approval);
  const forged = JSON.parse(JSON.stringify(gov)); forged.plans[0].approval = { by: 'x', at: '', users: [], confirmed: 1, suspected: 0, dismissed: 0, owners: [], questions: [] };
  assert.equal(normalizeGovernance(forged).plans[0].approval, undefined, 'a plan that is not approved carries no approval record');
});

test('a decision can remember the name of the user; the store keeps it', () => {
  const g = setUsageDecision(emptyGovernance(), 'fin|CA|agent:a1', 'confirmed', 'jonas@example.com', 0, ' Closing agent ');
  assert.equal(g.usageDecisions['fin|CA|agent:a1'].name, 'Closing agent');
  assert.equal(normalizeGovernance(JSON.parse(JSON.stringify(g))).usageDecisions['fin|CA|agent:a1'].name, 'Closing agent');
  assert.equal(setUsageDecision(emptyGovernance(), 'fin|CA|agent:a1', 'confirmed', 'x', 0).usageDecisions['fin|CA|agent:a1'].name, undefined);
});
