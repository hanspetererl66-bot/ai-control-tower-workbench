import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOntologyStore, declaredNames, normalizeGovernance, proposalView, versionsOf } from '../electron/ontology-store.mjs';
import {
  addBinding, applyGovernance, applyPrompt, consumersOf, discardPrompt, exampleGovernance, exampleOntologies, impactOf, needsLook,
  newPlan, planRequest, proposalTotals, proposePrompt, qualityFindings, removeBinding, setMeta, setPlanStatus, upsertView,
} from '../src/ontology-manager.ts';

const root = join(import.meta.dirname, '..');
const data = join(root, 'connectors/ontology-manager/server/data');
const finTtl = readFileSync(join(data, 'werkbank_fin.ttl'), 'utf8');
const [fin] = exampleOntologies();
const empty = () => normalizeGovernance(null);

test('governance input is cut down to the one shape we store, with limits', () => {
  const g = normalizeGovernance({
    ontologies: { werkbank_fin: { owner: '  Controlling ', domain: 'Finance', approver: 5 }, '../evil': { owner: 'x' } },
    bindings: [
      { slug: 'werkbank_fin', term: 'DSO', kind: 'skill', name: 'board-briefing' },
      { slug: 'werkbank_fin', term: 'DSO', kind: 'skill', name: 'Board-Briefing' }, // duplicate, case-insensitive
      { slug: 'werkbank_fin', term: 'DSO', kind: 'hack', name: 'x' }, // unknown kind
      { slug: '../x', term: 'DSO', kind: 'agent', name: 'x' },
    ],
    views: [{ name: 'Finance bot', slugs: ['werkbank_fin', '../x'] }, { name: 'finance BOT', slugs: [] }],
    plans: [{ id: 'p1', slug: 'werkbank_fin', term: 'DSO', change: 'rename', status: 'weird' }, { id: '', slug: 'werkbank_fin', term: 'a', change: 'b' }],
  });
  assert.deepEqual(Object.keys(g.ontologies), ['werkbank_fin']);
  assert.equal(g.ontologies.werkbank_fin.owner, 'Controlling');
  assert.equal(g.ontologies.werkbank_fin.approver, '');
  assert.equal(g.bindings.length, 1);
  assert.deepEqual(g.views, [{ name: 'Finance bot', slugs: ['werkbank_fin'] }]);
  assert.equal(g.plans.length, 1);
  assert.equal(g.plans[0].status, 'draft');
  assert.deepEqual(normalizeGovernance('nonsense'), empty());
});

test('history: versions oldest to newest show what each extension added and removed', () => {
  const small = finTtl.split('\n').slice(0, 40).join('\n');
  assert.ok(declaredNames(finTtl).size > 0);
  const v = versionsOf([{ file: 'b.ttl', stamp: '20261102T100000Z', ttl: small }], finTtl);
  assert.equal(v.length, 2);
  assert.equal(v[0].at, '2026-11-02T10:00:00Z');
  assert.deepEqual(v[0].added, []);
  assert.equal(v[1].file, 'current');
  assert.equal(v[1].terms, declaredNames(finTtl).size);
  assert.equal(v[1].added.length - v[1].removed.length, declaredNames(finTtl).size - declaredNames(small).size);
});

test('a proposal report becomes the review data; unknown actions become "new" and text is limited', () => {
  const p = proposalView(
    { id: 'p-1', slug: 'x_y', mode: 'extend', label: 'L', status: 'proposed', created_at: '2026-11-04', documents: [{ file: 'a.md', chunks: 3 }] },
    { classes: [{ name: 'Supplier', action: 'bogus', description: 'd'.repeat(2000), evidence: ['q1', 'q2', 'q3', 'q4'] }], needs_attention: [{ kind: 'class', name: 'Supplier', why: 'low' }] },
  );
  assert.equal(p.mode, 'extend');
  assert.equal(p.classes[0].action, 'new');
  assert.equal(p.classes[0].description.length, 600);
  assert.equal(p.classes[0].evidence.length, 3);
  assert.equal(proposalTotals(p).total, 1);
  assert.ok(needsLook(p, p.classes[0]));
});

test('saveGovernance writes only governance.json, returns what it stored, and fails clearly without a folder', () => {
  const folder = mkdtempSync(join(tmpdir(), 'ontogov-'));
  mkdirSync(join(folder, 'ontologies'));
  writeFileSync(join(folder, 'ontologies', 'catalog.json'), '{"ontologies":[]}');
  const store = createOntologyStore({ readSettings: () => ({ folder }) });
  const saved = store.saveGovernance({ ontologies: { werkbank_fin: { owner: 'Controlling' } } });
  assert.equal(saved.ok, true);
  assert.equal(saved.governance.ontologies.werkbank_fin.owner, 'Controlling');
  assert.deepEqual(readdirSync(join(folder, 'ontologies')).sort(), ['catalog.json', 'governance.json']);
  assert.equal(readFileSync(join(folder, 'ontologies', 'catalog.json'), 'utf8'), '{"ontologies":[]}');
  assert.equal(store.read().governance.ontologies.werkbank_fin.owner, 'Controlling');
  assert.equal(createOntologyStore({ readSettings: () => null }).saveGovernance({}).ok, false);
  assert.equal(createOntologyStore({ readSettings: () => ({ folder: join(folder, 'missing') }) }).saveGovernance({}).ok, false);
  assert.ok(!existsSync(join(folder, 'missing')));
});

test('owners are applied from governance; bindings and views are added once and removed again', () => {
  let g = setMeta(empty(), 'werkbank_fin', { owner: 'Controlling', domain: 'Finance' });
  assert.equal(applyGovernance([fin], g)[0].owner, 'Controlling');
  const b = { slug: 'werkbank_fin', term: 'DSO', kind: 'skill', name: 'board-briefing' };
  g = addBinding(addBinding(g, b), { ...b, name: 'BOARD-BRIEFING' });
  assert.equal(g.bindings.length, 1);
  assert.equal(addBinding(g, { ...b, name: '  ' }), g);
  assert.equal(removeBinding(g, b).bindings.length, 0);
  g = upsertView(upsertView(g, { name: 'Bot', slugs: ['a', 'a'] }), { name: 'bot', slugs: ['b'] });
  assert.deepEqual(g.views, [{ name: 'bot', slugs: ['b'] }]);
});

test('consumers: a direct binding is direct, one on something that depends on the term is indirect', () => {
  const dso = fin.terms.find((t) => t.id === 'DSO');
  const impact = impactOf(fin, 'DSO');
  const dependent = impact.usedBy[0]?.node.id;
  let g = addBinding(empty(), { slug: fin.slug, term: 'DSO', kind: 'agent', name: 'Collections bot' });
  if (dependent) g = addBinding(g, { slug: fin.slug, term: dependent, kind: 'report', name: 'Dashboard' });
  g = addBinding(g, { slug: 'other', term: 'DSO', kind: 'agent', name: 'Elsewhere' });
  const c = consumersOf(g, fin, dso.id, impact);
  assert.ok(c.find((x) => x.name === 'Collections bot')?.direct);
  assert.ok(!c.some((x) => x.name === 'Elsewhere'));
  if (dependent) assert.equal(c.find((x) => x.name === 'Dashboard')?.direct, false);
});

test('a change plan names who is asked, can move through its states and never touches the catalog', () => {
  const impact = impactOf(fin, 'DSO');
  const plan = newPlan(fin, 'DSO', '  rename to Days Sales Outstanding ', impact, 1700000000000);
  assert.equal(plan.status, 'draft');
  assert.equal(plan.change, 'rename to Days Sales Outstanding');
  const g = setPlanStatus({ ...empty(), plans: [plan] }, plan.id, 'asked');
  assert.equal(g.plans[0].status, 'asked');
  const text = planRequest(fin, 'DSO', plan.change, impact, [], []);
  assert.match(text, /DSO|Days/);
  assert.doesNotMatch(text, /confirmed=true/);
});

test('agent prompts: applying and discarding carry confirmed=true, proposing never applies', () => {
  const p = proposalView({ id: 'p-9', slug: 'werkbank_scm', mode: 'extend' }, {});
  assert.match(applyPrompt(p), /apply_ontology_proposal/);
  assert.match(applyPrompt(p), /confirmed=true/);
  assert.match(discardPrompt(p), /discard_ontology_proposal[\s\S]*confirmed=true/);
  const prop = proposePrompt('werkbank_scm', 'extend', 'handbook.md');
  assert.match(prop, /propose_ontology_from_documents/);
  assert.doesNotMatch(prop, /confirmed=true/);
});

test('quality rules find a missing owner, definition, formula, unused terms and duplicates, worst first', () => {
  const clone = (o, patch) => ({ ...o, ...patch });
  const bare = clone(fin, { slug: 'copy', owner: '', terms: [
    { ...fin.terms.find((t) => t.kind === 'metric'), id: 'M1', label: 'Margin', owner: '', formula: '', definition: '' },
    ...fin.terms.filter((t) => t.kind !== 'metric').slice(0, 1),
  ] });
  const f = qualityFindings([fin, bare], exampleGovernance());
  const rules = new Set(f.map((x) => x.rule));
  for (const r of ['ontology-owner', 'no-owner', 'no-definition', 'no-formula']) assert.ok(rules.has(r), r);
  assert.ok(f.some((x) => x.rule === 'duplicate'), 'Margin exists in both ontologies');
  const order = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < f.length; i++) assert.ok(order[f[i - 1].severity] <= order[f[i].severity]);
});

test('the Ontology views have no dead buttons and the styles use tokens only', () => {
  const files = readdirSync(join(root, 'src/ui')).filter((n) => /^Ontology.*\.tsx$/.test(n));
  assert.ok(files.length >= 6);
  for (const n of files) {
    for (const m of readFileSync(join(root, 'src/ui', n), 'utf8').matchAll(/<button\b[^>]*>/g)) assert.match(m[0], /onClick|disabled|type="submit"/, `${n}: ${m[0]}`);
  }
  const css = readFileSync(join(root, 'src/theme.css'), 'utf8').split('\n').filter((l) => /\.om-|\.adm-/.test(l) && !/--om-/.test(l));
  for (const l of css) assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b/, l);
});

test('the second sample ontology and its demo handbook are bundled', () => {
  assert.ok(existsSync(join(data, 'werkbank_scm.ttl')));
  assert.ok(declaredNames(readFileSync(join(data, 'werkbank_scm.ttl'), 'utf8')).has('Supplier'));
  assert.ok(existsSync(join(root, 'connectors/ontology-manager/examples/procurement-handbook.md')));
  assert.match(readFileSync(join(root, 'connectors/ontology-manager/server/ontorag_stdio.py'), 'utf8'), /werkbank_scm/);
});
