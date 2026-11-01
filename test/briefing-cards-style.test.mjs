import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const css = readFileSync(path.resolve(import.meta.dirname, '..', 'src/theme.css'), 'utf8');
const rule = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} exists`);
  return css.slice(start, css.indexOf('}', start));
};

test('the text on the briefing cards is 25% smaller than before (13px, 12px and 12px become 9.75px and 9px)', () => {
  assert.match(rule('.briefing-card'), /--briefing-text:\s*0\.75;/);
  assert.match(rule('.briefing-card h3'), /font-size:\s*calc\(13px \* var\(--briefing-text\)\)/);
  assert.match(rule('.briefing-card p'), /font-size:\s*calc\(12px \* var\(--briefing-text\)\)/);
  assert.match(rule('.briefing-action'), /font-size:\s*calc\(12px \* var\(--briefing-text, 0\.75\)\)/);
});

test('the cards are compact and quiet: outlined without fill, thin edge, small padding, no entrance animation', () => {
  const card = rule('.briefing-card');
  assert.match(card, /background:\s*transparent/);
  assert.match(card, /border-left:\s*2px solid/);
  assert.match(card, /padding:\s*6px 10px/);
  assert.match(card, /gap:\s*2px/);
  assert.doesNotMatch(card, /animation/);
  assert.doesNotMatch(css, /briefing-in/);
  assert.match(rule('.briefing-grid'), /minmax\(180px, 1fr\)[\s\S]*gap:\s*6px/);
  assert.match(rule('.briefing-card p'), /-webkit-line-clamp:\s*2/);
  assert.match(rule('.briefing-action'), /padding:\s*1px 8px/);
});

test('the label on the card is scaled with the card text; the title and the category tabs above the cards are smaller and tighter, not scaled', () => {
  assert.match(rule('.briefing-area'), /font-size:\s*calc\(11px \* var\(--briefing-text, 0\.75\)\)/);
  assert.match(rule('.briefing-title'), /font-size:\s*12px/);
  assert.match(rule('.briefing-tab'), /font-size:\s*11px/);
  assert.match(rule('.briefing-tab'), /padding:\s*2px 10px/);
});

test('the full text of a card stays available as a tooltip when it is cut after two lines', () => {
  const tsx = readFileSync(path.resolve(import.meta.dirname, '..', 'src/ui/BriefingCards.tsx'), 'utf8');
  assert.match(tsx, /<p title=\{card\.detail\}>\{card\.detail\}<\/p>/);
});
