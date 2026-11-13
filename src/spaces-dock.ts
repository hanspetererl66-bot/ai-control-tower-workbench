/**
 * Where the Spaces list sits. The list lives in the Spaces view only; in the other views (chat, manage) the list on the left is something else
 * (conversations) and stays where it is. Pure helpers so the rules can be tested; the grid itself is CSS (.app-spaces-* in theme.css).
 * Left and right keep the list as a column (cards or tree); top and bottom turn it into a bar of domain tabs and Space chips.
 */
import type { SpacesDock } from './preferences.ts';

export const DOCK_LABEL: Record<SpacesDock, string> = { left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' };

/** Top and bottom: the list is a bar, not a column. */
export const isBarDock = (dock: SpacesDock): boolean => dock === 'top' || dock === 'bottom';

/** The class the window grid gets, in the Spaces view only. The left side is the grid as it always was. */
export function spacesDockClass(view: string, dock: SpacesDock): string {
  return view === 'spaces' && dock !== 'left' ? `app-spaces-${dock}` : '';
}

/** The side the list sits on in this view, as far as the divider is concerned: only a column on the right changes it. */
export function listSide(view: string, dock: SpacesDock): 'left' | 'right' {
  return view === 'spaces' && dock === 'right' ? 'right' : 'left';
}

/** A divider between list and content exists for a column only; a bar takes the height it needs. */
export function showListSplitter(view: string, dock: SpacesDock): boolean {
  return !(view === 'spaces' && isBarDock(dock));
}
