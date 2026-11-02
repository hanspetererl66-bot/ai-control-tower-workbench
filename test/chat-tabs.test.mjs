import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as t from '../src/chat-tabs.ts';

const NOW = Date.UTC(2026, 10, 2);
const DAY = 86_400_000;
const skills = [
  { name: 'contract-check', description: 'Checks notice periods', updatedAt: NOW - 3 * DAY },
  { name: 'board-briefing', description: 'One page for the board', updatedAt: NOW - 90 * DAY },
  { name: 'ticket-writer', description: '', updatedAt: NOW - 40 * DAY },
  { name: 'pdf', description: 'Work with PDF files', updatedAt: NOW - 1 * DAY },
];
const spaces = [{ slug: 'renewals', title: 'Renewals', description: 'Contracts due', updatedAt: NOW - 5 * DAY }, { slug: 'old', title: 'Old', description: '', updatedAt: NOW - 200 * DAY }];

test('the four tabs are Favorites, Suggested, Popular and What\'s new, in this order', () => {
  assert.deepEqual(t.TABS.map((x) => x.label), ['Favorites', 'Suggested', 'Popular', "What's new"]);
});

test('suggested: skills that are neither favourite nor used yet, with a description first', () => {
  const used = t.recordUse({}, t.skillEntry(skills[0]), NOW);
  const list = t.suggested(skills, ['pdf'], used);
  assert.deepEqual(list.map((e) => e.label), ['board-briefing', 'ticket-writer']);
  assert.equal(list[0].prompt, 'Nutze den Skill board-briefing.');
  assert.ok(t.suggested(Array.from({ length: 20 }, (_, i) => ({ name: `s${i}`, description: 'x' })), [], {}).length <= t.MAX_ENTRIES);
});

test('popular: the most used entries, counted on this computer', () => {
  let u = {};
  u = t.recordUse(u, t.skillEntry(skills[0]), 1); u = t.recordUse(u, t.skillEntry(skills[3]), 2); u = t.recordUse(u, t.skillEntry(skills[3]), 3);
  u = t.recordUse(u, t.spaceEntry(spaces[0]), 4);
  const list = t.popular(u);
  assert.equal(list[0].label, 'pdf'); assert.equal(list[0].hint, '2× used');
  assert.deepEqual(list.slice(1).map((e) => e.label), ['Renewals', 'contract-check'], 'equal counts: the more recent first');
  assert.deepEqual(list.find((e) => e.label === 'Renewals').open, { space: 'renewals' });
  assert.deepEqual(t.popular({}), []);
});

test('what\'s new: skills and Spaces changed within 30 days, newest first', () => {
  const list = t.whatsNew(skills, spaces, NOW);
  assert.deepEqual(list.map((e) => e.label), ['pdf', 'contract-check', 'Renewals']);
  assert.deepEqual(t.whatsNew([], [], NOW), []);
});

test('the use counts are bounded and survive storage; broken entries are dropped', () => {
  let u = {};
  for (let i = 0; i < 80; i++) u = t.recordUse(u, { key: `k${i}`, label: `L${i}`, hint: '', prompt: 'p' }, i);
  u = t.recordUse(u, { key: 'k79', label: 'L79', hint: '', prompt: 'p' }, 100);
  assert.ok(Object.keys(u).length <= 60);
  assert.equal(u.k79.count, 2, 'the entry used most is kept');
  const store = new Map();
  const s = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  t.saveUse(s, u);
  assert.deepEqual(t.loadUse(s), JSON.parse(JSON.stringify(u)));
  store.set(t.USE_KEY, JSON.stringify({ a: { label: 'ok', count: 2, last: 1 }, b: { label: 1 }, c: null, d: { label: 'neg', count: -1 } }));
  assert.deepEqual(Object.keys(t.loadUse(s)), ['a']);
  store.set(t.USE_KEY, 'not json');
  assert.deepEqual(t.loadUse(s), {});
});

test('the composer shows the tabs on the empty chat and the cards hang under Favorites', () => {
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  assert.match(read('src/ui/Composer.tsx'), /<ChatTabs/);
  const tabs = read('src/ui/ChatTabs.tsx');
  assert.match(tabs, /tab === 'favorites'[\s\S]*<BriefingCards/, 'BriefingCards is inside the Favorites panel');
  assert.match(tabs, /role="tablist"/);
  assert.match(read('electron/main.mjs'), /updatedAt/, 'skills carry the change date');
});

test('each tab has an icon and a pill; what is under a tab is set 30 % smaller', () => {
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const tabs = read('src/ui/ChatTabs.tsx');
  for (const id of ['favorites', 'suggested', 'popular']) assert.match(tabs, new RegExp(`id === '${id}'`), `icon for ${id}`);
  assert.match(tabs, /<TabIcon id=\{t\.id\}/);
  const css = read('src/theme.css');
  assert.match(css, /\.chat-tab \{[^}]*border-radius: 999px/, 'the tab is an oval button');
  assert.match(css, /\.chat-tab-panel \{ --tab-scale: 0\.7;/, '70 % of the normal size');
  assert.match(css, /\.chat-tab-panel \.briefing-card h3 \{ font-size: max\(/, 'the cards are scaled too');
});

test('a tab toggles: click opens, second click closes, another tab switches', async () => {
  const { nextTab, readTab } = await import('../src/chat-tabs.ts');
  assert.equal(nextTab(null, 'popular'), 'popular');
  assert.equal(nextTab('popular', 'popular'), null);
  assert.equal(nextTab('popular', 'new'), 'new');
  assert.equal(readTab('none'), null);
  assert.equal(readTab('suggested'), 'suggested');
  assert.equal(readTab(null), 'favorites');
  assert.equal(readTab('bogus'), 'favorites');
});
