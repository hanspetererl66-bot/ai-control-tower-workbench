import assert from 'node:assert/strict';
import test from 'node:test';
import { SPACE_ORDER_KEY, loadSpaceOrder, moveSpace, nudgeSpace, orderSpaces, sortByTitle, saveSpaceOrder } from '../src/space-order.ts';

const spaces = ['a', 'b', 'c', 'd'].map((slug) => ({ slug }));

test('orderSpaces follows the saved order and puts new Spaces at the end', () => {
  assert.deepEqual(orderSpaces(spaces, ['c', 'a']).map((s) => s.slug), ['c', 'a', 'b', 'd']);
  assert.deepEqual(orderSpaces(spaces, []).map((s) => s.slug), ['a', 'b', 'c', 'd']);
  assert.deepEqual(orderSpaces(spaces, ['x', 'd', 'gone']).map((s) => s.slug), ['d', 'a', 'b', 'c']);
});

test('moveSpace puts a Space before or after the target', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveSpace(order, 'd', 'b'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveSpace(order, 'a', 'c', true), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveSpace(order, 'a', 'a'), order);
  assert.deepEqual(moveSpace(order, 'zzz', 'b'), order);
  assert.equal(order.join(), 'a,b,c,d', 'input is not mutated');
});

test('nudgeSpace moves one step and stops at the ends', () => {
  const order = ['a', 'b', 'c'];
  assert.deepEqual(nudgeSpace(order, 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(nudgeSpace(order, 'b', 1), ['a', 'c', 'b']);
  assert.deepEqual(nudgeSpace(order, 'a', -1), order);
  assert.deepEqual(nudgeSpace(order, 'c', 1), order);
});

test('the order survives a reload and bad stored data is ignored', () => {
  const values = new Map();
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  saveSpaceOrder(storage, ['b', 'a']);
  assert.deepEqual(loadSpaceOrder(storage), ['b', 'a']);
  values.set(SPACE_ORDER_KEY, '{"not":"a list"}');
  assert.deepEqual(loadSpaceOrder(storage), []);
  values.set(SPACE_ORDER_KEY, 'garbage');
  assert.deepEqual(loadSpaceOrder(storage), []);
  values.set(SPACE_ORDER_KEY, '["a", 5, null, "c"]');
  assert.deepEqual(loadSpaceOrder(storage), ['a', 'c']);
  assert.doesNotThrow(() => saveSpaceOrder({ getItem: () => null, setItem: () => { throw new Error('full'); } }, ['a']));
});

test('sortByTitle: A to Z ignores case and spaces, numbers go by value, ties by folder name; Z to A is the exact reverse', () => {
  const list = [
    { slug: 'x1', title: 'zebra' }, { slug: 'x2', title: ' Apple' }, { slug: 'x3', title: 'Space 10' },
    { slug: 'x4', title: 'space 2' }, { slug: 'x6', title: 'Banana' }, { slug: 'x5', title: 'banana' },
  ];
  assert.deepEqual(sortByTitle(list, 'asc'), ['x2', 'x5', 'x6', 'x4', 'x3', 'x1']);
  assert.deepEqual(sortByTitle(list, 'desc'), ['x1', 'x3', 'x4', 'x6', 'x5', 'x2']);
  assert.deepEqual(sortByTitle([], 'asc'), []);
  assert.equal(list[0].slug, 'x1', 'the list itself is not changed');
});
