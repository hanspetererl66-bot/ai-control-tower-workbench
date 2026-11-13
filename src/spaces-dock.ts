/**
 * Where the Spaces list sits. The list lives in the Spaces view only; in the other views (chat, manage) the list on the left is something else
 * (conversations) and stays where it is. Pure helpers so the rules can be tested; the grid itself is CSS (.app-spaces-right in theme.css).
 */
import type { SpacesDock } from './preferences.ts';

export const DOCK_LABEL: Record<SpacesDock, string> = { left: 'Left', right: 'Right' };

/** The class the window grid gets: the Spaces list moves to the right edge, in the Spaces view only. */
export function spacesDockClass(view: string, dock: SpacesDock): string {
  return view === 'spaces' && dock === 'right' ? 'app-spaces-right' : '';
}

/** The side the list sits on in this view; the splitter between list and content follows it. */
export function listSide(view: string, dock: SpacesDock): SpacesDock {
  return view === 'spaces' ? dock : 'left';
}
