export const APPEARANCE_STORAGE_KEY = 'werkbank.appearance';

export type AppearancePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export function parseAppearance(value: unknown): AppearancePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemUsesDark: boolean
): ResolvedTheme {
  return preference === 'system' ? (systemUsesDark ? 'dark' : 'light') : preference;
}

export function readAppearance(storage?: Pick<Storage, 'getItem'>): AppearancePreference {
  if (!storage) return 'system';
  try {
    return parseAppearance(storage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function writeAppearance(
  preference: AppearancePreference,
  storage?: Pick<Storage, 'setItem'>
): void {
  if (!storage) return;
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // An unavailable localStorage must not make appearance controls unusable.
  }
}
