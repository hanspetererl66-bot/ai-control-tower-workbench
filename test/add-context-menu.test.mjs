import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the add-context menu does not reuse the fixed right-click menu class', () => {
  const composer = read('../src/ui/Composer.tsx');
  assert.match(composer, /className="menu add-context-menu"/);
  assert.doesNotMatch(composer, /menu context-menu/);
  const css = read('../src/theme.css');
  assert.match(css, /\.add-context-menu \{ min-width: 200px; \}/);
});
