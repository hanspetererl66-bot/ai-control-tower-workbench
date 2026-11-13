import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PREFERENCES, allProfiles, applyProfile, assistantNote, deleteProfile, exportPreferences, importPreferences,
  loadPreferences, pinFirst, saveProfile, sanitizePreferences, savePreferences, startSpace, togglePin,
} from '../src/preferences.ts';
import { accentVariants, applySpacePrefs, buildPreferenceCss } from '../src/preferences-style.ts';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)) }; };

test('sanitize falls back to defaults for junk and clamps values', () => {
  assert.deepEqual(sanitizePreferences(null), DEFAULT_PREFERENCES);
  const p = sanitizePreferences({ accent: 'red; x', appScale: 9, font: 'comic', density: 'roomy', starters: [{ label: 'a', prompt: '' }, { label: 'ok', prompt: 'p' }] });
  assert.equal(p.accent, '');
  assert.equal(p.appScale, 1);
  assert.equal(p.font, 'default');
  assert.equal(p.density, 'roomy');
  assert.deepEqual(p.starters, [{ label: 'ok', prompt: 'p' }]);
});

test('profiles: built-ins apply, own profiles save and delete', () => {
  assert.ok(allProfiles(DEFAULT_PREFERENCES).length >= 5);
  const demo = applyProfile(DEFAULT_PREFERENCES, 'demo');
  assert.equal(demo.activeProfile, 'demo');
  const saved = saveProfile({ ...demo, accent: '#0070F2' }, 'Mein Profil');
  assert.ok(allProfiles(saved).some((x) => x.name === 'Mein Profil'));
  const mine = saved.profiles[0];
  assert.equal(deleteProfile(saved, mine.id).profiles.length, 0);
  assert.equal(deleteProfile(saved, 'demo').profiles.length, saved.profiles.length);
});

test('storage round trip and export/import', () => {
  const s = mem();
  const p = { ...DEFAULT_PREFERENCES, accent: '#0070F2', pinnedSpaces: ['a'] };
  savePreferences(p, s);
  assert.equal(loadPreferences(s).accent, '#0070F2');
  assert.equal(importPreferences(exportPreferences(p)).pinnedSpaces[0], 'a');
  assert.throws(() => importPreferences('{"x":1}'));
  assert.throws(() => importPreferences('nope'));
});

test('pins keep order and toggle', () => {
  const sp = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
  assert.deepEqual(pinFirst(sp, ['c', 'zz']).map((x) => x.slug), ['c', 'a', 'b']);
  assert.deepEqual(togglePin([], 'a'), ['a']);
  assert.deepEqual(togglePin(['a'], 'a'), []);
});

test('assistant note is empty by default and lists the choices', () => {
  assert.equal(assistantNote(DEFAULT_PREFERENCES), '');
  const note = assistantNote({ ...DEFAULT_PREFERENCES, assistant: { language: 'de', length: 'concise', tone: 'formal', instructions: 'Nenne Quellen.' } });
  assert.match(note, /German/);
  assert.match(note, /short/);
  assert.match(note, /Nenne Quellen/);
});

test('start view', () => {
  const slugs = ['a', 'b'];
  assert.equal(startSpace(DEFAULT_PREFERENCES, slugs, 'a'), null);
  assert.equal(startSpace({ ...DEFAULT_PREFERENCES, startView: 'last' }, slugs, 'b'), 'b');
  assert.equal(startSpace({ ...DEFAULT_PREFERENCES, startView: 'last' }, slugs, 'x'), null);
  assert.equal(startSpace({ ...DEFAULT_PREFERENCES, startView: 'space:a' }, slugs, null), 'a');
  assert.equal(startSpace({ ...DEFAULT_PREFERENCES, startView: 'space:gone' }, slugs, null), null);
});

test('style: accent, contrast, motion reach app and Spaces', () => {
  const p = { ...DEFAULT_PREFERENCES, accent: '#0070F2', contrast: 'high', reduceMotion: true, font: 'mono' };
  const css = buildPreferenceCss(p);
  assert.match(css, /#0070f2/i);
  assert.equal(buildPreferenceCss(DEFAULT_PREFERENCES).includes('#'), false);
  const html = applySpacePrefs('<html><head></head><body></body></html>', p);
  assert.match(html, /id="werkbank-space-prefs"/);
  assert.match(html, /--purple/);
  assert.equal(/--canvas|--purple/.test(applySpacePrefs('<html><head></head></html>', DEFAULT_PREFERENCES)), false, 'the default adds layout rules but no colours');
  assert.ok(accentVariants('#ffff00').dark);
});

import { DEFAULT_DOMAIN, addDomain, assignDomain, deleteDomain, domainNames, domainOf, profileSettingsOf, renameDomain } from '../src/preferences.ts';

test('domains: space.json default, own assignment wins, General is the fallback', () => {
  const spaces = [{ slug: 'sales', domain: 'Sales' }, { slug: 'calls', domain: 'Sales' }, { slug: 'x' }];
  const p = DEFAULT_PREFERENCES;
  assert.equal(domainOf(spaces[0], p), 'Sales');
  assert.equal(domainOf(spaces[2], p), DEFAULT_DOMAIN);
  const moved = assignDomain(p, spaces[2], 'My area');
  assert.equal(domainOf(spaces[2], moved), 'My area');
  assert.deepEqual(moved.domains, ['My area']);
  assert.deepEqual(domainNames(spaces, moved), ['My area', 'Sales']);
  const back = assignDomain(moved, spaces[0], 'Sales');
  assert.deepEqual(back.spaceDomains, moved.spaceDomains, 'moving back to the own domain stores nothing');
  assert.equal(assignDomain(p, spaces[0], '   '), p);
});

test('domains: add, rename and delete keep the assignments consistent', () => {
  const spaces = [{ slug: 'sales', domain: 'Sales' }, { slug: 'calls', domain: 'Sales' }];
  let p = addDomain(DEFAULT_PREFERENCES, 'Ops');
  p = addDomain(p, 'Ops');
  assert.deepEqual(p.domains, ['Ops']);
  p = renameDomain(p, spaces, 'Sales', 'Revenue');
  assert.equal(domainOf(spaces[0], p), 'Revenue');
  assert.equal(domainOf(spaces[1], p), 'Revenue');
  assert.ok(p.domains.includes('Revenue'));
  p = deleteDomain(p, 'Revenue');
  assert.equal(domainOf(spaces[0], p), 'Sales', 'falls back to the space.json domain');
  assert.equal(p.domains.includes('Revenue'), false);
});

test('domains survive sanitising, profiles and export; junk is dropped', () => {
  const p = sanitizePreferences({ domains: ['A', 'A', '', 'B'.repeat(50)], spaceDomains: { ok: 'A', 'Bad Slug': 'A', also: '' } });
  assert.equal(p.domains.length, 2);
  assert.equal(p.domains[1].length, 30);
  assert.deepEqual(p.spaceDomains, { ok: 'A' });
  assert.deepEqual(profileSettingsOf(p).domains, p.domains);
  assert.deepEqual(importPreferences(exportPreferences(p)).spaceDomains, { ok: 'A' });
});

import { isOriginal, isOriginalLook, resetAll, resetLook } from '../src/preferences.ts';

test('back to the original: look only, or everything but profiles and sync key', () => {
  const played = sanitizePreferences({ accent: '#0070F2', appScale: 1.25, font: 'mono', density: 'compact', contrast: 'high', reduceMotion: true, appearance: 'dark', pinnedSpaces: ['a'], starters: [{ label: 'x', prompt: 'y' }], sync: { key: 'work', auto: true } });
  const withProfile = saveProfile(played, 'Mine');
  assert.equal(isOriginalLook(withProfile), false);
  const look = resetLook(withProfile);
  assert.equal(isOriginalLook(look), true);
  assert.deepEqual(look.pinnedSpaces, ['a']);
  assert.equal(look.starters.length, 1);
  const all = resetAll(withProfile);
  assert.equal(isOriginal(all), true);
  assert.equal(all.pinnedSpaces.length, 0);
  assert.equal(all.starters.length, 0);
  assert.equal(all.profiles.length, 1);
  assert.equal(all.sync.key, 'work');
  assert.equal(isOriginal(DEFAULT_PREFERENCES), true);
});

import { assignParent, childrenOf, effectiveDomain, parentCandidates, parentOf } from '../src/preferences.ts';

test('subspaces: space.json parent, own override, one level, subspace follows the parent domain', () => {
  const spaces = [{ slug: 'sales', domain: 'Sales' }, { slug: 'renewals', domain: 'Sales', parent: 'sales' }, { slug: 'calls', domain: 'Sales' }, { slug: 'fin', domain: 'Finance' }, { slug: 'orphan', domain: 'Sales', parent: 'missing' }];
  const p = sanitizePreferences({});
  assert.equal(parentOf(spaces[1], spaces, p), 'sales');
  assert.equal(parentOf(spaces[4], spaces, p), '', 'unknown parent is ignored');
  assert.deepEqual(childrenOf('sales', spaces, p), ['renewals']);
  assert.deepEqual(parentCandidates(spaces[2], spaces, p), ['sales', 'orphan'], 'only top-level Spaces of the same domain');
  assert.deepEqual(parentCandidates(spaces[0], spaces, p), [], 'a Space with subspaces stays on top level');
  const a = assignParent(p, spaces[2], spaces, 'sales');
  assert.equal(parentOf(spaces[2], spaces, a), 'sales');
  assert.equal(assignParent(p, spaces[2], spaces, 'renewals'), p, 'a subspace cannot be a parent');
  assert.equal(assignParent(p, spaces[2], spaces, 'fin'), p, 'other domain is refused');
  const free = assignParent(a, spaces[1], spaces, '');
  assert.equal(parentOf(spaces[1], spaces, free), '', 'own choice beats space.json');
  assert.equal(assignParent(free, spaces[1], spaces, 'sales').spaceParents.renewals, undefined, 'back to the default stores nothing');
  assert.equal(effectiveDomain(spaces[1], spaces, { spaceDomains: { sales: 'Revenue' }, spaceParents: {} }), 'Revenue');
  assert.deepEqual(sanitizePreferences({ spaceParents: { a: 'b', c: 'c', 'Bad Slug': 'b', d: '' } }).spaceParents, { a: 'b', d: '' });
});

import { placeSpace } from '../src/preferences.ts';

test('placeSpace: drag a Space with its subspaces, a subspace alone, or nest one under another', () => {
  const spaces = [{ slug: 'sales', domain: 'Sales' }, { slug: 'renewals', domain: 'Sales', parent: 'sales' }, { slug: 'calls', domain: 'Sales' }, { slug: 'fin', domain: 'Finance' }, { slug: 'plan', domain: 'Finance' }];
  const p = sanitizePreferences({});
  // A Space with subspaces moves to another domain and takes them along.
  const moved = placeSpace(p, spaces[0], spaces, { domain: 'Finance' });
  assert.equal(effectiveDomain(spaces[0], spaces, moved), 'Finance');
  assert.equal(effectiveDomain(spaces[1], spaces, moved), 'Finance');
  assert.equal(parentOf(spaces[1], spaces, moved), 'sales');
  // A subspace dropped on a domain leaves its parent and lands in that domain.
  const alone = placeSpace(p, spaces[1], spaces, { domain: 'Finance' });
  assert.equal(parentOf(spaces[1], spaces, alone), '');
  assert.equal(effectiveDomain(spaces[1], spaces, alone), 'Finance');
  assert.equal(effectiveDomain(spaces[0], spaces, alone), 'Sales');
  // Dropped on the middle of a Space in another domain: subspace there, domain of the parent.
  const nested = placeSpace(p, spaces[2], spaces, { domain: 'Sales', parent: 'fin' });
  assert.equal(parentOf(spaces[2], spaces, nested), 'fin');
  assert.equal(effectiveDomain(spaces[2], spaces, nested), 'Finance');
  // A subspace can move under another parent in one step.
  const other = placeSpace(p, spaces[1], spaces, { domain: 'Sales', parent: 'calls' });
  assert.equal(parentOf(spaces[1], spaces, other), 'calls');
  // Refused, nothing changes: a Space with subspaces cannot become a subspace; a subspace cannot be a parent; not itself.
  assert.equal(placeSpace(p, spaces[0], spaces, { domain: 'Finance', parent: 'fin' }), p);
  assert.equal(placeSpace(p, spaces[2], spaces, { domain: 'Sales', parent: 'renewals' }), p);
  assert.equal(placeSpace(p, spaces[2], spaces, { domain: 'Sales', parent: 'calls' }), p);
});

import { spaceHighlight } from '../src/spaces.ts';

test('spaceHighlight skips notes about sample data and takes the first line that says what the Space does', () => {
  assert.equal(spaceHighlight(['Design mockup with fictional data; no CRM is connected.', 'Every stage has exit criteria.']), 'Every stage has exit criteria.');
  assert.equal(spaceHighlight(['Fictional customers and VMs generated from a fixed seed, no live monitoring.', 'Treemap: one tile per customer.']), 'Treemap: one tile per customer.');
  assert.equal(spaceHighlight(['Select an object once: source and where-used follow it.']), 'Select an object once: source and where-used follow it.');
  assert.equal(spaceHighlight(['Design mockup with fictional data.']), '');
  assert.equal(spaceHighlight(undefined), '');
});

import { sanitizePreferences as sanitizeForScale, sanitizeProfileSettings, DEFAULT_PREFERENCES as DEFAULTS_FOR_SCALE } from '../src/preferences.ts';
import { SPACE_SCALES as SCALES_FOR_PREFS } from '../src/space-scale.ts';
test('text size in Spaces: every step is kept, old 130% and 150% move to 125%, nonsense is ignored', () => {
  for (const step of SCALES_FOR_PREFS) assert.equal(sanitizeProfileSettings({ spaceScale: step }).spaceScale, step);
  assert.equal(sanitizeProfileSettings({ spaceScale: 1.3 }).spaceScale, 1.25);
  assert.equal(sanitizeProfileSettings({ spaceScale: 1.5 }).spaceScale, 1.25);
  for (const bad of [2, 0.1, '1.15', null, NaN]) assert.equal('spaceScale' in sanitizeProfileSettings({ spaceScale: bad }), false, String(bad));
  assert.equal(sanitizeForScale({ spaceScale: 1.3 }).spaceScale, 1.25);
  assert.equal(sanitizeForScale({}).spaceScale, DEFAULTS_FOR_SCALE.spaceScale);
});

// ---------------------------------------------------------------- tips (Ontology Manager speech bubbles)
import { DEFAULT_TIPS, TIP_SIZE_PX, sanitizeTips } from '../src/preferences.ts';
import { contrastRatio, tipCss } from '../src/preferences-style.ts';

test('tips: defaults are on, normal size, colours follow the skin; broken values fall back', () => {
  assert.deepEqual(sanitizePreferences({}).tips, DEFAULT_TIPS);
  assert.deepEqual(sanitizeTips({ enabled: false, size: 'xlarge', textColor: '#abcdef', bubbleColor: 'red', highlightColor: '#12345' }),
    { enabled: false, size: 'xlarge', textColor: '#ABCDEF', bubbleColor: '', highlightColor: '' });
  assert.deepEqual(sanitizeTips({ enabled: 'no', size: 'huge' }), DEFAULT_TIPS);
  assert.deepEqual(sanitizePreferences({ tips: { enabled: false } }).tips.enabled, false);
});

test('tips: only what was changed becomes a CSS variable, and the preview keeps the same values', () => {
  assert.deepEqual(tipCss(DEFAULT_TIPS), []);
  assert.equal(buildPreferenceCss(sanitizePreferences({})).includes('--tip-'), false);
  const css = tipCss({ enabled: true, size: 'large', textColor: '#111111', bubbleColor: '#FFEEAA', highlightColor: '#00AA55' })[0];
  assert.match(css, new RegExp(`--tip-size:${TIP_SIZE_PX.large}px`));
  assert.match(css, /--tip-text:#111111/); assert.match(css, /--tip-bg:#FFEEAA/); assert.match(css, /--tip-mark:#00AA55/);
  assert.match(buildPreferenceCss(sanitizePreferences({ tips: { size: 'small' } })), /--tip-size:12px/);
});

test('tips: contrast ratio is the WCAG one', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#FFFFFF')), 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  assert.ok(contrastRatio('#FFFFFF', '#FFEEAA') < 2);
});
