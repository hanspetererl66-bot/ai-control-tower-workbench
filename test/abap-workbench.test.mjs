import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embedMockupData } from '../scripts/sync-mockup-spaces.mjs';
import { MAX_ASK_LENGTH } from '../src/space-ask.ts';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/abap-workbench/index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/abap-workbench/data.json'), 'utf8'));
const names = new Set(data.objects.map((o) => o.name));

test('abap-workbench page embeds the current sample data', () => {
  assert.equal(embedMockupData(page, data), page, 'run: npm run sync:mockups');
});

test('abap-workbench sample data is internally consistent', () => {
  assert.equal(names.size, data.objects.length, 'object names are unique');
  for (const key of Object.keys(data.sources)) assert.ok(names.has(key), `source for unknown object ${key}`);
  for (const key of Object.keys(data.ktd)) assert.ok(names.has(key), `KTD for unknown object ${key}`);
  for (const key of Object.keys(data.uses)) assert.ok(names.has(key), `usages for unknown object ${key}`);
  assert.equal(new Set(data.transports.map((t) => t.id)).size, data.transports.length, 'request ids are unique');
  for (const t of data.transports) {
    assert.ok(['modifiable', 'released'].includes(t.status), `${t.id} has an unknown status`);
    for (const n of t.objects) assert.ok(names.has(n), `${t.id} contains unknown object ${n}`);
  }
});

test('abap-workbench only shows read tools of ARC-1', () => {
  const allowed = new Set(['SAPSearch', 'SAPRead', 'SAPContext', 'SAPNavigate', 'SAPDiagnose', 'SAPTransport']);
  for (const q of data.questions) {
    assert.ok(q.calls.length > 0 && q.answer.length > 0, `${q.id} needs a call and an answer`);
    for (const c of q.calls) {
      assert.ok(allowed.has(c.tool), `${c.tool} is not an allowed tool`);
      JSON.parse(c.args);
    }
  }
});

test('abap-workbench answer about transports matches the data', () => {
  const holders = data.transports.filter((t) => t.status === 'modifiable' && t.objects.includes('ZORDER_REPORT'));
  assert.equal(holders.length, 2);
  assert.equal(new Set(holders.map((t) => t.owner)).size, 2, 'the sample demonstrates a conflict');
  const q = data.questions.find((x) => /transports/i.test(x.q));
  for (const t of holders) assert.match(q.answer.join(' '), new RegExp(t.id));
});

test('abap-workbench is a static, sandbox-safe page', () => {
  assert.doesNotMatch(page, /\bfetch\(|XMLHttpRequest|localStorage|type="submit"/);
  assert.match(page, /wb:ask/);
  assert.match(page, /not call an SAP system|does not call an SAP system/);
});

const lineOf = (obj, needle) => (data.sources[obj] ?? []).findIndex((l) => l.toLowerCase().includes(needle.toLowerCase())) + 1;
function evalCheck(c) {
  if (c.kind === 'object') return names.has(c.name);
  if (c.kind === 'source') return lineOf(c.object, c.needle) > 0;
  return Boolean(data.messages?.[c.msag]?.[c.no]);
}
function status(r) {
  const n = r.checks.filter(evalCheck).length;
  return n === r.checks.length ? 'met' : n === 0 ? 'missing' : 'partly';
}

test('abap-workbench spec check: checks point at real objects, and the answer matches the computed status', () => {
  for (const r of data.spec.requirements) {
    for (const c of r.checks) {
      assert.ok(['object', 'source', 'message'].includes(c.kind), `${r.id}: unknown check kind`);
      if (c.kind === 'source') assert.ok(names.has(c.object), `${r.id}: unknown object ${c.object}`);
      if (c.kind === 'message') assert.ok(names.has(c.msag), `${r.id}: unknown message class ${c.msag}`);
    }
  }
  const by = { met: [], partly: [], missing: [] };
  for (const r of data.spec.requirements) by[status(r)].push(r.id);
  assert.ok(by.met.length && by.partly.length && by.missing.length, 'the sample shows all three states');
  const answer = data.questions.find((q) => q.id === 'q5').answer.join(' ');
  assert.match(answer, new RegExp(`${by.met.length} of ${data.spec.requirements.length} requirements are met`));
  for (const [state, ids] of Object.entries(by)) for (const id of ids) assert.match(answer, new RegExp(id), `${id} (${state}) is named in the answer`);
});

test('abap-workbench ATC findings point at the line they name', () => {
  assert.equal(new Set(data.atc.findings.map((f) => f.id)).size, data.atc.findings.length);
  for (const f of data.atc.findings) {
    assert.ok(names.has(f.object), `${f.id}: unknown object`);
    assert.ok([1, 2, 3].includes(f.prio));
    assert.equal(lineOf(f.object, f.needle), f.line, `${f.id}: line ${f.line} must contain "${f.needle}"`);
  }
  const q = data.questions.find((x) => x.id === 'q6');
  const report = data.atc.findings.filter((f) => f.object === 'ZORDER_REPORT');
  assert.match(q.answer.join(' '), new RegExp(`${['No', 'One', 'Two', 'Three'][report.length]} ATC finding`));
  assert.match(q.answer.join(' '), new RegExp(`line ${report[0].line}`));
});

test('abap-workbench: the prompt sent to Joule fits what the app accepts, and no tool in the sample changes anything', () => {
  const sp = data.spec;
  const prompt = `Compare spec ${sp.id} with the ABAP system, read only. Per requirement: met, partly or missing, with the object or line as proof. ${sp.requirements.map((r) => `${r.id} ${r.text}`).join(' ')}`;
  assert.ok(prompt.length <= MAX_ASK_LENGTH, `prompt has ${prompt.length} characters`);
  assert.ok(page.includes('prompt.length > 600'), 'the page keeps its own guard');
  const calls = data.questions.flatMap((q) => q.calls.map((c) => c.tool));
  assert.ok(!calls.some((t) => /Write|Activate|Query|Git|Manage/.test(t)));
  for (const q of data.questions) for (const c of q.calls) if (c.tool === 'SAPTransport') assert.equal(JSON.parse(c.args).action, 'list');
});
