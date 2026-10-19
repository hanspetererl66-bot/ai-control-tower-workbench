import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONVERSATION_STORAGE_KEY,
  archiveConversation,
  createConversation,
  deleteConversation,
  filterConversations,
  loadConversationState,
  restoreConversation,
  saveConversationState,
} from '../src/conversations.ts';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test('conversation state persists multiple active conversations and the selected item', () => {
  const first = { ...createConversation('first', 1), title: 'Meeting prep' };
  const second = { ...createConversation('second', 2), title: 'Transport overview' };
  const storage = memoryStorage();

  saveConversationState(storage, { selectedId: second.id, items: [second, first] });
  const loaded = loadConversationState(storage, createConversation('fallback', 3));

  assert.equal(loaded.selectedId, 'second');
  assert.deepEqual(loaded.items.map(({ id }) => id), ['second', 'first']);
});

test('archiving hides an item from active state and selects another active conversation', () => {
  const first = createConversation('first', 1);
  const second = createConversation('second', 2);
  const archived = archiveConversation(
    { selectedId: first.id, items: [first, second] },
    first.id,
    createConversation('replacement', 3)
  );

  assert.equal(archived.items.find(({ id }) => id === 'first')?.archived, true);
  assert.equal(archived.selectedId, 'second');

  const restored = restoreConversation(archived, 'first');
  assert.equal(restored.selectedId, 'first');
  assert.equal(restored.items.find(({ id }) => id === 'first')?.archived, false);
});

test('loading an all-archived store keeps its history and creates a new active conversation', () => {
  const old = { ...createConversation('old', 1), archived: true };
  const storage = memoryStorage({
    [CONVERSATION_STORAGE_KEY]: JSON.stringify({ selectedId: old.id, items: [old] }),
  });
  const loaded = loadConversationState(storage, createConversation('new', 2));

  assert.equal(loaded.selectedId, 'new');
  assert.deepEqual(loaded.items.map(({ id }) => id), ['new', 'old']);
  assert.equal(loaded.items[1].archived, true);
});

test('deleting a conversation removes it for good and keeps a valid selection', () => {
  const a = { ...createConversation('a', 1), title: 'Check my email' };
  const b = createConversation('b', 2);
  const c = { ...createConversation('c', 3), archived: true };
  const state = { selectedId: 'a', items: [a, b, c] };

  const afterOther = deleteConversation(state, 'b');
  assert.deepEqual(afterOther.items.map(({ id }) => id), ['a', 'c']);
  assert.equal(afterOther.selectedId, 'a');

  const afterSelected = deleteConversation(state, 'a');
  assert.deepEqual(afterSelected.items.map(({ id }) => id), ['b', 'c']);
  assert.equal(afterSelected.selectedId, 'b');

  const replacement = createConversation('fresh', 9);
  const last = deleteConversation({ selectedId: 'a', items: [a, c] }, 'a', replacement);
  assert.equal(last.selectedId, 'fresh');
  assert.deepEqual(last.items.map(({ id }) => id), ['fresh', 'c']);

  assert.equal(deleteConversation(state, 'nope'), state);
  const archivedGone = deleteConversation(state, 'c');
  assert.deepEqual(archivedGone.items.map(({ id }) => id), ['a', 'b']);
});

test('conversation search covers titles and message text, filters narrow by time and files', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = new Date(2026, 9, 19, 15, 0, 0).getTime();
  const base = (id, title, updatedAt, extra = {}) => ({ ...createConversation(id, updatedAt), title, updatedAt, ...extra });
  const items = [
    base('a', 'Ariba renewal', now - 60_000, { messages: [{ role: 'user', text: 'Wie steht der Vertrag?' }] }),
    base('b', 'Skills overview', now - 3 * day, { messages: [{ role: 'agent', text: 'Der Skill renewal-radar prüft Verträge.' }], files: [{ path: '/x/report.html' }] }),
    base('c', 'Old topic', now - 30 * day),
  ];
  const ids = (list) => list.map((c) => c.id);
  assert.deepEqual(ids(filterConversations(items)), ['a', 'b', 'c']);
  assert.deepEqual(ids(filterConversations(items, { query: '  ARIBA ' })), ['a'], 'title, case-insensitive, trimmed');
  assert.deepEqual(ids(filterConversations(items, { query: 'renewal' })), ['a', 'b'], 'title and message text');
  assert.deepEqual(ids(filterConversations(items, { query: 'vertrag' })), ['a', 'b'].filter((id) => id === 'a'), 'message text of a user message');
  assert.deepEqual(ids(filterConversations(items, { range: 'today' }, now)), ['a']);
  assert.deepEqual(ids(filterConversations(items, { range: 'week' }, now)), ['a', 'b']);
  assert.deepEqual(ids(filterConversations(items, { range: 'files' }, now)), ['b']);
  assert.deepEqual(ids(filterConversations(items, { query: 'renewal', range: 'files' }, now)), ['b'], 'search and filter combine');
  assert.deepEqual(ids(filterConversations(items, { query: 'nothing like this' })), []);
});
