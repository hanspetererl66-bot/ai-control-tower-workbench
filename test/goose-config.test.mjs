import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { ensureGooseConfig, GOOSE_CONFIG_REL, GOOSE_CONFIG_TEMPLATE_REL } from '../shared/goose-config.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

function fakeRoot(withTemplate = true) {
  const root = mkdtempSync(path.join(tmpdir(), 'goose-config-'));
  mkdirSync(path.join(root, 'goose-home/.config/goose'), { recursive: true });
  if (withTemplate) writeFileSync(path.join(root, GOOSE_CONFIG_TEMPLATE_REL), 'GOOSE_PROVIDER: openrouter\nextensions: {}\n');
  return root;
}

test('the checked-in template is valid and starts without machine-specific extensions', () => {
  const text = readFileSync(path.join(repoRoot, GOOSE_CONFIG_TEMPLATE_REL), 'utf8');
  const config = parse(text);
  assert.equal(config.GOOSE_PROVIDER, 'openrouter');
  assert.deepEqual(config.extensions, {});
  assert.doesNotMatch(text, /\/home\/|\/Users\/|https?:\/\/(?!\S*example)/, 'no absolute paths or instance URLs in the template');
});

test('a missing config.yaml is created from the template', () => {
  const root = fakeRoot();
  try {
    assert.equal(ensureGooseConfig(root), true);
    assert.equal(readFileSync(path.join(root, GOOSE_CONFIG_REL), 'utf8'), readFileSync(path.join(root, GOOSE_CONFIG_TEMPLATE_REL), 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an existing config.yaml is never overwritten', () => {
  const root = fakeRoot();
  try {
    writeFileSync(path.join(root, GOOSE_CONFIG_REL), 'GOOSE_PROVIDER: local\nextensions:\n  mine: {}\n');
    assert.equal(ensureGooseConfig(root), false);
    assert.match(readFileSync(path.join(root, GOOSE_CONFIG_REL), 'utf8'), /extensions:\n {2}mine/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('without a template and without config.yaml it fails with a clear message', () => {
  const root = fakeRoot(false);
  try {
    assert.throws(() => ensureGooseConfig(root), /template is missing/);
    assert.equal(existsSync(path.join(root, GOOSE_CONFIG_REL)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
