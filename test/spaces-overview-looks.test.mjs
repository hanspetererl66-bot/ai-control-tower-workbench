import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_PREFERENCES, OVERVIEW_LAYOUTS, TILE_STYLES, profileSettingsOf, sanitizePreferences } from '../src/preferences.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('three page layouts and three tile designs, with the current look as the default', () => {
  assert.deepEqual([...OVERVIEW_LAYOUTS], ['grid', 'list', 'board']);
  assert.deepEqual([...TILE_STYLES], ['classic', 'outline', 'bold']);
  assert.equal(DEFAULT_PREFERENCES.overviewLayout, 'grid');
  assert.equal(DEFAULT_PREFERENCES.tileStyle, 'classic');
});

test('settings: valid choices stay, anything else falls back; both are part of a profile', () => {
  const p = sanitizePreferences({ overviewLayout: 'board', tileStyle: 'bold' });
  assert.equal(p.overviewLayout, 'board');
  assert.equal(p.tileStyle, 'bold');
  const bad = sanitizePreferences({ overviewLayout: 'carousel', tileStyle: 7 });
  assert.equal(bad.overviewLayout, 'grid');
  assert.equal(bad.tileStyle, 'classic');
  assert.equal(profileSettingsOf(p).overviewLayout, 'board');
  assert.equal(profileSettingsOf(p).tileStyle, 'bold');
});

test('wired in: App passes the choices, the overview sets them as data attributes on both of its pages, Settings has the pickers', () => {
  assert.match(read('src/App.tsx'), /layout=\{prefs\.overviewLayout\}/);
  assert.match(read('src/App.tsx'), /tileStyle=\{prefs\.tileStyle\}/);
  const ov = read('src/ui/SpacesOverview.tsx');
  assert.equal((ov.match(/data-overview=\{layout\} data-tile=\{tileStyle\}/g) ?? []).length, 2);
  const panel = read('src/ui/PreferencesPanels.tsx');
  assert.match(panel, /title="Spaces overview"/);
  assert.match(panel, /kind="layout"/);
  assert.match(panel, /kind="tile"/);
});

test('every layout and every tile design has its styles, with tokens only', () => {
  const css = read('src/theme.css');
  const from = css.indexOf('/* ---- Spaces overview: three page layouts');
  assert.ok(from > 0);
  const block = css.slice(from);
  for (const l of ['list', 'board']) assert.match(block, new RegExp(`\\.sov\\[data-overview="${l}"\\]`));
  for (const t of ['outline', 'bold']) assert.match(block, new RegExp(`\\.sov\\[data-tile="${t}"\\]`));
  for (const kind of ['layout-grid', 'layout-list', 'layout-board', 'tile-classic', 'tile-outline', 'tile-bold']) assert.match(block, new RegExp(`\\.ovp-${kind}`));
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgb\(/, 'colours only as tokens');
});
