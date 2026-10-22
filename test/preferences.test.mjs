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
  assert.equal(applySpacePrefs('<html><head></head></html>', DEFAULT_PREFERENCES).includes('werkbank-space-prefs'), false);
  assert.ok(accentVariants('#ffff00').dark);
});
