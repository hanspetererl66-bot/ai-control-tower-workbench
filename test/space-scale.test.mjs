import assert from 'node:assert/strict';
import test from 'node:test';
import { applySpaceScale, DEFAULT_SPACE_SCALE, parseSpaceScale, readSpaceScale, writeSpaceScale } from '../src/space-scale.ts';

test('default is 115% and unknown values fall back to it', () => {
  assert.equal(DEFAULT_SPACE_SCALE, 1.15);
  assert.equal(parseSpaceScale('1.3'), 1.3);
  assert.equal(parseSpaceScale(1), 1);
  for (const bad of ['abc', '2', null, undefined, '', 0]) assert.equal(parseSpaceScale(bad), 1.15);
});

test('scale is read and written through storage and survives a broken storage', () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  assert.equal(readSpaceScale(storage), 1.15);
  writeSpaceScale(1.3, storage);
  assert.equal(readSpaceScale(storage), 1.3);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readSpaceScale(broken), 1.15);
  assert.doesNotThrow(() => writeSpaceScale(1, broken));
  assert.equal(readSpaceScale(undefined), 1.15);
});

test('the rule is injected once into the head, or in front of a page without head; 100% changes nothing', () => {
  const page = '<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body>hi</body></html>';
  const scaled = applySpaceScale(page, 1.15);
  assert.ok(scaled.includes('<head><style id="werkbank-space-scale">html{zoom:1.15}</style><meta'));
  assert.equal(applySpaceScale(scaled, 1.3), scaled, 'idempotent');
  assert.equal(applySpaceScale(page, 1), page);
  assert.ok(applySpaceScale('<p>fragment</p>', 1.3).startsWith('<style id="werkbank-space-scale">html{zoom:1.3}</style>'));
  assert.ok(applySpaceScale('<HEAD lang="de"><title>x</title>', 1.15).includes('<HEAD lang="de"><style'));
});
