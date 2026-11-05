import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { describeAction } from '../src/approval.ts';
import { BUILTIN_HARNESSES, checkToolCall } from '../src/harness.ts';

const ROOT = join(import.meta.dirname, '..');
const risk = (tool, rawInput = {}, ext = 'arc1') => describeAction({ toolName: `${ext}__${tool}`, rawInput }).risk;

test('ARC-1 read tools are shown as reads', () => {
  for (const t of ['SAPRead', 'SAPSearch', 'SAPNavigate', 'SAPContext', 'SAPLint', 'SAPDiagnose']) assert.equal(risk(t, { type: 'CLAS', name: 'ZCL_X' }), 'reads', t);
});

test('ARC-1 write tools are shown as changes, whatever their arguments', () => {
  for (const t of ['SAPWrite', 'SAPActivate', 'SAPGit']) {
    assert.equal(risk(t), 'changes', t);
    assert.equal(risk(t, { action: 'list' }), 'changes', `${t} with a read-looking action`);
  }
});

test('transports: only list, get, check and history are reads; every other action, and a missing one, changes the system', () => {
  for (const a of ['list', 'get', 'check', 'history', 'LIST']) assert.equal(risk('SAPTransport', { action: a }), 'reads', a);
  for (const a of ['create', 'release', 'delete', 'reassign', 'list_and_delete', '']) assert.equal(risk('SAPTransport', { action: a }), 'changes', a);
  assert.equal(risk('SAPTransport', {}), 'changes');
  assert.equal(risk('SAPTransport', { action: 42 }), 'changes');
});

test('business data and unclear tools need a look: table contents, free SQL, SAPManage', () => {
  assert.equal(risk('SAPRead', { type: 'TABLE_CONTENTS', name: 'USR02' }), 'unknown');
  assert.equal(risk('SAPRead', { object_type: ' table_contents ' }), 'unknown', 'any argument name, any case');
  assert.equal(risk('SAPQuery', { sql: 'SELECT * FROM mara' }), 'unknown');
  assert.equal(risk('SAPManage', { action: 'features' }), 'unknown');
});

test('the name of the connector does not matter, only the tool', () => {
  assert.equal(risk('SAPWrite', {}, 'ARC-1 | S4 DEV'), 'changes');
  assert.equal(describeAction({ toolName: 'SAPRead', rawInput: {} }).risk, 'reads', 'also without a connector prefix');
});

test('other connectors keep the word rules', () => {
  assert.equal(risk('list_contracts', {}, 'control-tower'), 'reads');
  assert.equal(risk('create_ticket', {}, 'sub4me'), 'changes');
  assert.equal(risk('sap_sandbox_query', {}, 'sap-sandbox'), 'reads');
});

test('the read-only working profile lets ARC-1 reads through and stops everything else', () => {
  const profile = BUILTIN_HARNESSES.find((p) => p.permission === 'read-only');
  assert.ok(profile, 'a built-in read-only profile exists');
  const ok = (tool, rawInput) => checkToolCall({ ...profile, connectors: [] }, { toolName: `arc1__${tool}`, rawInput }).ok;
  assert.equal(ok('SAPSearch', { query: 'ZCL*' }), true);
  assert.equal(ok('SAPRead', { type: 'CLAS' }), true);
  assert.equal(ok('SAPTransport', { action: 'list' }), true);
  for (const [tool, args] of [['SAPWrite', {}], ['SAPActivate', {}], ['SAPGit', {}], ['SAPTransport', { action: 'release' }], ['SAPQuery', {}], ['SAPRead', { type: 'TABLE_CONTENTS' }], ['SAPManage', {}]]) {
    assert.equal(ok(tool, args), false, `${tool} ${JSON.stringify(args)} is blocked`);
  }
});

test('every tool of the ARC-1 catalog entry is classified, and nothing that changes or reads data counts as a read', () => {
  const d = JSON.parse(readFileSync(join(ROOT, 'examples/mcp-marketplace/servers.json'), 'utf8'));
  const arc = d.servers.find((s) => s.id === 'arc-1');
  for (const t of arc.tools) {
    const r = risk(t.name);
    assert.ok(['reads', 'changes', 'unknown'].includes(r));
    if (t.class === 'read') assert.notEqual(r, 'changes', `${t.name} is a read in the catalog`);
    else assert.notEqual(r, 'reads', `${t.name} is ${t.class} in the catalog and must not look like a read`);
  }
  assert.ok(arc.tools.every((t) => /^SAP[A-Z]/.test(t.name)), 'catalog tool names follow the SAP* pattern the rules know');
  const known = new Set(['SAPRead', 'SAPSearch', 'SAPNavigate', 'SAPContext', 'SAPLint', 'SAPDiagnose', 'SAPManage', 'SAPWrite', 'SAPActivate', 'SAPTransport', 'SAPGit', 'SAPQuery']);
  assert.deepEqual(arc.tools.map((t) => t.name).filter((n) => !known.has(n)), [], 'a new ARC-1 tool must be classified in src/approval.ts');
});
