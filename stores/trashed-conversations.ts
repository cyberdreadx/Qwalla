import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'qwalla_trashed_conversations_v1';

/**
 * Soft-delete for conversations. "Delete" moves a conversation here (a local,
 * per-device list of conversationIds) instead of destroying it on-chain, so it
 * can be restored. Emptying the Trash ("delete forever") is what actually calls
 * the server delete. Trashing is device-local — it hides the chat on this device
 * only, which matches how a recycle bin should behave.
 */
type TrashedState = {
  hydrated: boolean;
  /** Set of trashed conversationIds, stored as an object for easy JSON persist. */
  trashed: Record<string, true>;
  hydrate: () => Promise<void>;
  isTrashed: (conversationId: string) => boolean;
  trash: (conversationId: string) => Promise<void>;
  restore: (conversationId: string) => Promise<void>;
};

async function persist(trashed: Record<string, true>) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.keys(trashed)));
  } catch {
    /* non-fatal — the choice just won't persist */
  }
}

export const useTrashedConversations = create<TrashedState>((set, get) => ({
  hydrated: false,
  trashed: {},

  hydrate: async () => {
    let trashed: Record<string, true> = {};
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids)) {
          trashed = Object.fromEntries(ids.map((id) => [String(id), true as const]));
        }
      }
    } catch {
      /* fall back to empty */
    }
    set({ hydrated: true, trashed });
  },

  isTrashed: (conversationId) => !!conversationId && get().trashed[conversationId] === true,

  trash: async (conversationId) => {
    if (!conversationId) return;
    const next = { ...get().trashed, [conversationId]: true as const };
    set({ trashed: next });
    await persist(next);
  },

  restore: async (conversationId) => {
    if (!conversationId) return;
    const next = { ...get().trashed };
    delete next[conversationId];
    set({ trashed: next });
    await persist(next);
  },
}));
