import test from 'node:test';
import assert from 'node:assert/strict';
import { canRedo, canUndo, commit, parsePreviewMessage, redo, startHistory, undo, withPreview } from '../src/space-designer-state.ts';
import { addBlock, emptyLayout } from '../src/space-layout.ts';

test('history: commit, undo, redo; identical state is not recorded', () => {
  let h = startHistory(emptyLayout());
  assert.equal(canUndo(h), false);
  const a = addBlock(h.present, 'text').layout;
  h = commit(h, a);
  assert.equal(h.present.blocks.length, 1);
  assert.equal(commit(h, JSON.parse(JSON.stringify(a))), h);
  h = undo(h);
  assert.equal(h.present.blocks.length, 0);
  assert.equal(canRedo(h), true);
  h = redo(h);
  assert.equal(h.present.blocks.length, 1);
  h = undo(h);
  h = commit(h, addBlock(h.present, 'divider').layout);
  assert.equal(canRedo(h), false, 'a new change clears redo');
});

test('history keeps at most 60 steps', () => {
  let h = startHistory(emptyLayout());
  for (let i = 0; i < 80; i += 1) h = commit(h, addBlock(h.present, 'divider').layout);
  assert.equal(h.past.length, 60);
});

test('preview messages: only known block ids and finite scroll values', () => {
  const l = addBlock(emptyLayout(), 'text').layout;
  const id = l.blocks[0].id;
  assert.deepEqual(parsePreviewMessage({ type: 'wbd:select', id }, l), { type: 'select', id });
  assert.equal(parsePreviewMessage({ type: 'wbd:select', id: 'nope' }, l), null);
  assert.equal(parsePreviewMessage({ type: 'wbd:scroll', y: Infinity }, l), null);
  assert.deepEqual(parsePreviewMessage({ type: 'wbd:scroll', y: 120 }, l), { type: 'scroll', y: 120 });
  assert.equal(parsePreviewMessage('x', l), null);
});

test('preview page: script and outline are added, a bad id adds no rule', () => {
  const html = '<html><body><main></main></body></html>';
  const out = withPreview(html, 'b1', 40);
  assert.ok(out.includes('[data-wb-block="b1"]') && out.includes('wbd:select') && out.includes('var y=40'));
  assert.ok(!withPreview(html, 'b1"]{x', 0).includes('b1"]{x'));
});
