import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLED_CONNECTORS, LIBRARY_CONNECTORS, MANIFEST_ONLY_CONNECTORS, stageConnector } from '../connectors/_lib/bundle.mjs';

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'connectors/ontology-manager');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));

const ONTORAG_TOOLS = [
  'list_ontologies', 'inspect_ontology', 'search_classes', 'search_properties', 'compose', 'add_ontology',
  'describe', 'list_by_class', 'outgoing', 'incoming', 'mentions', 'sparql_select', 'sparql_construct',
];
const IMPACT_TOOLS = ['impact_of_term'];
const DOCUMENT_TOOLS = [
  'propose_ontology_from_documents', 'list_ontology_proposals', 'show_ontology_proposal',
  'apply_ontology_proposal', 'discard_ontology_proposal', 'document_ontology_settings',
];

test('the Ontology Manager starts the launcher with uv and OntoRAG, over stdio, with the model key as its only (optional) secret', () => {
  assert.equal(manifest.name, 'ontology-manager');
  assert.equal(manifest.server.mcp_config.command, 'uv');
  const args = manifest.server.mcp_config.args;
  assert.ok(args.includes('--with') && args.includes('ontorag[pdf]'));
  assert.ok(args.includes('${__dirname}/server/ontorag_stdio.py'));
  assert.equal(manifest.server.entry_point, 'server/ontorag_stdio.py');
  assert.equal(manifest.user_config.ontology_folder.required, true);
  // only the model key is a secret, and it is optional: reading and querying work without any key
  const secrets = Object.entries(manifest.user_config).filter(([, f]) => f.sensitive).map(([k]) => k);
  assert.deepEqual(secrets, ['llm_api_key']);
  assert.ok(!manifest.user_config.llm_api_key.required);
  assert.deepEqual(Object.keys(manifest.server.mcp_config.env).sort(),
    ['ONTORAG_DOCUMENTS_FOLDER', 'ONTORAG_FOLDER', 'ONTORAG_INSTANCES_TTL', 'ONTORAG_ONTOLOGY_TTL',
      'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'OPENROUTER_MODEL'].sort());
  for (const [name, ref] of Object.entries(manifest.server.mcp_config.env)) {
    const key = /^\$\{user_config\.(\w+)\}$/.exec(ref)?.[1];
    assert.ok(key && manifest.user_config[key], `${name} points at a real setting`);
  }
});

test('the manifest lists the thirteen OntoRAG tools, the impact tool and the six document tools, and the launcher registers each one', () => {
  assert.deepEqual(manifest.tools.map((t) => t.name).sort(), [...ONTORAG_TOOLS, ...IMPACT_TOOLS, ...DOCUMENT_TOOLS].sort());
  assert.equal(manifest.tools.length, 20);
  const py = readFileSync(join(DIR, 'server/ontorag_stdio.py'), 'utf8');
  for (const t of [...DOCUMENT_TOOLS, ...IMPACT_TOOLS]) assert.match(py, new RegExp(`async def ${t}\\(`), `${t} is registered`);
  for (const t of manifest.tools) assert.ok(t.description.length > 10, `${t.name} has a description`);
});

test('it is bundled as a manifest connector that also brings its launcher and data', () => {
  assert.ok(MANIFEST_ONLY_CONNECTORS.includes('ontology-manager') && !LIBRARY_CONNECTORS.includes('ontology-manager'));
  assert.ok(BUNDLED_CONNECTORS.includes('ontology-manager'));
  const target = mkdtempSync(join(tmpdir(), 'ontology-manager-'));
  try {
    stageConnector('ontology-manager', target);
    for (const f of ['manifest.json', 'server/ontorag_stdio.py', 'server/data/werkbank_fin.ttl', 'server/data/werkbank_fin_instances.ttl']) {
      assert.ok(existsSync(join(target, f)), `${f} is staged`);
    }
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('the sample baseline uses the same company codes as the Databricks demo and the Pre-Close space', () => {
  const inst = readFileSync(join(DIR, 'server/data/werkbank_fin_instances.ttl'), 'utf8');
  for (const code of ['DE10', 'FR10', 'UK10']) assert.match(inst, new RegExp(`:code "${code}"`));
  assert.doesNotMatch(inst, /"(DE01|PL01|FR01)"/, 'the old codes are gone');
  // every metric the pre-close checks point to is defined
  for (const m of ['Margin', 'DSO', 'OpenPOExposure', 'MarginAfterAccruals']) assert.match(inst, new RegExp(`:${m} a :Metric`));
});

test('the launcher keeps stdout free for the protocol and never deletes catalog entries', () => {
  const py = readFileSync(join(DIR, 'server/ontorag_stdio.py'), 'utf8');
  assert.match(py, /transport="stdio"/);
  for (const line of py.split('\n').filter((l) => /\bprint\(/.test(l))) assert.match(line, /file=sys\.stderr/, line);
  assert.doesNotMatch(py, /rmtree|unlink|os\.remove|shutil\.rmtree/);
});

test('document proposals never change the catalog without a confirmation, and delete only their own folder', () => {
  const py = readFileSync(join(DIR, 'server/doc_to_ontology.py'), 'utf8');
  // the only functions that write to the catalog take the confirmed flag
  assert.match(py, /def apply_proposal\(ws: Workspace, proposal_id: str, confirmed: bool\)/);
  assert.match(py, /if not confirmed:\s+return \{\s+"status": "needs_confirmation"/);
  assert.match(py, /def discard_proposal\(ws: Workspace, proposal_id: str, confirmed: bool\)/);
  // propose() never registers anything
  const propose = py.slice(py.indexOf('def propose('), py.indexOf('# -------------------------------------------------------- list / show / apply'));
  assert.doesNotMatch(propose, /register_ontology\(/);
  // every deletion targets a proposal folder
  const deletions = py.split('\n').filter((l) => /rmtree\(|\.unlink\(|os\.remove\(/.test(l));
  assert.equal(deletions.length, 2);
  for (const l of deletions) assert.match(l, /rmtree\(pdir\)/);
  // baselines are never fetched from a remote catalog: unknown slugs are refused before composing
  assert.match(py, /Baseline\(s\) not in the local catalog/);
});

test('the end-to-end test and its mock model exist and are not part of the bundle', () => {
  assert.ok(existsSync(join(DIR, 'test/e2e_documents.py')) && existsSync(join(DIR, 'test/mock_llm.py')));
  const target = mkdtempSync(join(tmpdir(), 'ontology-manager-'));
  try {
    stageConnector('ontology-manager', target);
    assert.ok(!existsSync(join(target, 'test')), 'tests are not shipped');
    assert.ok(existsSync(join(target, 'server/doc_to_ontology.py')), 'the document module is shipped');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('impact_of_term is read-only: no writes, no deletions, no network', () => {
  const py = readFileSync(join(DIR, 'server/impact.py'), 'utf8');
  assert.doesNotMatch(py, /\.serialize\(|open\([^)]*['"]w|write_text|rmtree|unlink|os\.remove|requests|urllib|http/);
  assert.match(py, /\.parse\(/);
  const launcher = readFileSync(join(DIR, 'server/ontorag_stdio.py'), 'utf8');
  assert.match(launcher, /register_impact_tool\(app, onto, inst\)/);
  const stage = mkdtempSync(join(tmpdir(), 'ontology-manager-'));
  try {
    stageConnector('ontology-manager', stage);
    assert.ok(existsSync(join(stage, 'server/impact.py')), 'the impact module is shipped');
  } finally { rmSync(stage, { recursive: true, force: true }); }
});

test('the demo handbook exists, uses the demo company codes and is not part of the bundle', () => {
  const md = readFileSync(join(DIR, 'examples/finance-closing-handbook.md'), 'utf8');
  for (const code of ['DE10', 'FR10', 'UK10']) assert.match(md, new RegExp(code));
  for (const w of ['accrual', 'GR/IR', 'intercompany difference', 'Group Controlling']) assert.match(md.toLowerCase(), new RegExp(w.toLowerCase()));
  assert.match(md, /invented/);
  const stage = mkdtempSync(join(tmpdir(), 'ontology-manager-'));
  try {
    stageConnector('ontology-manager', stage);
    assert.ok(!existsSync(join(stage, 'examples')), 'examples are not shipped');
  } finally { rmSync(stage, { recursive: true, force: true }); }
});
