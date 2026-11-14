import { Fragment, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { PRODUCT_TITLE } from '../product';
import { sortByTitle } from '../space-order';
import { relativeTime, type Space } from '../spaces';
import { SPACES_DOCKS, type SpacesDock, type SpacesView } from '../preferences';
import { DOCK_LABEL, isBarDock } from '../spaces-dock';
import { barModel, chipOf } from '../spaces-bar';
import { spaceKey, treeNavigate, treeRows, type TreeRow } from '../spaces-tree';

type Props = {
  spaces: Space[];
  selected: string | null;
  onSelect: (slug: string) => void;
  /** Drop `from` before `to`, or after it when `after` is set. */
  onReorder?: (from: string, to: string, after: boolean) => void;
  /** Alt+Arrow keys: move one step up or down. */
  onNudge?: (slug: string, direction: -1 | 1) => void;
  /** Put all Spaces in alphabetical order (the slugs in the new order); dragging afterwards still works. */
  onSortAll?: (slugs: string[]) => void;
  /** Pinned Spaces (kept at the top) and the toggle. */
  pinned?: string[];
  onTogglePin?: (slug: string) => void;
  /** Domains: groups of Spaces. All names are in display order; `domainOf` says where a Space lives. */
  domains?: string[];
  domainOf?: (slug: string) => string;
  /** Move a Space (with its subspaces) or a subspace: to the top level of a domain, or under another Space. */
  onPlace?: (slug: string, to: { domain: string; parent?: string }) => void;
  /** Subspaces: `parentOf` gives the parent slug ('' for top level), `parentCandidates` the Spaces it could be moved under. */
  parentOf?: (slug: string) => string;
  parentCandidates?: (slug: string) => string[];
  onSetParent?: (slug: string, parent: string) => void;
  onAddDomain?: (name: string) => void;
  onRenameDomain?: (from: string, to: string) => void;
  onDeleteDomain?: (name: string) => void;
  /** Install a Space file somebody sent. */
  onImportSpace?: (file: File) => void;
  /** Rename a Space or subspace (own name; an empty or the original name takes it back). */
  onRenameSpace?: (slug: string, title: string) => void;
  originalTitle?: (slug: string) => string;
  /** Delete a Space for good; called only after the person confirmed in the dialog. */
  onDeleteSpace?: (slug: string) => void;
  onDuplicateSpace?: (slug: string) => void;
  /** Archive a Space: it leaves the list and can be restored from the Archived Spaces section. */
  onArchiveSpace?: (slug: string) => void;
  archived?: Space[];
  onRestoreSpace?: (slug: string) => void;
  /** How the list is drawn: cards, or a tree with one line per Space. The person's choice is kept in the settings. */
  view?: SpacesView;
  onViewChange?: (view: SpacesView) => void;
  /** Which side of the window the list sits on, and the choice in the menu of the header. */
  dock?: SpacesDock;
  onDockChange?: (dock: SpacesDock) => void;
};

const COLLAPSED_KEY = 'werkbank.collapsedDomains';
function loadCollapsed(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** `into`: the middle of a top-level card, dropping there makes the dragged Space a subspace of it. */
type DropMark = { slug: string; after: boolean; into: boolean };

export default function SpacesList({ spaces, selected, onSelect, onReorder, onNudge, onSortAll, pinned = [], onTogglePin, domains, domainOf, onPlace, parentOf, parentCandidates, onSetParent, onAddDomain, onRenameDomain, onDeleteDomain, onImportSpace, onRenameSpace, originalTitle, onDeleteSpace, onDuplicateSpace, onArchiveSpace, archived = [], onRestoreSpace, view = 'cards', onViewChange, dock = 'left', onDockChange }: Props) {
  const [archivedOpen, setArchivedOpen] = useState(false);
  const bar = isBarDock(dock);
  /* The bar form: the tab the person clicked, and the open popover ('sub:<slug>', 'manage' or 'archived'). */
  const [chosenDomain, setChosenDomain] = useState<string | null>(null);
  const [barPop, setBarPop] = useState<string | null>(null);
  useEffect(() => {
    if (!barPop) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setBarPop(null); };
    const onDown = (event: MouseEvent) => { if (!(event.target as Element | null)?.closest?.('[data-pop]')) setBarPop(null); };
    /* The subspace menu floats (position: fixed), so it would stay behind when the chip row scrolls or the window changes. */
    const close = () => setBarPop(null);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
  }, [barPop]);
  /* The chip row scrolls sideways (overflow), and that would cut off a menu inside it. So the menu is placed by hand next to its chip, above it for a bar at the bottom. */
  const placeSubMenu = (el: HTMLDivElement | null) => {
    const anchor = el?.parentElement?.getBoundingClientRect();
    if (!el || !anchor) return;
    el.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - el.offsetWidth - 8))}px`;
    if (dock === 'bottom') { el.style.top = 'auto'; el.style.bottom = `${window.innerHeight - anchor.top + 6}px`; }
    else { el.style.bottom = 'auto'; el.style.top = `${anchor.bottom + 6}px`; }
  };
  const [dockOpen, setDockOpen] = useState(false);
  const dockRef = useRef<HTMLSpanElement>(null);
  /* The dock menu closes on Escape and on a click anywhere else. */
  useEffect(() => {
    if (!dockOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { setDockOpen(false); dockRef.current?.querySelector('button')?.focus(); } };
    const onDown = (event: MouseEvent) => { if (!dockRef.current?.contains(event.target as Node)) setDockOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [dockOpen]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  const needle = query.trim().toLowerCase();
  const matches = (x: Space) => !needle || x.title.toLowerCase().includes(needle) || (x.description ?? '').toLowerCase().includes(needle);
  const shown = spaces.filter(matches);
  function toggleSearch() { if (searchOpen) setQuery(''); setSearchOpen((v) => !v); }
  const [renamingSpace, setRenamingSpace] = useState<string | null>(null);
  const [spaceName, setSpaceName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const grouped = Boolean(domains && domainOf);
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [overDomain, setOverDomain] = useState<string | null>(null);
  function toggleCollapsed(name: string) {
    setCollapsed((current) => {
      const next = current.includes(name) ? current.filter((x) => x !== name) : [...current, name];
      try { window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  function dropOnDomain(event: DragEvent<HTMLElement>, name: string) {
    event.preventDefault();
    const from = dragging ?? event.dataTransfer.getData('text/plain');
    endDrag();
    setOverDomain(null);
    if (from && onPlace) onPlace(from, { domain: name });
  }
  const [dragging, setDragging] = useState<string | null>(null);
  const [mark, setMark] = useState<DropMark | null>(null);

  function overCard(event: DragEvent<HTMLButtonElement>, slug: string) {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const offset = (event.clientY - box.top) / box.height;
    // Middle of a top-level card: nest. Edges: place before or after.
    const into = canNest(dragging, slug) && offset > 0.28 && offset < 0.72;
    const after = offset > 0.5;
    setMark((current) => (current?.slug === slug && current.after === after && current.into === into ? current : { slug, after, into }));
  }

  /** Over a chip of the bar: before or after it, by the horizontal half. A chip never takes a subspace (that is done with "Subspace of"). */
  function overChip(event: DragEvent<HTMLButtonElement>, slug: string) {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const after = (event.clientX - box.left) / box.width > 0.5;
    setMark((current) => (current?.slug === slug && current.after === after && !current.into ? current : { slug, after, into: false }));
  }

  /** A Space can become a subspace of a top-level Space; not one that has subspaces itself, not itself, not twice. */
  function canNest(from: string, to: string): boolean {
    if (from === to || !parentOf) return false;
    if (parentOf(to)) return false;
    if (subsOf(from).length > 0) return false;
    return parentOf(from) !== to;
  }

  function endDrag() {
    setDragging(null);
    setMark(null);
  }

  function dropOn(event: DragEvent<HTMLButtonElement>, slug: string) {
    event.preventDefault();
    const from = dragging ?? event.dataTransfer.getData('text/plain');
    const nest = mark?.slug === slug && mark.into;
    const after = mark?.slug === slug ? mark.after : false;
    endDrag();
    if (!from || from === slug) return;
    if (nest && onPlace) {
      onPlace(from, { domain: domainOf!(slug), parent: slug });
      return;
    }
    if (onPlace && domainOf) {
      // Beside a subspace the dragged Space joins that parent (unless it has subspaces itself); beside a top-level Space it becomes top level.
      const parent = parentOf?.(slug) ?? '';
      const joins = parent && subsOf(from).length === 0 ? parent : '';
      if (domainOf(from) !== domainOf(slug) || (parentOf?.(from) ?? '') !== joins) onPlace(from, joins ? { domain: domainOf(slug), parent: joins } : { domain: domainOf(slug) });
    }
    if (onReorder) onReorder(from, slug, after);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>, slug: string) {
    if (!event.altKey || !onNudge) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      onNudge(slug, event.key === 'ArrowUp' ? -1 : 1);
    }
  }

  const isSub = (slug: string) => Boolean(parentOf && parentOf(slug));
  const subsOf = (slug: string) => (parentOf ? spaces.filter((x) => parentOf(x.slug) === slug) : []);
  const subKey = spaceKey;
  // While searching, hits are listed flat so a subspace is found even if its parent is not a hit.
  const renderTree = (items: Space[]) => tree
    ? treeRows(items, (slug) => parentOf?.(slug) ?? '', collapsed, Boolean(needle)).flatMap((r) => { const x = items.find((y) => y.slug === r.slug); return x ? [renderRow(x, r)] : []; })
    : items.filter((x) => needle || !isSub(x.slug)).flatMap((x) => {
    const subs = needle ? [] : items.filter((y) => parentOf?.(y.slug) === x.slug);
    return [renderCard(x, subs.length), ...(subs.length && !collapsed.includes(subKey(x.slug)) ? subs.map((y) => renderCard(y, 0)) : [])];
  });
  /** The small buttons of a Space (rename, original name, duplicate, archive, delete, pin); shared by the card and the tree row. */
  const renderTools = (s: Space) => (
    <span className="card-tools">
      {onRenameSpace && (
        <span
          role="button"
          tabIndex={0}
          className="mini-icon"
          aria-label={`Rename ${s.title}`}
          title={isSub(s.slug) ? 'Rename this subspace' : 'Rename this Space'}
          onClick={(event) => { event.stopPropagation(); setRenamingSpace(s.slug); setSpaceName(s.title); }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setRenamingSpace(s.slug); setSpaceName(s.title); } }}
        ><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M11.3 2.3a1.6 1.6 0 0 1 2.3 2.3L5.4 12.8 2 13.6l.8-3.4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg></span>
      )}
      {onRenameSpace && originalTitle && originalTitle(s.slug) !== s.title && (
        <span
          role="button"
          tabIndex={0}
          className="mini-icon"
          aria-label={`Back to the original name of ${s.title}`}
          title={`Back to “${originalTitle(s.slug)}”`}
          onClick={(event) => { event.stopPropagation(); onRenameSpace(s.slug, ''); }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onRenameSpace(s.slug, ''); } }}
        ><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      )}
      {onDuplicateSpace && (
        <span
          role="button"
          tabIndex={0}
          className="mini-icon mini-icon-always"
          aria-label={`Duplicate ${s.title}`}
          title="Duplicate this Space (an editable copy)"
          onClick={(event) => { event.stopPropagation(); onDuplicateSpace(s.slug); }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onDuplicateSpace(s.slug); } }}
        ><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 3.5v-.4A1.6 1.6 0 0 0 8.9 1.5H3.6A1.6 1.6 0 0 0 2 3.1v5.3a1.6 1.6 0 0 0 1.6 1.6h.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg></span>
      )}
      {onArchiveSpace && (
        <span
          role="button"
          tabIndex={0}
          className="mini-icon mini-icon-always"
          aria-label={`Archive ${s.title}`}
          title="Archive this Space (hide it; restore it any time)"
          onClick={(event) => { event.stopPropagation(); onArchiveSpace(s.slug); }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onArchiveSpace(s.slug); } }}
        ><ArchiveIcon /></span>
      )}
      {onDeleteSpace && (
        <span
          role="button"
          tabIndex={0}
          className="mini-icon mini-icon-danger mini-icon-always"
          aria-label={`Delete ${s.title}`}
          title="Delete this Space"
          onClick={(event) => { event.stopPropagation(); setConfirmDelete(s.slug); }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setConfirmDelete(s.slug); } }}
        ><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2.5 4h11M6 4V2.6h4V4M4 4l.6 9.4h6.8L12 4M6.8 6.5v4.3M9.2 6.5v4.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      )}
      {onTogglePin ? (
        <span
          role="button"
          tabIndex={0}
          className={`pin-btn ${pinned.includes(s.slug) ? 'pin-btn-on' : ''}`}
          aria-pressed={pinned.includes(s.slug)}
          aria-label={pinned.includes(s.slug) ? `Unpin ${s.title}` : `Pin ${s.title}`}
          title={pinned.includes(s.slug) ? 'Unpin' : 'Pin to the top'}
          onClick={(event) => { event.stopPropagation(); onTogglePin(s.slug); }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onTogglePin(s.slug); } }}
        >{pinned.includes(s.slug) ? '★' : '☆'}</span>
      ) : (
        <span className="card-more" aria-hidden="true">···</span>
      )}
    </span>

  );
  /** What follows a Space when it is renamed or selected: the rename form and the "Subspace of" choice. */
  const renderExtras = (s: Space) => (
    <>
          {onRenameSpace && renamingSpace === s.slug && (
            <form className="domain-move space-rename" onSubmit={(event) => { event.preventDefault(); onRenameSpace(s.slug, spaceName); setRenamingSpace(null); }}>
              <input autoFocus value={spaceName} maxLength={80} aria-label={`New name for ${s.title}`} onChange={(event) => setSpaceName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setRenamingSpace(null); }} />
              <button type="submit" className="ghost-btn small" disabled={!spaceName.trim()}>Save</button>
              <button type="button" className="ghost-btn small" onClick={() => setRenamingSpace(null)}>Cancel</button>
            </form>
          )}
          {grouped && onSetParent && selected === s.slug && (() => {
            const options = parentCandidates?.(s.slug) ?? [];
            const current = parentOf?.(s.slug) ?? '';
            const has = subsOf(s.slug).length > 0;
            return (
              <label className="domain-move">
                <span>Subspace of</span>
                <select
                  value={current}
                  disabled={has || (!options.length && !current)}
                  onChange={(event) => onSetParent(s.slug, event.target.value)}
                  aria-label={`Parent Space of ${s.title}`}
                  title={has ? 'This Space has subspaces itself, so it stays on top level' : options.length || current ? 'Mark this Space as a subspace of another Space in the same domain' : 'No other top-level Space in this domain'}
                >
                  <option value="">None (top level)</option>
                  {[...new Set([...(current ? [current] : []), ...options])].map((slug) => <option key={slug} value={slug}>{spaces.find((x) => x.slug === slug)?.title ?? slug}</option>)}
                </select>
              </label>
            );
          })()}
    </>
  );

  /** The little menu in the header: where the Spaces list sits. The same in the column and in the bar. */
  const renderDockMenu = () => (
    onDockChange ? (
          <span className="dock-menu-wrap" ref={dockRef}>
            <button type="button" className={`icon-btn ${dockOpen ? 'icon-btn-on' : ''}`} aria-haspopup="menu" aria-expanded={dockOpen} aria-label="Where the Spaces list sits" title="Move the Spaces list to another side" onClick={() => setDockOpen((v) => !v)}><DockIcon side={dock} /></button>
            {dockOpen && (
              <div className="dock-menu" role="menu" aria-label="Where the Spaces list sits">
                {SPACES_DOCKS.map((side) => (
                  <button key={side} type="button" role="menuitemradio" aria-checked={dock === side} className={`dock-item ${dock === side ? 'dock-item-on' : ''}`} onClick={() => { onDockChange(side); setDockOpen(false); }}>
                    <DockIcon side={side} />
                    <span>{DOCK_LABEL[side]}</span>
                  </button>
                ))}
              </div>
            )}
          </span>
        ) : null
  );

  /** The dialog that asks before a Space is deleted for good. */
  const renderConfirm = () => {
    if (!confirmDelete) return null;
    const target = [...spaces, ...archived].find((x) => x.slug === confirmDelete);
    const subs = target ? subsOf(target.slug) : [];
    if (!target) return null;
    return (
      <div className="scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmDelete(null); }}>
        <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title" aria-describedby="del-text" onKeyDown={(event) => { if (event.key === 'Escape') setConfirmDelete(null); }}>
          <h2 id="del-title" className="dialog-title">Delete “{target.title}”?</h2>
          <p id="del-text" className="dialog-body">
            This deletes the {isSub(target.slug) ? 'subspace' : 'Space'} and its page from this computer. It cannot be undone.
            {subs.length > 0 && ` Its ${subs.length === 1 ? 'subspace' : `${subs.length} subspaces`} (${subs.map((x) => x.title).join(', ')}) will stay and move to the top level.`}
            {' '}Tip: Share → Save as file keeps a copy first.
          </p>
          <div className="dialog-actions">
            <button autoFocus className="dialog-btn dialog-btn-primary" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="dialog-btn dialog-btn-danger" onClick={() => { const slug = confirmDelete; setConfirmDelete(null); onDeleteSpace?.(slug); }}>Delete for good</button>
          </div>
        </div>
      </div>
    );
  };

  const tree = view === 'tree';
  /** Arrow keys in the tree: Up and Down move, Right and Left open, close or step in and out (see spaces-tree.ts); Alt+Arrow still reorders. */
  function treeKey(event: KeyboardEvent<HTMLButtonElement>, slug: string) {
    keyDown(event, slug);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const nodes = [...(event.currentTarget.closest('.list')?.querySelectorAll<HTMLButtonElement>('[data-tree-row]') ?? [])];
    const rows: TreeRow[] = nodes.map((n) => ({ slug: n.dataset.slug ?? '', depth: n.dataset.depth === '1' ? 1 : 0, parent: n.dataset.parent ?? '', subCount: Number(n.dataset.subs ?? 0), expanded: n.dataset.expanded === 'true' }));
    const move = treeNavigate(rows, nodes.indexOf(event.currentTarget), event.key);
    if (!move) return;
    event.preventDefault();
    if (move.toggle) toggleCollapsed(subKey(move.toggle));
    if (move.focus !== undefined) nodes[move.focus]?.focus();
  }
  /** One line per Space, like a folder tree: opener, icon, name; the buttons show on hover or focus. Same dragging, renaming and pinning as the card. */
  const renderRow = (s: Space, row: TreeRow) => (
    <Fragment key={s.slug}>
      <button
        type="button"
        data-tree-row
        data-slug={s.slug}
        data-depth={row.depth}
        data-parent={row.parent}
        data-subs={row.subCount}
        data-expanded={row.expanded}
        className={[
          'trow',
          row.depth === 1 ? 'trow-sub' : '',
          selected === s.slug ? 'trow-on' : '',
          dragging === s.slug ? 'trow-dragging' : '',
          mark?.slug === s.slug && dragging !== s.slug ? (mark.into ? 'card-drop-into' : mark.after ? 'card-drop-after' : 'card-drop-before') : '',
        ].filter(Boolean).join(' ')}
        aria-current={selected === s.slug ? 'true' : undefined}
        draggable={Boolean(onReorder)}
        title={s.description ? `${s.title}: ${s.description}` : s.title}
        onClick={() => onSelect(s.slug)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', s.slug);
          setDragging(s.slug);
        }}
        onDragOver={(event) => overCard(event, s.slug)}
        onDrop={(event) => dropOn(event, s.slug)}
        onDragEnd={endDrag}
        onKeyDown={(event) => treeKey(event, s.slug)}
      >
        {row.subCount > 0 ? (
          <span
            role="button"
            tabIndex={-1}
            className="trow-open"
            aria-expanded={row.expanded}
            aria-label={`${row.expanded ? 'Hide' : 'Show'} the ${row.subCount} subspaces of ${s.title}`}
            onClick={(event) => { event.stopPropagation(); toggleCollapsed(subKey(s.slug)); }}
          >{row.expanded ? '▾' : '▸'}</span>
        ) : <span className="trow-open trow-open-none" aria-hidden="true" />}
        <span className="trow-icon"><SpaceIcon /></span>
        <span className="trow-title">{s.title}</span>
        {row.subCount > 0 && <span className="sub-count" title={`${row.subCount} subspaces`}>{row.subCount}</span>}
        {pinned.includes(s.slug) && <span className="trow-pin" aria-hidden="true" title="Pinned">★</span>}
        {renderTools(s)}
      </button>
      {renderExtras(s)}
    </Fragment>
  );

  const renderCard = (s: Space, subCount = 0) => (
<Fragment key={s.slug}>
          <button
            className={[
              'card',
              isSub(s.slug) ? 'card-sub' : '',
              selected === s.slug ? 'card-on' : '',
              dragging === s.slug ? 'card-dragging' : '',
              mark?.slug === s.slug && dragging !== s.slug ? (mark.into ? 'card-drop-into' : mark.after ? 'card-drop-after' : 'card-drop-before') : '',
            ].filter(Boolean).join(' ')}
            draggable={Boolean(onReorder)}
            title={onReorder ? 'Drag to move: onto a domain, between Spaces, or onto the middle of a Space to make it a subspace (Alt+↑ / Alt+↓ reorders)' : undefined}
            onClick={() => onSelect(s.slug)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', s.slug);
              setDragging(s.slug);
            }}
            onDragOver={(event) => overCard(event, s.slug)}
            onDrop={(event) => dropOn(event, s.slug)}
            onDragEnd={endDrag}
            onKeyDown={(event) => keyDown(event, s.slug)}
          >
            <span className="card-head">
              <span className="card-icon"><SpaceIcon /></span>
              <span className="card-title-wrap">
                <span className="card-title">
                  {subCount > 0 && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="sub-toggle"
                      aria-expanded={!collapsed.includes(subKey(s.slug))}
                      aria-label={`${collapsed.includes(subKey(s.slug)) ? 'Show' : 'Hide'} the ${subCount} subspaces of ${s.title}`}
                      onClick={(event) => { event.stopPropagation(); toggleCollapsed(subKey(s.slug)); }}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggleCollapsed(subKey(s.slug)); } }}
                    >{collapsed.includes(subKey(s.slug)) ? '▸' : '▾'}</span>
                  )}
                  {s.title}
                  {subCount > 0 && <span className="sub-count" title={`${subCount} subspaces`}>{subCount}</span>}
                </span>
                <span className="card-meta">Updated {relativeTime(s.updatedAt)}</span>
              </span>
              {renderTools(s)}
            </span>
            {s.description && <span className="card-desc">{s.description}</span>}
          </button>
          {renderExtras(s)}
        </Fragment>
  );

  /** The bar form (docked on top or at the bottom): domains as tabs, the Spaces of the open domain as chips, subspaces on the chip, the rest in small menus. */
  const model = bar ? barModel({ spaces: shown, domains: domains ?? [], domainOf: domainOf ?? (() => ''), parentOf: parentOf ?? (() => ''), selected, chosen: chosenDomain, searching: Boolean(needle) }) : null;
  function chipKey(event: KeyboardEvent<HTMLButtonElement>, slug: string) {
    if (event.altKey && onNudge && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); onNudge(slug, event.key === 'ArrowLeft' ? -1 : 1); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End')) return;
    const chips = [...(event.currentTarget.closest('.bar-chips')?.querySelectorAll<HTMLButtonElement>('[data-chip]') ?? [])];
    const i = chips.indexOf(event.currentTarget);
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? chips.length - 1 : Math.max(0, Math.min(chips.length - 1, i + (event.key === 'ArrowRight' ? 1 : -1)));
    event.preventDefault();
    chips[to]?.focus();
  }
  const renderBar = () => {
    const m = model!;
    const titleOf = (slug: string) => spaces.find((x) => x.slug === slug)?.title ?? slug;
    const open = chipOf(m.chips, selected);
    const current = selected ? spaces.find((x) => x.slug === selected) : undefined;
    const activeCount = m.tabs.find((t) => t.name === m.active)?.count ?? 0;
    return (
      <aside className={`list list-bar list-bar-${dock}`} aria-label="Spaces">
        <div className="bar-row">
          <span className="list-title">Spaces</span>
          {!m.flat && (
            <div className="bar-tabs" role="tablist" aria-label="Domains">
              {m.tabs.map((t) => (renaming === t.name ? (
                <form key={t.name} className="bar-tab-form" onSubmit={(event) => { event.preventDefault(); if (renameValue.trim() && onRenameDomain) onRenameDomain(t.name, renameValue); setRenaming(null); }}>
                  <input autoFocus value={renameValue} maxLength={30} aria-label={`New name for ${t.name}`} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }} onBlur={() => setRenaming(null)} />
                </form>
              ) : (
                <button
                  key={t.name}
                  type="button"
                  role="tab"
                  aria-selected={t.name === m.active}
                  className={`bar-tab ${t.name === m.active ? 'bar-tab-on' : ''} ${overDomain === t.name ? 'bar-tab-over' : ''}`}
                  onClick={() => { setChosenDomain(t.name); setBarPop(null); }}
                  onDragOver={(event) => { if (dragging) { event.preventDefault(); setOverDomain(t.name); } }}
                  onDragLeave={() => setOverDomain((cur) => (cur === t.name ? null : cur))}
                  onDrop={(event) => dropOnDomain(event, t.name)}
                >
                  <span className="bar-tab-name">{t.name}</span>
                  <span className="domain-count">{t.count}</span>
                </button>
              )))}
              {onAddDomain && (adding ? (
                <form className="bar-tab-form" onSubmit={(event) => { event.preventDefault(); if (newName.trim()) onAddDomain(newName); setNewName(''); setAdding(false); }}>
                  <input autoFocus value={newName} maxLength={30} placeholder="Name of the domain" aria-label="Name of the new domain" onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setAdding(false); setNewName(''); } }} />
                </form>
              ) : (
                <button type="button" className="bar-tab bar-tab-add" title="New domain" aria-label="New domain" onClick={() => setAdding(true)}>+</button>
              ))}
            </div>
          )}
          {!m.flat && m.active && (onRenameDomain || (onDeleteDomain && activeCount === 0)) && (
            <span className="bar-domain-tools">
              {onRenameDomain && <button type="button" className="icon-btn" title="Rename this domain" aria-label={`Rename ${m.active}`} onClick={() => { setRenaming(m.active); setRenameValue(m.active); }}>✎</button>}
              {onDeleteDomain && activeCount === 0 && <button type="button" className="icon-btn" title="Delete this empty domain" aria-label={`Delete ${m.active}`} onClick={() => onDeleteDomain(m.active)}>✕</button>}
            </span>
          )}
          {m.flat && <span className="bar-count" role="status">{shown.length === 0 ? `No Spaces match “${query.trim()}”.` : `${shown.length} of ${spaces.length} shown`}</span>}
          <span className="bar-spacer" />
          {searchOpen && (
            <input ref={searchRef} className="bar-search" type="search" value={query} placeholder="Search names and descriptions" aria-label="Search Spaces" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); } }} />
          )}
          <button className={`icon-btn ${searchOpen ? 'icon-btn-on' : ''}`} title="Search Spaces" aria-label="Search Spaces" aria-expanded={searchOpen} onClick={toggleSearch}><SearchIcon /></button>
          {onImportSpace && (
            <label className="ghost-btn" title="Install a Space file somebody sent you" style={{ cursor: 'pointer' }}>
              Import
              <input type="file" accept=".json,application/json" hidden aria-label="Import Space file" onChange={(event) => { const f = event.target.files?.[0]; event.target.value = ''; if (f) onImportSpace(f); }} />
            </label>
          )}
          {archived.length > 0 && (
            <span className="bar-pop-wrap" data-pop>
              <button type="button" className={`ghost-btn ${barPop === 'archived' ? 'ghost-btn-on' : ''}`} aria-haspopup="menu" aria-expanded={barPop === 'archived'} onClick={() => setBarPop(barPop === 'archived' ? null : 'archived')}>Archived <span className="domain-count">{archived.length}</span></button>
              {barPop === 'archived' && (
                <div className="bar-pop bar-pop-archived" role="menu" aria-label="Archived Spaces">
                  {archived.map((a) => (
                    <div key={a.slug} className="bar-pop-line">
                      <span className="archived-title" title={a.description || a.title}>{a.title}</span>
                      {onRestoreSpace && <button className="ghost-btn small" onClick={() => onRestoreSpace(a.slug)} aria-label={`Restore ${a.title}`}>Restore</button>}
                      {onDeleteSpace && <button className="mini-icon mini-icon-danger mini-icon-always" onClick={() => { setBarPop(null); setConfirmDelete(a.slug); }} aria-label={`Delete ${a.title}`} title="Delete this Space for good"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2.5 4h11M6 4V2.6h4V4M4 4l.6 9.4h6.8L12 4M6.8 6.5v4.3M9.2 6.5v4.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
                    </div>
                  ))}
                </div>
              )}
            </span>
          )}
          {renderDockMenu()}
        </div>
        <div
          className="bar-row bar-chips"
          role="list"
          aria-label={m.flat ? 'Search results' : `Spaces in ${m.active}`}
          onDragOver={(event) => { if (dragging && !m.flat && m.active) event.preventDefault(); }}
          onDrop={(event) => { if (!m.flat && m.active && event.target === event.currentTarget) dropOnDomain(event, m.active); }}
        >
          {m.chips.length === 0 && <span className="bar-empty">{m.flat ? '' : m.active ? 'No Spaces in this domain yet. Drag one here, or ask Joule to build one.' : 'No domain yet. Add one with +.'}</span>}
          {m.chips.map((c) => {
            const sp = spaces.find((x) => x.slug === c.slug);
            if (!sp) return null;
            const parentOn = open === c.slug && selected !== c.slug;
            return (
              <span key={c.slug} role="listitem" className="chip-wrap">
                <button
                  type="button"
                  data-chip
                  data-slug={c.slug}
                  className={['chip', selected === c.slug ? 'chip-on' : '', parentOn ? 'chip-parent-on' : '', dragging === c.slug ? 'chip-dragging' : '', mark?.slug === c.slug && dragging !== c.slug ? (mark.after ? 'chip-drop-after' : 'chip-drop-before') : ''].filter(Boolean).join(' ')}
                  aria-current={selected === c.slug ? 'true' : undefined}
                  draggable={Boolean(onReorder)}
                  title={sp.description ? `${sp.title}: ${sp.description}` : sp.title}
                  onClick={() => { setBarPop(null); onSelect(c.slug); }}
                  onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', c.slug); setDragging(c.slug); }}
                  onDragOver={(event) => overChip(event, c.slug)}
                  onDrop={(event) => dropOn(event, c.slug)}
                  onDragEnd={endDrag}
                  onKeyDown={(event) => chipKey(event, c.slug)}
                >
                  <span className="chip-icon"><SpaceIcon /></span>
                  <span className="chip-title">{sp.title}</span>
                  {pinned.includes(c.slug) && <span className="trow-pin" aria-hidden="true" title="Pinned">★</span>}
                </button>
                {c.subs.length > 0 && (
                  <span className="chip-sub-wrap" data-pop>
                    <button type="button" className={`chip-sub ${parentOn ? 'chip-sub-on' : ''}`} aria-haspopup="menu" aria-expanded={barPop === `sub:${c.slug}`} aria-label={`${c.subs.length} subspaces of ${sp.title}`} title={`${c.subs.length} subspaces`} onClick={() => setBarPop(barPop === `sub:${c.slug}` ? null : `sub:${c.slug}`)}>{c.subs.length} ▾</button>
                    {barPop === `sub:${c.slug}` && (
                      <div className="bar-pop bar-pop-float" role="menu" ref={placeSubMenu} aria-label={`Subspaces of ${sp.title}`}>
                        {c.subs.map((sub) => (
                          <button key={sub} type="button" role="menuitem" className={`bar-pop-item ${selected === sub ? 'bar-pop-item-on' : ''}`} aria-current={selected === sub ? 'true' : undefined} onClick={() => { setBarPop(null); onSelect(sub); }}>
                            <SpaceIcon />
                            <span>{titleOf(sub)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </span>
                )}
              </span>
            );
          })}
          {current && (open || m.flat) && (
            <span className="bar-pop-wrap bar-manage" data-pop>
              <button type="button" className={`icon-btn ${barPop === 'manage' ? 'icon-btn-on' : ''}`} aria-haspopup="menu" aria-expanded={barPop === 'manage'} aria-label={`Manage ${current.title}`} title={`Rename, duplicate, archive, delete or pin ${current.title}`} onClick={() => setBarPop(barPop === 'manage' ? null : 'manage')}>⋯</button>
              {barPop === 'manage' && (
                <div className="bar-pop bar-pop-manage" role="group" aria-label={`Manage ${current.title}`}>
                  <span className="bar-pop-title">{current.title}</span>
                  {renderTools(current)}
                  {renderExtras(current)}
                </div>
              )}
            </span>
          )}
        </div>
        {renderConfirm()}
      </aside>
    );
  };
  if (bar) return renderBar();

  return (
    <aside className={`list ${tree ? 'list-tree' : ''}`}>
      <div className="list-head">
        <span className="list-title">Spaces</span>
        {onViewChange && (
          <span className="view-switch" role="group" aria-label="How the Spaces are listed">
            <button type="button" className={`icon-btn ${tree ? '' : 'icon-btn-on'}`} aria-pressed={!tree} title="Cards: a card with a description for every Space" aria-label="Show Spaces as cards" onClick={() => onViewChange('cards')}><CardsIcon /></button>
            <button type="button" className={`icon-btn ${tree ? 'icon-btn-on' : ''}`} aria-pressed={tree} title="Tree: one line per Space, like a folder tree" aria-label="Show Spaces as a tree" onClick={() => onViewChange('tree')}><TreeIcon /></button>
          </span>
        )}
        {onSortAll && (
          <span className="view-switch" role="group" aria-label="Sort the Spaces by name">
            <button type="button" className="icon-btn" title="Sort all Spaces A to Z (you can still drag them afterwards)" aria-label="Sort Spaces A to Z" onClick={() => onSortAll(sortByTitle(spaces, 'asc'))}><SortIcon dir="asc" /></button>
            <button type="button" className="icon-btn" title="Sort all Spaces Z to A (you can still drag them afterwards)" aria-label="Sort Spaces Z to A" onClick={() => onSortAll(sortByTitle(spaces, 'desc'))}><SortIcon dir="desc" /></button>
          </span>
        )}
        {renderDockMenu()}
        {onImportSpace && (
          <label className="ghost-btn" title="Install a Space file somebody sent you" style={{ cursor: 'pointer' }}>
            Import
            <input type="file" accept=".json,application/json" hidden aria-label="Import Space file" onChange={(event) => { const f = event.target.files?.[0]; event.target.value = ''; if (f) onImportSpace(f); }} />
          </label>
        )}
        <button className={`icon-btn ${searchOpen ? 'icon-btn-on' : ''}`} title="Search Spaces" aria-label="Search Spaces" aria-expanded={searchOpen} onClick={toggleSearch}>
          <SearchIcon />
        </button>
      </div>
      {searchOpen && (
        <input
          ref={searchRef}
          className="list-search"
          type="search"
          value={query}
          placeholder="Search names and descriptions"
          aria-label="Search Spaces"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); } }}
        />
      )}
      {dragging && grouped && (() => {
        const n = subsOf(dragging).length;
        const sub = isSub(dragging);
        return <p className="list-empty drag-hint" role="status">{n > 0 ? `Moves with its ${n === 1 ? 'subspace' : `${n} subspaces`}. Drop it on a domain or between Spaces.` : sub ? 'Moves alone, out of its parent. Drop it on a domain, between Spaces, or onto another Space.' : 'Drop it on a domain or between Spaces, or onto the middle of a Space to make it a subspace.'}</p>;
      })()}
      {needle && <p className="list-empty" role="status">{shown.length === 0 ? `No Spaces match “${query.trim()}”.` : `${shown.length} of ${spaces.length} shown`}</p>}

      {spaces.length === 0 ? (
        <p className="list-empty">
          {archived.length > 0
            ? `All Spaces are archived. Restore one below, or ask ${PRODUCT_TITLE} to build a new one.`
            : `No Spaces yet. Ask ${PRODUCT_TITLE} to create a dashboard from grounded data.`}
        </p>
      ) : (
        grouped ? (
          <>
            {onAddDomain && (
              <div className="domain-add">
                {adding ? (
                  <form onSubmit={(event) => { event.preventDefault(); if (newName.trim()) onAddDomain(newName); setNewName(''); setAdding(false); }}>
                    <input autoFocus value={newName} maxLength={30} placeholder="Name of the domain" aria-label="Name of the new domain" onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setAdding(false); setNewName(''); } }} />
                  </form>
                ) : (
                  <button className="ghost-btn" onClick={() => setAdding(true)}>+ New domain</button>
                )}
              </div>
            )}
            {domains!.map((name) => {
              const items = shown.filter((x) => domainOf!(x.slug) === name);
              if (needle && items.length === 0) return null;
              const isCollapsed = collapsed.includes(name);
              return (
                <section key={name} className={`domain ${overDomain === name ? 'domain-over' : ''}`} aria-label={`Domain ${name}`}>
                  <div
                    className="domain-head"
                    onDragOver={(event) => { if (dragging) { event.preventDefault(); setOverDomain(name); } }}
                    onDragLeave={() => setOverDomain((cur) => (cur === name ? null : cur))}
                    onDrop={(event) => dropOnDomain(event, name)}
                  >
                    <button className="domain-toggle" aria-expanded={!isCollapsed} onClick={() => toggleCollapsed(name)}>
                      <span className="domain-chev" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                      {renaming === name ? null : <span className="domain-name">{name}</span>}
                      {renaming === name ? null : <span className="domain-count">{items.length}</span>}
                    </button>
                    {renaming === name ? (
                      <form onSubmit={(event) => { event.preventDefault(); if (renameValue.trim() && onRenameDomain) onRenameDomain(name, renameValue); setRenaming(null); }}>
                        <input autoFocus value={renameValue} maxLength={30} aria-label={`New name for ${name}`} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }} onBlur={() => setRenaming(null)} />
                      </form>
                    ) : (
                      <span className="domain-tools">
                        {onRenameDomain && <button className="icon-btn" title="Rename domain" aria-label={`Rename ${name}`} onClick={() => { setRenaming(name); setRenameValue(name); }}>✎</button>}
                        {onDeleteDomain && items.length === 0 && <button className="icon-btn" title="Delete empty domain" aria-label={`Delete ${name}`} onClick={() => onDeleteDomain(name)}>✕</button>}
                      </span>
                    )}
                  </div>
                  {!isCollapsed && (items.length ? renderTree(items) : <div className="domain-empty" onDragOver={(event) => { if (dragging) { event.preventDefault(); setOverDomain(name); } }} onDrop={(event) => dropOnDomain(event, name)}>Drag a Space here</div>)}
                </section>
              );
            })}
          </>
        ) : (
          shown.map((x) => (tree ? renderRow(x, { slug: x.slug, depth: 0, parent: '', subCount: 0, expanded: false }) : renderCard(x)))
        )
      )}
      {archived.length > 0 && (
        <section className="archived-spaces" aria-label="Archived Spaces">
          <button className="archived-head" aria-expanded={archivedOpen} onClick={() => setArchivedOpen((v) => !v)}>
            <span aria-hidden="true">{archivedOpen ? '▾' : '▸'}</span>
            <span>Archived Spaces</span>
            <span className="domain-count">{archived.length}</span>
          </button>
          {archivedOpen && (
            <ul className="archived-list">
              {archived.map((s) => (
                <li key={s.slug}>
                  <span className="archived-title" title={s.description || s.title}>{s.title}</span>
                  {onRestoreSpace && <button className="ghost-btn small" onClick={() => onRestoreSpace(s.slug)} aria-label={`Restore ${s.title}`}>Restore</button>}
                  {onDeleteSpace && (
                    <button className="mini-icon mini-icon-danger mini-icon-always" onClick={() => setConfirmDelete(s.slug)} aria-label={`Delete ${s.title}`} title="Delete this Space for good">
                      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2.5 4h11M6 4V2.6h4V4M4 4l.6 9.4h6.8L12 4M6.8 6.5v4.3M9.2 6.5v4.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {renderConfirm()}
    </aside>
  );
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M2 3.5h12v3H2zM3 6.5v6h10v-6M6.5 9h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpaceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.8 6h12.4M6.4 6v7.4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Two letters and an arrow: the first letter on top for A to Z, the other way round for Z to A. */
function SortIcon({ dir }: { dir: 'asc' | 'desc' }) {
  const [top, bottom] = dir === 'asc' ? ['A', 'Z'] : ['Z', 'A'];
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <text x="1" y="7" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="inherit">{top}</text>
      <text x="1" y="14.5" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="inherit">{bottom}</text>
      <path d="M12 2.5v11M12 13.5l-2.4-2.6M12 13.5l2.4-2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" transform={dir === 'desc' ? 'rotate(180 12 8)' : undefined} />
    </svg>
  );
}

function CardsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.2" width="12" height="4.6" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="9.2" width="12" height="4.6" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function TreeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 3h6M5 7.5h8M5 12h8M3.4 3v9M3.4 7.5H5M3.4 12H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** A window with the side the list sits on filled in. */
function DockIcon({ side }: { side: SpacesDock }) {
  const bar = side === 'left' ? { x: 2, y: 2.6, w: 4.4, h: 10.8 } : side === 'right' ? { x: 9.6, y: 2.6, w: 4.4, h: 10.8 } : side === 'top' ? { x: 2, y: 2.6, w: 12, h: 4 } : { x: 2, y: 9.4, w: 12, h: 4 };
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.6" width="12" height="10.8" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <rect x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx="1.4" fill="currentColor" />
    </svg>
  );
}
