import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { companyCodesIn, exampleOntologies, filterTerms, healthOf, impactOf, kpis, ownerLabel, resolveCatalog, usedLabel } from '../src/ontology-manager.ts';

const root = join(import.meta.dirname, '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const [fin, proc] = exampleOntologies();

test('the example matches the bundled sample: 8 classes, 4 metrics, 13 properties, half of the classes defined', () => {
  const k = kpis(fin);
  assert.equal(k.classes, 8);
  assert.equal(k.metrics, 4);
  assert.equal(k.properties, 13);
  assert.equal(k.definedClasses, 4);
  assert.equal(k.coverage, 0.5);
  assert.equal(k.needAttention, 4);
  assert.equal(k.openProposals, 1);
  assert.equal(k.total, 12);
});

test('example classes without a definition are the four the sample really has', () => {
  const missing = fin.terms.filter((t) => healthOf(t) === 'missing').map((t) => t.id).sort();
  assert.deepEqual(missing, ['FinancialDocument', 'GLAccount', 'Invoice', 'JournalEntry']);
  // the same four classes have no rdfs:comment in the bundled ontology
  const ttl = read('connectors/ontology-manager/server/data/werkbank_fin.ttl');
  for (const id of ['GLAccount', 'FinancialDocument', 'Invoice', 'JournalEntry']) {
    const block = ttl.slice(ttl.indexOf(`:${id} a owl:Class`)).split('\n\n')[0];
    assert.doesNotMatch(block, /rdfs:comment/, `${id} has no comment in the sample`);
  }
  for (const id of ['CompanyCode', 'Metric', 'PreCloseCheck', 'Dataset']) {
    const block = ttl.slice(ttl.indexOf(`:${id} a owl:Class`)).split('\n\n')[0];
    assert.match(block, /rdfs:comment/, `${id} has a comment in the sample`);
  }
});

test('a metric without an owner needs attention even with a definition', () => {
  const m = { ...fin.terms[0], owner: '' };
  assert.equal(healthOf(m), 'missing');
  assert.equal(ownerLabel(m), 'Not assigned');
});

test('filters: metrics, classes, needs attention, and search over name, id, definition and owner', () => {
  assert.equal(filterTerms(fin, 'all', '').length, 12);
  assert.equal(filterTerms(fin, 'metrics', '').length, 4);
  assert.equal(filterTerms(fin, 'classes', '').length, 8);
  assert.equal(filterTerms(fin, 'attention', '').length, 4);
  assert.deepEqual(filterTerms(fin, 'all', 'treasury').map((t) => t.id), ['DSO']);
  assert.deepEqual(filterTerms(fin, 'all', 'GLACCOUNT').map((t) => t.id), ['GLAccount']);
  assert.deepEqual(filterTerms(fin, 'all', 'receivables').map((t) => t.id), ['DSO']);
  assert.deepEqual(filterTerms(fin, 'attention', 'invoice').map((t) => t.id), ['Invoice']);
  assert.equal(filterTerms(fin, 'all', 'zzz').length, 0);
});

test('"used by" says links for metrics, instances or subclasses for classes', () => {
  const by = (id) => fin.terms.find((t) => t.id === id);
  assert.equal(usedLabel(fin, by('Margin')), '2 links');
  assert.equal(usedLabel(fin, by('DSO')), '1 link');
  assert.equal(usedLabel(fin, by('CompanyCode')), '3 instances');
  assert.equal(usedLabel(fin, by('FinancialDocument')), '2 subclasses');
  assert.equal(usedLabel(fin, by('GLAccount')), 'no links');
});

test('impact of DSO: one check, three company codes, ask Group Treasury', () => {
  const i = impactOf(fin, 'DSO');
  assert.deepEqual(i.usedBy.map((d) => d.node.id), ['chk_dso']);
  assert.equal(i.usedBy[0].hop, 1);
  assert.deepEqual(i.dependsOn.map((d) => d.node.id), ['ds_invoices']);
  assert.deepEqual(i.ask, ['Group Treasury']);
  assert.deepEqual(companyCodesIn(fin, i), ['DE10', 'FR10', 'UK10']);
  assert.deepEqual(i.byType, { 'Pre-Close Check': 1 });
});

test('impact of Margin: the derived metric and the check, two company codes, ask Group Controlling', () => {
  const i = impactOf(fin, 'Margin');
  assert.deepEqual(i.usedBy.map((d) => d.node.id).sort(), ['MarginAfterAccruals', 'chk_margin']);
  assert.deepEqual(i.dependsOn.map((d) => d.node.id).sort(), ['ds_gl', 'ds_invoices']);
  assert.deepEqual(i.ask, ['Group Controlling']);
  assert.deepEqual(companyCodesIn(fin, i), ['DE10', 'FR10']);
});

test('impact follows links more than one step and shows each resource once', () => {
  // OpenPOExposure is read by chk_po only; a dataset is read by metrics which are read by checks
  const ds = impactOf(fin, 'ds_invoices');
  const ids = ds.usedBy.map((d) => `${d.node.id}:${d.hop}`);
  assert.ok(ids.includes('Margin:1') && ids.includes('DSO:1'));
  assert.ok(ids.includes('chk_dso:2') && ids.includes('chk_margin:2') && ids.includes('MarginAfterAccruals:2'));
  assert.equal(new Set(ds.usedBy.map((d) => d.node.id)).size, ds.usedBy.length);
  assert.deepEqual(ds.ask, ['Group Controlling', 'Group Treasury']);
  // depth 1 stops after the first step
  assert.deepEqual(impactOf(fin, 'ds_invoices', 1).usedBy.map((d) => d.node.id).sort(), ['DSO', 'Margin']);
});

test('the example links are the ones in the bundled instances file', () => {
  const inst = read('connectors/ontology-manager/server/data/werkbank_fin_instances.ttl');
  for (const [from, prop, to] of fin.edges.map((e) => [e.from, e.prop, e.to])) {
    const block = inst.slice(inst.indexOf(`:${from} a `)).split(/\n\n|\n# /)[0];
    assert.match(block, new RegExp(`:${prop}[^.;]*:${to}\\b`), `${from} ${prop} ${to}`);
  }
});

test('the draft from documents has its two classes and no links', () => {
  assert.equal(proc.status, 'draft');
  assert.equal(kpis(proc).classes, 2);
  assert.equal(impactOf(proc, 'Supplier').usedBy.length, 0);
});

test('the view uses tokens only (no hex colours), respects reduced motion, and is reachable from Admin, not from Develop', () => {
  const css = read('src/theme.css');
  const om = css.split('\n').filter((l) => /^\.om[-\s{.]|^:root\[data-theme="dark"\] \.om/.test(l)).join('\n');
  assert.ok(om.length > 200, 'the om styles exist');
  assert.doesNotMatch(om.replace(/--om-[a-z-]+:\s*#[0-9a-fA-F]{3,8}/g, ''), /#[0-9a-fA-F]{3,8}\b/, 'colours come from tokens');
  assert.match(css, /prefers-reduced-motion[^{]*\{[^}]*\.om/s);
  assert.match(read('src/ui/Rail.tsx'), /'ontology'/);
  assert.match(read('src/App.tsx'), /view === 'ontology'/);
  // Admin owns the way in: a rail button, an Admin page with the Ontologies tile, and nothing in the Develop hub
  const rail = read('src/ui/Rail.tsx');
  assert.match(rail, /View = [^;]*'admin'/);
  assert.match(rail, /ADMIN_VIEWS: View\[\] = \['admin', 'ontology', 'registry', 'skillhealth'\]/);
  assert.match(rail, /onView\('admin'\)/);
  assert.doesNotMatch(rail, /DEVELOP_VIEWS: View\[\] = [^;]*'ontology'/);
  assert.match(read('src/App.tsx'), /view === 'admin'/);
  assert.match(read('src/ui/AdminView.tsx'), /Open Ontology Manager/);
  assert.doesNotMatch(read('src/ui/DevelopHub.tsx'), /ntolog/);
});

test('the real catalog is shown when the app answers; otherwise the example with the reason, never a silent mix', () => {
  const real = [{ ...fin, example: false }];
  const ok = resolveCatalog({ ok: true, ontologies: real, folder: '/x', instances: 'bundled', warnings: ['bad: not readable'] });
  assert.equal(ok.source.kind, 'catalog');
  assert.deepEqual(ok.ontologies.map((o) => o.slug), real.map((o) => o.slug));
  assert.ok(ok.ontologies.every((o) => !o.example));
  assert.equal(ok.source.folder, '/x');
  const empty = resolveCatalog({ ok: true, ontologies: [] });
  assert.equal(empty.source.kind, 'catalog');
  assert.equal(empty.ontologies.length, 0);
  const failed = resolveCatalog({ ok: false, code: 'not-configured', detail: 'The connector is not installed.' });
  assert.equal(failed.source.kind, 'example');
  assert.equal(failed.source.reason, 'The connector is not installed.');
  assert.ok(failed.ontologies.every((o) => o.example));
  assert.match(resolveCatalog(null).source.reason, /desktop app/);
});

test('the view labels its data as example data and has no dead buttons', () => {
  const v = read('src/ui/OntologyManagerView.tsx');
  assert.match(v, /Example data/);
  assert.match(v, /Read from your ontology catalog/);
  // every button has a handler
  for (const m of v.matchAll(/<button\b[^>]*>/g)) assert.match(m[0], /onClick|disabled/, m[0]);
});
