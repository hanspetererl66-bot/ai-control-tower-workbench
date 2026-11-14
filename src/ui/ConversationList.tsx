import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { CONVERSATION_RANGES, filterConversations, type ConversationRange, type ConversationRecord } from '../conversations';

type Props = {
  conversations: ConversationRecord[];
  selectedId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
};

type ContextMenu = { id: string; archived: boolean; x: number; y: number };

export default function ConversationList({
  conversations,
  selectedId,
  disabled = false,
  onSelect,
  onNew,
  onArchive,
  onRestore,
  onDelete,
}: Props) {
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<ConversationRange>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const filtered = filterConversations(conversations, { query, range });
  const filtering = query.trim() !== '' || range !== 'all';
  const active = filtered.filter((conversation) => !conversation.archived);
  const archived = filtered.filter((conversation) => conversation.archived);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!filterOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFilterOpen(false);
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [filterOpen]);

  function toggleSearch() {
    if (searchOpen) setQuery('');
    setSearchOpen((open) => !open);
  }

  useEffect(() => {
    if (!menu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [menu]);

  function openMenu(conversation: ConversationRecord, x: number, y: number) {
    if (disabled) return;
    setMenu({
      id: conversation.id,
      archived: conversation.archived,
      x: Math.min(x, window.innerWidth - 202),
      y: Math.min(y, window.innerHeight - 100),
    });
  }

  function showMenu(event: MouseEvent, conversation: ConversationRecord) {
    event.preventDefault();
    event.stopPropagation();
    openMenu(conversation, event.clientX, event.clientY);
  }

  function conversationButton(conversation: ConversationRecord) {
    const selected = conversation.id === selectedId;
    return (
      <div
        key={conversation.id}
        className={`list-item ${selected ? 'list-item-on' : ''}`}
        onContextMenu={(event) => showMenu(event, conversation)}
        title={conversation.title}
      >
        <button
          className="list-item-select"
          disabled={disabled}
          onClick={() => onSelect(conversation.id)}
        >
          <span>{conversation.title}</span>
        </button>
        <div className="list-item-actions">
          <button
            className="list-item-act"
            type="button"
            disabled={disabled}
            title={conversation.archived ? 'Restore conversation' : 'Archive conversation'}
            aria-label={`${conversation.archived ? 'Restore' : 'Archive'} ${conversation.title}`}
            onClick={(event) => {
              event.stopPropagation();
              if (conversation.archived) onRestore(conversation.id);
              else onArchive(conversation.id);
            }}
          >
            {conversation.archived ? <RestoreIcon /> : <ArchiveIcon />}
          </button>
          <button
            className="list-item-act list-item-act-danger"
            type="button"
            disabled={disabled}
            title="Delete conversation"
            aria-label={`Delete ${conversation.title}`}
            onClick={(event) => {
              event.stopPropagation();
              setPendingDelete({ id: conversation.id, title: conversation.title });
            }}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    );
  }

  return (
    <aside className="list">
      <div className="list-head">
        <span className="list-title">Conversations</span>
        <button
          className={`icon-btn ${searchOpen || query ? 'icon-btn-on' : ''}`}
          title="Search conversations"
          aria-label="Search conversations"
          aria-pressed={searchOpen}
          onClick={toggleSearch}
        >
          <SearchIcon />
        </button>
        <div className="list-filter" ref={filterRef}>
          <button
            className={`icon-btn ${range !== 'all' ? 'icon-btn-on' : ''}`}
            title="Filter conversations"
            aria-label="Filter conversations"
            aria-haspopup="menu"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
          >
            <FilterIcon />
          </button>
          {filterOpen && (
            <div className="context-menu list-filter-menu" role="menu">
              {CONVERSATION_RANGES.map((option) => (
                <button
                  key={option.id}
                  className={`context-menu-item ${range === option.id ? 'context-menu-item-on' : ''}`}
                  role="menuitemradio"
                  aria-checked={range === option.id}
                  onClick={() => {
                    setRange(option.id);
                    setFilterOpen(false);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="icon-btn list-new" title="New conversation" aria-label="New conversation" disabled={disabled} onClick={onNew}>
          +
        </button>
      </div>

      {searchOpen && (
        <input
          ref={searchRef}
          className="list-search"
          type="search"
          value={query}
          placeholder="Search titles and messages"
          aria-label="Search conversations"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('');
              setSearchOpen(false);
            }
          }}
        />
      )}
      {filtering && (
        <p className="conversation-empty list-filter-note">
          {active.length + archived.length} of {conversations.length} shown
          {range !== 'all' ? ` · ${CONVERSATION_RANGES.find((r) => r.id === range)?.label.toLowerCase()}` : ''}
          <button
            className="list-filter-clear"
            onClick={() => {
              setQuery('');
              setRange('all');
            }}
          >
            Clear
          </button>
        </p>
      )}

      <div className="list-section">
        <span>Active Conversations</span>
        <ChevronIcon />
      </div>
      <div className="conversation-items">
        {active.length > 0 ? active.map(conversationButton) : filtering ? (
          <p className="conversation-empty">No matching conversations</p>
        ) : null}
      </div>

      <button
        className="list-section list-section-muted list-section-button"
        onClick={() => setArchivedOpen((open) => !open)}
        aria-expanded={archivedOpen}
      >
        <span>Archived Conversations</span>
        <span className="list-section-count">{archived.length || ''}</span>
        <ChevronIcon right={!archivedOpen} />
      </button>
      {(archivedOpen || (filtering && archived.length > 0)) && (
        <div className="conversation-items conversation-items-archived">
          {archived.length > 0 ? archived.map(conversationButton) : (
            <p className="conversation-empty">No archived conversations</p>
          )}
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="context-menu conversation-context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="context-menu-item"
            role="menuitem"
            onClick={() => {
              if (menu.archived) onRestore(menu.id);
              else onArchive(menu.id);
              setMenu(null);
            }}
          >
            {menu.archived ? 'Restore conversation' : 'Archive conversation'}
          </button>
          <button
            className="context-menu-item"
            role="menuitem"
            onClick={() => {
              const target = conversations.find((c) => c.id === menu.id);
              setPendingDelete({ id: menu.id, title: target?.title ?? 'this conversation' });
              setMenu(null);
            }}
          >
            Delete conversation
          </button>
        </div>
      )}
      {pendingDelete && (
        <div className="scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingDelete(null); }}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="conv-del-title" aria-describedby="conv-del-text" onKeyDown={(event) => { if (event.key === 'Escape') setPendingDelete(null); }}>
            <h2 id="conv-del-title" className="dialog-title">Delete “{pendingDelete.title}”?</h2>
            <p id="conv-del-text" className="dialog-body">This deletes the conversation and all its messages from this computer. It cannot be undone. Archive it instead if you may need it later.</p>
            <div className="dialog-actions">
              <button autoFocus className="dialog-btn dialog-btn-primary" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="dialog-btn dialog-btn-danger" onClick={() => { const id = pendingDelete.id; setPendingDelete(null); onDelete(id); }}>Delete for good</button>
            </div>
          </div>
        </div>
      )}
    </aside>
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

function ChevronIcon({ right = false }: { right?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={right ? undefined : { transform: 'rotate(90deg)' }}
    >
      <path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.8" y="2.5" width="12.4" height="3.2" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 5.7v6.3a1.3 1.3 0 0 0 1.3 1.3h7.4A1.3 1.3 0 0 0 13 12V5.7M6.3 8.6h3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4h11M6 4V2.6h4V4M4 4l.6 9.4h6.8L12 4M6.8 6.5v4.3M9.2 6.5v4.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
