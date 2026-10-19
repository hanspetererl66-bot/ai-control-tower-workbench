import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isNumericCell, isUnbreakable } from '../src/markdown-table.ts';

test('numbers, amounts and percentages are numeric; ids, dates and text are not', () => {
  for (const ok of ['90', '410.000', '1.234,56', '€ 290.000', '290.000 €', '12 %', '-3,5', '4.5 h', '2 Mio.']) assert.ok(isNumericCell(ok), ok);
  for (const no of ['', 'C-2025-0041', '31.12.2026', '2027-01-31', 'Erneuerung fällig', '4.800 Mitarbeiter', 'Q3', 'v2']) assert.ok(!isNumericCell(no), no);
});

test('ids and single words stay on one line, sentences may wrap', () => {
  assert.ok(isUnbreakable('C-2025-0041') && isUnbreakable('Vertrag-ID') && isUnbreakable('90'));
  assert.ok(!isUnbreakable('SuccessFactors Employee Central') && !isUnbreakable('') && !isUnbreakable('x'.repeat(40)));
});

test('chat renders GitHub-flavoured Markdown so tables become tables', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.dependencies['remark-gfm'], 'remark-gfm is a dependency');
  const chat = readFileSync(new URL('../src/ui/Chat.tsx', import.meta.url), 'utf8');
  assert.match(chat, /<ChatMarkdown text=\{m\.text\}/);
  const md = readFileSync(new URL('../src/ui/ChatMarkdown.tsx', import.meta.url), 'utf8');
  assert.match(md, /remarkPlugins=\{\[remarkGfm\]\}/);
  const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  assert.match(css, /\.md-table\s*\{/);
});
