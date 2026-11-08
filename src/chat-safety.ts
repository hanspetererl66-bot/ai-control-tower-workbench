/**
 * What the chat bar shows about safety. Working profile and approval mode live in the context panel; the bar itself shows a small
 * shield only when something is out of the ordinary, so a restricted agent is visible at a glance and a normal one adds no clutter.
 */
export const DEFAULT_PROFILE_ID = 'standard';
/** Modes that count as normal: the agent acts, asking only where its own rules say so. */
export const USUAL_MODES = ['auto', 'smart_approve'];

export type SafetyState = { profileId: string; profileName: string; modeId: string; modeName: string };

/** True when the profile is not the standard one or the approval mode is not one of the usual ones. */
export function safetyNotable(profileId: string, modeId: string): boolean {
  const profile = profileId || DEFAULT_PROFILE_ID;
  return profile !== DEFAULT_PROFILE_ID || (modeId !== '' && !USUAL_MODES.includes(modeId));
}

/** One line for the shield: what is in force right now. */
export function safetyLine(s: SafetyState): string {
  return `Working profile: ${s.profileName || 'Standard'} · Approval mode: ${s.modeName || s.modeId || 'unknown'}`;
}
