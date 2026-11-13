import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const composer = readFileSync(join(import.meta.dirname, '..', 'src/ui/Composer.tsx'), 'utf8');

test('the chat input shows "Text . . ." once the agent is connected and "Connecting…" before', () => {
  assert.match(composer, /placeholder=\{agent \? 'Text \. \. \.' : 'Connecting…'\}/);
  assert.ok(!/Message \$\{PRODUCT_TITLE\}/.test(composer), 'the old text is gone');
  assert.ok(!composer.includes('PRODUCT_TITLE'), 'and its import is not left behind');
});
