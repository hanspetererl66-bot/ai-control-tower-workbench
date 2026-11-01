import assert from 'node:assert/strict';
import test from 'node:test';

import { frame } from '../src/gem.ts';

test('the gem shows the table, crown and pavilion facets that face the viewer, painted far to near', () => {
  const f = frame(0.3);
  assert.ok(f.faces.length >= 6 && f.faces.length <= 13, `${f.faces.length} facets visible`);
  const zs = f.faces.map((x) => x.z);
  assert.deepEqual(zs, [...zs].sort((a, b) => a - b));
  for (const face of f.faces) assert.match(face.points, /^(\d+\.\d+,\d+\.\d+ ?)+$/);
});

test('the picture changes as the stone turns and repeats after one full turn', () => {
  const a = JSON.stringify(frame(0.2).faces.map((x) => x.points));
  const b = JSON.stringify(frame(0.9).faces.map((x) => x.points));
  const c = JSON.stringify(frame(0.2 + Math.PI * 2).faces.map((x) => x.points));
  assert.notEqual(a, b);
  assert.equal(a, c);
});

test('it flashes when a facet looks straight at the viewer and is quiet in between', () => {
  const samples = Array.from({ length: 360 }, (_, i) => frame((i / 360) * Math.PI * 2).glint);
  const peak = Math.max(...samples), low = Math.min(...samples);
  assert.ok(peak > 0.8, `peak ${peak}`);
  assert.ok(low < 0.35, `low ${low}`);
  // six facets around the stone: six flashes per turn
  let flashes = 0;
  for (let i = 0; i < samples.length; i += 1) if (samples[i] > 0.6 && samples[i] >= samples[(i + 359) % 360] && samples[i] > samples[(i + 1) % 360]) flashes += 1;
  assert.ok(flashes >= 5 && flashes <= 7, `${flashes} flashes per turn`);
});
