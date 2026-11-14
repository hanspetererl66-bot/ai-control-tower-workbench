import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const spaces = readdirSync(join(ROOT, 'examples'), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(ROOT, 'examples', e.name, 'index.html'))).map((e) => e.name);

test('no Space has a "What is this page?" box: no intro element, no heading, no text that points at it', () => {
  assert.ok(spaces.length >= 40, 'every example Space is checked');
  for (const name of spaces) {
    const html = readFileSync(join(ROOT, 'examples', name, 'index.html'), 'utf8');
    // the formatting for such a box is part of the shared design system that every page embeds unchanged, and its comment names the box: that stays
    const page = html.replace(/\/\* Collapsible "What is this page\?" card \(details element\) \*\//g, '');
    assert.doesNotMatch(page, /<details class="(?:card )?intro"/, `${name}: the intro box`);
    assert.doesNotMatch(page, /<div class="intro-wrap">/, `${name}: its wrapper`);
    assert.doesNotMatch(page, /What is this page|What is this briefing\?|Was ist diese Seite\?/, `${name}: a heading or a text that names the box`);
  }
});
