import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { GRID_PALETTE, GRID_PITCH, gridSize, litAlpha, shimmer, spawnCount } from '../src/cover-grid.ts';

test('the grid fills the box and never collapses', () => {
  const { cols, rows } = gridSize(1000, 300);
  assert.ok(cols * GRID_PITCH <= 1000 + 5 && (cols + 1) * GRID_PITCH > 1000 + 5 - 1);
  assert.ok(rows >= 10);
  assert.deepEqual(gridSize(0, 0), { cols: 1, rows: 1 });
});

test('cubes light up at a steady rate and the remainder is carried over', () => {
  let carry = 0, total = 0;
  for (let i = 0; i < 100; i += 1) { const s = spawnCount(1000, 16, carry); carry = s.carry; total += s.count; }
  assert.ok(Math.abs(total + carry - 19.2) < 1e-6, 'nothing is lost: spawned plus carry equals the wanted number');
  assert.ok(carry >= 0 && carry < 1);
});

test('grey brightness and lit alpha stay in range, lit cubes fade in and out', () => {
  for (let t = 0; t < 20000; t += 997) assert.ok(shimmer(7, 20, 3, 1.3, t) >= 0 && shimmer(7, 20, 3, 1.3, t) <= 1);
  assert.equal(litAlpha(-1, 1000), 0);
  assert.equal(litAlpha(1000, 1000), 0);
  assert.ok(litAlpha(50, 2000) < 1 && litAlpha(1000, 2000) === 1 && litAlpha(1900, 2000) < 1);
  assert.ok(GRID_PALETTE.length >= 5);
});

test('the cover sheet shows the grid, respects reduced motion and cleans up', () => {
  const root = join(import.meta.dirname, '..');
  assert.match(readFileSync(join(root, 'src/ui/CoverSheet.tsx'), 'utf8'), /<CoverGrid \/>/);
  const grid = readFileSync(join(root, 'src/ui/CoverGrid.tsx'), 'utf8');
  assert.match(grid, /prefers-reduced-motion: reduce/);
  assert.match(grid, /cancelAnimationFrame\(frame\)/);
  assert.match(grid, /observer\.disconnect\(\)/);
});
