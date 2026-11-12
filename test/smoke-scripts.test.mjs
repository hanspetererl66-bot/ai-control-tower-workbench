import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const SCRIPTS = ['scripts/smoke-electron.mjs', 'scripts/smoke-governance.mjs'];
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the smoke scripts find Electron through the package, not through a Linux-only path', () => {
  for (const file of SCRIPTS) {
    const src = read(file);
    const spawned = src.split('\n').filter((l) => /\bspawn\(|\bstart\(/.test(l) && /electron/i.test(l));
    assert.ok(spawned.length >= 1, `${file}: starts Electron`);
    assert.ok(spawned.every((l) => l.includes('electronPath')), `${file}: starts Electron with electronPath`);
    assert.match(src, /createRequire\(import\.meta\.url\)\('electron'\)/, `${file}: resolves the binary with the electron package`);
    assert.doesNotMatch(src.replace(/catch \{ return join\(ROOT, 'node_modules\/electron\/dist\/electron'\); \}/, ''), /electron\/dist\/electron/, `${file}: no hard-coded dist/electron outside the fallback`);
  }
});

test('on this machine the package gives an Electron binary that exists and runs', (t) => {
  let path;
  try { path = createRequire(import.meta.url)('electron'); } catch (error) { t.skip(`Electron is not installed here: ${error.message}`); return; }
  assert.equal(typeof path, 'string');
  assert.ok(existsSync(path), path);
  const version = execFileSync(path, ['--version'], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }).trim();
  assert.match(version, /^v\d+\.\d+\.\d+/);
});
