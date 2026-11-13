import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GUIDE_KEY, GUIDE_STEPS, placeBubble, readGuidePref, stepsFor, writeGuidePref } from '../src/ontology-guide.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const mem = (init) => { const m = new Map(init ? [[GUIDE_KEY, init]] : []); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

test('every tab has tips, and every target exists in the view', () => {
  const view = read('src/ui/OntologyManagerView.tsx') + read('src/ui/OntologyDetails.tsx');
  for (const tab of ['catalog', 'map', 'questions', 'proposals', 'quality', 'use', 'history', 'export']) {
    assert.ok(stepsFor(tab).length > 0, tab);
    for (const s of stepsFor(tab)) {
      assert.ok(s.title && s.text, `${tab} step is written out`);
      const ok = s.target.startsWith('tab-') ? view.includes('data-guide={`tab-${t.id}`}') : view.includes(`data-guide="${s.target}"`);
      assert.ok(ok, `${tab}: no part named ${s.target}`);
    }
  }
  assert.equal(Object.keys(GUIDE_STEPS).length, 8);
});

test('the bubble sits on the asked side, flips when it does not fit, and stays inside the view', () => {
  const size = { width: 300, height: 120 }, view = { width: 1000, height: 700 };
  assert.equal(placeBubble({ left: 100, top: 100, width: 200, height: 40 }, size, view, 'below').side, 'below');
  assert.equal(placeBubble({ left: 100, top: 600, width: 200, height: 40 }, size, view, 'below').side, 'above', 'no room below');
  const edge = placeBubble({ left: 960, top: 100, width: 30, height: 30 }, size, view, 'below');
  assert.ok(edge.left + size.width <= view.width - 12 && edge.left >= 12);
  assert.ok(edge.arrow >= 18 && edge.arrow <= size.width - 18);
  assert.equal(placeBubble({ left: 20, top: 100, width: 200, height: 300 }, size, view, 'right').side, 'right');
  const tall = placeBubble({ left: 20, top: 650, width: 100, height: 40 }, size, view, 'right');
  assert.ok(tall.top + size.height <= view.height - 12);
});

test('the switch and the seen tabs are remembered, and broken storage means tips on', () => {
  assert.deepEqual(readGuidePref(mem()), { on: true, seen: [] });
  const s = mem();
  assert.ok(writeGuidePref(s, { on: false, seen: ['catalog'] }));
  assert.deepEqual(readGuidePref(s), { on: false, seen: ['catalog'] });
  assert.deepEqual(readGuidePref(mem('not json')), { on: true, seen: [] });
  assert.deepEqual(readGuidePref(mem(JSON.stringify({ on: true, seen: ['map', 'evil', 5] }))), { on: true, seen: ['map'] });
  assert.equal(writeGuidePref({ getItem: () => null, setItem: () => { throw new Error('blocked'); } }, { on: true, seen: [] }), false);
  assert.deepEqual(readGuidePref(null), { on: true, seen: [] });
});

test('the guide is wired in: switch lives in Settings, one tour per tab, off for good, no network, tokens only', () => {
  const view = read('src/ui/OntologyManagerView.tsx'), guide = read('src/ui/OntologyGuide.tsx'), css = read('src/theme.css'), panels = read('src/ui/PreferencesPanels.tsx'), app = read('src/App.tsx');
  assert.doesNotMatch(view, /role="switch"/, 'the on/off switch moved to Settings');
  assert.match(panels, /role="switch"[^>]*checked=\{prefs\.tips\.enabled\}/);
  assert.match(app, /tipsOn=\{prefs\.tips\.enabled\}/);
  assert.match(view, /<OntologyGuide /);
  assert.match(view, /!guide\.seen\.includes\(tab\)/);
  assert.match(view, /Tips are off/);
  assert.doesNotMatch(guide, /fetch\(|localStorage|XMLHttpRequest/);
  const block = css.slice(css.indexOf('/* Ontology Manager: Tips switch'));
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}\b/, 'colours only from tokens');
  assert.match(block, /var\(--tip-bg, var\(--panel\)\)/);
  assert.match(block, /var\(--tip-text, var\(--ink\)\)/);
  assert.match(block, /prefers-reduced-motion: reduce\) \{ \.om-guide \{ animation: none; \} \}/);
});

test('the tile and the heading say Ontology Manager', () => {
  const admin = read('src/ui/AdminView.tsx');
  assert.match(admin, /develop-card-title">Ontology Manager</);
  assert.doesNotMatch(admin, /Open Ontologies|card-title">Ontologies/);
});
