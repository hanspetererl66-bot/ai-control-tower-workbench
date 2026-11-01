/**
 * Personal settings of the Werkbank in one validated object: look (colour, text size, font, density, contrast,
 * motion), working style (start view, pinned Spaces, favourite skills, own starter prompts), the assistant's
 * standing instructions, named storage locations and profiles that bundle all of this.
 * Kept in localStorage; can be exported, imported and synced to Supabase through the connector (never secrets).
 * Everything coming from storage, a file or Supabase goes through `sanitizePreferences`.
 */
import { DEFAULT_HARNESS_STATE, sanitizeHarnessState, type HarnessState } from './harness.ts';
import { SPACE_SCALES } from './space-scale.ts';

export const PREFERENCES_STORAGE_KEY = 'werkbank.preferences.v1';
export const PREFERENCES_VERSION = 1;

export const APPEARANCES = ['system', 'light', 'dark'] as const;
export const APP_SCALES = [0.9, 1, 1.1, 1.25] as const;
export const FONTS = ['default', 'arial', 'system', 'readable', 'mono'] as const;
export const DENSITIES = ['compact', 'normal', 'roomy'] as const;
export const CONTRASTS = ['normal', 'high'] as const;
export const LANGUAGES = ['auto', 'de', 'en'] as const;
export const LENGTHS = ['concise', 'balanced', 'detailed'] as const;
export const TONES = ['neutral', 'friendly', 'formal'] as const;
export const PURPOSES = ['reports', 'presentations', 'data', 'other'] as const;

export const ACCENT_PRESETS = [
  { id: 'purple', name: 'Violet', hex: '#A100FF' },
  { id: 'blue', name: 'Blue', hex: '#0070F2' },
  { id: 'teal', name: 'Teal', hex: '#0F8B8D' },
  { id: 'green', name: 'Green', hex: '#1E8E3E' },
  { id: 'orange', name: 'Orange', hex: '#D9480F' },
  { id: 'pink', name: 'Pink', hex: '#C2185B' },
] as const;

export const FONT_STACKS: Record<(typeof FONTS)[number], string> = {
  default: '',
  arial: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  readable: 'Verdana, Tahoma, "Trebuchet MS", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

export type Assistant = {
  language: (typeof LANGUAGES)[number];
  length: (typeof LENGTHS)[number];
  tone: (typeof TONES)[number];
  instructions: string;
};
/** Optional helpers in the chat window. Read aloud, privacy bar and usage are off until the person switches them on. */
export type ChatTools = {
  readAloud: boolean;
  privacyBar: boolean;
  usage: boolean;
  /** Ask before an action that changes something (approval card). */
  askBeforeActions: boolean;
  /** Price per million tokens in EUR; 0 means no cost is shown. */
  priceInPerM: number;
  priceOutPerM: number;
  /** Labels of the built-in suggestions on the empty chat that the person switched off. */
  hiddenStarters: string[];
  /** Briefing cards (by id) and whole groups ("cat:<id>") under the chat that the person switched off. */
  hiddenBriefing: string[];
};
export const DEFAULT_CHAT_TOOLS: ChatTools = { readAloud: false, privacyBar: false, usage: false, askBeforeActions: true, priceInPerM: 0, priceOutPerM: 0, hiddenStarters: [], hiddenBriefing: [] };
export type Starter = { label: string; prompt: string };
export type StorageLocation = { id: string; name: string; purpose: (typeof PURPOSES)[number]; location: string };

/** What a profile bundles. */
export type ProfileSettings = {
  appearance: (typeof APPEARANCES)[number];
  accent: string;
  appScale: number;
  spaceScale: number;
  font: (typeof FONTS)[number];
  density: (typeof DENSITIES)[number];
  contrast: (typeof CONTRASTS)[number];
  reduceMotion: boolean;
  startView: string;
  pinnedSpaces: string[];
  /** Own domains (groups of Spaces), in display order, and manual Space → domain assignments. */
  domains: string[];
  spaceDomains: Record<string, string>;
  /** Subspaces: Space → parent Space. An empty value means "top level" even if its space.json names a parent. */
  spaceParents: Record<string, string>;
  /** Own names for Spaces (slug → title). They survive updates of the example Spaces. */
  spaceTitles: Record<string, string>;
  favoriteSkills: string[];
  assistant: Assistant;
  chat: ChatTools;
};
export type Profile = { id: string; name: string; settings: Partial<ProfileSettings> };

export type Preferences = ProfileSettings & {
  version: number;
  /** Archived Spaces: hidden from the list and kept on this computer until restored or deleted. Not part of a profile. */
  archivedSpaces: string[];
  starters: Starter[];
  setup: { model: string; connectors: string[] };
  storages: StorageLocation[];
  profiles: Profile[];
  activeProfile: string;
  /** Harness profiles: working rules for the chat (persona, connectors, rights, step limit). Chosen in the chat. */
  harness: HarnessState;
  sync: { key: string; auto: boolean };
};

export const DEFAULT_ASSISTANT: Assistant = { language: 'auto', length: 'balanced', tone: 'neutral', instructions: '' };

export const DEFAULT_PREFERENCES: Preferences = {
  version: PREFERENCES_VERSION,
  appearance: 'system',
  accent: '',
  appScale: 1,
  spaceScale: 1.15,
  font: 'default',
  density: 'normal',
  contrast: 'normal',
  reduceMotion: false,
  startView: 'chat',
  pinnedSpaces: [],
  archivedSpaces: [],
  domains: [],
  spaceDomains: {},
  spaceParents: {},
  spaceTitles: {},
  favoriteSkills: [],
  assistant: { ...DEFAULT_ASSISTANT },
  chat: { ...DEFAULT_CHAT_TOOLS },
  starters: [],
  setup: { model: '', connectors: [] },
  storages: [],
  profiles: [],
  activeProfile: 'standard',
  harness: { ...DEFAULT_HARNESS_STATE, custom: [] },
  sync: { key: 'default', auto: false },
};

/** Ready-made profiles; they cannot be changed or deleted, only applied. */
export const BUILTIN_PROFILES: Profile[] = [
  { id: 'standard', name: 'Standard', settings: {} },
  {
    id: 'sales', name: 'Sales',
    settings: { startView: 'space:sales', pinnedSpaces: ['sales', 'sub4me'], assistant: { ...DEFAULT_ASSISTANT, length: 'concise' } },
  },
  {
    id: 'governance', name: 'Governance',
    settings: { startView: 'space:ai-control-tower', pinnedSpaces: ['ai-control-tower', 'skill-marketplace', 'mcp-marketplace'], assistant: { ...DEFAULT_ASSISTANT, length: 'detailed', tone: 'formal' } },
  },
  {
    id: 'demo', name: 'Demo on a big screen',
    settings: { appScale: 1.25, spaceScale: 1.3, density: 'roomy', accent: '#A100FF', reduceMotion: false },
  },
  {
    id: 'accessible', name: 'High contrast and large text',
    settings: { appScale: 1.25, spaceScale: 1.3, contrast: 'high', reduceMotion: true, font: 'readable' },
  },
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const START = /^(chat|last|space:[a-z0-9][a-z0-9-]{0,59})$/;

export const DEFAULT_DOMAIN = 'General';
export const MAX_DOMAINS = 12;
const domainName = (value: unknown): string => text(value, 30).replace(/\s+/g, ' ');

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pick = <T extends readonly unknown[]>(list: T, value: unknown, fallback: T[number]): T[number] => (list.includes(value) ? (value as T[number]) : fallback);
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '';
const list = (value: unknown, ok: (s: string) => boolean, max: number): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && ok(v)))].slice(0, max) : [];

const price = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(1000, Math.round(value * 100) / 100) : 0);
export function sanitizeChatTools(value: unknown): ChatTools {
  const v = isObject(value) ? value : {};
  const flag = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
  return {
    readAloud: flag(v.readAloud, DEFAULT_CHAT_TOOLS.readAloud),
    privacyBar: flag(v.privacyBar, DEFAULT_CHAT_TOOLS.privacyBar),
    usage: flag(v.usage, DEFAULT_CHAT_TOOLS.usage),
    askBeforeActions: flag(v.askBeforeActions, DEFAULT_CHAT_TOOLS.askBeforeActions),
    priceInPerM: price(v.priceInPerM),
    priceOutPerM: price(v.priceOutPerM),
    hiddenBriefing: Array.isArray(v.hiddenBriefing) ? [...new Set(v.hiddenBriefing.filter((x): x is string => typeof x === 'string').map((x) => text(x, 40)).filter(Boolean))].slice(0, 40) : [],
    hiddenStarters: Array.isArray(v.hiddenStarters) ? [...new Set(v.hiddenStarters.filter((x): x is string => typeof x === 'string').map((x) => text(x, 60)).filter(Boolean))].slice(0, 12) : [],
  };
}

export function sanitizeAssistant(value: unknown): Assistant {
  const v = isObject(value) ? value : {};
  return {
    language: pick(LANGUAGES, v.language, 'auto'),
    length: pick(LENGTHS, v.length, 'balanced'),
    tone: pick(TONES, v.tone, 'neutral'),
    instructions: text(v.instructions, 1000),
  };
}

/** Validates the profile-level fields that are present; absent or invalid ones are dropped, not defaulted. */
export function sanitizeProfileSettings(value: unknown): Partial<ProfileSettings> {
  const v = isObject(value) ? value : {};
  const out: Partial<ProfileSettings> = {};
  if (APPEARANCES.includes(v.appearance as never)) out.appearance = v.appearance as ProfileSettings['appearance'];
  if (v.accent === '' || (typeof v.accent === 'string' && HEX.test(v.accent))) out.accent = String(v.accent).toUpperCase();
  if (APP_SCALES.includes(v.appScale as never)) out.appScale = v.appScale as number;
  if (SPACE_SCALES.includes(v.spaceScale as never)) out.spaceScale = v.spaceScale as number;
  if (FONTS.includes(v.font as never)) out.font = v.font as ProfileSettings['font'];
  if (DENSITIES.includes(v.density as never)) out.density = v.density as ProfileSettings['density'];
  if (CONTRASTS.includes(v.contrast as never)) out.contrast = v.contrast as ProfileSettings['contrast'];
  if (typeof v.reduceMotion === 'boolean') out.reduceMotion = v.reduceMotion;
  if (typeof v.startView === 'string' && START.test(v.startView)) out.startView = v.startView;
  if (Array.isArray(v.pinnedSpaces)) out.pinnedSpaces = list(v.pinnedSpaces, (s) => SLUG.test(s), 20);
  if (Array.isArray(v.domains)) out.domains = [...new Set(v.domains.map((d) => domainName(d)).filter(Boolean))].slice(0, MAX_DOMAINS);
  if (isObject(v.spaceDomains)) {
    const map: Record<string, string> = {};
    for (const [slug, name] of Object.entries(v.spaceDomains)) {
      const clean = domainName(name);
      if (SLUG.test(slug) && clean && Object.keys(map).length < 80) map[slug] = clean;
    }
    out.spaceDomains = map;
  }
  if (isObject(v.spaceParents)) {
    const map: Record<string, string> = {};
    for (const [slug, parent] of Object.entries(v.spaceParents)) {
      if (SLUG.test(slug) && typeof parent === 'string' && (parent === '' || (SLUG.test(parent) && parent !== slug)) && Object.keys(map).length < 80) map[slug] = parent;
    }
    out.spaceParents = map;
  }
  if (isObject(v.spaceTitles)) {
    const map: Record<string, string> = {};
    for (const [slug, title] of Object.entries(v.spaceTitles)) {
      const clean = cleanSpaceTitle(title);
      if (SLUG.test(slug) && clean && Object.keys(map).length < 80) map[slug] = clean;
    }
    out.spaceTitles = map;
  }
  if (Array.isArray(v.favoriteSkills)) out.favoriteSkills = list(v.favoriteSkills, (s) => SLUG.test(s), 12);
  if (isObject(v.assistant)) out.assistant = sanitizeAssistant(v.assistant);
  if (isObject(v.chat)) out.chat = sanitizeChatTools(v.chat);
  return out;
}

export function sanitizePreferences(value: unknown): Preferences {
  const v = isObject(value) ? value : {};
  const base = { ...DEFAULT_PREFERENCES, ...sanitizeProfileSettings(v) } as Preferences;
  const starters: Starter[] = (Array.isArray(v.starters) ? v.starters : [])
    .filter(isObject)
    .map((s) => ({ label: text(s.label, 40), prompt: text(s.prompt, 600) }))
    .filter((s) => s.label && s.prompt)
    .slice(0, 12);
  const setup = isObject(v.setup) ? v.setup : {};
  const seen = new Set<string>();
  const storages: StorageLocation[] = (Array.isArray(v.storages) ? v.storages : [])
    .filter(isObject)
    .map((s, i) => ({ id: ID.test(String(s.id)) ? String(s.id) : `loc-${i + 1}`, name: text(s.name, 40), purpose: pick(PURPOSES, s.purpose, 'other'), location: text(s.location, 300) }))
    .filter((s) => s.name && s.location && !seen.has(s.id) && seen.add(s.id))
    .slice(0, 10);
  const taken = new Set(BUILTIN_PROFILES.map((p) => p.id));
  const profiles: Profile[] = (Array.isArray(v.profiles) ? v.profiles : [])
    .filter(isObject)
    .map((p) => ({ id: String(p.id), name: text(p.name, 40), settings: sanitizeProfileSettings(p.settings) }))
    .filter((p) => ID.test(p.id) && p.name && !taken.has(p.id) && taken.add(p.id))
    .slice(0, 10);
  const sync = isObject(v.sync) ? v.sync : {};
  const activeProfile = typeof v.activeProfile === 'string' && [...BUILTIN_PROFILES, ...profiles].some((p) => p.id === v.activeProfile) ? v.activeProfile : 'standard';
  return {
    ...base,
    version: PREFERENCES_VERSION,
    archivedSpaces: Array.isArray(v.archivedSpaces) ? list(v.archivedSpaces, (s) => SLUG.test(s), 200) : [],
    starters,
    setup: { model: text(setup.model, 80), connectors: list(setup.connectors, (s) => s.length > 0 && s.length <= 60, 12) },
    storages,
    profiles,
    activeProfile,
    harness: sanitizeHarnessState(v.harness),
    sync: { key: typeof sync.key === 'string' && ID.test(sync.key) ? sync.key : 'default', auto: sync.auto === true },
  };
}

/** Everything a profile covers, taken from the current settings. */
export function profileSettingsOf(prefs: Preferences): ProfileSettings {
  const { appearance, accent, appScale, spaceScale, font, density, contrast, reduceMotion, startView, pinnedSpaces, domains, spaceDomains, spaceParents, spaceTitles, favoriteSkills, assistant, chat } = prefs;
  return { appearance, accent, appScale, spaceScale, font, density, contrast, reduceMotion, startView, pinnedSpaces: [...pinnedSpaces], domains: [...domains], spaceDomains: { ...spaceDomains }, spaceParents: { ...spaceParents }, spaceTitles: { ...spaceTitles }, favoriteSkills: [...favoriteSkills], assistant: { ...assistant }, chat: { ...chat } };
}

export function allProfiles(prefs: Preferences): Profile[] {
  return [...BUILTIN_PROFILES, ...prefs.profiles];
}

/** Applies a profile on top of the standard values, so a profile that sets little still resets the rest of its area. */
export function applyProfile(prefs: Preferences, id: string): Preferences {
  const profile = allProfiles(prefs).find((p) => p.id === id);
  if (!profile) return prefs;
  const defaults = profileSettingsOf(DEFAULT_PREFERENCES);
  return sanitizePreferences({ ...prefs, ...defaults, ...profile.settings, activeProfile: profile.id });
}

/** Saves the current look and working settings as a new profile (or replaces a custom one with the same name). */
export function saveProfile(prefs: Preferences, name: string): Preferences {
  const clean = text(name, 40);
  if (!clean) return prefs;
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'profile';
  const id = BUILTIN_PROFILES.some((p) => p.id === slug) ? `my-${slug}` : slug;
  const others = prefs.profiles.filter((p) => p.id !== id);
  return sanitizePreferences({ ...prefs, profiles: [...others, { id, name: clean, settings: profileSettingsOf(prefs) }], activeProfile: id });
}

export function deleteProfile(prefs: Preferences, id: string): Preferences {
  if (!prefs.profiles.some((p) => p.id === id)) return prefs;
  return sanitizePreferences({ ...prefs, profiles: prefs.profiles.filter((p) => p.id !== id), activeProfile: prefs.activeProfile === id ? 'standard' : prefs.activeProfile });
}

type StorageLike = Pick<Storage, 'getItem'>;

/** Reads the preferences; falls back to the older separate settings (appearance, Space text size). */
export function loadPreferences(storage?: StorageLike): Preferences {
  if (!storage) return sanitizePreferences({});
  try {
    const raw = storage.getItem(PREFERENCES_STORAGE_KEY);
    if (raw) return sanitizePreferences(JSON.parse(raw));
    const legacyScale = Number(storage.getItem('werkbank.space-scale'));
    return sanitizePreferences({ appearance: storage.getItem('werkbank.appearance') ?? undefined, spaceScale: Number.isFinite(legacyScale) && legacyScale > 0 ? legacyScale : undefined });
  } catch {
    return sanitizePreferences({});
  }
}

export function savePreferences(prefs: Preferences, storage?: Pick<Storage, 'setItem'>): void {
  if (!storage) return;
  try {
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
    storage.setItem('werkbank.appearance', prefs.appearance);
    storage.setItem('werkbank.space-scale', String(prefs.spaceScale));
  } catch {
    // The settings still apply for this session when storage is unavailable.
  }
}

/** File format of an export. */
export function exportPreferences(prefs: Preferences, now = new Date()): string {
  return JSON.stringify({ app: 'werkbank', kind: 'preferences', version: PREFERENCES_VERSION, exportedAt: now.toISOString(), preferences: prefs }, null, 2);
}

export function importPreferences(raw: string): Preferences {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (!isObject(parsed) || parsed.app !== 'werkbank' || parsed.kind !== 'preferences' || !isObject(parsed.preferences)) throw new Error('This is not a Werkbank settings file.');
  return sanitizePreferences(parsed.preferences);
}

/** Pinned Spaces first (in pin order), the rest keep the given order. */
export function pinFirst<T extends { slug: string }>(spaces: T[], pinned: string[]): T[] {
  const pins = pinned.map((slug) => spaces.find((s) => s.slug === slug)).filter((s): s is T => Boolean(s));
  return [...pins, ...spaces.filter((s) => !pinned.includes(s.slug))];
}

export function togglePin(pinned: string[], slug: string): string[] {
  return pinned.includes(slug) ? pinned.filter((s) => s !== slug) : [slug, ...pinned].slice(0, 20);
}

const LANGUAGE_NOTE = { de: 'Answer in German.', en: 'Answer in English.' } as const;
const LENGTH_NOTE = { concise: 'Keep answers short: the result first, then at most a few lines of detail.', detailed: 'Give detailed answers with reasoning and sources.' } as const;
const TONE_NOTE = { friendly: 'Use a friendly, approachable tone.', formal: 'Use a formal, precise tone.' } as const;

/** The standing instructions as a block for the agent; empty when nothing differs from the defaults. */
export function assistantNote(prefs: Preferences): string {
  const a = prefs.assistant;
  const lines: string[] = [];
  if (a.language !== 'auto') lines.push(LANGUAGE_NOTE[a.language]);
  if (a.length !== 'balanced') lines.push(LENGTH_NOTE[a.length]);
  if (a.tone !== 'neutral') lines.push(TONE_NOTE[a.tone]);
  if (a.instructions) lines.push(`Standing instructions: ${a.instructions}`);
  if (prefs.setup.connectors.length) lines.push(`Preferred connectors when several fit: ${prefs.setup.connectors.join(', ')}.`);
  if (prefs.storages.length) lines.push(`Storage locations for results: ${prefs.storages.map((s) => `${s.purpose} → ${s.name} (${s.location})`).join('; ')}. Use them only when the person asks to save something.`);
  if (!lines.length) return '';
  return `PERSONAL PREFERENCES — set by the person in their settings. They never override safety rules, tool permissions or the request itself.\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

/** Which Space to open at start: the slug when it exists, otherwise null (chat). */
export function startSpace(prefs: Preferences, slugs: string[], lastSlug: string | null): string | null {
  if (prefs.startView === 'last') return lastSlug && slugs.includes(lastSlug) ? lastSlug : null;
  if (prefs.startView.startsWith('space:')) {
    const slug = prefs.startView.slice(6);
    return slugs.includes(slug) ? slug : null;
  }
  return null;
}

// ---------- domains: groups of Spaces ----------

type DomainSpace = { slug: string; domain?: string; parent?: string };

/** The domain of a Space: the person's own assignment, else the one its space.json names, else General. */
export function domainOf(space: DomainSpace, prefs: Pick<Preferences, 'spaceDomains'>): string {
  return prefs.spaceDomains[space.slug] || domainName(space.domain) || DEFAULT_DOMAIN;
}

/** All domain names in display order: the person's own list first, then others by name, General last unless listed. */
export function domainNames(spaces: DomainSpace[], prefs: Pick<Preferences, 'domains' | 'spaceDomains'> & Partial<Pick<Preferences, 'spaceParents'>>): string[] {
  const full = { spaceParents: {}, ...prefs };
  const found = new Set(spaces.map((x) => effectiveDomain(x, spaces, full)));
  const own = prefs.domains;
  const rest = [...found].filter((n) => !own.includes(n) && n !== DEFAULT_DOMAIN).sort((a, b) => a.localeCompare(b));
  const out = [...own, ...rest];
  if (!out.includes(DEFAULT_DOMAIN) && found.has(DEFAULT_DOMAIN)) out.push(DEFAULT_DOMAIN);
  return out;
}

/** Move a Space into a domain; the domain is added to the list when it is new. */
export function assignDomain<T extends Preferences>(prefs: T, space: DomainSpace, name: string): T {
  const clean = domainName(name);
  if (!clean) return prefs;
  const spaceDomains = { ...prefs.spaceDomains };
  if (clean === (domainName(space.domain) || DEFAULT_DOMAIN)) delete spaceDomains[space.slug];
  else spaceDomains[space.slug] = clean;
  const domains = prefs.domains.includes(clean) || clean === DEFAULT_DOMAIN ? prefs.domains : [...prefs.domains, clean].slice(0, MAX_DOMAINS);
  return { ...prefs, spaceDomains, domains };
}

export function addDomain<T extends Preferences>(prefs: T, name: string): T {
  const clean = domainName(name);
  if (!clean || prefs.domains.includes(clean) || prefs.domains.length >= MAX_DOMAINS) return prefs;
  return { ...prefs, domains: [...prefs.domains, clean] };
}

/** Rename a domain everywhere, including Spaces that only got it from their space.json. */
export function renameDomain<T extends Preferences>(prefs: T, spaces: DomainSpace[], from: string, to: string): T {
  const clean = domainName(to);
  if (!clean || clean === from) return prefs;
  const spaceDomains = { ...prefs.spaceDomains };
  for (const x of spaces) if (domainOf(x, prefs) === from) spaceDomains[x.slug] = clean;
  for (const slug of Object.keys(spaceDomains)) if (spaceDomains[slug] === from) spaceDomains[slug] = clean;
  const listed = prefs.domains.includes(from) ? prefs.domains : [...prefs.domains, from];
  const domains = [...new Set(listed.map((n) => (n === from ? clean : n)))].slice(0, MAX_DOMAINS);
  return { ...prefs, domains, spaceDomains };
}

/** Delete a domain: its Spaces fall back to their own domain (space.json) or General. */
export function deleteDomain<T extends Preferences>(prefs: T, name: string): T {
  const spaceDomains = Object.fromEntries(Object.entries(prefs.spaceDomains).filter(([, n]) => n !== name));
  return { ...prefs, domains: prefs.domains.filter((n) => n !== name), spaceDomains };
}

// ---------- subspaces: one level of hierarchy inside a domain ----------

const rawParent = (space: DomainSpace, prefs: Pick<Preferences, 'spaceParents'>): string =>
  Object.prototype.hasOwnProperty.call(prefs.spaceParents, space.slug) ? prefs.spaceParents[space.slug] : (space.parent ?? '');

/** The parent of a Space, or '' for a top-level Space. Only one level: the parent must exist and must not be a subspace itself. */
export function parentOf(space: DomainSpace, spaces: DomainSpace[], prefs: Pick<Preferences, 'spaceParents'>): string {
  const p = rawParent(space, prefs);
  if (!p || p === space.slug) return '';
  const parent = spaces.find((x) => x.slug === p);
  return parent && !rawParent(parent, prefs) ? p : '';
}

export function childrenOf(slug: string, spaces: DomainSpace[], prefs: Pick<Preferences, 'spaceParents'>): string[] {
  return spaces.filter((x) => parentOf(x, spaces, prefs) === slug).map((x) => x.slug);
}

/** A subspace lives in the domain of its parent. */
export function effectiveDomain(space: DomainSpace, spaces: DomainSpace[], prefs: Pick<Preferences, 'spaceDomains' | 'spaceParents'>): string {
  const p = parentOf(space, spaces, prefs), parent = p ? spaces.find((x) => x.slug === p) : undefined;
  return parent ? domainOf(parent, prefs) : domainOf(space, prefs);
}

/** Spaces a Space can become a subspace of: top-level Spaces of its domain; none if it has subspaces itself. */
export function parentCandidates(space: DomainSpace, spaces: DomainSpace[], prefs: Pick<Preferences, 'spaceDomains' | 'spaceParents'>): string[] {
  if (childrenOf(space.slug, spaces, prefs).length) return [];
  const dom = effectiveDomain(space, spaces, prefs);
  return spaces.filter((x) => x.slug !== space.slug && !parentOf(x, spaces, prefs) && effectiveDomain(x, spaces, prefs) === dom).map((x) => x.slug);
}

/** Mark a Space as subspace of `parent`, or back to top level with ''. Invalid choices change nothing. */
export function assignParent<T extends Preferences>(prefs: T, space: DomainSpace, spaces: DomainSpace[], parent: string): T {
  if (parent && !parentCandidates(space, spaces, prefs).includes(parent)) return prefs;
  const spaceParents = { ...prefs.spaceParents };
  if (parent === (space.parent ?? '')) delete spaceParents[space.slug];
  else spaceParents[space.slug] = parent;
  return { ...prefs, spaceParents };
}

// ---------- rename and delete ----------

export const MAX_SPACE_TITLE = 80;

/** A usable Space title: one line, no control characters, 1 to 80 characters; '' when nothing is left. */
export function cleanSpaceTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SPACE_TITLE);
}

/** Give a Space (or subspace) its own name; the original name (or an empty value) takes the own name away again. */
export function renameSpace<T extends Preferences>(prefs: T, slug: string, title: string, originalTitle: string): T {
  const clean = cleanSpaceTitle(title);
  const spaceTitles = { ...prefs.spaceTitles };
  if (!clean || clean === originalTitle) delete spaceTitles[slug];
  else spaceTitles[slug] = clean;
  return { ...prefs, spaceTitles };
}

/** The list of Spaces with the person's own names applied. */
export function applySpaceTitles<S extends { slug: string; title: string }>(spaces: S[], prefs: Pick<Preferences, 'spaceTitles'>): S[] {
  return spaces.map((x) => (prefs.spaceTitles[x.slug] ? { ...x, title: prefs.spaceTitles[x.slug] } : x));
}

/** After a Space is deleted: remove every trace of it from the settings. Its subspaces move to the top level. */
export function forgetSpace<T extends Preferences>(prefs: T, slug: string, spaces: DomainSpace[]): T {
  const spaceParents = { ...prefs.spaceParents };
  delete spaceParents[slug];
  for (const space of spaces) if (space.slug !== slug && (rawParent(space, prefs) === slug)) spaceParents[space.slug] = '';
  const without = <V,>(map: Record<string, V>) => Object.fromEntries(Object.entries(map).filter(([key]) => key !== slug));
  return {
    ...prefs,
    pinnedSpaces: prefs.pinnedSpaces.filter((x) => x !== slug),
    archivedSpaces: prefs.archivedSpaces.filter((x) => x !== slug),
    spaceDomains: without(prefs.spaceDomains),
    spaceTitles: without(prefs.spaceTitles),
    spaceParents,
    startView: prefs.startView === `space:${slug}` ? 'chat' : prefs.startView,
  };
}

// ---------- archive ----------

/**
 * Archive a Space: it leaves the list (and the pins) but its folder stays on this computer.
 * Its subspaces stay visible and move to the top level, as when a Space is deleted.
 */
export function archiveSpace<T extends Preferences>(prefs: T, slug: string, spaces: DomainSpace[]): T {
  if (prefs.archivedSpaces.includes(slug)) return prefs;
  const spaceParents = { ...prefs.spaceParents };
  delete spaceParents[slug];
  for (const space of spaces) if (space.slug !== slug && rawParent(space, prefs) === slug) spaceParents[space.slug] = '';
  return {
    ...prefs,
    archivedSpaces: [...prefs.archivedSpaces, slug].slice(-200),
    pinnedSpaces: prefs.pinnedSpaces.filter((x) => x !== slug),
    spaceParents,
  };
}

export function restoreSpace<T extends Preferences>(prefs: T, slug: string): T {
  return { ...prefs, archivedSpaces: prefs.archivedSpaces.filter((x) => x !== slug) };
}

/** The Spaces that are not archived, and the ones that are (in the order they were archived, newest first). */
export function splitArchived<S extends { slug: string }>(spaces: S[], prefs: Pick<Preferences, 'archivedSpaces'>): { active: S[]; archived: S[] } {
  const set = new Set(prefs.archivedSpaces);
  const active = spaces.filter((x) => !set.has(x.slug));
  const archived = [...prefs.archivedSpaces].reverse().map((slug) => spaces.find((x) => x.slug === slug)).filter((x): x is S => Boolean(x));
  return { active, archived };
}

// ---------- back to the original ----------

const LOOK_KEYS = ['appearance', 'accent', 'appScale', 'spaceScale', 'font', 'density', 'contrast', 'reduceMotion'] as const;

/** Only the look (colour, sizes, font, density, contrast, motion, light/dark) goes back to the original. */
export function resetLook<T extends Preferences>(prefs: T): T {
  const next = { ...prefs } as Record<string, unknown>;
  for (const key of LOOK_KEYS) next[key] = DEFAULT_PREFERENCES[key];
  return next as T;
}

export function isOriginalLook(prefs: Preferences): boolean {
  return LOOK_KEYS.every((key) => prefs[key] === DEFAULT_PREFERENCES[key]);
}

/** Everything back to the original; saved profiles and the Supabase key stay. */
export function resetAll(prefs: Preferences): Preferences {
  // Harness profiles are saved work setups like the profiles above, so they stay too. Archived Spaces stay archived: that is how the person sorted their work, not a look or an assistant setting.
  return { ...DEFAULT_PREFERENCES, profiles: prefs.profiles, harness: prefs.harness, sync: prefs.sync, archivedSpaces: prefs.archivedSpaces };
}

export function isOriginal(prefs: Preferences): boolean {
  return JSON.stringify(resetAll(prefs)) === JSON.stringify(prefs);
}
