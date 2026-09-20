import AsyncStorage from '@react-native-async-storage/async-storage';

// Persists the in-app browser's visit history — the pages actually loaded in a
// tab, most-recent first, deduped by URL. Powers the "Recent" list on the
// browser home. Kept separate from open-tab state (lib/browser-tabs.ts): closing
// a tab or restarting doesn't erase history; only an explicit clear does.

const STORAGE_KEY = 'qwalla_browser_history';
const MAX_ENTRIES = 200;

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Record a visit (or refresh an existing one's title/time) and return the
 *  updated, deduped list. No-ops for non-http URLs. */
export async function addHistoryEntry(url: string, title: string): Promise<HistoryEntry[]> {
  if (!url || !/^https?:\/\//i.test(url)) return loadHistory();
  try {
    const list = await loadHistory();
    const rest = list.filter((e) => e.url !== url);
    const next = [{ url, title: title || url, visitedAt: Date.now() }, ...rest].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadHistory();
  }
}

export async function removeHistoryEntry(url: string): Promise<HistoryEntry[]> {
  try {
    const next = (await loadHistory()).filter((e) => e.url !== url);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadHistory();
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}
