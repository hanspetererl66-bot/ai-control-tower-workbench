import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const composer = readFileSync(path.join(root, 'src/ui/Composer.tsx'), 'utf8');
const manage = readFileSync(path.join(root, 'src/ui/ManageView.tsx'), 'utf8');
const spaces = readFileSync(path.join(root, 'src/spaces.ts'), 'utf8');

test('the public product surface uses Werkbank branding', () => {
  assert.match(app, /Werkbank uses AI/);
  assert.match(composer, /Message Werkbank/);
});

test('connector import and all generated Spaces are available in the product surface', () => {
  assert.match(manage, /Import \.mcpb/);
  assert.doesNotMatch(spaces, /FEATURED_SPACE_SLUG|visibleSpaces/);
});
