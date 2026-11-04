/**
 * The tabs under the empty chat: Favorites, Suggested, Popular, What's new.
 * Favorites hold what the person chose (own prompts, favourite skills) and the "Heute für dich" cards.
 * The other three are worked out from what the app knows, without a server: the installed skills, the Spaces and how often
 * the person used an entry on this computer. Pure functions; the lists are short on purpose.
 */
export type TabId = 'favorites' | 'suggested' | 'popular' | 'new';
export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'favorites', label: 'Favorites' },
  { id: 'suggested', label: 'Suggested' },
  { id: 'popular', label: 'Popular' },
  { id: 'new', label: "What's new" },
];

/** One entry in a list: a prompt to send or a Space to open. */
export type Entry = { key: string; label: string; hint: string; prompt?: string; open?: { space: string; tab?: string }; at?: number };
export type SkillLike = { name: string; description: string; updatedAt?: number };
export type SpaceLike = { slug: string; title: string; description: string; updatedAt: number };
export type UseMap = Record<string, { label: string; hint: string; prompt?: string; open?: { space: string; tab?: string }; count: number; last: number }>;

export const MAX_ENTRIES = 6;
export const NEW_DAYS = 30;
const DAY = 86_400_000;

export const skillEntry = (s: SkillLike): Entry => ({ key: `skill:${s.name}`, label: s.name, hint: s.description, prompt: `Nutze den Skill ${s.name}.`, at: s.updatedAt });
export const spaceEntry = (s: SpaceLike): Entry => ({ key: `space:${s.slug}`, label: s.title, hint: s.description, open: { space: s.slug }, at: s.updatedAt });

/** Skills the person has not made a favourite and has not used yet: something to try. */
export function suggested(skills: SkillLike[], favoriteNames: string[], used: UseMap): Entry[] {
  return skills
    .filter((s) => s.name && !favoriteNames.includes(s.name) && !used[`skill:${s.name}`])
    .sort((a, b) => Number(!!b.description) - Number(!!a.description) || a.name.localeCompare(b.name))
    .slice(0, MAX_ENTRIES).map(skillEntry);
}

/** One row of the usage ranking in the shared database (skills_ranking, last 30 days). */
export type RankRow = { slug: string; description?: string; installs: number; views: number; devices: number; score: number };

/**
 * What is used most: the organisation's ranking (when the database answered) first, then what the person used on this computer.
 * Only skills that are installed here are listed from the ranking, so every entry can be started. A skill in both lists appears once.
 */
export function popular(used: UseMap, ranking: RankRow[] = [], installed: SkillLike[] = []): Entry[] {
  const have = new Set(installed.map((s) => s.name));
  const org: Entry[] = ranking
    .filter((r) => r.score > 0 && have.has(r.slug))
    .slice(0, MAX_ENTRIES)
    .map((r) => ({ key: `skill:${r.slug}`, label: r.slug, hint: `${r.devices} ${r.devices === 1 ? 'device' : 'devices'} · ${r.installs} installs`, prompt: `Nutze den Skill ${r.slug}.` }));
  const seen = new Set(org.map((e) => e.key));
  const mine = Object.entries(used)
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)
    .filter(([key]) => !seen.has(key))
    .slice(0, MAX_ENTRIES)
    .map(([key, u]) => ({ key, label: u.label, hint: `${u.count}× used`, prompt: u.prompt, open: u.open, at: u.last }));
  return [...org, ...mine].slice(0, MAX_ENTRIES);
}

/** Skills and Spaces added or changed in the last NEW_DAYS days, newest first. */
export function whatsNew(skills: SkillLike[], spaces: SpaceLike[], now = Date.now()): Entry[] {
  const since = now - NEW_DAYS * DAY;
  return [...skills.map(skillEntry), ...spaces.map(spaceEntry)]
    .filter((e) => (e.at ?? 0) >= since)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, MAX_ENTRIES);
}

export const USE_KEY = 'werkbank.chatUse';
const MAX_USED = 60;

export function recordUse(used: UseMap, e: Entry, now = Date.now()): UseMap {
  const old = used[e.key];
  const next: UseMap = { ...used, [e.key]: { label: e.label, hint: e.hint, prompt: e.prompt, open: e.open, count: (old?.count ?? 0) + 1, last: now } };
  const keys = Object.keys(next);
  if (keys.length > MAX_USED) { // forget the least used, oldest first
    keys.sort((a, b) => next[a].count - next[b].count || next[a].last - next[b].last);
    for (const k of keys.slice(0, keys.length - MAX_USED)) delete next[k];
  }
  return next;
}

export function loadUse(store: Pick<Storage, 'getItem'>): UseMap {
  try {
    const raw = JSON.parse(store.getItem(USE_KEY) ?? '{}');
    const out: UseMap = {};
    for (const [k, v] of Object.entries(raw ?? {}) as Array<[string, any]>) {
      if (typeof k === 'string' && k.length <= 120 && typeof v?.label === 'string' && Number.isFinite(v.count) && v.count > 0) {
        out[k] = { label: v.label.slice(0, 80), hint: String(v.hint ?? '').slice(0, 240), ...(typeof v.prompt === 'string' ? { prompt: v.prompt.slice(0, 2000) } : {}), ...(typeof v.open?.space === 'string' ? { open: { space: v.open.space.slice(0, 80), ...(typeof v.open.tab === 'string' ? { tab: v.open.tab.slice(0, 80) } : {}) } } : {}), count: Math.floor(v.count), last: Number(v.last) || 0 };
      }
    }
    return out;
  } catch { return {}; }
}
export function saveUse(store: Pick<Storage, 'setItem'>, used: UseMap): void { try { store.setItem(USE_KEY, JSON.stringify(used)); } catch { /* ignore */ } }

/** A tab opens its list on click and closes it on the next click on the same tab; another tab switches. null = all closed. */
export function nextTab(current: TabId | null, clicked: TabId): TabId | null {
  return current === clicked ? null : clicked;
}

/** Reads the stored choice: a tab id, 'none' (closed) or anything else (first visit: Favorites open). */
export function readTab(stored: string | null): TabId | null {
  if (stored === 'none') return null;
  return TABS.some((x) => x.id === stored) ? (stored as TabId) : 'favorites';
}
