import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Develop rail icon is angle brackets around two slashes: <//>', () => {
  const src = readFileSync(new URL('../src/ui/Rail.tsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function DevelopIcon()'), src.indexOf('function ChatIcon()'));
  assert.match(body, /M5\.6 6 1\.8 10l3\.8 4/, 'left chevron');
  assert.match(body, /M14\.4 6l3\.8 4-3\.8 4/, 'right chevron');
  assert.match(body, /M8\.5 14\.2 9\.7 5\.8M10\.8 14\.2l1\.2-8\.4/, 'two slashes');
});
