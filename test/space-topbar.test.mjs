import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('with two or more filters the Space tools get their own row so the title is not squeezed away', () => {
  const view = read('src/ui/SpaceViewer.tsx');
  assert.match(view, /tools\.filters\.length >= 2 \? 'space-tools-wide' : ''/);
  const css = read('src/theme.css');
  assert.match(css, /\.topbar:has\(\.space-tools-wide\) \{ flex-wrap: wrap;/);
  assert.match(css, /\.space-tools-wide \{ order: 1; flex: 1 1 100%; margin-left: 0; \}/);
});
