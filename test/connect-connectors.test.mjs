import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse, parseDocument } from 'yaml';
import { connectAll, discoverConnectors, formatReport } from '../scripts/connect-connectors.mjs';

const ROOT = join(import.meta.dirname, '..');
const CONFIG = 'goose-home/.config/goose/config.yaml';

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'werkbank-connect-'));
  mkdirSync(join(root, 'goose-home/.config/goose'), { recursive: true });
  cpSync(join(ROOT, 'goose-home/.config/goose/config.example.yaml'), join(root, 'goose-home/.config/goose/config.example.yaml'));
  return root;
}
const extensions = (root) => parse(readFileSync(join(root, CONFIG), 'utf8')).extensions;

test('it finds every connector folder with a manifest, and not the shared library', () => {
  const found = discoverConnectors(ROOT);
  const onDisk = readdirSync(join(ROOT, 'connectors'), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(ROOT, 'connectors', e.name, 'manifest.json'))).map((e) => e.name).sort();
  assert.deepEqual(found, onDisk);
  assert.ok(!found.includes('_lib'));
  for (const id of ['ai-control-tower', 'n8n-automation', 'web-sources', 'gmail', 'jira', 'sap-mock']) assert.ok(found.includes(id), id);
});

test('it connects all of them: staged bundle, absolute paths in config.yaml, comments kept, no secret written', () => {
  const root = tempRoot();
  try {
    const before = readFileSync(join(root, 'goose-home/.config/goose/config.example.yaml'), 'utf8');
    const results = connectAll({ root });
    const connected = results.filter((r) => r.status === 'added');
    assert.ok(connected.length >= 15, `connected ${connected.length}`);
    assert.equal(results.filter((r) => r.status === 'failed').length, 0);
    const ext = extensions(root);
    for (const r of connected) {
      const e = ext[r.name];
      assert.ok(e, r.name);
      assert.equal(e.type, 'stdio');
      assert.ok(e.args.every((a) => !a.includes('${__dirname}')), `${r.name}: paths filled in`);
      const entry = e.args.find((a) => a.startsWith(root));
      if (e.cmd === 'node') assert.ok(entry && existsSync(entry), `${r.name}: staged server exists (${entry})`);
      assert.ok(existsSync(join(root, 'goose-home/bundles', r.name, 'manifest.json')), `${r.name}: bundle staged`);
      assert.ok(existsSync(join(root, 'goose-home/connectors', `${r.name}.json`)), `${r.name}: settings remembered`);
    }
    // a library connector brings its sample data along
    assert.ok(existsSync(join(root, 'goose-home/bundles/n8n-automation/connectors/_lib/data/infra-ops.json')));
    // comments of the template survive the write
    const comment = before.split('\n').find((l) => l.trim().startsWith('#'));
    if (comment) assert.ok(readFileSync(join(root, CONFIG), 'utf8').includes(comment.trim()));
    assert.doesNotMatch(readFileSync(join(root, CONFIG), 'utf8'), /sk-|dapi|hf_|Bearer /);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a connector that needs a setting nobody has entered is added switched off; the others are on', () => {
  const root = tempRoot();
  try {
    const results = connectAll({ root });
    const ext = extensions(root);
    assert.equal(ext.jira.enabled, false);
    assert.deepEqual(results.find((r) => r.name === 'jira').missing.sort(), ['jira_api_token', 'jira_email', 'jira_site']);
    assert.equal(ext['web-sources'].enabled, true);
    assert.equal(ext['knowledge-graph'].enabled, true);
    const again = connectAll({ root: tempRoot(), enableUnconfigured: true });
    assert.ok(again.filter((r) => r.status === 'added').every((r) => r.enabled === true));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('running it again is safe: new files, but entered settings and the on/off switch are kept', () => {
  const root = tempRoot();
  try {
    connectAll({ root });
    const doc = parseDocument(readFileSync(join(root, CONFIG), 'utf8'));
    doc.setIn(['extensions', 'sub4me', 'envs', 'SUPABASE_URL'], 'https://example.invalid');
    doc.setIn(['extensions', 'web-sources', 'enabled'], false);
    writeFileSync(join(root, CONFIG), doc.toString());
    rmSync(join(root, 'goose-home/bundles/sub4me'), { recursive: true });
    const second = connectAll({ root });
    assert.ok(second.filter((r) => r.status !== 'skipped').every((r) => r.status === 'refreshed'));
    const ext = extensions(root);
    assert.equal(ext.sub4me.envs.SUPABASE_URL, 'https://example.invalid');
    assert.equal(ext['web-sources'].enabled, false, 'a connector you switched off stays off');
    assert.ok(existsSync(join(root, 'goose-home/bundles/sub4me/manifest.json')), 'bundle is staged again');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--only and --skip select, a command that is not allowed is skipped with the reason, and a dry run writes nothing', () => {
  const root = tempRoot();
  try {
    const dry = connectAll({ root, dryRun: true });
    assert.ok(!existsSync(join(root, CONFIG)) && !existsSync(join(root, 'goose-home/bundles')), 'dry run writes nothing');
    assert.match(formatReport(dry, { dryRun: true }), /Dry run: nothing was written/);
    const some = connectAll({ root, only: ['web-sources', 'sub4me'], skip: ['sub4me'] });
    assert.deepEqual(some.filter((r) => r.status === 'added').map((r) => r.name), ['web-sources']);
    const onto = connectAll({ root }).find((r) => r.name === 'ontology-manager');
    assert.notEqual(onto.status, 'skipped', 'uv is allowed, so the Ontology Manager is connected');
    const src = tempRoot();
    mkdirSync(join(src, 'connectors/risky'), { recursive: true });
    writeFileSync(join(src, 'connectors/risky/manifest.json'), JSON.stringify({ name: 'risky', display_name: 'Risky', server: { type: 'node', mcp_config: { command: 'curl', args: [] } } }));
    const risky = connectAll({ root: tempRoot(), sourceRoot: src }).find((r) => r.name === 'risky');
    assert.equal(risky.status, 'skipped');
    assert.match(risky.note, /not allowed/);
    rmSync(src, { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
