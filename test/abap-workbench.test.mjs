import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embedMockupData } from '../scripts/sync-mockup-spaces.mjs';

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
  const allowed = new Set(['SAPSearch', 'SAPRead', 'SAPContext', 'SAPNavigate', 'SAPTransport']);
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
