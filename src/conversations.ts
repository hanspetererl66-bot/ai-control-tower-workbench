import type { Message } from './ui/Chat';
import type { GeneratedFile } from './ui/DetailsPanel';

export const CONVERSATION_STORAGE_KEY = 'werkbank.conversations.v1';

export type ConversationRecord = {
  id: string;
  title: string;
  messages: Message[];
  files: GeneratedFile[];
  archived: boolean;
  /** Web Search switch of this conversation (on unless switched off). */
  webSearch?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ConversationState = {
  selectedId: string;
  items: ConversationRecord[];
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function makeConversationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `conversation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createConversation(id = makeConversationId(), now = Date.now()): ConversationRecord {
  return {
    id,
    title: 'New Conversation',
    messages: [],
    files: [],
    archived: false,
    webSearch: true,
    createdAt: now,
    updatedAt: now,
  };
}

function validConversation(value: unknown): ConversationRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ConversationRecord>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.title !== 'string' ||
    !Array.isArray(candidate.messages) ||
    !Array.isArray(candidate.files)
  ) {
    return null;
  }
  return {
    id: candidate.id,
    title: candidate.title || 'New Conversation',
    messages: candidate.messages,
    files: candidate.files.filter(
      (file): file is GeneratedFile => Boolean(file && typeof file.path === 'string')
    ),
    archived: candidate.archived === true,
    webSearch: candidate.webSearch !== false,
    createdAt: Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : Date.now(),
    updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : Date.now(),
  };
}

export function loadConversationState(
  storage: StorageLike,
  replacement = createConversation()
): ConversationState {
  try {
    const raw = storage.getItem(CONVERSATION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ConversationState>;
      const items = Array.isArray(parsed.items)
        ? parsed.items.map(validConversation).filter(Boolean) as ConversationRecord[]
        : [];
      if (items.length > 0) {
        const selected = items.find(
          (conversation) => conversation.id === parsed.selectedId && !conversation.archived
        );
        const fallback = items.find((conversation) => !conversation.archived);
        if (selected || fallback) {
          return { items, selectedId: (selected ?? fallback)!.id };
        }
        return { items: [replacement, ...items], selectedId: replacement.id };
      }
    }
  } catch {
    // A malformed or unavailable local store should never prevent the app opening.
  }
  return { selectedId: replacement.id, items: [replacement] };
}

export function saveConversationState(storage: StorageLike, state: ConversationState): void {
  try {
    storage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep conversations usable in-memory if localStorage is unavailable or full.
  }
}

export function archiveConversation(
  state: ConversationState,
  id: string,
  replacement = createConversation()
): ConversationState {
  const target = state.items.find((conversation) => conversation.id === id);
  if (!target || target.archived) return state;

  let items = state.items.map((conversation) =>
    conversation.id === id
      ? { ...conversation, archived: true, updatedAt: Date.now() }
      : conversation
  );
  if (state.selectedId !== id) return { ...state, items };

  const next = items.find((conversation) => !conversation.archived);
  if (next) return { items, selectedId: next.id };

  items = [replacement, ...items];
  return { items, selectedId: replacement.id };
}

export function restoreConversation(state: ConversationState, id: string): ConversationState {
  const target = state.items.find((conversation) => conversation.id === id);
  if (!target || !target.archived) return state;
  return {
    selectedId: id,
    items: state.items.map((conversation) =>
      conversation.id === id
        ? { ...conversation, archived: false, updatedAt: Date.now() }
        : conversation
    ),
  };
}

/** Remove a conversation for good. If it was selected, the next active one (or a fresh one) takes over. */
export function deleteConversation(
  state: ConversationState,
  id: string,
  replacement = createConversation()
): ConversationState {
  if (!state.items.some((conversation) => conversation.id === id)) return state;
  const items = state.items.filter((conversation) => conversation.id !== id);
  if (state.selectedId !== id) return { ...state, items };

  const next = items.find((conversation) => !conversation.archived);
  if (next) return { items, selectedId: next.id };
  return { items: [replacement, ...items], selectedId: replacement.id };
}
