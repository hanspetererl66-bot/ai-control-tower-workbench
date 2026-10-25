import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_MEMORY, addMemory, deleteMemory, loadMemory, looksSecret, memoryNote, saveMemory, suggestMemory, updateMemory } from '../src/memory.ts';

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('entries are added, changed and deleted; duplicates, secrets and overflow are refused', () => {
  let r = addMemory(EMPTY_MEMORY, 'about', '  Ich leite das  Sales-Team  ');
  assert.equal(r.state.entries[0].text, 'Ich leite das Sales-Team');
  assert.match(addMemory(r.state, 'about', 'ich leite das sales-team').error, /already/);
  assert.match(addMemory(r.state, 'about', 'Mein Passwort ist abc').error, /not stored/);
  assert.match(addMemory(r.state, 'about', '4111 1111 1111 1111').error, /not stored/);
  assert.match(addMemory(r.state, 'about', '   ').error, /Write/);
  const id = r.state.entries[0].id;
  r = updateMemory(r.state, id, 'Ich leite Sales EMEA');
  assert.equal(r.state.entries[0].text, 'Ich leite Sales EMEA');
  assert.equal(deleteMemory(r.state, id).entries.length, 0);
  let full = EMPTY_MEMORY;
  for (let i = 0; i < 50; i++) full = addMemory(full, 'fact' === 'x' ? 'about' : 'context', `Note ${i}`, new Date(i)).state;
  assert.match(addMemory(full, 'context', 'one more').error, /full/);
});

test('memory survives a reload, drops damaged or secret entries and can be switched off', () => {
  const s = store();
  let st = addMemory(EMPTY_MEMORY, 'style', 'Antworte kurz').state;
  saveMemory(s, st);
  assert.equal(loadMemory(s).entries.length, 1);
  s.setItem('werkbank.memory', JSON.stringify({ enabled: false, entries: [{ id: 'a', kind: 'about', text: 'ok' }, { id: 'b', kind: 'zzz', text: 'bad kind' }, { id: 'c', kind: 'about', text: 'my api key is 123' }] }));
  const loaded = loadMemory(s);
  assert.equal(loaded.enabled, false);
  assert.deepEqual(loaded.entries.map((e) => e.id), ['a']);
  assert.equal(memoryNote(loaded), '');
  assert.equal(loadMemory({ getItem: () => 'not json' }).entries.length, 0);
});

test('the note groups entries by kind and says it never overrides safety', () => {
  let st = addMemory(EMPTY_MEMORY, 'context', 'Projekt Falke startet im Januar').state;
  st = addMemory(st, 'about', 'Ich bin Berater bei Accenture').state;
  const note = memoryNote(st);
  assert.ok(note.indexOf('About me') < note.indexOf('Projects and context'));
  assert.match(note, /never override safety rules/);
});

test('suggestions come only from clear requests and are not made for secrets or known entries', () => {
  assert.deepEqual(suggestMemory('Merk dir: Projekt Falke startet im Januar', EMPTY_MEMORY), { kind: 'context', text: 'Projekt Falke startet im Januar' });
  assert.deepEqual(suggestMemory('Please remember that I prefer short answers.', EMPTY_MEMORY), { kind: 'context', text: 'I prefer short answers' });
  assert.equal(suggestMemory('Ab jetzt antworte auf Deutsch', EMPTY_MEMORY)?.kind, 'style');
  assert.equal(suggestMemory('Ich bin Berater bei Accenture', EMPTY_MEMORY)?.kind, 'about');
  assert.equal(suggestMemory('Wie wird das Wetter morgen?', EMPTY_MEMORY), null);
  assert.equal(suggestMemory('Merk dir mein Passwort hunter2', EMPTY_MEMORY), null);
  assert.equal(suggestMemory('Merk dir: Projekt Falke', { enabled: false, entries: [] }), null);
  const known = addMemory(EMPTY_MEMORY, 'context', 'Projekt Falke startet im Januar').state;
  assert.equal(suggestMemory('Merk dir: Projekt Falke startet im Januar', known), null);
  assert.ok(looksSecret('sk-abcdefghijklmnop'));
});
