import { Fragment, useState, type DragEvent, type KeyboardEvent } from 'react';
import { PRODUCT_NAME } from '../product';
import { relativeTime, type Space } from '../spaces';

type Props = {
  spaces: Space[];
  selected: string | null;
  onSelect: (slug: string) => void;
  /** Drop `from` before `to`, or after it when `after` is set. */
  onReorder?: (from: string, to: string, after: boolean) => void;
  /** Alt+Arrow keys: move one step up or down. */
  onNudge?: (slug: string, direction: -1 | 1) => void;
  /** Pinned Spaces (kept at the top) and the toggle. */
  pinned?: string[];
  onTogglePin?: (slug: string) => void;
  /** Domains: groups of Spaces. All names are in display order; `domainOf` says where a Space lives. */
  domains?: string[];
  domainOf?: (slug: string) => string;
  onAssign?: (slug: string, domain: string) => void;
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

type DropMark = { slug: string; after: boolean };

export default function SpacesList({ spaces, selected, onSelect, onReorder, onNudge, pinned = [], onTogglePin, domains, domainOf, onAssign, parentOf, parentCandidates, onSetParent, onAddDomain, onRenameDomain, onDeleteDomain, onImportSpace, onRenameSpace, originalTitle, onDeleteSpace }: Props) {
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
    if (from && onAssign) onAssign(from, name);
  }
  const [dragging, setDragging] = useState<string | null>(null);
  const [mark, setMark] = useState<DropMark | null>(null);

  function overCard(event: DragEvent<HTMLButtonElement>, slug: string) {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    setMark((current) => (current?.slug === slug && current.after === after ? current : { slug, after }));
  }

  function endDrag() {
    setDragging(null);
    setMark(null);
  }

  function dropOn(event: DragEvent<HTMLButtonElement>, slug: string) {
    event.preventDefault();
    const from = dragging ?? event.dataTransfer.getData('text/plain');
    const after = mark?.slug === slug ? mark.after : false;
    endDrag();
    if (from && domainOf && onAssign && domainOf(from) !== domainOf(slug)) onAssign(from, domainOf(slug));
    if (from && onReorder) onReorder(from, slug, after);
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
  const subKey = (slug: string) => `space:${slug}`;
  const renderTree = (items: Space[]) => items.filter((x) => !isSub(x.slug)).flatMap((x) => {
    const subs = items.filter((y) => parentOf?.(y.slug) === x.slug);
    return [renderCard(x, subs.length), ...(subs.length && !collapsed.includes(subKey(x.slug)) ? subs.map((y) => renderCard(y, 0)) : [])];
  });
  const renderCard = (s: Space, subCount = 0) => (
<Fragment key={s.slug}>
          <button
            className={[
              'card',
              isSub(s.slug) ? 'card-sub' : '',
              selected === s.slug ? 'card-on' : '',
              dragging === s.slug ? 'card-dragging' : '',
              mark?.slug === s.slug && dragging !== s.slug ? (mark.after ? 'card-drop-after' : 'card-drop-before') : '',
            ].filter(Boolean).join(' ')}
            draggable={Boolean(onReorder)}
            title={onReorder ? 'Drag to reorder (or Alt+↑ / Alt+↓)' : undefined}
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
                {onDeleteSpace && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="mini-icon mini-icon-danger"
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
            </span>
            {s.description && <span className="card-desc">{s.description}</span>}
          </button>
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
          {grouped && onAssign && selected === s.slug && (
            <label className="domain-move">
              <span>Domain</span>
              <select value={domainOf!(s.slug)} onChange={(event) => onAssign(s.slug, event.target.value)} aria-label={`Domain of ${s.title}`}>
                {domains!.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          )}
        </Fragment>
  );

  return (
    <aside className="list">
      <div className="list-head">
        <span className="list-title">Spaces</span>
        {onImportSpace && (
          <label className="ghost-btn" title="Install a Space file somebody sent you" style={{ cursor: 'pointer' }}>
            Import
            <input type="file" accept=".json,application/json" hidden aria-label="Import Space file" onChange={(event) => { const f = event.target.files?.[0]; event.target.value = ''; if (f) onImportSpace(f); }} />
          </label>
        )}
        <button className="icon-btn" title="Search" aria-label="Search">
          <SearchIcon />
        </button>
        <button className="icon-btn" title="Filter" aria-label="Filter">
          <FilterIcon />
        </button>
      </div>

      {spaces.length === 0 ? (
        <p className="list-empty">
          No Spaces yet. Ask {PRODUCT_NAME} to create a dashboard from grounded data.
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
              const items = spaces.filter((x) => domainOf!(x.slug) === name);
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
                      <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
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
                  {!isCollapsed && (items.length ? renderTree(items) : <div className="domain-empty">Drag a Space here</div>)}
                </section>
              );
            })}
          </>
        ) : (
          spaces.map(renderCard)
        )
      )}
      {confirmDelete && (() => {
        const target = spaces.find((x) => x.slug === confirmDelete);
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
      })()}
    </aside>
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

function FilterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.2 3.2h11.6L9.5 8.1v3.5l-3 1.5v-5z" fill="currentColor" />
    </svg>
  );
}
