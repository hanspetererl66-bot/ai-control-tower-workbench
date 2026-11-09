import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');

test('the Space toolbar menu button and icon-button hover have dark values, not the light fills', () => {
  assert.match(css, /\.topbar > \.icon-btn:first-child \{[^}]*background: #fbfbfd;/); // light fill stays
  assert.match(css, /:root\[data-theme="dark"\] \.topbar > \.icon-btn:first-child \{\s*background: var\(--bg\);/);
  assert.match(css, /:root\[data-theme="dark"\] \.icon-btn:hover \{\s*background: #222630;/);
});
