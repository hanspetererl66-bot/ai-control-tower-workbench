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
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    setConfirmDelete(false);
  }, [menu]);

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

  function showButtonMenu(event: MouseEvent<HTMLButtonElement>, conversation: ConversationRecord) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(conversation, rect.right - 2, rect.bottom + 3);
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
        <button
          className="list-item-more"
          type="button"
          disabled={disabled}
          title={conversation.archived ? 'Conversation options' : 'Archive conversation'}
          aria-label={`Options for ${conversation.title}`}
          onClick={(event) => showButtonMenu(event, conversation)}
        >
          ···
        </button>
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
            className={`context-menu-item ${confirmDelete ? 'context-menu-item-danger' : ''}`}
            role="menuitem"
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              onDelete(menu.id);
              setMenu(null);
            }}
          >
            {confirmDelete ? 'Click again to delete for good' : 'Delete conversation'}
          </button>
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
