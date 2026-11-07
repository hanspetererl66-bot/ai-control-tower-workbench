import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const composer = readFileSync(new URL('../src/ui/Composer.tsx', import.meta.url), 'utf8');
const contextBar = readFileSync(new URL('../src/ui/ChatContextBar.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');

test('the skill bolt puts the cursor in the input and explains itself when Joule is not connected', () => {
  assert.match(composer, /inputRef\.current\?\.focus\(\)/);
  assert.match(composer, /Joule is not connected yet/);
});

test('the working folder opens from the context panel through the main process, never a path from the page', () => {
  assert.match(app, /window\.host\?\.openWorkspace\?\.\(\)/);
  assert.match(contextBar, /Working folder/);
  assert.match(preload, /openWorkspace: \(\) => ipcRenderer\.invoke\('open-workspace'\)/);
  assert.match(main, /ipcMain\.handle\('open-workspace', async \(\) => \{\s*const detail = await shell\.openPath\(WORKSPACE\)/);
});

test('the model menu lists only providers that are connected', () => {
  assert.match(composer, /MODEL_PROVIDERS\.filter\(\(provider\) => provider\.available\)/);
});

test('the bar stays clean: working profile, approval mode and folder moved into the context panel', () => {
  assert.doesNotMatch(composer, /aria-label="Working profile"/);
  assert.doesNotMatch(composer, /title="Approval mode"/);
  assert.doesNotMatch(composer, /Open the working folder/);
  assert.match(contextBar, /aria-label="Working profile"/);
  assert.match(contextBar, /aria-label="Approval mode"/);
  assert.match(contextBar, /ctx-shield/);
});
