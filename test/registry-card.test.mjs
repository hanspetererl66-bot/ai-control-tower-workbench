import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CRITICALITY, FLAGS, PHASES, RISK, UNDERUSED_RUNS, VERIFICATION, cardWords, euro, flagsOf, phaseOf, policyBriefOf, profileOf, sanitizeCard, sanitizeTelemetry, similarItems, summarize,
} from '../src/registry-card.ts';
import { EXAMPLE_PREFIX, exampleRegistry, isExampleId } from '../src/registry-examples.ts';
import { filterItems, itemFrom, noFilter } from '../src/registry.ts';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const { items, history } = exampleRegistry();
const byId = (id) => items.find((i) => i.id === id);
const flagIds = (id, now = NOW) => flagsOf(byId(id), items, now).map((f) => f.id);

test('sanitizeCard: unknown values fall back to "not declared" or the least favourable value, never to a better one', () => {
  assert.equal(sanitizeCard(null), null);
  assert.equal(sanitizeCard([]), null);
  assert.equal(sanitizeCard('x'), null);
  const c = sanitizeCard({ phase: 'launched', criticality: 'vital', verification: 'great', risk: 'none', discovery: 'guessed', dates: { active: '2026-13-45', plan: '2026-05-01', 'phase-in': 'soon' }, verifiedAt: 'yesterday', reviewDue: '2026-12-01' });
  assert.equal(c.phase, null);
  assert.equal(c.criticality, null);
  assert.equal(c.verification, 'unverified');
  assert.equal(c.risk, 'not-assessed');
  assert.equal(c.discovery, 'built');
  assert.deepEqual(c.dates, { plan: '2026-05-01' }, 'only real calendar days are kept');
  assert.equal(c.verifiedAt, '');
  assert.equal(c.reviewDue, '2026-12-01');
});

test('sanitizeCard: relations, tags and text are cut to size and bad rows are dropped', () => {
  const c = sanitizeCard({
    purpose: 'x'.repeat(500), tags: ['a', '', 'b'.repeat(80), ...Array.from({ length: 20 }, (_, i) => `t${i}`)],
    relations: [{ kind: 'system', name: 'SAP', access: 'write', note: 'drafts' }, { kind: 'planet', name: 'Mars' }, { kind: 'data', name: '' }, { kind: 'model', name: 'M', access: 'root' }, null],
  });
  assert.equal(c.purpose.length, 300);
  assert.equal(c.tags.length, 12);
  assert.ok(c.tags.every((t) => t.length <= 30));
  assert.deepEqual(c.relations, [{ kind: 'system', name: 'SAP', access: 'write', note: 'drafts' }, { kind: 'model', name: 'M' }]);
});

test('sanitizeTelemetry: numbers only, success rate capped at 100, missing stays null (not 0)', () => {
  assert.deepEqual(sanitizeTelemetry({ runs30: '12', successPct: 140, users30: -3, costEur: 'a lot', valueEur: null, lastRun: '2026-11-01' }), { runs30: 12, successPct: 100, users30: null, costEur: null, valueEur: null, lastRun: '2026-11-01' });
  assert.deepEqual(sanitizeTelemetry(undefined), { runs30: null, successPct: null, users30: null, costEur: null, valueEur: null, lastRun: '' });
  assert.equal(sanitizeTelemetry({ runs30: 0 }).runs30, 0, 'zero runs is a measurement, not a gap');
});

test('policyBriefOf: needs a known mode, the rest is cleaned', () => {
  assert.equal(policyBriefOf({ systems: 2 }), null);
  assert.equal(policyBriefOf(null), null);
  assert.deepEqual(policyBriefOf({ mode: 'draft', systems: 2, writes: true, unattended: 'yes', gaps: 3 }), { mode: 'draft', systems: 2, writes: true, unattended: false, gaps: 3 });
});

test('itemFrom reads the card from intent.register and the policy summary from intent.policy', () => {
  const row = { id: 'i1', kind: 'agent', name: 'A', owner: 'a@b.de', visibility: 'private', current_rev: 1, updated_at: '2026-11-03T10:00:00Z', files: 1 };
  const i = itemFrom(row, { intent: { register: { criticality: 'critical', risk: 'high' }, policy: { mode: 'read-only', systems: 1, writes: false, unattended: false, gaps: 2 } } });
  assert.equal(i.card.criticality, 'critical');
  assert.equal(i.card.risk, 'high');
  assert.equal(i.policy.mode, 'read-only');
  const plain = itemFrom(row, { intent: {} });
  assert.equal(plain.card, null);
  assert.equal(plain.policy, null);
  assert.equal(itemFrom(row).card, null, 'without detail there is no card');
});

test('phaseOf: a declared phase wins; otherwise it is derived from the steps, and agents are never derived as active', () => {
  const base = { id: 'x', name: 'X', owner: 'o', archived: false, approved: [], stage: '', card: null, policy: null };
  assert.deepEqual(phaseOf({ ...base, type: 'workflow', card: sanitizeCard({ phase: 'phase-out' }), approved: ['test'] }), { phase: 'phase-out', source: 'declared' });
  assert.deepEqual(phaseOf({ ...base, type: 'agent', archived: true }), { phase: 'end-of-life', source: 'derived' });
  assert.deepEqual(phaseOf({ ...base, type: 'agent', approved: ['questions', 'prd'] }), { phase: 'plan', source: 'derived' });
  assert.deepEqual(phaseOf({ ...base, type: 'agent', approved: ['questions', 'prd', 'tfd', 'arch', 'risk', 'build', 'test'] }), { phase: 'phase-in', source: 'derived' }, '"live" is read from the Studio and not saved, so it is not guessed');
  assert.deepEqual(phaseOf({ ...base, type: 'workflow', stage: 'build', approved: ['intent'] }), { phase: 'phase-in', source: 'derived' });
  assert.deepEqual(phaseOf({ ...base, type: 'workflow', stage: 'test', approved: ['intent', 'requirements', 'specification', 'build', 'test'] }), { phase: 'active', source: 'derived' });
  assert.deepEqual(phaseOf({ ...base, type: 'code' }), { phase: null, source: 'none' });
});

test('the example register: unique ids, example prefix, revisions match the history, every card is already in its cleaned form', () => {
  assert.equal(items.length, 19);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  assert.ok(items.every((i) => i.id.startsWith(EXAMPLE_PREFIX) && isExampleId(i.id)));
  assert.equal(isExampleId('abc'), false);
  for (const i of items) {
    assert.equal(i.rev, history[i.id].length, `${i.name}: rev`);
    assert.equal(history[i.id][0].rev, i.rev, `${i.name}: newest revision first`);
    assert.equal(history[i.id][0].at, i.updatedAt, `${i.name}: changed = newest revision`);
    assert.deepEqual(sanitizeCard(i.card), i.card, `${i.name}: card survives the reader unchanged`);
  }
  assert.deepEqual(items.map((i) => i.updatedAt), [...items.map((i) => i.updatedAt)].sort((a, b) => b - a), 'newest change first');
  assert.ok(items.every((i) => i.owner === '' || i.owner.endsWith('@example.com')), 'invented people only');
});

test('the example register covers every phase, criticality, verification state, risk class and each type', () => {
  const sol = items.filter((i) => i.type === 'agent' || i.type === 'workflow');
  assert.deepEqual([...new Set(items.map((i) => i.card.phase))].sort(), [...PHASES].sort());
  assert.deepEqual([...new Set(sol.map((i) => i.card.criticality).filter(Boolean))].sort(), [...CRITICALITY].sort());
  assert.deepEqual([...new Set(items.map((i) => i.card.verification))].sort(), [...VERIFICATION].sort());
  assert.deepEqual([...new Set(items.map((i) => i.card.risk))].sort(), [...RISK].sort());
  assert.deepEqual([...new Set(items.map((i) => i.type))].sort(), ['agent', 'code', 'feature', 'workflow']);
  assert.equal(items.filter((i) => i.archived).length, 1);
  assert.ok(sol.every((i) => i.card.relations.some((r) => r.kind === 'capability' || r.kind === 'process')), 'every solution names what it is for');
});

test('flags at a fixed date: each rule fires where it should and nowhere else', () => {
  assert.deepEqual(flagIds('ex-margin-analyst'), []);
  assert.deepEqual(flagIds('ex-preclose'), []);
  assert.deepEqual(flagIds('ex-po-watcher'), ['review-overdue', 'verification-open', 'overlaps']);
  assert.deepEqual(flagIds('ex-supplier-scout'), ['verification-open', 'risk-not-assessed', 'underused', 'overlaps']);
  assert.deepEqual(flagIds('ex-renewal-watcher'), ['no-owner', 'verification-open', 'risk-not-assessed']);
  assert.deepEqual(flagIds('ex-cv-prescreen'), ['high-risk-autonomous'], 'only the nightly run without a person; not yet in use, so no verification flags');
  assert.deepEqual(flagIds('ex-hiring-shortlist'), [], 'high risk is fine while a person decides');
  assert.deepEqual(flagIds('ex-abap-doc'), [], 'still being built');
  assert.deepEqual(flagIds('ex-vm-maintenance'), ['review-overdue', 'verification-open']);
  assert.deepEqual(flagIds('ex-sales-report-legacy'), ['verification-open', 'overlaps'], 'a phased-out item still counts while it is in use');
  assert.deepEqual(flagIds('ex-sales-briefing'), ['overlaps']);
  assert.deepEqual(flagIds('ex-monday-close'), [], 'a weekly job that twelve people read is not underused');
  assert.deepEqual(flagIds('ex-slack-digest'), [], 'archived items are not judged');
  assert.deepEqual(flagIds('ex-feat-teams'), [], 'features and code are not judged');
  assert.deepEqual(flagIds('ex-code-tabpfn'), []);
  assert.ok(items.every((i) => flagsOf(i, items, NOW).every((f) => FLAGS.includes(f.id) && f.label && f.why)));
});

test('review dates age with the clock', () => {
  const early = Date.parse('2026-10-01T00:00:00Z');
  assert.ok(!flagIds('ex-po-watcher', early).includes('review-overdue'), 'not yet due on 1 Oct');
  assert.ok(!flagIds('ex-vm-maintenance', early).includes('review-overdue'));
  assert.ok(flagIds('ex-po-watcher', Date.parse('2026-10-21T12:00:00Z')).includes('review-overdue'), 'the day after the due date');
  assert.ok(!flagIds('ex-po-watcher', Date.parse('2026-10-20T12:00:00Z')).includes('review-overdue'), 'on the due date itself it is not overdue');
});

test('flags need a card: an in-use item without one is "not verified" and "risk not assessed", not silently fine', () => {
  const bare = { id: 'b', type: 'workflow', name: 'Bare', owner: 'a@b.de', stage: 'test', archived: false, approved: ['test'], card: null, policy: null };
  assert.deepEqual(flagsOf(bare, [bare], NOW).map((f) => f.id), ['verification-open', 'risk-not-assessed']);
  const p = profileOf(bare, [bare], NOW);
  assert.equal(p.phase, 'active');
  assert.equal(p.phaseSource, 'derived');
  assert.equal(p.criticality, null);
  assert.equal(p.verification, 'unverified');
  assert.equal(p.risk, 'not-assessed');
  assert.deepEqual(flagsOf({ ...bare, owner: '  ' }, [bare], NOW).map((f) => f.id)[0], 'no-owner');
});

test('similarItems: same type, shared systems/capabilities/data, retired and unlike items left out', () => {
  const twins = similarItems(items, 'ex-po-watcher');
  assert.deepEqual(twins.map((t) => t.item.id), ['ex-supplier-scout']);
  assert.deepEqual(twins[0].shared.sort(), ['Databricks', 'Procurement', 'Purchase order follow-up', 'SAP S/4HANA'], 'shown as written, compared without case');
  const lower = items.map((i) => (i.id === 'ex-supplier-scout' ? { ...i, card: { ...i.card, relations: i.card.relations.map((r) => ({ ...r, name: r.name.toUpperCase() })) } } : i));
  assert.deepEqual(similarItems(lower, 'ex-po-watcher').map((t) => t.item.id), ['ex-supplier-scout'], 'case does not matter when comparing');
  assert.deepEqual(similarItems(items, 'ex-margin-analyst'), [], 'two shared systems out of nine names is not a twin');
  assert.deepEqual(similarItems(items, 'ex-sales-briefing').map((t) => t.item.id), ['ex-sales-report-legacy'], 'workflows are only compared with workflows');
  assert.deepEqual(similarItems(items, 'nope'), []);
  assert.deepEqual(similarItems(items, 'ex-feat-teams'), []);
  const noRel = items.map((i) => (i.id === 'ex-po-watcher' ? { ...i, card: { ...i.card, relations: [] } } : i));
  assert.deepEqual(similarItems(noRel, 'ex-po-watcher'), [], 'nothing declared, nothing to compare');
});

test('summarize: counts solutions, phases, flags and the sums only over items that report them', () => {
  const s = summarize(items, NOW);
  assert.equal(s.items, 18, 'archived item not counted');
  assert.equal(s.solutions, 15, 'agents and workflows');
  assert.deepEqual(s.byPhase, { plan: 1, 'phase-in': 2, active: 11, 'phase-out': 1, 'end-of-life': 0 });
  assert.equal(s.verified, 7);
  assert.equal(s.flagged, 7);
  assert.deepEqual(s.byFlag, { 'no-owner': 1, 'review-overdue': 2, 'verification-open': 5, 'risk-not-assessed': 2, 'high-risk-autonomous': 1, underused: 1, overlaps: 4 });
  assert.equal(s.measured, 13, 'two solutions are not running yet and report nothing');
  assert.equal(s.costEur, 2683);
  assert.equal(s.valueEur, 20850);
  const none = summarize(items.map((i) => ({ ...i, card: i.card && { ...i.card, telemetry: sanitizeTelemetry({}) } })), NOW);
  assert.equal(none.costEur, null, 'no measurement is "unknown", not zero');
  assert.equal(none.valueEur, null);
  assert.deepEqual(summarize([], NOW).byPhase, { plan: 0, 'phase-in': 0, active: 0, 'phase-out': 0, 'end-of-life': 0 });
});

test('filterItems: phase, flag and card words (tags, systems, organisation)', () => {
  const ids = (f) => filterItems(items, { ...noFilter(), ...f }, NOW).map((i) => i.id).sort();
  assert.deepEqual(ids({ phase: 'plan' }), ['ex-contract-upload']);
  assert.deepEqual(ids({ phase: 'phase-out' }), ['ex-sales-report-legacy']);
  assert.deepEqual(ids({ phase: 'end-of-life', status: 'all' }), ['ex-slack-digest']);
  assert.deepEqual(ids({ flag: 'no-owner' }), ['ex-renewal-watcher']);
  assert.deepEqual(ids({ flag: 'overlaps' }), ['ex-po-watcher', 'ex-sales-briefing', 'ex-sales-report-legacy', 'ex-supplier-scout']);
  assert.equal(ids({ flag: 'any' }).length, 7);
  assert.deepEqual(ids({ flag: 'any', phase: 'active', type: 'agent' }), ['ex-po-watcher', 'ex-renewal-watcher', 'ex-supplier-scout']);
  assert.deepEqual(ids({ query: 'eu-ai-act' }), ['ex-hiring-shortlist'], 'tag');
  assert.deepEqual(ids({ query: 'icertis' }), ['ex-contract-upload'], 'system in a relation');
  assert.ok(ids({ query: 'procurement' }).includes('ex-po-watcher'), 'organisation');
  assert.ok(ids({ query: 'jonas' }).includes('ex-po-watcher'), 'owner');
  assert.equal(filterItems(items, { type: 'all', status: 'active', query: '' }, NOW).length, 18, 'old callers without phase and flag still work');
});

test('cardWords and euro', () => {
  assert.deepEqual(cardWords(null), []);
  assert.ok(cardWords(byId('ex-margin-analyst').card).includes('Databricks'));
  assert.equal(euro(null), '–');
  assert.equal(euro(2683), '2,683 EUR');
  assert.equal(UNDERUSED_RUNS, 5);
});
