/**
 * Handing harness profiles from one person to another.
 *  1. As a file: one profile is exported, shown in a preview on the other side and added as a profile of its own.
 *  2. Through a group: an admin publishes a profile into the group configuration (no new table: the group config is
 *     a free object that only admins can write and that is already logged). Members choose it in the chat bar, read
 *     only, and can copy it into their own profiles.
 * Everything that comes from a file or from the server goes through `sanitizeHarness`. A profile can only narrow the
 * chat, and an imported or group profile is never activated by itself.
 */
import {
  GROUP_HARNESS_PREFIX, STANDARD_HARNESS, activeHarness, allHarnesses, harnessNote, saveHarness, sanitizeHarness,
  type HarnessProfile, type HarnessState,
} from './harness.ts';

export const HARNESS_FILE_KIND = 'harness-profile';
export const HARNESS_FILE_VERSION = 1;
export const MAX_HARNESS_FILE = 20_000;
export const MAX_GROUP_HARNESSES = 10;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clip = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '');

// ---------- 1. file ----------

/** The file for one profile. The origin is not exported: the receiver sets their own. */
export function exportHarness(profile: HarnessProfile, now = new Date()): string {
  const { origin: _origin, ...rest } = profile;
  return JSON.stringify({ app: 'werkbank', kind: HARNESS_FILE_KIND, version: HARNESS_FILE_VERSION, exportedAt: now.toISOString(), profile: rest }, null, 2);
}

/** The profile in a file or pasted text. Throws a message the person can read. */
export function parseHarnessFile(raw: string): HarnessProfile {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Nothing to import.');
  if (raw.length > MAX_HARNESS_FILE) throw new Error('The file is too large for a profile.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The text is not valid JSON.');
  }
  if (!isObject(parsed) || parsed.app !== 'werkbank' || parsed.kind !== HARNESS_FILE_KIND || !isObject(parsed.profile)) throw new Error('This is not a Werkbank profile file.');
  if (typeof parsed.version === 'number' && parsed.version > HARNESS_FILE_VERSION) throw new Error('This profile was made with a newer version of Werkbank.');
  const profile = sanitizeHarness(parsed.profile);
  if (!profile) throw new Error('The profile has no usable id or name.');
  return profile;
}

const SUSPICIOUS = /(https?:\/\/|ignore (all |any |the )?(previous|prior|above)|disregard|ignoriere|vergiss (alle|die)|system prompt|api[ _-]?key|password|passwort|token|\bsecret\b)/i;

/** Things worth a look before a profile is added. The text of a profile steers the answers, so the person should read it. */
export function harnessWarnings(profile: HarnessProfile): string[] {
  const out: string[] = [];
  if (SUSPICIOUS.test(`${profile.persona} ${profile.description}`)) out.push('The text mentions links, keys or instructions to ignore other rules. Read it before you use the profile.');
  if (profile.permission === 'standard' && profile.connectors.length === 0 && profile.maxSteps === 0) out.push('This profile does not restrict anything. It only changes how the assistant answers.');
  return out;
}

export const MAX_OWN_HARNESSES = 10;
/** Own profiles are limited; saving more would silently push the oldest one out, so adding is refused instead. */
export const canAddHarness = (state: HarnessState): boolean => state.custom.length < MAX_OWN_HARNESSES;

const taken = (state: HarnessState, id: string) => allHarnesses(state).some((p) => p.id === id);
const baseId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'profile';

/** Adds a profile as one of the person's own with a free id and name. Nothing is replaced and nothing is activated. */
export function addImportedHarness(state: HarnessState, profile: HarnessProfile, origin: string): HarnessState {
  if (!canAddHarness(state)) return state;
  let id = baseId(profile.name);
  for (let n = 1; taken(state, id); n += 1) id = `${baseId(profile.name)}-${n + 1}`.slice(0, 40);
  const names = new Set(allHarnesses(state).map((p) => p.name.toLowerCase()));
  let name = profile.name;
  for (let n = 2; names.has(name.toLowerCase()); n += 1) name = `${profile.name.slice(0, 34)} (${n})`;
  const next = saveHarness(state, { ...profile, id, name, origin: clip(origin, 80) });
  return next === state ? state : { ...next, active: state.active };
}

// ---------- 2. group ----------

/** A profile as it is stored in the group configuration. */
export type GroupHarness = HarnessProfile & { version: number; publishedBy: string; publishedAt: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The profiles in a group configuration; damaged entries, duplicate ids and everything beyond the limit are dropped. */
export function sanitizeGroupHarnesses(value: unknown): GroupHarness[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: GroupHarness[] = [];
  for (const raw of value) {
    const profile = sanitizeHarness(raw);
    if (!profile || seen.has(profile.id) || out.length >= MAX_GROUP_HARNESSES) continue;
    const r = raw as Record<string, unknown>;
    const version = typeof r.version === 'number' && Number.isFinite(r.version) ? Math.max(1, Math.min(9999, Math.round(r.version))) : 1;
    const by = clip(r.publishedBy, 120).toLowerCase();
    const at = clip(r.publishedAt, 30);
    seen.add(profile.id);
    const { origin: _origin, ...rest } = profile;
    out.push({ ...rest, version, publishedBy: EMAIL.test(by) ? by : '', publishedAt: /^\d{4}-\d\d-\d\d/.test(at) ? at : '' });
  }
  return out;
}

/** Publishes a profile: a new one is added, a profile with the same id gets the next version. Admin only on the server. */
export function publishGroupHarness(list: GroupHarness[], profile: HarnessProfile, actor: string, now = new Date()): GroupHarness[] {
  const clean = sanitizeHarness(profile);
  if (!clean) return list;
  const { origin: _origin, ...rest } = clean;
  const existing = list.find((p) => p.id === clean.id);
  if (!existing && list.length >= MAX_GROUP_HARNESSES) return list;
  const entry: GroupHarness = { ...rest, version: (existing?.version ?? 0) + 1, publishedBy: clip(actor, 120).toLowerCase(), publishedAt: now.toISOString() };
  return sanitizeGroupHarnesses([...list.filter((p) => p.id !== clean.id), entry]);
}

export const unpublishGroupHarness = (list: GroupHarness[], id: string): GroupHarness[] => list.filter((p) => p.id !== id);

/** The profiles of the active group as choices in the chat bar. The prefix keeps them apart from the person's own. */
export function groupChoices(list: GroupHarness[], groupName: string): HarnessProfile[] {
  return list.map((p) => ({ ...p, id: `${GROUP_HARNESS_PREFIX}${p.id}`, origin: clip(`Group "${groupName}" · version ${p.version}`, 80) }));
}

/** All profiles the person can choose right now: their own, ready-made and those of the active group. */
export function harnessChoices(state: HarnessState, list: GroupHarness[], groupName: string): HarnessProfile[] {
  return [...allHarnesses(state), ...groupChoices(list, groupName)];
}

/** The profile in force. A group profile that is not available (no group, group not loaded, profile withdrawn) gives the standard profile. */
export function resolveHarness(state: HarnessState, list: GroupHarness[], groupName: string): HarnessProfile {
  if (state.active.startsWith(GROUP_HARNESS_PREFIX)) return groupChoices(list, groupName).find((p) => p.id === state.active) ?? STANDARD_HARNESS;
  return activeHarness(state);
}

/** True when the chosen profile is a group profile that cannot be found now, so the standard rules apply. */
export const groupProfileMissing = (state: HarnessState, list: GroupHarness[]): boolean =>
  state.active.startsWith(GROUP_HARNESS_PREFIX) && !list.some((p) => `${GROUP_HARNESS_PREFIX}${p.id}` === state.active);

/** Copies a group profile into the person's own profiles (the copy can be changed). */
export function copyGroupHarness(state: HarnessState, profile: GroupHarness, groupName: string): HarnessState {
  const { version, publishedBy: _by, publishedAt: _at, ...own } = profile;
  return addImportedHarness(state, own, `Group "${groupName}" · version ${version}`);
}

/** The text a person reads before choosing or importing a profile. */
export const harnessPreview = (profile: HarnessProfile): string => harnessNote(profile) || 'No extra rules: the profile adds nothing to the chat.';
