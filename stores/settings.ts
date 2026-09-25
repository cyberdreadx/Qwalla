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

/**
 * How long a browser tab may sit inactive before it's "slept" — its webview is
 * unmounted to free memory and reloads when the user returns to it. `ms: 0`
 * disables sleeping (tabs stay live forever). Mobile webviews are memory-heavy,
 * so a default keeps many open tabs from getting the app OS-killed.
 */
export const TAB_SLEEP_OPTIONS = [
  { ms: 0, label: 'Never' },
  { ms: 5 * 60_000, label: 'After 5 minutes' },
  { ms: 10 * 60_000, label: 'After 10 minutes' },
  { ms: 30 * 60_000, label: 'After 30 minutes' },
] as const;

export const DEFAULT_TAB_SLEEP_MS = 10 * 60_000;

const VALID_TAB_SLEEP = new Set<number>(TAB_SLEEP_OPTIONS.map((o) => o.ms));

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
  /** Idle ms before a background browser tab is slept; 0 = never. */
  browserTabSleepMs: number;
  /** True once the user has seen (or skipped) the first-run tutorial tour. */
  seenTutorial: boolean;
  hydrate: () => Promise<void>;
  setAutoLockMs: (ms: number) => Promise<void>;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  setHideBalances: (hide: boolean) => Promise<void>;
  toggleHideBalances: () => Promise<void>;
  setBrowserTabSleepMs: (ms: number) => Promise<void>;
  setSeenTutorial: (seen: boolean) => Promise<void>;
};

async function persist(get: () => SettingsState) {
  try {
    const s = get();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        autoLockMs: s.autoLockMs,
        notificationsEnabled: s.notificationsEnabled,
        hideBalances: s.hideBalances,
        browserTabSleepMs: s.browserTabSleepMs,
        seenTutorial: s.seenTutorial,
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
  browserTabSleepMs: DEFAULT_TAB_SLEEP_MS,
  seenTutorial: false,

  hydrate: async () => {
    let autoLockMs = DEFAULT_AUTO_LOCK_MS;
    let notificationsEnabled = DEFAULT_NOTIFICATIONS_ENABLED;
    let hideBalances = DEFAULT_HIDE_BALANCES;
    let browserTabSleepMs = DEFAULT_TAB_SLEEP_MS;
    let seenTutorial = false;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw != null) {
        const parsed = JSON.parse(raw) as {
          autoLockMs?: unknown;
          notificationsEnabled?: unknown;
          hideBalances?: unknown;
          browserTabSleepMs?: unknown;
          seenTutorial?: unknown;
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
        if (typeof parsed?.browserTabSleepMs === 'number' && VALID_TAB_SLEEP.has(parsed.browserTabSleepMs)) {
          browserTabSleepMs = parsed.browserTabSleepMs;
        }
        if (typeof parsed?.seenTutorial === 'boolean') {
          seenTutorial = parsed.seenTutorial;
        }
      }
    } catch {
      /* fall back to defaults */
    }
    set({ hydrated: true, autoLockMs, notificationsEnabled, hideBalances, browserTabSleepMs, seenTutorial });
  },

  setAutoLockMs: async (ms: number) => {
    if (!VALID_AUTO_LOCK.has(ms)) return;
    set({ autoLockMs: ms });
    await persist(get);
  },

  setSeenTutorial: async (seen: boolean) => {
    set({ seenTutorial: seen });
    await persist(get);
  },

  setBrowserTabSleepMs: async (ms: number) => {
    if (!VALID_TAB_SLEEP.has(ms)) return;
    set({ browserTabSleepMs: ms });
    await persist(get);
  },

  setNotificationsEnabled: async (enabled: boolean) => {
    set({ notificationsEnabled: enabled });
    await persist(get);
  },

  setHideBalances: async (hide: boolean) => {
    set({ hideBalances: hide });
    await persist(get);
  },

  toggleHideBalances: async () => {
    await get().setHideBalances(!get().hideBalances);
  },
}));
