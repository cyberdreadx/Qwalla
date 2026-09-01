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

type SettingsState = {
  /** True once the persisted settings have been loaded. */
  hydrated: boolean;
  /** Grace period in ms before auto-lock; 0 = lock immediately on background. */
  autoLockMs: number;
  hydrate: () => Promise<void>;
  setAutoLockMs: (ms: number) => Promise<void>;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  hydrated: false,
  autoLockMs: DEFAULT_AUTO_LOCK_MS,

  hydrate: async () => {
    let autoLockMs = DEFAULT_AUTO_LOCK_MS;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw != null) {
        const parsed = JSON.parse(raw) as { autoLockMs?: unknown };
        if (typeof parsed?.autoLockMs === 'number' && VALID_AUTO_LOCK.has(parsed.autoLockMs)) {
          autoLockMs = parsed.autoLockMs;
        }
      }
    } catch {
      /* fall back to default */
    }
    set({ hydrated: true, autoLockMs });
  },

  setAutoLockMs: async (ms: number) => {
    if (!VALID_AUTO_LOCK.has(ms)) return;
    set({ autoLockMs: ms });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ autoLockMs: ms }));
    } catch {
      /* non-fatal — the choice just won't persist */
    }
  },
}));
