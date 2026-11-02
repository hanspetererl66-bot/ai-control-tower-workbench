import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendDictation } from '../src/voice-text.ts';

test('appendDictation joins with one space and trims', () => {
  assert.equal(appendDictation('', ' hello ', 400), 'hello');
  assert.equal(appendDictation('Book rooms ', 'for the team', 400), 'Book rooms for the team');
  assert.equal(appendDictation('abc', '', 400), 'abc');
});

test('appendDictation respects the character limit', () => {
  const out = appendDictation('a'.repeat(395), 'bbbbbbbbbb', 400);
  assert.equal(out.length, 400);
});

test('both Develop tiles get the dictation button', () => {
  const src = readFileSync(new URL('../src/ui/DevelopHub.tsx', import.meta.url), 'utf8');
  assert.match(src, /<DictateButton[\s\S]*appendDictation\(g, heard, 400\)/);
  const btn = readFileSync(new URL('../src/ui/DictateButton.tsx', import.meta.url), 'utf8');
  assert.match(btn, /aria-pressed/);
  assert.match(btn, /voice\?\.transcribe/);
});
