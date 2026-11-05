import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildOntologies, createOntologyStore } from '../electron/ontology-store.mjs';
import { companyCodesIn, exampleOntologies, impactOf, kpis } from '../src/ontology-manager.ts';

const data = join(import.meta.dirname, '..', 'connectors/ontology-manager/server/data');
const finTtl = readFileSync(join(data, 'werkbank_fin.ttl'), 'utf8');
const instTtl = readFileSync(join(data, 'werkbank_fin_instances.ttl'), 'utf8');
const catalog = { ontologies: [{ slug: 'werkbank_fin', label: 'Werkbank Finance Pre-Close', path: 'werkbank_fin.ttl', tags: [] }] };
const [example] = exampleOntologies();

function folder() {
  const root = mkdtempSync(join(tmpdir(), 'ontostore-'));
  mkdirSync(join(root, 'ontologies'), { recursive: true });
  writeFileSync(join(root, 'ontologies', 'catalog.json'), JSON.stringify(catalog));
  writeFileSync(join(root, 'ontologies', 'werkbank_fin.ttl'), finTtl);
  return root;
}

test('the bundled files give the same terms, owners and links as the example data', () => {
  const { ontologies, warnings } = buildOntologies({ catalog, files: { werkbank_fin: finTtl }, instancesTtl: instTtl });
  assert.deepEqual(warnings, []);
  const [fin] = ontologies;
  const ids = (o) => o.terms.map((t) => `${t.kind}:${t.id}`).sort();
  assert.deepEqual(ids(fin), ids(example));
  assert.deepEqual(fin.terms.filter((t) => t.kind === 'metric').map((t) => [t.id, t.owner]).sort(), example.terms.filter((t) => t.kind === 'metric').map((t) => [t.id, t.owner]).sort());
  const edge = (e) => `${e.from} ${e.prop} ${e.to}`;
  assert.deepEqual(fin.edges.map(edge).sort(), example.edges.map(edge).sort());
  assert.equal(fin.properties, 13);
  assert.equal(fin.example, false);
  assert.equal(kpis(fin).classes, 8);
  assert.equal(kpis(fin).needAttention, 4);
});

test('impact on read data matches the example: DSO reaches three company codes and asks Group Treasury', () => {
  const [fin] = buildOntologies({ catalog, files: { werkbank_fin: finTtl }, instancesTtl: instTtl }).ontologies;
  const i = impactOf(fin, 'DSO');
  assert.deepEqual(i.usedBy.map((d) => d.node.id), ['chk_dso']);
  assert.deepEqual(i.ask, ['Group Treasury']);
  assert.deepEqual(companyCodesIn(fin, i), ['DE10', 'FR10', 'UK10']);
  assert.equal(fin.nodes.find((n) => n.id === 'ds_invoices').note, 'werkbank_demo.fin.invoices');
});

test('class members: subclasses when there are any, instances otherwise; definitions come from comments', () => {
  const [fin] = buildOntologies({ catalog, files: { werkbank_fin: finTtl }, instancesTtl: instTtl }).ontologies;
  const t = (id) => fin.terms.find((x) => x.id === id);
  assert.deepEqual(t('FinancialDocument').members, ['Invoice', 'JournalEntry']);
  assert.equal(t('FinancialDocument').membersKind, 'subclasses');
  assert.deepEqual(t('CompanyCode').members, ['DE10', 'FR10', 'UK10']);
  assert.match(t('CompanyCode').definition, /Legal entity/); // English first, German stays in the file
  assert.equal(t('Invoice').definition, '');
});

test('without an instances file the classes still show and the metrics are simply absent', () => {
  const [fin] = buildOntologies({ catalog, files: { werkbank_fin: finTtl } }).ontologies;
  assert.equal(fin.terms.filter((t) => t.kind === 'metric').length, 0);
  assert.equal(fin.terms.filter((t) => t.kind === 'class').length, 8);
});

test('broken Turtle is reported as a warning, other ontologies still load; proposals are counted', () => {
  const cat = { ontologies: [...catalog.ontologies, { slug: 'bad', label: 'Bad', path: 'bad.ttl' }] };
  const r = buildOntologies({ catalog: cat, files: { werkbank_fin: finTtl, bad: ':x a ;;; "' }, proposals: [{ slug: 'werkbank_fin', status: 'proposed' }, { slug: 'werkbank_fin', status: 'applied' }] });
  assert.equal(r.ontologies.length, 1);
  assert.equal(r.ontologies[0].openProposals, 1);
  assert.match(r.warnings[0], /^bad: not readable/);
});

test('the store reads a catalog folder, falls back to the bundled instances, and says why when it cannot', () => {
  const root = folder();
  const store = createOntologyStore({ readSettings: () => ({ folder: root, instancesFile: '' }), bundledInstances: join(data, 'werkbank_fin_instances.ttl') });
  const r = store.read();
  assert.equal(r.ok, true);
  assert.equal(r.instances, 'bundled');
  assert.equal(r.ontologies[0].terms.length, 12);
  assert.equal(createOntologyStore({ readSettings: () => null }).read().code, 'not-configured');
  const empty = mkdtempSync(join(tmpdir(), 'ontostore-'));
  assert.equal(createOntologyStore({ readSettings: () => ({ folder: empty }) }).read().code, 'no-catalog');
  writeFileSync(join(empty, 'x'), '');
  mkdirSync(join(empty, 'ontologies'));
  writeFileSync(join(empty, 'ontologies', 'catalog.json'), '{not json');
  assert.equal(createOntologyStore({ readSettings: () => ({ folder: empty }) }).read().code, 'unreadable');
});

test('the manifest cannot point outside the catalog folder', () => {
  const root = folder();
  writeFileSync(join(root, 'secret.ttl'), ':a a <http://www.w3.org/2002/07/owl#Class> .');
  writeFileSync(join(root, 'ontologies', 'catalog.json'), JSON.stringify({ ontologies: [{ slug: 'evil', label: 'Evil', path: '../secret.ttl' }] }));
  const r = createOntologyStore({ readSettings: () => ({ folder: root }) }).read();
  assert.equal(r.ok, true);
  assert.equal(r.ontologies.length, 0);
});

test('the desktop app wires the catalog read: IPC handler, preload bridge and window typing', () => {
  const r = (f) => readFileSync(join(import.meta.dirname, '..', f), 'utf8');
  assert.match(r('electron/main.mjs'), /ipcMain\.handle\('ontology-catalog'/);
  assert.match(r('electron/main.mjs'), /extensions', 'ontology-manager'/);
  assert.match(r('electron/preload.cjs'), /ontologyCatalog: \(\) => ipcRenderer\.invoke\('ontology-catalog'\)/);
  assert.match(r('src/main.tsx'), /ontologyCatalog\?:/);
});
