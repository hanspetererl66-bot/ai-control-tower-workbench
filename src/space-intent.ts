const SPACE_TERM = /\b(space|dashboard)\b/i;
const SPACE_NEGATION = /\b(?:do not|don't|dont|never|without)\b[^.!?\n]{0,100}\b(?:space|dashboard)\b/i;

/** A negative mention such as "do not create a Space" is a guardrail, not an
 * authoring request. Keep this separate from the broad positive intent check. */
export function wantsSpace(text: string): boolean {
  return SPACE_TERM.test(text) && !SPACE_NEGATION.test(text);
}
