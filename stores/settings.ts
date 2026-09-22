import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'qwalla_settings_v1';

/**
 * How long the app may sit in the background before it auto-locks on return.
 * `ms: 0` means lock immediately on background (most strict). The default is a
 * short grace period so hopping to another app and back doesn't force a re-unlock
 * — testers hit the old lock-on-every-background behavior as "it asks for the
 * password every time, even after switching back from another app."
 */
export const AUTO_LOCK_OPTIONS = [
  { ms: 0, label: 'Immediately' },
  { ms: 60_000, label: 'After 1 minute' },
  { ms: 5 * 60_000, label: 'After 5 minutes' },
  { ms: 15 * 60_000, label: 'After 15 minutes' },
] as const;

export const DEFAULT_AUTO_LOCK_MS = 60_000;

const VALID_AUTO_LOCK = new Set<number>(AUTO_LOCK_OPTIONS.map((o) => o.ms));

/** Notifications default on so existing users keep receiving alerts after this ships. */
export const DEFAULT_NOTIFICATIONS_ENABLED = true;

/** Balances are shown by default; the toggle is opt-in privacy. */
export const DEFAULT_HIDE_BALANCES = false;

type SettingsState = {
  /** True once the persisted settings have been loaded. */
  hydrated: boolean;
  /** Grace period in ms before auto-lock; 0 = lock immediately on background. */
  autoLockMs: number;
  /**
   * Master switch for push + in-app alert notifications. When off, the push
   * token is unregistered from the node (no background pushes) and in-app
   * toasts are suppressed. Unread badge counts are unaffected.
   */
  notificationsEnabled: boolean;
  /**
   * When true, wallet balances and USD values are masked (shown as dots) on the
   * wallet home. Privacy for shoulder-surfing / screenshots; doesn't affect the
   * actual balances, only their display.
   */
  hideBalances: boolean;
  hydrate: () => Promise<void>;
  setAutoLockMs: (ms: number) => Promise<void>;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  setHideBalances: (hide: boolean) => Promise<void>;
  toggleHideBalances: () => Promise<void>;
};

async function persist(state: {
  autoLockMs: number;
  notificationsEnabled: boolean;
  hideBalances: boolean;
}) {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        autoLockMs: state.autoLockMs,
        notificationsEnabled: state.notificationsEnabled,
        hideBalances: state.hideBalances,
      }),
    );
  } catch {
    /* non-fatal — the choice just won't persist */
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  hydrated: false,
  autoLockMs: DEFAULT_AUTO_LOCK_MS,
  notificationsEnabled: DEFAULT_NOTIFICATIONS_ENABLED,
  hideBalances: DEFAULT_HIDE_BALANCES,

  hydrate: async () => {
    let autoLockMs = DEFAULT_AUTO_LOCK_MS;
    let notificationsEnabled = DEFAULT_NOTIFICATIONS_ENABLED;
    let hideBalances = DEFAULT_HIDE_BALANCES;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw != null) {
        const parsed = JSON.parse(raw) as {
          autoLockMs?: unknown;
          notificationsEnabled?: unknown;
          hideBalances?: unknown;
        };
        if (typeof parsed?.autoLockMs === 'number' && VALID_AUTO_LOCK.has(parsed.autoLockMs)) {
          autoLockMs = parsed.autoLockMs;
        }
        if (typeof parsed?.notificationsEnabled === 'boolean') {
          notificationsEnabled = parsed.notificationsEnabled;
        }
        if (typeof parsed?.hideBalances === 'boolean') {
          hideBalances = parsed.hideBalances;
        }
      }
    } catch {
      /* fall back to defaults */
    }
    set({ hydrated: true, autoLockMs, notificationsEnabled, hideBalances });
  },

  setAutoLockMs: async (ms: number) => {
    if (!VALID_AUTO_LOCK.has(ms)) return;
    set({ autoLockMs: ms });
    await persist({
      autoLockMs: ms,
      notificationsEnabled: get().notificationsEnabled,
      hideBalances: get().hideBalances,
    });
  },

  setNotificationsEnabled: async (enabled: boolean) => {
    set({ notificationsEnabled: enabled });
    await persist({
      autoLockMs: get().autoLockMs,
      notificationsEnabled: enabled,
      hideBalances: get().hideBalances,
    });
  },

  setHideBalances: async (hide: boolean) => {
    set({ hideBalances: hide });
    await persist({
      autoLockMs: get().autoLockMs,
      notificationsEnabled: get().notificationsEnabled,
      hideBalances: hide,
    });
  },

  toggleHideBalances: async () => {
    await get().setHideBalances(!get().hideBalances);
  },
}));
