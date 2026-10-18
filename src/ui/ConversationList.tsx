import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ConversationRecord } from '../conversations';

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
  const active = conversations.filter((conversation) => !conversation.archived);
  const archived = conversations.filter((conversation) => conversation.archived);

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
        <button className="icon-btn" title="Search" aria-label="Search">
          <SearchIcon />
        </button>
        <button className="icon-btn" title="Filter" aria-label="Filter">
          <FilterIcon />
        </button>
        <button className="icon-btn list-new" title="New conversation" aria-label="New conversation" disabled={disabled} onClick={onNew}>
          +
        </button>
      </div>

      <div className="list-section">
        <span>Active Conversations</span>
        <ChevronIcon />
      </div>
      <div className="conversation-items">{active.map(conversationButton)}</div>

      <button
        className="list-section list-section-muted list-section-button"
        onClick={() => setArchivedOpen((open) => !open)}
        aria-expanded={archivedOpen}
      >
        <span>Archived Conversations</span>
        <span className="list-section-count">{archived.length || ''}</span>
        <ChevronIcon right={!archivedOpen} />
      </button>
      {archivedOpen && (
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
