/**
 * The one set of limits and patterns every SKILL.md check uses: the Develop screen (skill-check.mjs),
 * the registry scripts (scripts/skills-registry.mjs) and the package check. Change them here only.
 * No Node imports, so the browser and the main process share it.
 */
export const MAX_DESCRIPTION = 240;
export const MAX_SKILL_CHARS = 20_000;
/** Credential patterns: the union of what the Develop check and the registry each caught before. */
export const SECRET_LIKE = /(sb_secret_|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|\bsk-[A-Za-z0-9]{20,}|\bxox[bp]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b)/;

/** "a, b" or "[a, b]" -> ['a','b'] (connector ids a skill needs, from `requires:` in the metadata block). */
export function parseRequires(value) {
  return String(value ?? '').split(',').map((s) => s.trim().replace(/^[\["']+|[\]"']+$/g, '')).filter(Boolean);
}

/** Connector ids a skill needs that are not in `available` (a Set or array of ids). */
export function missingConnectors(requires, available) {
  const have = new Set(available);
  return (requires ?? []).filter((id) => !have.has(id));
}
