/**
 * The settings dialog works on a draft: a change is not applied until the person presses Save.
 * `base` is what the draft started from (the settings when the dialog opened, or when it was last saved), `draft` is what the person
 * has edited. Only the keys the person really changed are written on Save, so that something that changed meanwhile elsewhere
 * (for instance the place of Casimir, dragged while the dialog was open) is not overwritten by an old copy.
 */
import type { Preferences } from './preferences.ts';

/** The same text for the same content, whatever the order of the keys (the settings come out of different places in different key orders). */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const same = (a: unknown, b: unknown) => canon(a) === canon(b);

/** The settings the draft changed against its base. */
export function changedKeys(base: Preferences, draft: Preferences): Array<keyof Preferences> {
  return (Object.keys(draft) as Array<keyof Preferences>).filter((k) => !same(base[k], draft[k]));
}

export const isDirty = (base: Preferences, draft: Preferences): boolean => changedKeys(base, draft).length > 0;

/** The current settings with the changed keys of the draft put in. */
export function applyDraft(current: Preferences, draft: Preferences, base: Preferences): Preferences {
  const out: Preferences = { ...current };
  for (const k of changedKeys(base, draft)) (out as Record<string, unknown>)[k] = draft[k];
  return out;
}

/** A short list of what changed, for the line next to the Save button ("Skin, Text size"). */
const LABELS: Partial<Record<keyof Preferences, string>> = {
  appearance: 'Appearance', skin: 'Skin', layout: 'Layout', accent: 'Accent colour', bgTint: 'Background', bgPattern: 'Background', appScale: 'Text size', iconScale: 'Icon size', spaceScale: 'Text size in Spaces',
  font: 'Font', density: 'Density', contrast: 'Contrast', reduceMotion: 'Reduce motion', startView: 'Start view', pinnedSpaces: 'Pinned Spaces', domains: 'Domains', spaceDomains: 'Domains', spaceParents: 'Subspaces', spaceTitles: 'Space names',
  favoriteSkills: 'Favourite skills', assistant: 'Assistant', chat: 'Chat tools', tips: 'Tips', cat: 'Casimir', starters: 'Starter prompts', setup: 'Setup', storages: 'Storage locations', profiles: 'Profiles', activeProfile: 'Profile',
  spacesView: 'Spaces list', spacesDock: 'Spaces list', overviewLayout: 'Spaces overview', tileStyle: 'Spaces overview', harness: 'Working profile', sync: 'Sync',
};
export function changeSummary(base: Preferences, draft: Preferences, max = 4): string {
  const names = [...new Set(changedKeys(base, draft).map((k) => LABELS[k] ?? String(k)))];
  return names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', ');
}
