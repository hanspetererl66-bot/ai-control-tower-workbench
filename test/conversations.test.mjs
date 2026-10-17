import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONVERSATION_STORAGE_KEY,
  archiveConversation,
  createConversation,
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
