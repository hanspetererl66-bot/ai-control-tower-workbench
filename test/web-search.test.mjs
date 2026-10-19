import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_PROVIDERS, WEB_SEARCH_OFF_NOTE, WEB_SEARCH_ON_NOTE, isWebTool, webSearchNote } from '../src/web-search.ts';
import { createConversation, loadConversationState, saveConversationState } from '../src/conversations.ts';

test('the instruction follows the switch', () => {
  assert.equal(webSearchNote(true), WEB_SEARCH_ON_NOTE);
  assert.equal(webSearchNote(false), WEB_SEARCH_OFF_NOTE);
  assert.match(WEB_SEARCH_OFF_NOTE, /do not use any web search/i);
});

test('web tools are recognised, connectors are not', () => {
  for (const call of [
    { toolName: 'computercontroller__web_scrape' },
    { toolName: 'brave-search__brave_web_search' },
    { toolName: 'fetch_url' },
    { title: 'Web search: SAP TechEd 2026' },
    { toolName: 'tavily_search' },
  ]) assert.equal(isWebTool(call), true, JSON.stringify(call));
  for (const call of [
    { toolName: 'ai-control-tower__get_contracts' },
    { toolName: 'ai-control-tower__search_graph' },
    { toolName: 'search_skills' },
    { toolName: 'gmail__search_messages', title: 'Search mail' },
    { toolName: 'developer__shell', title: 'ls' },
    { toolName: 'n8n__list_workflows' },
    {},
  ]) assert.equal(isWebTool(call), false, JSON.stringify(call));
});

test('only OpenRouter is available in the Model menu, the others are shown but disabled', () => {
  assert.deepEqual(MODEL_PROVIDERS.filter((p) => p.available).map((p) => p.id), ['openrouter']);
  assert.ok(MODEL_PROVIDERS.length > 1 && MODEL_PROVIDERS[0].id === 'openrouter');
});

test('the switch is per conversation, on by default and persists', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const a = createConversation('a', 1);
  const b = { ...createConversation('b', 2), webSearch: false };
  assert.equal(a.webSearch, true);
  saveConversationState(storage, { selectedId: 'a', items: [a, b] });
  const loaded = loadConversationState(storage);
  assert.equal(loaded.items.find((c) => c.id === 'a').webSearch, true);
  assert.equal(loaded.items.find((c) => c.id === 'b').webSearch, false);
  // conversations saved before the switch existed stay on
  store.set('werkbank.conversations.v1', JSON.stringify({ selectedId: 'old', items: [{ id: 'old', title: 'Old', messages: [], files: [] }] }));
  assert.equal(loadConversationState(storage).items[0].webSearch, true);
});
