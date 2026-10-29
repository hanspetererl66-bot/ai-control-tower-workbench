import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../src/skill-governance.ts';

test('levels can be renamed; blanks and duplicates are refused', () => {
  let s = g.defaultGov();
  s = g.renameLevel(s, 1, '  Vertrieb   EMEA ');
  assert.equal(s.levels[1], 'Vertrieb EMEA');
  assert.equal(g.renameLevel(s, 2, '').levels[2], 'Company');
  assert.equal(g.renameLevel(s, 2, 'vertrieb emea').levels[2], 'Company');
});

test('a skill moves up one level only after approval', () => {
  let s = g.defaultGov();
  s = g.requestPromotion(s, 'a', 'please', 1);
  assert.equal(g.levelOf(s, 'a'), 0);
  assert.equal(g.requestPromotion(s, 'a', 'again', 2).requests.length, 1);
  s = g.decide(s, s.requests[0].id, true, 'ok', 3);
  assert.equal(g.levelOf(s, 'a'), 1);
  s = g.requestPromotion(s, 'a', '', 4);
  s = g.decide(s, s.requests[0].id, true, '', 5);
  assert.equal(g.levelOf(s, 'a'), 2);
  assert.equal(g.requestPromotion(s, 'a', '', 6).requests.length, s.requests.length);
});

test('a rejection keeps the level and can be requested again', () => {
  let s = g.requestPromotion(g.defaultGov(), 'b', '', 1);
  s = g.decide(s, 1, false, 'needs docs', 2);
  assert.equal(g.levelOf(s, 'b'), 0);
  assert.equal(s.requests[0].reason, 'needs docs');
  assert.equal(g.requestPromotion(s, 'b', '', 3).requests.length, 2);
});

test('load/save round trip and bad data falls back', () => {
  let store = {};
  const st = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  let s = g.renameLevel(g.defaultGov(), 0, 'Ich');
  g.saveGov(s, st);
  assert.equal(g.loadGov(st).levels[0], 'Ich');
  store = { [g.GOV_KEY]: '{oops' };
  assert.equal(g.loadGov(st).levels[0], 'Personal');
});
