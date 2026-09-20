import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'qwalla_muted_conversations_v1';

/**
 * Per-conversation mute list (by conversationId). Muting suppresses in-app
 * alerts — the WebSocket toast/feed entry (useRealtimeNotifications) and the
 * foreground push toast (usePushNotifications) — on every platform. Unread
 * badge counts still update, so a muted chat shows it has activity without
 * nagging.
 *
 * NOTE: this does NOT stop background/system push banners on iOS/Android. Those
 * are sent by the RougeChain node to the wallet's registered token for any
 * incoming message; the SDK has no per-conversation mute, so silencing them
 * requires a node-side mute list (see docs / lib/push.ts). Muting here is the
 * in-app + foreground layer only.
 */
type MutedState = {
  hydrated: boolean;
  /** Set of muted conversationIds, stored as an object for easy JSON persist. */
  muted: Record<string, true>;
  hydrate: () => Promise<void>;
  isMuted: (conversationId: string) => boolean;
  toggle: (conversationId: string) => Promise<void>;
  setMuted: (conversationId: string, muted: boolean) => Promise<void>;
};

async function persist(muted: Record<string, true>) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.keys(muted)));
  } catch {
    /* non-fatal — the choice just won't persist */
  }
}

export const useMutedConversations = create<MutedState>((set, get) => ({
  hydrated: false,
  muted: {},

  hydrate: async () => {
    let muted: Record<string, true> = {};
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids)) {
          muted = Object.fromEntries(ids.map((id) => [String(id), true as const]));
        }
      }
    } catch {
      /* fall back to empty */
    }
    set({ hydrated: true, muted });
  },

  isMuted: (conversationId) => !!conversationId && get().muted[conversationId] === true,

  toggle: (conversationId) => get().setMuted(conversationId, !get().isMuted(conversationId)),

  setMuted: async (conversationId, muted) => {
    if (!conversationId) return;
    const next = { ...get().muted };
    if (muted) next[conversationId] = true;
    else delete next[conversationId];
    set({ muted: next });
    await persist(next);
  },
}));
