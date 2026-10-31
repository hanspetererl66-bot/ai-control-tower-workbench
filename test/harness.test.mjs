import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  BUILTIN_HARNESSES, DEFAULT_HARNESS_STATE, STANDARD_HARNESS, activeHarness, allHarnesses, checkToolCall, chooseHarness, copyHarness, deleteHarness, harnessNote, harnessSummary,
  memoryFor, rejectOption, requiresApproval, sanitizeHarness, sanitizeHarnessState, saveHarness, stepsExceeded,
} from '../src/harness.ts';
import { DEFAULT_PREFERENCES, exportPreferences, importPreferences, resetAll, sanitizePreferences } from '../src/preferences.ts';

const read = (rel) => readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');
const get = (id) => BUILTIN_HARNESSES.find((p) => p.id === id);

test('every ready-made profile is valid, has a unique id, and the standard one adds nothing', () => {
  const ids = BUILTIN_HARNESSES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of BUILTIN_HARNESSES) assert.deepEqual(sanitizeHarness(p), p, `${p.id} survives sanitizing unchanged`);
  assert.equal(harnessNote(STANDARD_HARNESS), '');
  assert.equal(requiresApproval(STANDARD_HARNESS), false);
  assert.equal(harnessSummary(STANDARD_HARNESS), 'Standard: no extra rules');
});

test('sanitizing drops bad ids and names, clamps limits and cleans lists', () => {
  assert.equal(sanitizeHarness(null), null);
  assert.equal(sanitizeHarness({ id: 'Bad Id', name: 'x' }), null);
  assert.equal(sanitizeHarness({ id: 'ok', name: '   ' }), null);
  const p = sanitizeHarness({
    id: 'ok', name: ' Mine ', persona: 'a\u0000b', permission: 'root', memory: 'everything', answerForm: 'poem', maxSteps: 999,
    connectors: ['ai-control-tower', 'ai-control-tower', 'has space', 5], skills: ['x'], spaces: ['sales'],
  });
  assert.equal(p.name, 'Mine');
  assert.equal(p.persona, 'ab');
  assert.equal(p.permission, 'standard');
  assert.equal(p.memory, 'all');
  assert.equal(p.answerForm, 'free');
  assert.equal(p.maxSteps, 50);
  assert.deepEqual(p.connectors, ['ai-control-tower']);
  assert.equal(sanitizeHarness({ id: 'ok', name: 'n', maxSteps: -3 }).maxSteps, 0);
});

test('the state keeps own profiles, refuses ready-made ids and unknown choices, and caps the list', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const s = sanitizeHarnessState({ active: 'p3', custom: [{ id: 'review', name: 'Fake' }, { id: 'p1', name: 'One' }, { id: 'p1', name: 'Dup' }, ...many] });
  assert.equal(s.custom.length, 10);
  assert.equal(s.custom[0].name, 'One');
  assert.ok(!s.custom.some((p) => p.id === 'review'));
  assert.equal(s.active, 'p3');
  assert.equal(sanitizeHarnessState({ active: 'nope' }).active, 'standard');
  assert.deepEqual(sanitizeHarnessState(undefined), DEFAULT_HARNESS_STATE);
});

test('choosing, saving, copying and deleting profiles', () => {
  let s = sanitizeHarnessState({});
  assert.equal(chooseHarness(s, 'sales').active, 'sales');
  assert.equal(chooseHarness(s, 'missing'), s);
  assert.equal(saveHarness(s, { ...get('review'), name: 'Changed' }), s, 'a ready-made profile cannot be overwritten');
  s = copyHarness(s, 'review', 'Controlling review');
  assert.equal(s.custom.length, 1);
  assert.equal(s.active, 'controlling-review');
  assert.equal(activeHarness(s).permission, 'read-only', 'a copy starts with the rules of its source');
  assert.equal(copyHarness(s, 'review', 'Controlling review').custom.length, 2, 'the same name gets its own id');
  s = saveHarness(s, { ...activeHarness(s), maxSteps: 5 });
  assert.equal(activeHarness(s).maxSteps, 5);
  assert.equal(copyHarness(s, 'review', '  ').custom.length, s.custom.length, 'an empty name changes nothing');
  assert.equal(deleteHarness(s, 'review'), s, 'a ready-made profile cannot be deleted');
  const after = deleteHarness(s, 'controlling-review');
  assert.equal(after.active, 'standard');
  assert.ok(!allHarnesses(after).some((p) => p.id === 'controlling-review'));
});

test('the note carries persona, connectors, skills, rights, limit and form, and only narrows', () => {
  const note = harnessNote(get('review'));
  assert.match(note, /^HARNESS "Review \(read only\)"/);
  assert.match(note, /never override safety rules, tool permissions/);
  assert.match(note, /Never change, create or send anything/);
  assert.match(note, /Connectors for this work: ai-control-tower/);
  assert.match(note, /contract-checker/);
  assert.match(note, /read only/i);
  assert.match(note, /at most 12 tool calls/);
  assert.match(note, /finding first/);
  assert.match(harnessNote(get('pre-close')), /Answer form: a table/);
  assert.match(harnessNote(get('sales')), /approval/);
  assert.doesNotMatch(harnessNote({ ...STANDARD_HARNESS, name: 'X', persona: 'Hi' }), /Rights|tool calls|Connectors/);
});

test('the memory shown to the assistant follows the profile', () => {
  const memory = {
    enabled: true,
    entries: [
      { id: '1', kind: 'about', text: 'Leite Sales', createdAt: '' },
      { id: '2', kind: 'style', text: 'Kurz', createdAt: '' },
      { id: '3', kind: 'context', text: 'Projekt Alpha', createdAt: '' },
    ],
  };
  assert.equal(memoryFor(STANDARD_HARNESS, memory), memory);
  assert.deepEqual(memoryFor({ ...STANDARD_HARNESS, memory: 'personal' }, memory).entries.map((e) => e.id), ['1', '2']);
  assert.equal(memoryFor({ ...STANDARD_HARNESS, memory: 'none' }, memory).entries.length, 0);
  assert.equal(memory.entries.length, 3, 'the stored memory is not touched');
});

test('read only refuses everything that is not clearly a read, and a connector list refuses other connectors', () => {
  const review = get('review');
  assert.equal(checkToolCall(review, { toolName: 'ai-control-tower__get_contract' }).ok, true);
  assert.equal(checkToolCall(review, { toolName: 'ai-control-tower__search_graph' }).ok, true);
  const write = checkToolCall(review, { toolName: 'ai-control-tower__create_ticket' });
  assert.equal(write.ok, false);
  assert.match(write.reason, /read only/);
  assert.equal(checkToolCall(review, { toolName: 'ai-control-tower__frobnicate' }).ok, false, 'unknown counts as not a read');
  assert.equal(checkToolCall(review, { toolName: 'developer__shell' }).ok, false, 'built-in shell is a change');
  assert.equal(checkToolCall(review, { toolName: 'developer__read_file' }).ok, true, 'built-in tools are not hit by the connector list');
  const other = checkToolCall(review, { toolName: 'gmail__search_messages' });
  assert.equal(other.ok, false);
  assert.match(other.reason, /does not allow the connector gmail/);
  assert.equal(checkToolCall({ ...review, connectors: [] }, { toolName: 'gmail__search_messages' }).ok, true, 'an empty list means no restriction');
  assert.equal(checkToolCall(review, { toolName: 'AI_Control_Tower__get_contract' }).ok, true, 'names are compared without case and separators');
  assert.equal(checkToolCall(get('sales'), { toolName: 'ai-control-tower__create_ticket' }).ok, true, 'ask mode leaves the decision to the approval card');
  assert.equal(checkToolCall(STANDARD_HARNESS, { toolName: 'anything__delete_all' }).ok, true);
});

test('the step limit counts calls and zero means no limit', () => {
  assert.equal(stepsExceeded(get('review'), 12), false);
  assert.equal(stepsExceeded(get('review'), 13), true);
  assert.equal(stepsExceeded(STANDARD_HARNESS, 10_000), false);
});

test('a refused approval request is answered with the reject option the agent offered', () => {
  assert.equal(rejectOption([{ optionId: 'allow_once' }, { optionId: 'reject_once' }, { optionId: 'reject_always' }]), 'reject_once');
  assert.equal(rejectOption([{ optionId: 'allow' }, { optionId: 'reject_always' }]), 'reject_always');
  assert.equal(rejectOption([]), 'reject');
  assert.equal(requiresApproval(get('sales')), true);
  assert.equal(requiresApproval(get('review')), true);
});

test('the profiles live in the settings: saved, exported, imported, validated and kept on reset', () => {
  assert.deepEqual(DEFAULT_PREFERENCES.harness, DEFAULT_HARNESS_STATE);
  const own = copyHarness(DEFAULT_PREFERENCES.harness, 'sales', 'My sales');
  const prefs = sanitizePreferences({ ...DEFAULT_PREFERENCES, harness: own });
  assert.equal(prefs.harness.active, 'my-sales');
  assert.equal(importPreferences(exportPreferences(prefs)).harness.custom[0].name, 'My sales');
  assert.deepEqual(resetAll(prefs).harness, prefs.harness, 'reset to the original keeps saved work setups');
  assert.equal(sanitizePreferences({ harness: { active: 'x', custom: 'junk' } }).harness.active, 'standard');
  assert.deepEqual(sanitizePreferences({}).harness, DEFAULT_HARNESS_STATE);
});

test('the app checks every tool call and approval request, sends the note and the filtered memory, and shows the choice', () => {
  const app = read('src/App.tsx');
  assert.match(app, /checkToolCall\(harnessRef\.current, req\)[\s\S]*resolve\(rejectOption\(req\.options\)\)/, 'a refused approval request is declined without a dialog');
  assert.match(app, /const verdict = checkToolCall\(profile, tc\)[\s\S]*stepsExceeded\(profile, harnessStepCount\.current\)[\s\S]*agentRef\.current\?\.cancel\(\)/);
  assert.match(app, /assistantNote\(prefs\), harnessNote\(harnessRef\.current\), personaNote\(personas\), currentMemoryNote\(contextSpace, memoryFor\(harnessRef\.current, memory\)\)/);
  assert.match(app, /harnessStepCount\.current = 0;\s*harnessBlock\.current = null;/, 'every answer starts with a fresh count');
  assert.match(app, /draft\.current \+= harnessBlock\.current/, 'the person is told why an answer stopped');
  assert.match(app, /requiresApproval\(harness\) && mode === 'auto'\) void changeMode\('smart_approve'\)/);
  assert.match(app, /id: 'harness', label: 'Working profile'/);
  assert.match(app, /onHarnessChange=\{changeHarness\}/);
  const composer = read('src/ui/Composer.tsx');
  assert.match(composer, /aria-label="Working profile"/);
  assert.match(composer, /harnesses\.length > 1/);
  assert.match(read('src/ui/SidePanel.tsx'), /<HarnessPanel prefs=\{prefs\} onPrefs=\{onPrefs\} \/>/);
});
