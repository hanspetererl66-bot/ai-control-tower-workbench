import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { embedAlerts, repoAlerts } from '../scripts/sync-it-operations.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('examples/it-operations/index.html');
const wf = JSON.parse(read('examples/n8n-workflows/04-it-operations-alert-triage.json'));
const runNode = async (name, items, first = {}) => {
  const js = wf.nodes.find((n) => n.name === name).parameters.jsCode;
  return [...(await vm.runInNewContext(`(async()=>{${js}})`, { $input: { all: () => items, first: () => ({ json: first }) } })())].map((i) => i.json);
};
const pageTriage = () => {
  const logic = /<script id="triage-logic">([\s\S]*?)<\/script>/.exec(page)[1];
  return vm.runInNewContext(`${logic}; triage`);
};

test('page embeds the current alerts and design system, installs, and has no network access', () => {
  assert.equal(embedAlerts(page, repoAlerts(), read('examples/shared/design-system.css')), page, 'run npm run sync:it-operations');
  assert.equal(EXAMPLE_SPACES['it-operations'], 'it-operations');
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage|type="submit"/);
  assert.equal(JSON.parse(read('examples/it-operations/space.json')).title, 'Cloud Infrastructure Operations');
});

test('the workflow samples are the Space alerts, and page and workflow triage give the same result', async () => {
  const sample = await runNode('Alerts', []);
  assert.deepEqual(JSON.parse(JSON.stringify(sample)), repoAlerts().alerts);
  const fromWorkflow = await runNode('Priority', (await runNode('Guardrail: untrusted text', sample.map((json) => ({ json })))).filter((a) => !a.flagged).map((json) => ({ json })));
  const guarded = await runNode('Guardrail: untrusted text', sample.map((json) => ({ json })));
  const pageRows = pageTriage()(sample);
  assert.deepEqual(pageRows.filter((r) => r.flagged).map((r) => r.id), guarded.filter((a) => a.flagged).map((a) => a.id));
  for (const w of fromWorkflow) {
    const p = pageRows.find((r) => r.id === w.id);
    assert.equal(p.priority, w.priority, `${w.id}: priority`);
    assert.equal(p.reasons, w.reasons, `${w.id}: reasons`);
    assert.equal(p.route, w.priority >= 70 ? 'P1' : w.priority >= 35 ? 'P2' : 'P3');
  }
  assert.equal(pageRows.find((r) => r.id === 'A-507').text, '[withheld: untrusted content]');
});
