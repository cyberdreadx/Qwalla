import AsyncStorage from '@react-native-async-storage/async-storage';

// Persists the in-app browser's open tabs so a wallet lock/unlock (which unmounts the tab tree)
// or an app restart reopens exactly where you left off. Only the URL + title are stored — the
// WebView reloads the page, and since approved origins live in `connected-sites` (persisted,
// cleared only on disconnect), dApps auto-reconnect on reload.

const STORAGE_KEY = 'qwalla_browser_tabs';

export interface PersistedBrowserTab {
  url: string;
  title: string;
}

export interface PersistedBrowserState {
  tabs: PersistedBrowserTab[];
  activeIndex: number;
}

export async function loadBrowserState(): Promise<PersistedBrowserState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedBrowserState;
    if (!parsed?.tabs?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveBrowserState(state: PersistedBrowserState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* best-effort; a failed persist just means a stale/absent restore */
  }
}

export async function clearBrowserState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
