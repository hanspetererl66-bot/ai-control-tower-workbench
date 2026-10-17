import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const css = readFileSync(path.resolve(import.meta.dirname, '../src/theme.css'), 'utf8');

test('the application shell stays fixed while chat and side panels scroll independently', () => {
  assert.match(css, /html,\s*body,\s*#root\s*{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.app\s*{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.main\s*{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.chat\s*{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
});
