import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_PREFERENCES, SPACES_DOCKS, exportPreferences, importPreferences, profileSettingsOf, sanitizePreferences, sanitizeProfileSettings } from '../src/preferences.ts';
import { DOCK_LABEL, isBarDock, listSide, showListSplitter, spacesDockClass } from '../src/spaces-dock.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('setting: the Spaces list sits on the left by default; the choice is part of the profile and survives export and import', () => {
  assert.deepEqual([...SPACES_DOCKS], ['left', 'right', 'top', 'bottom']);
  assert.equal(DEFAULT_PREFERENCES.spacesDock, 'left');
  assert.equal(sanitizePreferences({}).spacesDock, 'left');
  assert.equal(sanitizePreferences({ spacesDock: 'right' }).spacesDock, 'right');
  assert.equal(sanitizePreferences({ spacesDock: 'top' }).spacesDock, 'top');
  assert.equal(sanitizePreferences({ spacesDock: 'bottom' }).spacesDock, 'bottom');
  assert.equal(sanitizePreferences({ spacesDock: 'middle' }).spacesDock, 'left', 'a side that does not exist falls back');
  assert.deepEqual(sanitizeProfileSettings({ spacesDock: 'right' }), { spacesDock: 'right' });
  assert.deepEqual(sanitizeProfileSettings({ spacesDock: 'x' }), {}, 'an invalid profile value is dropped, not defaulted');
  const p = { ...DEFAULT_PREFERENCES, spacesDock: 'right', spacesView: 'tree' };
  assert.equal(profileSettingsOf(p).spacesDock, 'right');
  const back = importPreferences(exportPreferences(p));
  assert.equal(back.spacesDock, 'right');
  assert.equal(back.spacesView, 'tree', 'the view and the side are separate choices');
});

test('rules: the list moves only in the Spaces view; the left list of other views stays where it is', () => {
  assert.equal(spacesDockClass('spaces', 'right'), 'app-spaces-right');
  assert.equal(spacesDockClass('spaces', 'top'), 'app-spaces-top');
  assert.equal(spacesDockClass('spaces', 'bottom'), 'app-spaces-bottom');
  assert.equal(spacesDockClass('spaces', 'left'), '', 'the left side is the grid as it always was');
  for (const view of ['chat', 'manage', 'studio', 'skills']) for (const dock of ['right', 'top', 'bottom']) assert.equal(spacesDockClass(view, dock), '', `${view} ${dock}`);
  assert.equal(listSide('spaces', 'right'), 'right');
  assert.equal(listSide('spaces', 'left'), 'left');
  assert.equal(listSide('spaces', 'top'), 'left', 'a bar has no side for the divider');
  assert.equal(listSide('chat', 'right'), 'left', 'the conversation list of the chat is not the Spaces list');
  assert.deepEqual(SPACES_DOCKS.filter(isBarDock), ['top', 'bottom']);
  assert.equal(showListSplitter('spaces', 'left'), true);
  assert.equal(showListSplitter('spaces', 'right'), true);
  assert.equal(showListSplitter('spaces', 'top'), false, 'a bar takes the height it needs: no divider');
  assert.equal(showListSplitter('chat', 'top'), true, 'the chat list keeps its divider');
  assert.deepEqual(Object.keys(DOCK_LABEL), [...SPACES_DOCKS], 'every side has a label');
});

test('wiring: the grid, the splitter, the menu in the header and the settings page all follow the same choice', () => {
  const app = read('src/App.tsx'), list = read('src/ui/SpacesList.tsx'), split = read('src/ui/Splitter.tsx'), css = read('src/theme.css'), prefs = read('src/ui/PreferencesPanels.tsx');
  assert.match(app, /spacesDockClass\(view, prefs\.spacesDock\)/);
  assert.match(app, /side=\{listSide\(view, prefs\.spacesDock\)\}/);
  assert.match(app, /dock=\{prefs\.spacesDock\}/);
  assert.match(app, /onDockChange=\{\(next\) => updatePrefs\(\(c\) => \(\{ \.\.\.c, spacesDock: next \}\)\)\}/);
  assert.match(css, /\.app-spaces-right \{ grid-template-columns: var\(--rail-w\) minmax\(0, 1fr\) var\(--list-w\); \}/);
  assert.match(css, /\.app-spaces-right > \.list \{ order: 3;/, 'the list takes the last column without moving anything else');
  assert.match(css, /\.app-spaces-right \.study-badge \{ left: auto; right: 14px; \}/, 'the badge goes with the list and does not cover the content');
  assert.match(css, /\.splitter-list-right \{ left: auto; right: calc\(var\(--list-w\) - 5px\); \}/);
  assert.match(split, /side === 'right' \? -1 : 1/, 'a list on the right grows when the divider moves left');
  assert.match(list, /role="menuitemradio"/);
  assert.match(list, /aria-haspopup="menu"/);
  assert.match(list, /event\.key === 'Escape'/, 'the menu closes on Escape');
  assert.match(prefs, /<Choice label="Position" value=\{prefs\.spacesDock\}/);
  assert.match(prefs, /<Choice label="View" value=\{prefs\.spacesView\}/);
});

test('wiring: top and bottom turn the list into a bar of tabs and chips, without a divider, and the badge moves into the bar', () => {
  const app = read('src/App.tsx'), list = read('src/ui/SpacesList.tsx'), css = read('src/theme.css');
  assert.match(app, /showListSplitter\(view, prefs\.spacesDock\) && <Splitter/);
  assert.match(css, /\.app-spaces-top, \.app-spaces-bottom \{ grid-template-columns: var\(--rail-w\) minmax\(0, 1fr\); grid-template-rows: auto minmax\(0, 1fr\); \}/);
  assert.match(css, /\.app-spaces-bottom \{ grid-template-rows: minmax\(0, 1fr\) auto; \}/);
  assert.match(css, /\.app-spaces-top > \.rail, \.app-spaces-bottom > \.rail \{ grid-row: 1 \/ span 2; \}/, 'the rail spans both rows');
  assert.match(css, /\.app-spaces-bottom > \.list \{ order: 3; \}/);
  assert.match(css, /\.app-spaces-top \.study-badge \{ left: auto; right: 14px; top: 8px; bottom: auto; \}/);
  assert.match(css, /\.app-spaces-bottom \.study-badge \{ left: auto; right: 14px; \}/);
  assert.match(list, /role="tablist" aria-label="Domains"/);
  assert.match(list, /role="tab"/);
  assert.match(list, /aria-selected=\{t\.name === m\.active\}/);
  assert.match(list, /role="menuitem"/, 'subspaces are in a menu on their chip');
  assert.match(list, /aria-label=\{`Manage \$\{current\.title\}`\}/, 'the open Space has a menu for rename, duplicate, archive, delete and pin');
  assert.match(list, /if \(bar\) return renderBar\(\);/);
});
