import type { SourceKind } from './requirements.ts';

/** Words in a connector name that stand for a tool whose mark we draw. */
const BRANDS: Record<string, SourceKind> = { jira: 'jira', slack: 'slack', linear: 'linear', figma: 'figma', notion: 'notion', teams: 'teams', msteams: 'teams' };

/**
 * The tool a connector belongs to, from its name ("slack", "Jira-Cloud", "microsoft_teams"), or null when we have no mark for it.
 * Whole words only, so "gmail-drafts" or "nonlinear" never get a wrong logo.
 */
export function brandOf(name: string | undefined | null): SourceKind | null {
  for (const word of String(name ?? '').toLowerCase().split(/[^a-z0-9]+/)) if (Object.hasOwn(BRANDS, word)) return BRANDS[word];
  return null;
}
