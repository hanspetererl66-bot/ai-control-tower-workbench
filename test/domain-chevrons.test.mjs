import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const css = readFileSync(join(ROOT, 'src/theme.css'), 'utf8');
const list = readFileSync(join(ROOT, 'src/ui/SpacesList.tsx'), 'utf8');
const rule = (sel) => new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

test('the open/closed sign of a domain is violet (the accent) and twice the old 12 px', () => {
  assert.match(list, /<span className="domain-chev" aria-hidden="true">\{isCollapsed \? '▸' : '▾'\}<\/span>/);
  const r = rule('.domain-chev');
  assert.match(r, /font-size: 24px/, 'the domain heading text is 12 px, the sign is twice that');
  assert.match(r, /color: var\(--accent\)/, 'violet by default, and it follows a chosen accent colour');
  assert.doesNotMatch(r, /#[0-9a-fA-F]{3,8}\b|rgb\(/, 'no colour outside the tokens');
  assert.match(rule('.domain-toggle'), /font-size: 12px/, 'the heading itself keeps its size');
});

test('the sign keeps a fixed box so the heading does not jump, grows a little on hover, and holds still with reduced motion', () => {
  const r = rule('.domain-chev');
  assert.match(r, /width: 24px/);
  assert.match(r, /height: 24px/);
  assert.match(css, /\.domain-toggle:hover \.domain-chev,\s*\.domain-toggle:focus-visible \.domain-chev \{\s*transform: scale\(1\.12\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.domain-chev \{ transition: none; \}/);
});
