/**
 * "Back to the Space": a question from a Space ("Ask Joule about …") switches to the chat. The chat header then offers a way back to
 * that Space. The button is only shown while the chat is the open view and the Space still exists.
 */
export type SpaceRef = { slug: string; title: string };

/** The label of the back button, or null when there is nothing to go back to. */
export function backLabel(spaces: readonly SpaceRef[], slug: string | null): string | null {
  if (!slug) return null;
  const space = spaces.find((s) => s.slug === slug);
  return space ? `Back to ${space.title}` : null;
}

/** The remembered Space is dropped as soon as another view than the chat is open. */
export function keepReturn(view: string): boolean {
  return view === 'chat';
}
