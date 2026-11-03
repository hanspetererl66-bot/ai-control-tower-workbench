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

test('the Ontology Manager starts the launcher with uv and OntoRAG, over stdio, with no secret', () => {
  assert.equal(manifest.name, 'ontology-manager');
  assert.equal(manifest.server.mcp_config.command, 'uv');
  const args = manifest.server.mcp_config.args;
  assert.ok(args.includes('--with') && args.includes('ontorag'));
  assert.ok(args.includes('${__dirname}/server/ontorag_stdio.py'));
  assert.equal(manifest.server.entry_point, 'server/ontorag_stdio.py');
  assert.equal(manifest.user_config.ontology_folder.required, true);
  assert.ok(!Object.values(manifest.user_config).some((f) => f.sensitive), 'no secret is needed');
  assert.deepEqual(Object.keys(manifest.server.mcp_config.env).sort(),
    ['ONTORAG_FOLDER', 'ONTORAG_INSTANCES_TTL', 'ONTORAG_ONTOLOGY_TTL']);
});

test('the manifest lists exactly the thirteen OntoRAG tools the launcher mounts', () => {
  assert.deepEqual(manifest.tools.map((t) => t.name).sort(), [...ONTORAG_TOOLS].sort());
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
