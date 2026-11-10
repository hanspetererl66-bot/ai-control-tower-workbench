import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// A working call for a Space or a Develop page (developGenerate) opens its own conversation. It must NOT switch the app to the chat:
// that unmounts the Space, its answers and the pending reply are lost (seen in the Electron app, 10.11.2026).
// Source-text checks, because App.tsx is not importable; the real behaviour was checked in the Electron app.
const app = readFileSync(join(import.meta.dirname, '..', 'src/App.tsx'), 'utf8');
const body = (name) => app.slice(app.indexOf(name), app.indexOf(name) + 1600);

test('a working call opens its conversation without leaving the current view', () => {
  assert.match(body('async function developGenerate'), /newConversation\(\{ keepView: true \}\)/);
});

test('only the keepView option skips the switch to the chat', () => {
  assert.match(app, /function resetConversationSurface\(conversationFiles: GeneratedFile\[\] = \[\], options: \{ keepView\?: boolean \} = \{\}\) \{\s*setDetailsOpen\(false\);\s*if \(!options\.keepView\) setView\('chat'\);/);
  assert.match(app, /function newConversation\(options: \{ keepView\?: boolean \} = \{\}\)/);
  assert.match(app, /resetConversationSurface\(\[\], options\);/);
});

test('the buttons that start a chat by hand still go to the chat, and never pass a click event as options', () => {
  assert.equal((app.match(/onNew=\{\(\) => \{ newConversation\(\); \}\}/g) || []).length, 2);
  assert.match(app, /onNewChat=\{\(\) => \{ newConversation\(\); \}\}/);
  assert.equal(/onNew=\{newConversation\}/.test(app), false);
});

test('the other ways into a conversation still switch to the chat', () => {
  for (const call of ['resetConversationSurface(conversationFiles)', 'resetConversationSurface(conversation.files)', 'resetConversationSurface(nextSelected.files)']) {
    assert.ok(app.includes(call) || app.includes(call.replace('(conversationFiles)', '(conversation.files)')), call);
  }
  assert.equal(/keepView: true/.test(app.replace(/newConversation\(\{ keepView: true \}\)/, '')), false, 'keepView is used in one place only');
});
