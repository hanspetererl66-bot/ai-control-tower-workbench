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

test('the area title and the category tabs above the cards keep their size', () => {
  assert.match(rule('.briefing-title'), /font-size:\s*12px/);
  assert.match(rule('.briefing-area'), /font-size:\s*11px/);
  assert.match(rule('.briefing-tab'), /font-size:\s*12\.5px/);
});
