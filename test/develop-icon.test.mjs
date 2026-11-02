import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Develop rail icon is square brackets around two slashes', () => {
  const src = readFileSync(new URL('../src/ui/Rail.tsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function DevelopIcon()'), src.indexOf('function ChatIcon()'));
  assert.match(body, /M5\.5 3\.5H3v13h2\.5/, 'left bracket');
  assert.match(body, /M14\.5 3\.5H17v13h-2\.5/, 'right bracket');
  assert.equal((body.match(/M\d+\.\d+ 13\.4/g) ?? []).length, 1, 'slash path present');
  assert.match(body, /M8\.6 13\.4 10\.4 6\.6M11\.8 13\.4l1\.8-6\.8/, 'two slashes');
});
