/**
 * The tree view of the Spaces list (like the folder tree of a file manager): which rows are shown, and where the arrow keys lead.
 * Pure logic so it can be tested; SpacesList.tsx only draws what this returns.
 */
export type TreeRow = { slug: string; depth: 0 | 1; parent: string; subCount: number; expanded: boolean };

export const spaceKey = (slug: string) => `space:${slug}`;

/**
 * Rows in display order: each top-level Space, followed by its subspaces unless it is collapsed.
 * While searching, hits are listed flat (a subspace is found even when its parent is not a hit).
 * A subspace whose parent is not in the list is not shown, like in the card view.
 */
export function treeRows(items: { slug: string }[], parentOf: (slug: string) => string, collapsed: string[], searching: boolean): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const x of items) {
    const parent = parentOf(x.slug);
    if (!searching && parent) continue;
    const subs = searching ? [] : items.filter((y) => parentOf(y.slug) === x.slug);
    const expanded = subs.length > 0 && !collapsed.includes(spaceKey(x.slug));
    rows.push({ slug: x.slug, depth: 0, parent: searching ? '' : parent, subCount: subs.length, expanded });
    if (expanded) for (const y of subs) rows.push({ slug: y.slug, depth: 1, parent: x.slug, subCount: 0, expanded: false });
  }
  return rows;
}

export type TreeMove = { focus?: number; toggle?: string } | null;

/**
 * What an arrow key does on row `index` of the visible rows (in screen order):
 * Up and Down move, Home and End jump, Right opens a Space or steps into its first subspace, Left closes it or steps up to its parent.
 */
export function treeNavigate(rows: TreeRow[], index: number, key: string): TreeMove {
  const row = rows[index];
  if (!row) return null;
  const last = rows.length - 1;
  switch (key) {
    case 'ArrowDown': return index < last ? { focus: index + 1 } : null;
    case 'ArrowUp': return index > 0 ? { focus: index - 1 } : null;
    case 'Home': return { focus: 0 };
    case 'End': return { focus: last };
    case 'ArrowRight':
      if (row.subCount === 0) return null;
      return row.expanded ? { focus: index + 1 } : { toggle: row.slug };
    case 'ArrowLeft': {
      if (row.subCount > 0 && row.expanded) return { toggle: row.slug };
      const up = row.parent ? rows.findIndex((r) => r.slug === row.parent) : -1;
      return up >= 0 ? { focus: up } : null;
    }
    default: return null;
  }
}
