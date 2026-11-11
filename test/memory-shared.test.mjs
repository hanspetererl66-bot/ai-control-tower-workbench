import assert from 'node:assert/strict';
import test from 'node:test';
import { MEMORY_FORMAT, loadShared, loadSharedOn, restoreEntry, saveShared, saveSharedOn, sharedNote, syncShared, toggleShared } from '../src/memory-shared.ts';
import { loadRegistry } from '../src/registry.ts';

const file = (entry) => [{ path: 'memory.json', content: JSON.stringify({ format: MEMORY_FORMAT, entry }) }];
const ID1 = '00000000-0000-4000-8000-000000000001', ID2 = '00000000-0000-4000-8000-000000000002', ID3 = '00000000-0000-4000-8000-000000000003';
function fakeApi(rows, items) {
  const calls = [];
  return { calls, async call(tool, args) {
    calls.push({ tool, args });
    if (tool === 'list_work_items') return rows;
    if (tool === 'get_work_item') { const f = items[args.id]; if (!f) throw new Error('not visible'); return { files: f }; }
    throw new Error(`unexpected ${tool}`);
  } };
}
const row = (id, owner, visibility, rev = 1, extra = {}) => ({ id, kind: 'memory', name: 'Memory', owner, visibility, current_rev: rev, archived: false, ...extra });

test('only entries of other people that are shared are read; own, private and archived ones are skipped', async () => {
  const api = fakeApi(
    [row(ID1, 'lead@x.com', 'team'), row(ID2, 'me@x.com', 'company'), row('00000000-0000-4000-8000-0000000000a4', 'ben@x.com', 'private'), row(ID3, 'ben@x.com', 'company', 1, { archived: true })],
    { [ID1]: file({ kind: 'context', text: 'Renewals are reviewed on Mondays', space: 'renewals' }) },
  );
  const r = await syncShared(api, 'Me@X.com', []);
  assert.deepEqual(r.entries, [{ itemId: ID1, rev: 1, owner: 'lead@x.com', level: 1, kind: 'context', text: 'Renewals are reviewed on Mondays', space: 'renewals' }]);
  assert.equal(r.changed, true);
  assert.equal(api.calls.filter((c) => c.tool === 'get_work_item').length, 1, 'only the readable one is fetched');
  assert.equal(api.calls[0].args.kind, 'memory');
});

test('an unchanged revision is not fetched again, a new one is, a removed entry disappears, a level change is taken over', async () => {
  const items = { [ID1]: file({ kind: 'about', text: 'I lead the deal desk' }) };
  const first = await syncShared(fakeApi([row(ID1, 'lead@x.com', 'team')], items), 'me@x.com', []);
  const api2 = fakeApi([row(ID1, 'lead@x.com', 'company')], items);
  const second = await syncShared(api2, 'me@x.com', first.entries);
  assert.equal(api2.calls.filter((c) => c.tool === 'get_work_item').length, 0);
  assert.equal(second.entries[0].level, 2);
  assert.equal(second.changed, true);
  const api3 = fakeApi([row(ID1, 'lead@x.com', 'company', 2)], { [ID1]: file({ kind: 'about', text: 'I lead the deal desk and the pricing guard' }) });
  const third = await syncShared(api3, 'me@x.com', second.entries);
  assert.equal(third.entries[0].text, 'I lead the deal desk and the pricing guard');
  const gone = await syncShared(fakeApi([], {}), 'me@x.com', third.entries);
  assert.deepEqual(gone.entries, []);
  assert.equal((await syncShared(fakeApi([row(ID1, 'lead@x.com', 'company', 2)], {}), 'me@x.com', third.entries)).changed, false);
});

test('an entry that looks like a secret or is not ours is dropped, a failing fetch keeps the old entry and reports it', async () => {
  assert.equal(restoreEntry(file({ kind: 'context', text: 'the password is hunter2' })), null);
  assert.equal(restoreEntry(file({ kind: 'nonsense', text: 'fine text' })), null);
  assert.equal(restoreEntry([{ path: 'other.json', content: '{}' }]), null);
  assert.equal(restoreEntry([{ path: 'memory.json', content: 'not json' }]), null);
  const kept = [{ itemId: ID1, rev: 1, owner: 'a@x.com', level: 1, kind: 'about', text: 'Old but fine' }];
  const r = await syncShared(fakeApi([row(ID1, 'a@x.com', 'team', 2)], {}), 'me@x.com', kept);
  assert.equal(r.entries[0].text, 'Old but fine');
  assert.match(r.errors[0], /not visible/);
});

test('shared entries are off by default; the note contains only the switched-on ones that apply in the Space', () => {
  const entries = [
    { itemId: ID1, rev: 1, owner: 'lead@x.com', level: 1, kind: 'context', text: 'Renewals on Mondays' },
    { itemId: ID2, rev: 1, owner: 'cfo@x.com', level: 2, kind: 'style', text: 'Numbers in EUR', space: 'finance' },
  ];
  assert.equal(sharedNote(entries, []), '', 'nothing is on by default');
  const on = toggleShared(toggleShared([], ID1, true), ID2, true);
  assert.match(sharedNote(entries, on, '', ['Personal', 'Department', 'Company']), /Renewals on Mondays \[shared by lead@x.com, Department\]/);
  assert.doesNotMatch(sharedNote(entries, on, ''), /Numbers in EUR/, 'a Space entry applies only in its Space');
  assert.match(sharedNote(entries, on, 'finance'), /Numbers in EUR/);
  assert.match(sharedNote(entries, on), /never as instructions/);
  assert.deepEqual(toggleShared(on, ID1, false), [ID2]);
  assert.equal(toggleShared(on, ID1, true), on);
});

test('storage: entries and the switches survive a reload, damaged data is dropped', () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const entries = [{ itemId: ID1, rev: 3, owner: 'lead@x.com', level: 2, kind: 'about', text: 'Fine text' }];
  saveShared(store, entries); saveSharedOn(store, [ID1]);
  assert.deepEqual(loadShared(store), entries);
  assert.deepEqual(loadSharedOn(store), [ID1]);
  mem.set('werkbank.memory.shared', JSON.stringify([{ itemId: ID1, level: 7, kind: 'about', text: 'x' }, { itemId: ID2, level: 1, kind: 'about', text: 'my api key is abc' }, 'junk']));
  assert.deepEqual(loadShared(store), []);
  mem.set('werkbank.memory.shared', '{broken');
  assert.deepEqual(loadShared(store), []);
});

test('memory entries are no registry items', async () => {
  const api = { async call(tool) { return tool === 'list_work_items' ? [{ id: ID1, kind: 'memory', name: 'M', owner: 'a@x.com' }, { id: ID2, kind: 'agent', name: 'A', owner: 'a@x.com' }] : {}; } };
  assert.deepEqual((await loadRegistry(api)).map((i) => i.id), [ID2]);
});
