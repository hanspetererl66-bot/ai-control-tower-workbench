import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source-text checks: electron/main.mjs cannot be imported without Electron.
const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const ready = main.slice(main.indexOf('app.whenReady().then(() => {'));
const body = ready.slice(0, ready.indexOf('app.on(\'activate\''));

test('a second instance does not start goosed', () => {
  assert.match(main, /const gotSingleInstanceLock = app\.requestSingleInstanceLock\(\)/);
  assert.match(body, /if \(!gotSingleInstanceLock\) return;/);
  assert.ok(body.indexOf('gotSingleInstanceLock') < body.indexOf('setTimeout(startGoosed'));
});

test('the window opens before goosed starts (the keychain read can block the main process)', () => {
  assert.ok(body.indexOf('void createWindow()') > -1 && body.indexOf('void createWindow()') < body.indexOf('setTimeout(startGoosed'));
  assert.match(body, /createWindow\(\)\.then\(\(\) => \{ setTimeout\(startGoosed, \d+\); \}\)/);
});

test('the restart path still starts goosed directly', () => {
  assert.match(main, /goosed\?\.kill\(\);[\s\S]{0,200}startGoosed\(\);/);
});
