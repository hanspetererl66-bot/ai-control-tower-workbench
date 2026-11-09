import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const map = read('src/ui/OntologyMap.tsx');
const view = read('src/ui/OntologyManagerView.tsx');
const css = read('src/theme.css');

test('the map is a living graph: a simulation that settles on screen, drag a node, curved links with lights, areas, overview', () => {
  assert.match(map, /createSimulation/);
  assert.match(map, /requestAnimationFrame\(loop\)/);
  assert.match(map, /quadraticCurveTo/, 'links are curved');
  assert.match(map, /createRadialGradient/, 'glow and areas');
  assert.match(map, /kind: 'node'/, 'a node can be dragged');
  assert.match(map, /pinned\[d\.i\] = 1/);
  assert.match(map, /small overview in the corner/);
  assert.match(map, /camTo/, 'the camera eases to its target');
  assert.match(map, /deprecated/, 'deprecated terms look different');
});

test('the loop stops when nothing moves, and reduced motion shows the finished layout without any animation', () => {
  assert.match(map, /if \(busy\) kick\(\);/, 'the loop schedules itself only while something moves');
  assert.match(map, /prefers-reduced-motion: reduce/);
  assert.match(map, /if \(quiet\) \{\s*const done = layoutMap\(map\)/, 'finished layout at once');
  assert.match(map, /if \(!quiet && !e\.weak/, 'no travelling lights without motion');
  assert.match(map, /\{!quiet && <button[^>]*>Replay<\/button>\}/);
});

test('the map takes its colours from tokens and touches no network or storage', () => {
  assert.doesNotMatch(map, /fetch\(|localStorage|sessionStorage|XMLHttpRequest/);
  assert.doesNotMatch(map.replace(/'#[0-9a-fA-F]{3,6}'/g, ''), /#[0-9a-fA-F]{6}\b/, 'colours only come from the tokens (the only literals are fallbacks)');
  for (const token of ['--panel', '--ink', '--muted', '--line', '--accent', '--om-ok', '--om-warn', '--om-bad']) assert.match(map, new RegExp(token));
});

test('the Ontology Manager has the new tabs and the new styles stop moving for reduced motion', () => {
  for (const tab of ["id: 'questions'", "id: 'export'", "'deprecated'"]) assert.match(view, new RegExp(tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(view, /OntologyQuestions/);
  assert.match(view, /OntologyExport/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.om-tag-btn \{ transition: none; \}/);
  const added = css.slice(css.indexOf('/* Ontology Manager: lifecycle, synonyms'));
  assert.doesNotMatch(added, /#[0-9a-fA-F]{3,8}\b|rgb\(/, 'no colour outside the tokens in the new styles');
});
