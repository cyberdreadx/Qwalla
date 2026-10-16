import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
  Image,
  useWindowDimensions,
} from 'react-native';
import type { ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, spacing, radius, fontSize } from '@/constants/theme';
import { useWalletStore } from '@/stores/wallet';
import { useSettingsStore } from '@/stores/settings';
import { setDappEventSink } from '@/lib/dapp-events';
import { isBundledBookmarkListed } from '@/lib/compliance';
import type { ApprovalRequest } from '@/lib/dapp-provider';
import { loadBrowserState, saveBrowserState } from '@/lib/browser-tabs';
import { sameUrl, urlKey } from '@/lib/url-key';
import {
  loadHistory,
  addHistoryEntry,
  clearHistory as clearBrowserHistory,
  type HistoryEntry,
} from '@/lib/browser-history';
import PqConnectionBadge from '@/components/PqConnectionBadge';
import { useT } from '@/lib/i18n';

let WebView: any = null;
let getInjectedProviderScript: (() => string) | null = null;
let handleDappRequest: any = null;
let sendResponseToWebView: any = null;
let sendEventToWebView: any = null;
let ApprovalModal: any = null;
let getInjectedEthereumScript: (() => string) | null = null;
let handleEvmRequest: any = null;
let CryptoNewsFeed: any = null;

// Native uses react-native-webview; the desktop (web) build renders pages in an
// Electron <webview> through an API-compatible shim, so the rest of this screen
// is one shared code path. See components/ElectronWebView.tsx.
if (Platform.OS === 'web') {
  WebView = require('@/components/ElectronWebView').default;
} else {
  WebView = require('react-native-webview').default;
}

// The dApp provider bridge is pure logic + RN components (no native modules), so
// it runs on the desktop build too and drives the Electron <webview> exactly as
// it drives the native WebView — same injected scripts, same message bus.
const provider = require('@/lib/dapp-provider');
getInjectedProviderScript = provider.getInjectedProviderScript;
handleDappRequest = provider.handleDappRequest;
sendResponseToWebView = provider.sendResponseToWebView;
sendEventToWebView = provider.sendEventToWebView;
ApprovalModal = require('@/components/dapp/ApprovalModal').default;
const evm = require('@/lib/evm-provider');
getInjectedEthereumScript = evm.getInjectedEthereumScript;
handleEvmRequest = evm.handleEvmRequest;

// News + markets feed is pure RN + fetch (no WebView), so it also runs on the
// web build — which is what the desktop (Electron) app ships. main.js relaxes
// CORS for remote responses there, so the RSS/CoinGecko fetches succeed.
CryptoNewsFeed = require('@/components/CryptoNewsFeed').default;

// The dApp provider scripts are static (no baked-in wallet state), so compute the
// combined injection once. Used both as the WebView's before-content-loaded prop
// and registered with the Electron main process (window.qwallaRegisterInjection)
// so the guest preload can install the provider at document-start. See
// components/ElectronWebView.tsx and desktop/webview-preload.js.
const INJECTED_PROVIDER_SCRIPT =
  (getInjectedProviderScript ? getInjectedProviderScript() : '') +
  (getInjectedEthereumScript ? getInjectedEthereumScript() : '');

interface Bookmark {
  name: string;
  url: string;
  icon: string;
  isCustom?: boolean;
  /** Bundled logo image (wins over favicon/Ionicon). */
  logo?: number;
  /** Skip the site favicon and use the Ionicon (e.g. music notes, not the coin). */
  noFavicon?: boolean;
}

const ALL_BOOKMARKS: Bookmark[] = [
  { name: 'RouGee', url: 'https://rougee.app', icon: 'people' },
  { name: 'Music', url: 'https://music.rougee.app', icon: 'musical-notes', noFavicon: true },
  {
    name: 'antiReddit',
    url: 'https://antireddit.com',
    icon: 'chatbubbles',
    logo: require('@/assets/images/antireddit.png'),
  },
  // All rougechain.io subpages share one favicon, so let each use its own
  // Ionicon instead — otherwise they render as six identical "R" coins.
  { name: 'Explorer', url: 'https://rougechain.io/blockchain', icon: 'search', noFavicon: true },
  { name: 'Swap', url: 'https://rougechain.io/swap', icon: 'swap-horizontal', noFavicon: true },
  { name: 'Tokens', url: 'https://rougechain.io/tokens', icon: 'diamond', noFavicon: true },
  { name: 'NFTs', url: 'https://rougechain.io/nfts', icon: 'image', noFavicon: true },
  { name: 'Pools', url: 'https://rougechain.io/pools', icon: 'water', noFavicon: true },
  { name: 'Bridge', url: 'https://rougechain.io/bridge', icon: 'git-compare', noFavicon: true },
];

// The iOS build ships no RougeChain shortcuts in its bookmark index: build 24
// dropped only Swap/Pools/Bridge, and the reviewer tapped Tokens and reached
// the exchange from rougechain.io's own sidebar. This is an index filter, not a
// navigation block — rougechain.io still works if a user goes there.
// See lib/compliance.ts (App Review Guidelines 3.1.5(iii) and 4.7).
const DEFAULT_BOOKMARKS: Bookmark[] = ALL_BOOKMARKS.filter((b) =>
  isBundledBookmarkListed(b.url),
);

const BOOKMARKS_KEY = 'qwalla_browser_bookmarks'; // legacy (custom-only); migrated to v2
const BOOKMARKS_V2_KEY = 'qwalla_browser_bookmarks_v2'; // full editable list

// ── Web panels (Opera GX-style sidebar) ───────────────────────────
interface WebPanel {
  id: string;
  name: string;
  url: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const DEFAULT_PANELS: WebPanel[] = [
  { id: 'whatsapp', name: 'WhatsApp', url: 'https://web.whatsapp.com', icon: 'logo-whatsapp' },
  { id: 'telegram', name: 'Telegram', url: 'https://web.telegram.org', icon: 'paper-plane' },
  { id: 'x', name: 'X', url: 'https://x.com', icon: 'logo-twitter' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', icon: 'chatbubble-ellipses' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai', icon: 'sparkles' },
];

const PANELS_KEY = 'qwalla_web_panels_v1';

function normaliseUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    if (url.includes('.') && !url.includes(' ')) {
      url = 'https://' + url;
    } else {
      url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
    }
  }
  return url;
}

// ── Tab data ──────────────────────────────────────────────────────

interface BrowserTab {
  id: string;
  /** The load target — what the WebView's source points at. Only changes on an
   *  explicit navigate()/restore, so it never churns the source prop (which
   *  would force a redundant reload). */
  url: string;
  /** The live page URL as the guest navigates (links, redirects). Used for
   *  bookmarking, the bookmark star, origin, and session restore. */
  currentUrl: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

let nextTabId = 1;
function makeTab(url = ''): BrowserTab {
  return {
    id: `tab_${nextTabId++}`,
    url,
    currentUrl: url,
    title: url ? new URL(url).hostname : 'New Tab',
    canGoBack: false,
    canGoForward: false,
  };
}

/** The tab's live URL (where the guest actually is), falling back to its load target. */
function tabLiveUrl(tb: BrowserTab): string {
  return tb.currentUrl || tb.url;
}

type DownloadEntry = {
  id: string;
  filename: string;
  path: string;
  received: number;
  total: number;
  state: string; // started | progressing | interrupted | completed | cancelled
};

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

type ExtInfo = { id: string; name: string; version: string; description?: string };
type ExtBridge = {
  list: () => Promise<ExtInfo[]>;
  loadUnpacked: () => Promise<{ ok: boolean; error?: string; canceled?: boolean }>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  update: () => Promise<{ ok: boolean; error?: string }>;
};
type BrowserBridge = {
  onDownload?: (cb: (d: DownloadEntry) => void) => () => void;
  openDownload?: (p: string) => void;
  showDownload?: (p: string) => void;
  setActiveTab?: (webContentsId: number) => void;
  onOpenTab?: (cb: (url: string) => void) => () => void;
  /** Native menu accelerator actions (new-tab, find, reload, back, …). */
  onShortcut?: (cb: (action: string) => void) => () => void;
  ext?: ExtBridge;
};

/** The Electron browser exposes downloads + file actions here (desktop only). */
function browserBridge(): BrowserBridge | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return (window as { qwallaBrowser?: BrowserBridge }).qwallaBrowser ?? null;
}

function domainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 24);
  }
}

function faviconUrl(u: string): string | null {
  try {
    return `https://icons.duckduckgo.com/ip3/${new URL(u).hostname}.ico`;
  } catch {
    return null;
  }
}

/** Shows a bookmarked site's real favicon (for RougeChain sites, that's the
 *  brand logo), falling back to the Ionicon if the favicon can't be loaded. */
function BookmarkIcon({
  url,
  icon,
  isCustom,
  logo,
  noFavicon,
}: {
  url: string;
  icon: string;
  isCustom?: boolean;
  logo?: number;
  noFavicon?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (logo) {
    return <Image source={logo} style={{ width: 34, height: 34, borderRadius: 8 }} />;
  }
  const fav = noFavicon ? null : faviconUrl(url);
  if (fav && !failed) {
    return (
      <Image
        source={{ uri: fav }}
        style={{ width: 32, height: 32, borderRadius: 8 }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <Ionicons name={icon as any} size={24} color={isCustom ? colors.purple : colors.accent} />
  );
}

/** A tab chip's icon: the site favicon, falling back to a globe. Lets several
 *  open tabs be told apart at a glance instead of all showing one globe. */
function TabFavicon({ url, active }: { url: string; active: boolean }) {
  const [failed, setFailed] = useState(false);
  const fav = url ? faviconUrl(url) : null;
  if (fav && !failed) {
    return (
      <Image
        source={{ uri: fav }}
        style={{ width: 14, height: 14, borderRadius: 3 }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <Ionicons name="globe-outline" size={13} color={active ? colors.text : colors.textTertiary} />
  );
}

// ── Component ─────────────────────────────────────────────────────

// Stable, module-level style so the custom element's props never change identity.
const BROWSER_ACTION_STYLE = { display: 'flex', alignItems: 'center', height: 34 };

/**
 * Extension toolbar (desktop/Electron only): renders the <browser-action-list>
 * custom element defined by the registered extension preload, showing pinned
 * extension icons next to the address bar. Clicking one opens its popup (handled
 * by the extensions runtime). `partition` targets the dApp browsing session.
 *
 * Memoized with NO props so it never re-renders — otherwise React reflows the
 * element that an open popup is anchored to, and the popup violently jitters /
 * closes-and-reopens as its anchor moves.
 */
const ExtensionToolbar = React.memo(function ExtensionToolbar() {
  if (Platform.OS !== 'web') return null;
  const w = typeof window !== 'undefined' ? (window as unknown as { qwallaBrowser?: { setActiveTab?: unknown } }) : null;
  if (!w?.qwallaBrowser?.setActiveTab) return null; // only in the extension-capable desktop build
  return React.createElement('browser-action-list', {
    partition: 'persist:dappbrowser',
    style: BROWSER_ACTION_STYLE,
  });
});

/** Manage extensions: list, remove, load unpacked, check for updates. */
function ExtensionManager({ ext, onClose, top }: { ext: ExtBridgeType; onClose: () => void; top?: number }) {
  const { t } = useT();
  const [items, setItems] = useState<ExtInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    ext.list().then(setItems).catch(() => setItems([]));
  }, [ext]);
  useEffect(() => { refresh(); }, [refresh]);

  const onLoadUnpacked = async () => {
    setBusy(true);
    try {
      const r = await ext.loadUnpacked();
      if (!r.ok && r.error) Alert.alert(t('b_ext_load_failed'), r.error);
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const onUpdate = async () => {
    setBusy(true);
    try {
      const r = await ext.update();
      Alert.alert(t('b_extensions'), r.ok ? t('b_ext_updated') : (r.error || 'error'));
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const onRemove = (item: ExtInfo) => {
    const doRemove = async () => {
      await ext.remove(item.id);
      refresh();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('b_ext_remove_confirm').replace('{name}', item.name))) void doRemove();
      return;
    }
    Alert.alert(item.name, t('b_ext_remove_confirm').replace('{name}', item.name), [
      { text: t('b_cancel'), style: 'cancel' },
      { text: t('b_ext_remove'), style: 'destructive', onPress: () => void doRemove() },
    ]);
  };

  return (
    <View style={styles.menuOverlay}>
      <TouchableOpacity style={styles.menuBackdrop} onPress={onClose} />
      <View style={[styles.extPanel, top != null ? { top } : null]}>
        <View style={styles.extHeader}>
          <Text style={styles.extTitle}>{t('b_extensions')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={styles.extActions}>
          <TouchableOpacity style={styles.extBtn} disabled={busy} onPress={onLoadUnpacked}>
            <Ionicons name="folder-open-outline" size={16} color={colors.accent} />
            <Text style={styles.extBtnText}>{t('b_ext_load_unpacked')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.extBtn} disabled={busy} onPress={onUpdate}>
            <Ionicons name="refresh-outline" size={16} color={colors.accent} />
            <Text style={styles.extBtnText}>{t('b_ext_update')}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ maxHeight: 360 }}>
          {items.length === 0 ? (
            <Text style={styles.extEmpty}>{t('b_ext_empty')}</Text>
          ) : (
            items.map((item) => (
              <View key={item.id} style={styles.extRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.extName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.extMeta} numberOfLines={1}>v{item.version}</Text>
                </View>
                <TouchableOpacity onPress={() => onRemove(item)} hitSlop={8} style={styles.extRemove}>
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
        <Text style={styles.extHint}>{t('b_ext_store_hint')}</Text>
      </View>
    </View>
  );
}
type ExtBridgeType = {
  list: () => Promise<ExtInfo[]>;
  loadUnpacked: () => Promise<{ ok: boolean; error?: string; canceled?: boolean }>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  update: () => Promise<{ ok: boolean; error?: string }>;
};

export default function BrowserScreen() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Desktop (Qwalla Browser / wide web) gets a Chrome-style horizontal tab strip
  // instead of the phone tab-count button + full-screen switcher.
  const isDesktop = Platform.OS === 'web' && width >= 760;
  const wallet = useWalletStore((s) => s.wallet);
  const webViewRefs = useRef<Record<string, any>>({});
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  // Header chrome height (tab strip + URL bar + bookmarks bar), measured so the
  // omnibox and dropdowns anchor just below it on desktop instead of a hard-coded
  // phone-layout offset.
  const [headerHeight, setHeaderHeight] = useState(0);

  // Register the provider injection scripts with the Electron main process so the
  // guest preload can install window.rougechain/ethereum at document-start.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const reg = (window as unknown as { qwallaRegisterInjection?: (code: string) => void })
      .qwallaRegisterInjection;
    if (typeof reg === 'function') reg(INJECTED_PROVIDER_SCRIPT);
  }, []);

  // Forward wallet/network events (accountsChanged, networkChanged,
  // disconnect) into every open dApp tab.
  useEffect(() => {
    if (!sendEventToWebView) return;
    return setDappEventSink((event, data) => {
      for (const ref of Object.values(webViewRefs.current)) {
        if (ref) sendEventToWebView({ current: ref }, event, data);
      }
    });
  }, []);

  // Reload open tabs when the active account changes so the injected
  // `window.rougechain` provider re-initializes with the new account — sites
  // that read it on load (rather than caching their own wallet) pick up the
  // switch without a manual refresh. (Skips the first mount.)
  const browserPkRef = useRef<string | null>(null);
  useEffect(() => {
    const pk = wallet?.publicKey ?? null;
    const switched = browserPkRef.current !== null && browserPkRef.current !== pk;
    browserPkRef.current = pk;
    if (!switched) return;
    for (const ref of Object.values(webViewRefs.current)) {
      try {
        ref?.reload?.();
      } catch {
        /* ignore */
      }
    }
  }, [wallet?.publicKey]);

  // Tab state
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [makeTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  const [showTabSwitcher, setShowTabSwitcher] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const bridge = browserBridge();

  // Find-in-page (desktop / Electron): Ctrl/Cmd+F opens a find bar driving the
  // webview's findInPage.
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [findResult, setFindResult] = useState<{ activeMatchOrdinal: number; matches: number }>({
    activeMatchOrdinal: 0,
    matches: 0,
  });
  const findInputRef = useRef<TextInput>(null);

  // Address bar + tab strip refs, closed-tab stack (Ctrl+Shift+T), and live
  // mirrors of state the global keydown handler reads without re-subscribing.
  const addressInputRef = useRef<TextInput>(null);
  const tabStripRef = useRef<ScrollView>(null);
  const closedTabsRef = useRef<{ url: string; title: string }[]>([]);
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const findOpenRef = useRef(findOpen);
  findOpenRef.current = findOpen;

  // Tell the extensions runtime which dApp tab is active, so browser-action
  // popups act on the current page. The webview may not be attached right after
  // switching, so retry briefly.
  useEffect(() => {
    const report = () => {
      const ref = webViewRefs.current[activeTabId];
      const id = ref?.getWebContentsId?.();
      if (typeof id === 'number' && id > 0) bridge?.setActiveTab?.(id);
      // Move keyboard focus to the newly-active webview so typing goes to the
      // visible page, not a now-hidden background tab that held focus.
      if (!addressFocusedRef.current) ref?.focus?.();
    };
    report();
    const t1 = setTimeout(report, 120);
    const t2 = setTimeout(report, 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  // Toggle DevTools (inspect / console / network) on the active page.
  const toggleDevTools = useCallback(() => {
    webViewRefs.current[activeTabId]?.toggleDevTools?.();
  }, [activeTabId]);


  // Desktop: open target="_blank"/window.open links (and extension-opened tabs)
  // in a new in-app tab instead of the system browser.
  useEffect(() => {
    if (!bridge?.onOpenTab) return;
    return bridge.onOpenTab((url) => {
      if (url) openTabWithUrl(url);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  // Auto-sleep: after `tabSleepMs` idle, a background tab's webview is unmounted
  // to free memory (mobile webviews are heavy); it reloads when reopened. 0 = off.
  const tabSleepMs = useSettingsStore((s) => s.browserTabSleepMs);
  const [sleeping, setSleeping] = useState<Set<string>>(new Set());
  const lastActiveRef = useRef<Record<string, number>>({});
  const tabsRef = useRef<BrowserTab[]>(tabs);
  tabsRef.current = tabs;

  // The active tab is always awake; stamp it so its idle clock never advances.
  useEffect(() => {
    lastActiveRef.current[activeTabId] = Date.now();
    setSleeping((prev) => {
      if (!prev.has(activeTabId)) return prev;
      const next = new Set(prev);
      next.delete(activeTabId);
      return next;
    });
  }, [activeTabId]);

  // Periodically sleep tabs idle past the threshold (skip active + empty tabs).
  useEffect(() => {
    if (!tabSleepMs) return;
    const iv = setInterval(() => {
      const now = Date.now();
      lastActiveRef.current[activeTabId] = now;
      setSleeping((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const tab of tabsRef.current) {
          if (tab.id === activeTabId || next.has(tab.id) || !tab.url) continue;
          const last = lastActiveRef.current[tab.id] ?? now;
          if (now - last > tabSleepMs) {
            next.add(tab.id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 60_000);
    return () => clearInterval(iv);
  }, [activeTabId, tabSleepMs]);

  // Stream download progress from the Electron main process into a tray.
  useEffect(() => {
    if (!bridge?.onDownload) return;
    return bridge.onDownload((d) => {
      setDownloads((prev) => {
        const idx = prev.findIndex((x) => x.id === d.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = d;
          return next;
        }
        return [d, ...prev].slice(0, 30);
      });
    });
  }, [bridge]);

  const activeDownloads = downloads.filter(
    (d) => d.state === 'started' || d.state === 'progressing',
  ).length;

  const clearDownloads = useCallback(() => setDownloads([]), []);
  const removeDownload = useCallback(
    (id: string) => setDownloads((prev) => prev.filter((x) => x.id !== id)),
    [],
  );

  // Web panels (Opera GX-style sidebar of pinned sites)
  const [webPanels, setWebPanels] = useState<WebPanel[]>(DEFAULT_PANELS);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [panelStripCollapsed, setPanelStripCollapsed] = useState(false);
  const [newPanelUrl, setNewPanelUrl] = useState('');
  const panelWebRef = useRef<any>(null);

  useEffect(() => {
    AsyncStorage.getItem(PANELS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        if (Array.isArray(p) && p.length) setWebPanels(p);
      } catch {
        /* ignore */
      }
    });
  }, []);

  const savePanels = useCallback((p: WebPanel[]) => {
    setWebPanels(p);
    void AsyncStorage.setItem(PANELS_KEY, JSON.stringify(p));
  }, []);

  const addWebPanel = useCallback(() => {
    const url = normaliseUrl(newPanelUrl);
    if (!url) return;
    let name = url;
    try {
      name = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      /* keep url */
    }
    const panel: WebPanel = { id: `p_${Date.now()}`, name, url, icon: 'globe' };
    savePanels([...webPanels, panel]);
    setNewPanelUrl('');
    setShowAddPanel(false);
    setActivePanelId(panel.id);
  }, [newPanelUrl, webPanels, savePanels]);

  const removeWebPanel = useCallback(
    (id: string) => {
      savePanels(webPanels.filter((p) => p.id !== id));
      setActivePanelId((cur) => (cur === id ? null : cur));
    },
    [webPanels, savePanels],
  );

  const activePanel = webPanels.find((p) => p.id === activePanelId) || null;

  // Bookmarks — one fully-editable list. Seeded on first run with either the
  // RougeChain ecosystem or an empty slate (the user chooses). Every bookmark
  // is removable, including the defaults.
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(DEFAULT_BOOKMARKS);
  const [editingBookmarks, setEditingBookmarks] = useState(false);
  const [showFirstRun, setShowFirstRun] = useState(false);

  // Visit history ("Recent" on the home)
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const lastRecorded = useRef<string>('');

  useEffect(() => {
    (async () => {
      const v2 = await AsyncStorage.getItem(BOOKMARKS_V2_KEY);
      if (v2) {
        try {
          setBookmarks(JSON.parse(v2));
        } catch {
          /* ignore */
        }
        return;
      }
      // Migrate a pre-existing custom list (existing users skip the first-run prompt).
      const v1 = await AsyncStorage.getItem(BOOKMARKS_KEY);
      if (v1) {
        let custom: Bookmark[] = [];
        try {
          custom = JSON.parse(v1);
        } catch {
          /* ignore */
        }
        // De-dupe by normalized URL so a custom bookmark matching a default
        // doesn't produce two entries (and duplicate React keys downstream).
        const seenKeys = new Set<string>();
        const merged = [...DEFAULT_BOOKMARKS, ...custom].filter((b) => {
          const k = urlKey(b.url);
          if (seenKeys.has(k)) return false;
          seenKeys.add(k);
          return true;
        });
        setBookmarks(merged);
        void AsyncStorage.setItem(BOOKMARKS_V2_KEY, JSON.stringify(merged));
        return;
      }
      // Fresh install — ask ecosystem vs empty slate.
      setShowFirstRun(true);
    })();
    loadHistory().then(setHistory);
  }, []);

  // Record a loaded page. Throttled by url|title so pure canGoBack/forward
  // state changes (which also fire onNavigationStateChange) don't re-persist.
  const recordHistory = useCallback((url: string, title: string) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    const key = `${url}|${title}`;
    if (key === lastRecorded.current) return;
    lastRecorded.current = key;
    addHistoryEntry(url, title).then(setHistory);
  }, []);

  const clearHistoryAction = useCallback(() => {
    lastRecorded.current = '';
    clearBrowserHistory().then(() => setHistory([]));
  }, []);

  const saveBookmarks = useCallback((bm: Bookmark[]) => {
    setBookmarks(bm);
    void AsyncStorage.setItem(BOOKMARKS_V2_KEY, JSON.stringify(bm));
  }, []);

  const chooseFirstRun = useCallback(
    (ecosystem: boolean) => {
      saveBookmarks(ecosystem ? DEFAULT_BOOKMARKS : []);
      savePanels(ecosystem ? DEFAULT_PANELS : []);
      setShowFirstRun(false);
    },
    [saveBookmarks, savePanels],
  );

  const allBookmarks = bookmarks;

  const activeTab = tabs.find((v) => v.id === activeTabId) || tabs[0];
  const [addressBar, setAddressBar] = useState(activeTab.url);
  const [addressFocused, setAddressFocused] = useState(false);
  // Ref mirror so webview navigation callbacks (stale closures) can check the
  // live focus state and avoid overwriting the URL field while the user types.
  const addressFocusedRef = useRef(false);

  // Restore persisted tabs on mount so a wallet lock/unlock (which unmounts this whole screen)
  // or an app restart reopens exactly where you left off. dApp approvals persist separately
  // (connected-sites, cleared only on disconnect), so reloaded pages auto-reconnect.
  const [tabsHydrated, setTabsHydrated] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadBrowserState();
      if (!cancelled && saved && saved.tabs.length > 0) {
        const restored = saved.tabs.map((v) => ({
          ...makeTab(v.url),
          title: v.title || (v.url ? domainLabel(v.url) : t('b_new_tab')),
        }));
        const idx = Math.min(Math.max(saved.activeIndex, 0), restored.length - 1);
        setTabs(restored);
        setActiveTabId(restored[idx].id);
        setAddressBar(restored[idx].url);
      }
      if (!cancelled) setTabsHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist tabs whenever they change — only after hydration, so the initial blank tab never
  // clobbers a saved session before it's restored.
  useEffect(() => {
    if (!tabsHydrated) return;
    const idx = Math.max(0, tabs.findIndex((v) => v.id === activeTabId));
    void saveBrowserState({
      tabs: tabs.map((v) => ({ url: tabLiveUrl(v), title: v.title })),
      activeIndex: idx,
    });
  }, [tabs, activeTabId, tabsHydrated]);

  const activeLiveUrl = tabLiveUrl(activeTab);
  const isCurrentPageBookmarked = activeLiveUrl
    ? allBookmarks.some((b) => sameUrl(b.url, activeLiveUrl))
    : false;

  const addBookmark = useCallback(() => {
    const url = tabLiveUrl(activeTab);
    if (!url) return;
    if (bookmarks.some((b) => sameUrl(b.url, url))) return;
    const bm: Bookmark = {
      name: activeTab.title || domainLabel(url),
      url,
      icon: 'bookmark',
      isCustom: true,
    };
    saveBookmarks([...bookmarks, bm]);
    setShowMenu(false);
  }, [activeTab, bookmarks, saveBookmarks]);

  const removeBookmark = useCallback(
    (url: string) => {
      saveBookmarks(bookmarks.filter((b) => b.url !== url));
    },
    [bookmarks, saveBookmarks],
  );

  // ── Helpers ───────────────────────────────────────────────────

  const updateTab = useCallback((id: string, patch: Partial<BrowserTab>) => {
    setTabs((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }, []);

  const navigate = useCallback(
    (target: string) => {
      const normalised = normaliseUrl(target);
      if (!normalised) return;
      updateTab(activeTabId, { url: normalised, currentUrl: normalised, title: domainLabel(normalised) });
      setAddressBar(normalised);
    },
    [activeTabId, updateTab],
  );

  // Deep-link: other screens can open a URL here via
  // router.push({ pathname: '/(tabs)/browser', params: { url } }). Clear the
  // param after handling so re-opening the same URL fires again.
  const { url: deepLinkUrl } = useLocalSearchParams<{ url?: string }>();
  useEffect(() => {
    if (!deepLinkUrl) return;
    navigate(deepLinkUrl);
    router.setParams({ url: '' });
  }, [deepLinkUrl, navigate]);

  const switchToTab = useCallback(
    (id: string) => {
      setActiveTabId(id);
      const v = tabs.find((tab) => tab.id === id);
      setAddressBar(v ? tabLiveUrl(v) : '');
      setShowTabSwitcher(false);
    },
    [tabs],
  );

  // Move keyboard focus to the address bar (deferred so the input is mounted
  // after any state change that triggered it).
  const focusAddressBar = useCallback(() => {
    setTimeout(() => {
      try {
        addressInputRef.current?.focus();
      } catch {
        /* not focusable (native) */
      }
    }, 0);
  }, []);

  const newTab = useCallback(() => {
    const v = makeTab();
    setTabs((prev) => [...prev, v]);
    setActiveTabId(v.id);
    setAddressBar('');
    setShowTabSwitcher(false);
    setShowMenu(false);
    focusAddressBar();
  }, [focusAddressBar]);

  // Open a URL in a brand-new tab. Used by onOpenWindow so that target="_blank"
  // links inside a dApp (e.g. RouGee link-in-bio) actually open — WebViews drop
  // them otherwise — landing in their own tab instead of hijacking the dApp's.
  const openTabWithUrl = useCallback((url: string) => {
    const clean = (url || '').trim();
    if (!clean) return;
    const v = makeTab(clean);
    setTabs((prev) => [...prev, v]);
    setActiveTabId(v.id);
    setAddressBar(clean);
    setShowTabSwitcher(false);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      // Remember the closed tab so Ctrl/Cmd+Shift+T can reopen it.
      const closing = tabsRef.current.find((v) => v.id === id);
      const closingUrl = closing ? tabLiveUrl(closing) : '';
      if (closingUrl) {
        closedTabsRef.current.push({ url: closingUrl, title: closing!.title });
        if (closedTabsRef.current.length > 25) closedTabsRef.current.shift();
      }
      delete webViewRefs.current[id];
      setTabs((prev) => {
        const remaining = prev.filter((v) => v.id !== id);
        if (remaining.length === 0) {
          const fresh = makeTab();
          setActiveTabId(fresh.id);
          setAddressBar('');
          return [fresh];
        }
        if (activeTabId === id) {
          const idx = prev.findIndex((v) => v.id === id);
          const next = remaining[Math.min(idx, remaining.length - 1)];
          setActiveTabId(next.id);
          setAddressBar(tabLiveUrl(next));
        }
        return remaining;
      });
    },
    [activeTabId],
  );

  const reopenClosedTab = useCallback(() => {
    const last = closedTabsRef.current.pop();
    if (last?.url) openTabWithUrl(last.url);
  }, [openTabWithUrl]);

  // ── Find in page (desktop) ────────────────────────────────────
  const runFind = useCallback((text: string, opts?: { findNext?: boolean; forward?: boolean }) => {
    const ref = webViewRefs.current[activeTabIdRef.current];
    if (!ref?.findInPage) return;
    if (!text) {
      ref.stopFindInPage?.();
      setFindResult({ activeMatchOrdinal: 0, matches: 0 });
      return;
    }
    ref.findInPage(text, opts);
  }, []);

  const openFind = useCallback(() => {
    setFindOpen(true);
    setTimeout(() => {
      try {
        findInputRef.current?.focus();
      } catch {
        /* ignore */
      }
    }, 0);
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindText('');
    setFindResult({ activeMatchOrdinal: 0, matches: 0 });
    try {
      webViewRefs.current[activeTabIdRef.current]?.stopFindInPage?.();
    } catch {
      /* ignore */
    }
  }, []);

  // ── Tab cycling (Ctrl+Tab / Ctrl+1-9) ─────────────────────────
  const cycleTab = useCallback(
    (dir: number) => {
      const list = tabsRef.current;
      if (list.length < 2) return;
      const i = list.findIndex((v) => v.id === activeTabIdRef.current);
      const n = list[(((i + dir) % list.length) + list.length) % list.length];
      if (n) switchToTab(n.id);
    },
    [switchToTab],
  );

  const gotoTabIndex = useCallback(
    (num: number) => {
      const list = tabsRef.current;
      const idx = num >= 9 ? list.length - 1 : num - 1;
      const target = list[idx];
      if (target) switchToTab(target.id);
    },
    [switchToTab],
  );

  // Dispatch a native-menu accelerator action (from desktop/main.js) to the same
  // handlers the in-app shortcuts use.
  const runShortcut = useCallback(
    (action: string) => {
      const active = () => webViewRefs.current[activeTabIdRef.current];
      switch (action) {
        case 'new-tab': newTab(); break;
        case 'close-tab': closeTab(activeTabIdRef.current); break;
        case 'reopen-tab': reopenClosedTab(); break;
        case 'focus-address': focusAddressBar(); break;
        case 'find': openFind(); break;
        case 'reload': active()?.reload?.(); break;
        case 'back': active()?.goBack?.(); break;
        case 'forward': active()?.goForward?.(); break;
        case 'devtools': toggleDevTools(); break;
        case 'next-tab': cycleTab(1); break;
        case 'prev-tab': cycleTab(-1); break;
        default: break;
      }
    },
    [newTab, closeTab, reopenClosedTab, focusAddressBar, openFind, toggleDevTools, cycleTab],
  );

  useEffect(() => {
    if (!bridge?.onShortcut) return;
    return bridge.onShortcut((action) => runShortcut(action));
  }, [bridge, runShortcut]);

  // Desktop browser keyboard shortcuts. F12 / Ctrl+Shift+I (DevTools) and Escape
  // work everywhere on web; the tab/navigation combos are gated to the desktop
  // layout. Navigation keys are suppressed while the address bar has focus so
  // typing isn't hijacked.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    // On the Electron desktop build the native application menu owns the global
    // accelerators (they fire even when a guest <webview> has focus); handling
    // them here too would double-fire. Escape and Ctrl/Cmd+1-9 aren't menu
    // items, so they stay here for both web and desktop.
    const hasNativeMenu =
      typeof (window as unknown as { qwallaBrowser?: { onShortcut?: unknown } }).qwallaBrowser
        ?.onShortcut === 'function';

    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (e.key === 'Escape') {
        setShowMenu(false);
        setShowDownloads(false);
        setShowExtensions(false);
        setShowAddPanel(false);
        if (findOpenRef.current) closeFind();
        return;
      }
      // Jump to tab N (not represented in the native menu).
      if (isDesktop && mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        gotoTabIndex(parseInt(e.key, 10));
        return;
      }

      if (hasNativeMenu) return;

      if (e.key === 'F12' || (mod && e.shiftKey && k === 'i')) {
        e.preventDefault();
        toggleDevTools();
        return;
      }

      if (!isDesktop) return;

      // Ctrl/Cmd+L — focus & select the address bar (allowed even while typing).
      if (mod && !e.shiftKey && k === 'l') {
        e.preventDefault();
        focusAddressBar();
        return;
      }
      // Ctrl/Cmd+F — find in page.
      if (mod && !e.shiftKey && k === 'f') {
        e.preventDefault();
        openFind();
        return;
      }
      if (mod && !e.shiftKey && k === 't') {
        e.preventDefault();
        newTab();
        return;
      }
      if (mod && e.shiftKey && k === 't') {
        e.preventDefault();
        reopenClosedTab();
        return;
      }
      if (mod && !e.shiftKey && k === 'w') {
        e.preventDefault();
        closeTab(activeTabIdRef.current);
        return;
      }
      if (mod && !e.shiftKey && k === 'r') {
        e.preventDefault();
        webViewRefs.current[activeTabIdRef.current]?.reload?.();
        return;
      }
      if (mod && e.key === 'Tab') {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop, toggleDevTools, closeFind, openFind, focusAddressBar, newTab, reopenClosedTab, closeTab, cycleTab, gotoTabIndex]);

  // Keep the newest/active tab in view on the desktop tab strip (a new tab is
  // appended at the right and would otherwise scroll off-screen).
  useEffect(() => {
    if (!isDesktop) return;
    const id = setTimeout(() => tabStripRef.current?.scrollToEnd?.({ animated: true }), 0);
    return () => clearTimeout(id);
  }, [tabs.length, isDesktop]);

  // While the find bar is open, re-run the search as the query changes.
  useEffect(() => {
    if (!findOpen) return;
    runFind(findText, { findNext: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findText, findOpen]);

  const clearCache = useCallback(() => {
    const ref = webViewRefs.current[activeTabId];
    if (ref) {
      ref.clearCache?.(true);
      ref.clearHistory?.();
      ref.reload?.();
    }
    Alert.alert(t('b_cache_cleared'), t('b_cache_cleared_msg'));
    setShowMenu(false);
  }, [activeTabId]);

  const clearAllData = useCallback(() => {
    const doClear = () => {
      Object.values(webViewRefs.current).forEach((ref: any) => {
        ref?.clearCache?.(true);
        ref?.clearHistory?.();
      });
      webViewRefs.current = {};
      lastRecorded.current = '';
      void clearBrowserHistory();
      setHistory([]);
      const fresh = makeTab();
      setTabs([fresh]);
      setActiveTabId(fresh.id);
      setAddressBar('');
      setShowMenu(false);
    };

    // RN Alert with buttons is a no-op on web, so use the DOM confirm there.
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' &&
          window.confirm(t('b_clear_all_confirm'))) {
        doClear();
      }
      return;
    }

    Alert.alert(
      t('b_clear_all_title'),
      t('b_clear_all_msg'),
      [
        { text: t('b_cancel'), style: 'cancel' },
        { text: t('b_clear'), style: 'destructive', onPress: doClear },
      ],
    );
  }, []);

  // ── WebView message handler ───────────────────────────────────

  const onMessage = useCallback(
    (tabId: string, event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        const isRouge = data?.source === 'rougechain-provider';
        const isEvm = data?.source === 'qwalla-evm';
        if (!isRouge && !isEvm) return;

        const tab = tabs.find((v) => v.id === tabId);
        const ref = webViewRefs.current[tabId];
        // Prefer the webview's live URL (desktop shim exposes getURL) over the
        // async React tab state, which can still hold the previous page's URL
        // when a dApp calls connect() immediately on load — a stale origin would
        // record the connection for, or gate signing against, the wrong site.
        let liveUrl: string | null = null;
        try {
          liveUrl = ref?.getURL?.() ?? null;
        } catch {
          /* native WebView has no getURL */
        }
        const originSource = liveUrl || tab?.currentUrl || tab?.url || '';
        const origin = originSource ? new URL(originSource).origin : 'unknown';
        const webViewRefWrapper = { current: ref };
        const onApproval = (req: ApprovalRequest) => setApproval(req);

        if (isEvm) {
          if (!handleEvmRequest) return;
          handleEvmRequest(
            { id: data.id, method: data.method, params: data.params, origin },
            webViewRefWrapper,
            onApproval,
          );
          return;
        }

        if (!handleDappRequest) return;
        handleDappRequest(
          { id: data.id, method: data.method, params: data.params, origin },
          webViewRefWrapper,
          onApproval,
        );
      } catch {
        /* ignore non-provider messages */
      }
    },
    [tabs],
  );

  // ── Platform gate ──────────────────────────────────────────────

  // ── Tab switcher overlay ──────────────────────────────────────

  if (showTabSwitcher) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.tabSwitcherHeader}>
          <Text style={styles.tabSwitcherTitle}>{tabs.length} {tabs.length !== 1 ? t('b_tabs') : t('b_tab')}</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity onPress={newTab} style={styles.tabSwitcherAction}>
              <Ionicons name="add" size={22} color={colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowTabSwitcher(false)} style={styles.tabSwitcherAction}>
              <Text style={{ color: colors.accent, fontWeight: '600', fontSize: fontSize.sm }}>{t('b_done')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.tabGrid}>
          {tabs.map((v) => (
            <TouchableOpacity
              key={v.id}
              style={[
                styles.tabCard,
                v.id === activeTabId && styles.tabCardActive,
              ]}
              onPress={() => switchToTab(v.id)}
              activeOpacity={0.7}
            >
              <View style={styles.tabCardHeader}>
                <Ionicons name="globe-outline" size={12} color={colors.textTertiary} />
                <Text style={styles.tabCardTitle} numberOfLines={1}>
                  {v.url ? domainLabel(v.url) : t('b_new_tab')}
                </Text>
                <TouchableOpacity
                  onPress={(e: any) => {
                    e?.stopPropagation?.();
                    closeTab(v.id);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
              <View style={styles.tabCardBody}>
                {v.url ? (
                  <Text style={styles.tabCardUrl} numberOfLines={2}>{v.title}</Text>
                ) : (
                  <Ionicons name="compass-outline" size={28} color={colors.textTertiary} />
                )}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Main browser ───────────────────────────────────────────────

  return (
    <View style={styles.rootRow}>
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top chrome (tab strip + URL bar + bookmarks bar), measured so the
          omnibox and dropdown panels anchor to its bottom edge. */}
      <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
      {/* Desktop horizontal tab strip */}
      {isDesktop && (
        <View style={styles.tabStrip}>
          <ScrollView
            ref={tabStripRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabStripContent}
          >
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <TouchableOpacity
                  key={tab.id}
                  onPress={() => switchToTab(tab.id)}
                  style={[styles.tabChip, isActive && styles.tabChipActive]}
                  activeOpacity={0.8}
                >
                  <TabFavicon url={tab.url} active={isActive} />
                  <Text
                    style={[styles.tabChipText, isActive && styles.tabChipTextActive]}
                    numberOfLines={1}
                  >
                    {tab.url ? domainLabel(tab.url) : t('b_new_tab')}
                  </Text>
                  <TouchableOpacity
                    onPress={(e: any) => {
                      // Don't let the press bubble to the chip's switchToTab.
                      e?.stopPropagation?.();
                      closeTab(tab.id);
                    }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    style={styles.tabChipClose}
                  >
                    <Ionicons name="close" size={13} color={colors.textTertiary} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={newTab}
              style={styles.tabNewBtn}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="add" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* URL bar */}
      <View style={styles.urlBar}>
        <TouchableOpacity
          disabled={!activeTab.canGoBack}
          onPress={() => webViewRefs.current[activeTabId]?.goBack()}
          style={styles.navBtn}
        >
          <Ionicons
            name="chevron-back"
            size={20}
            color={activeTab.canGoBack ? colors.text : colors.textTertiary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!activeTab.canGoForward}
          onPress={() => webViewRefs.current[activeTabId]?.goForward()}
          style={styles.navBtn}
        >
          <Ionicons
            name="chevron-forward"
            size={20}
            color={activeTab.canGoForward ? colors.text : colors.textTertiary}
          />
        </TouchableOpacity>

        <View style={styles.addressContainer}>
          <Ionicons name="globe-outline" size={14} color={colors.textTertiary} />
          <TextInput
            ref={addressInputRef}
            style={styles.addressInput}
            value={addressBar}
            onChangeText={setAddressBar}
            onSubmitEditing={() => { navigate(addressBar); setAddressFocused(false); }}
            onFocus={() => { addressFocusedRef.current = true; setAddressFocused(true); }}
            onBlur={() => { addressFocusedRef.current = false; setTimeout(() => setAddressFocused(false), 150); }}
            placeholder={t('b_search_or_url')}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            selectTextOnFocus
          />
        </View>

        <TouchableOpacity
          onPress={() => webViewRefs.current[activeTabId]?.reload()}
          style={styles.navBtn}
        >
          <Ionicons name="refresh" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* Tab count button (mobile only — desktop uses the tab strip above) */}
        {!isDesktop && (
          <TouchableOpacity onPress={() => setShowTabSwitcher(true)} style={styles.tabCountBtn}>
            <Text style={styles.tabCountText}>{tabs.length}</Text>
          </TouchableOpacity>
        )}

        {/* Extension toolbar (pinned browser-action icons) — desktop only */}
        {isDesktop && <ExtensionToolbar />}

        {/* Downloads button (desktop / Electron browser) */}
        {isDesktop && !!bridge?.onDownload && (
          <TouchableOpacity onPress={() => setShowDownloads((s) => !s)} style={styles.navBtn}>
            <Ionicons name="download-outline" size={18} color={colors.textSecondary} />
            {activeDownloads > 0 && (
              <View style={styles.dlBadge}>
                <Text style={styles.dlBadgeText}>{activeDownloads}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* Menu button */}
        <TouchableOpacity onPress={() => setShowMenu((s) => !s)} style={styles.navBtn}>
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Bookmarks bar (desktop) */}
      {isDesktop && allBookmarks.length > 0 && (
        <View style={styles.bookmarksBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.bookmarksBarContent}
          >
            {allBookmarks.map((b) => (
              <TouchableOpacity
                key={b.url}
                style={styles.bmBarItem}
                onPress={() => navigate(b.url)}
                activeOpacity={0.7}
              >
                <Ionicons name={b.icon as any} size={13} color={colors.textSecondary} />
                <Text style={styles.bmBarText} numberOfLines={1}>
                  {b.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      </View>
      {/* end top chrome */}

      {/* Downloads panel */}
      {showDownloads && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={styles.menuBackdrop} onPress={() => setShowDownloads(false)} />
          <View style={[styles.menu, styles.dlPanel, { top: headerHeight }]}>
            <View style={styles.dlHeaderRow}>
              <Text style={styles.dlPanelTitle}>{t('b_downloads')}</Text>
              {downloads.length > 0 && (
                <TouchableOpacity onPress={clearDownloads} hitSlop={8}>
                  <Text style={styles.dlClear}>{t('b_clear')}</Text>
                </TouchableOpacity>
              )}
            </View>
            {downloads.length === 0 ? (
              <Text style={styles.dlEmpty}>{t('b_no_downloads')}</Text>
            ) : (
              downloads.map((d) => {
                const done = d.state === 'completed';
                const active = d.state === 'started' || d.state === 'progressing';
                return (
                  <View key={d.id} style={styles.dlRow}>
                    <Ionicons
                      name={done ? 'checkmark-circle' : active ? 'arrow-down-circle' : 'alert-circle'}
                      size={18}
                      color={done ? colors.accent : colors.textSecondary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dlName} numberOfLines={1}>
                        {d.filename}
                      </Text>
                      <Text style={styles.dlMeta} numberOfLines={1}>
                        {done
                          ? formatBytes(d.total || d.received)
                          : `${formatBytes(d.received)}${d.total ? ` / ${formatBytes(d.total)}` : ''}`}
                      </Text>
                    </View>
                    {done && !!bridge?.showDownload && (
                      <TouchableOpacity onPress={() => bridge?.showDownload?.(d.path)} hitSlop={8}>
                        <Ionicons name="folder-open-outline" size={16} color={colors.textSecondary} />
                      </TouchableOpacity>
                    )}
                    {done && (
                      <TouchableOpacity onPress={() => bridge?.openDownload?.(d.path)} hitSlop={8}>
                        <Ionicons name="open-outline" size={16} color={colors.accent} />
                      </TouchableOpacity>
                    )}
                    {!active && (
                      <TouchableOpacity onPress={() => removeDownload(d.id)} hitSlop={8}>
                        <Ionicons name="close" size={15} color={colors.textTertiary} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </View>
        </View>
      )}

      {/* Omnibox suggestions */}
      {addressFocused &&
        (() => {
          const query = addressBar.trim().toLowerCase();
          const raw: { icon: keyof typeof Ionicons.glyphMap; title: string; url: string }[] = [];
          for (const b of allBookmarks) {
            if (!query || b.name.toLowerCase().includes(query) || b.url.toLowerCase().includes(query)) {
              raw.push({ icon: 'bookmark-outline', title: b.name, url: b.url });
            }
          }
          for (const h of history) {
            if (!query || (h.title || '').toLowerCase().includes(query) || h.url.toLowerCase().includes(query)) {
              raw.push({ icon: 'time-outline', title: h.title || domainLabel(h.url), url: h.url });
            }
          }
          const seen = new Set<string>();
          const deduped: typeof raw = [];
          for (const it of raw) {
            const k = urlKey(it.url);
            if (!seen.has(k)) {
              seen.add(k);
              deduped.push(it);
            }
          }
          const capped = deduped.slice(0, 6);
          const q = addressBar.trim();
          if (!q && capped.length === 0) return null;
          return (
            <View style={[styles.omnibox, { top: headerHeight }]}>
              {!!q && (
                <TouchableOpacity
                  style={styles.omniRow}
                  onPress={() => {
                    navigate(q);
                    setAddressFocused(false);
                  }}
                >
                  <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
                  <Text style={styles.omniTitle} numberOfLines={1}>
                    {q}
                  </Text>
                </TouchableOpacity>
              )}
              {capped.map((it) => (
                <TouchableOpacity
                  key={it.url}
                  style={styles.omniRow}
                  onPress={() => {
                    navigate(it.url);
                    setAddressFocused(false);
                  }}
                >
                  <Ionicons name={it.icon} size={16} color={colors.textTertiary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.omniTitle} numberOfLines={1}>
                      {it.title}
                    </Text>
                    <Text style={styles.omniUrl} numberOfLines={1}>
                      {domainLabel(it.url)}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          );
        })()}

      {/* Find in page (desktop) */}
      {findOpen && isDesktop && (
        <View style={[styles.findBar, { top: headerHeight }]}>
          <TextInput
            ref={findInputRef}
            style={styles.findInput}
            value={findText}
            onChangeText={setFindText}
            onSubmitEditing={() => runFind(findText, { findNext: true, forward: true })}
            placeholder={t('b_find')}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <Text style={styles.findCount}>
            {findText
              ? findResult.matches > 0
                ? `${findResult.activeMatchOrdinal}/${findResult.matches}`
                : t('b_find_none')
              : ''}
          </Text>
          <TouchableOpacity
            onPress={() => runFind(findText, { findNext: true, forward: false })}
            disabled={!findText}
            hitSlop={6}
            style={styles.findBtn}
          >
            <Ionicons name="chevron-up" size={16} color={findText ? colors.text : colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => runFind(findText, { findNext: true, forward: true })}
            disabled={!findText}
            hitSlop={6}
            style={styles.findBtn}
          >
            <Ionicons name="chevron-down" size={16} color={findText ? colors.text : colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={closeFind} hitSlop={6} style={styles.findBtn}>
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Dropdown menu */}
      {showMenu && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={styles.menuBackdrop} onPress={() => setShowMenu(false)} />
          <View style={[styles.menu, { top: headerHeight }]}>
            <TouchableOpacity style={styles.menuItem} onPress={newTab}>
              <Ionicons name="add-circle-outline" size={18} color={colors.text} />
              <Text style={styles.menuText}>{t('b_new_tab')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeTab(activeTabId);
                setShowMenu(false);
              }}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.text} />
              <Text style={styles.menuText}>{t('b_close_tab')}</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            {activeTab.url ? (
              isCurrentPageBookmarked ? (
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    removeBookmark(activeLiveUrl);
                    setShowMenu(false);
                  }}
                >
                  <Ionicons name="bookmark" size={18} color={colors.accent} />
                  <Text style={styles.menuText}>{t('b_remove_bookmark')}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.menuItem} onPress={addBookmark}>
                  <Ionicons name="bookmark-outline" size={18} color={colors.text} />
                  <Text style={styles.menuText}>{t('b_bookmark_page')}</Text>
                </TouchableOpacity>
              )
            ) : null}
            {isDesktop && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowMenu(false);
                  openFind();
                }}
              >
                <Ionicons name="search-outline" size={18} color={colors.text} />
                <Text style={styles.menuText}>{t('b_find')}</Text>
              </TouchableOpacity>
            )}
            {isDesktop && !!(bridge as { ext?: unknown })?.ext && (
              <>
                <View style={styles.menuDivider} />
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    setShowMenu(false);
                    setShowExtensions(true);
                  }}
                >
                  <Ionicons name="extension-puzzle-outline" size={18} color={colors.text} />
                  <Text style={styles.menuText}>{t('b_extensions')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    setShowMenu(false);
                    toggleDevTools();
                  }}
                >
                  <Ionicons name="code-slash-outline" size={18} color={colors.text} />
                  <Text style={styles.menuText}>{t('b_inspect')}</Text>
                </TouchableOpacity>
              </>
            )}
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={clearCache}>
              <Ionicons name="trash-outline" size={18} color={colors.text} />
              <Text style={styles.menuText}>{t('b_clear_tab_cache')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={clearAllData}>
              <Ionicons name="nuclear-outline" size={18} color={colors.error} />
              <Text style={[styles.menuText, { color: colors.error }]}>{t('b_clear_all_data')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {showExtensions && (bridge as { ext?: ExtBridge })?.ext && (
        <ExtensionManager ext={(bridge as { ext: ExtBridge }).ext} onClose={() => setShowExtensions(false)} top={headerHeight} />
      )}

      {/* WebViews — all tabs stay mounted, only the active one is visible */}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        if (!tab.url) {
          if (!isActive) return null;
          return (
            <ScrollView
              key={tab.id}
              style={{ flex: 1, backgroundColor: colors.bg }}
              contentContainerStyle={{ paddingTop: spacing.xxl, paddingBottom: spacing.xxl }}
              showsVerticalScrollIndicator={false}
            >
              <View style={{ paddingHorizontal: spacing.lg, alignItems: 'center' }}>
                <Text style={styles.homeTitle}>{t('b_dapp_browser')}</Text>
                <Text style={styles.homeSubtitle}>
                  {t('b_home_subtitle')}
                </Text>

                {Platform.OS === 'web' && <PqConnectionBadge />}

                {allBookmarks.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setEditingBookmarks((e) => !e)}
                    style={{ alignSelf: 'flex-end', marginBottom: spacing.sm }}
                  >
                    <Text style={{ color: colors.accent, fontSize: fontSize.xs, fontWeight: '600' }}>
                      {editingBookmarks ? t('b_done') : t('b_edit')}
                    </Text>
                  </TouchableOpacity>
                )}

                <View style={styles.grid}>
                  {allBookmarks.map((item) => (
                    <TouchableOpacity
                      key={item.url}
                      style={styles.bookmark}
                      onPress={() => navigate(item.url)}
                      onLongPress={() => {
                        Alert.alert(
                          t('b_remove_bookmark'),
                          t('b_remove_bookmark_msg').replace('{name}', item.name),
                          [
                            { text: t('b_cancel'), style: 'cancel' },
                            { text: t('b_remove'), style: 'destructive', onPress: () => removeBookmark(item.url) },
                          ],
                        );
                      }}
                    >
                      <View style={[styles.bookmarkIcon, item.isCustom && styles.bookmarkIconCustom]}>
                        <BookmarkIcon
                          url={item.url}
                          icon={item.icon}
                          isCustom={item.isCustom}
                          logo={item.logo}
                          noFavicon={item.noFavicon}
                        />
                        {editingBookmarks && (
                          <TouchableOpacity
                            style={styles.bookmarkDelete}
                            onPress={() => removeBookmark(item.url)}
                          >
                            <Ionicons name="close-circle" size={18} color={colors.error} />
                          </TouchableOpacity>
                        )}
                      </View>
                      <Text style={styles.bookmarkLabel} numberOfLines={1}>
                        {item.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {!wallet && (
                  <View style={styles.noWallet}>
                    <Ionicons name="alert-circle" size={18} color={colors.warning} />
                    <Text style={styles.noWalletText}>
                      {t('b_no_wallet')}
                    </Text>
                  </View>
                )}
              </View>

              {history.length > 0 && (
                <View style={styles.recentWrap}>
                  <View style={styles.recentHead}>
                    <Text style={styles.recentTitle}>{t('b_recent')}</Text>
                    <TouchableOpacity
                      onPress={clearHistoryAction}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Text style={styles.recentClear}>{t('b_clear')}</Text>
                    </TouchableOpacity>
                  </View>
                  {history.slice(0, 8).map((h) => (
                    <TouchableOpacity
                      key={h.url}
                      style={styles.recentItem}
                      activeOpacity={0.7}
                      onPress={() => navigate(h.url)}
                    >
                      <Ionicons name="time-outline" size={16} color={colors.textTertiary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.recentItemTitle} numberOfLines={1}>
                          {h.title || h.url}
                        </Text>
                        <Text style={styles.recentItemUrl} numberOfLines={1}>
                          {domainLabel(h.url)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {CryptoNewsFeed && <CryptoNewsFeed onOpen={navigate} />}
            </ScrollView>
          );
        }

        // Slept background tab: unmount its webview to free memory. It's hidden
        // anyway; reopening it (isActive) remounts and reloads the page.
        const isSlept = sleeping.has(tab.id) && !isActive;

        return (
          <View
            key={tab.id}
            // Keep inactive tabs at full size but hidden, so their webview stays
            // laid out at the real window size (zeroing the height makes the guest
            // render at 0 and never reflow) yet can't grab keyboard focus —
            // visibility:hidden removes an off-screen webview from the focus order,
            // which otherwise silently swallowed typing.
            style={[
              { flex: 1 },
              !isActive && ({
                position: 'absolute',
                top: 0,
                left: -100000,
                width: '100%',
                height: '100%',
                opacity: 0,
                // web/desktop (react-native-web) style, not in RN's ViewStyle type
                visibility: 'hidden',
              } as ViewStyle),
            ]}
            pointerEvents={isActive ? 'auto' : 'none'}
          >
            {WebView && !isSlept && (
              <WebView
                ref={(r: any) => {
                  // Clear the handle on unmount (slept/closed tab) so provider
                  // events aren't injected into a detached guest and the
                  // extensions runtime isn't handed a dead webContents id.
                  if (r) webViewRefs.current[tab.id] = r;
                  else delete webViewRefs.current[tab.id];
                }}
                source={{ uri: tab.url }}
                style={{ flex: 1, backgroundColor: colors.bg }}
                injectedJavaScriptBeforeContentLoaded={INJECTED_PROVIDER_SCRIPT}
                onMessage={(e: any) => onMessage(tab.id, e)}
                onFoundInPage={
                  tab.id === activeTabId ? (r: { activeMatchOrdinal: number; matches: number }) => setFindResult(r) : undefined
                }
                onNavigationStateChange={(nav: any) => {
                  updateTab(tab.id, {
                    // Track the live page URL (not the load target `url`, which
                    // must stay stable so the source prop doesn't churn and force
                    // a reload) so bookmarking, the star, and restore are correct.
                    currentUrl: nav.url || tab.currentUrl || tab.url,
                    canGoBack: nav.canGoBack,
                    canGoForward: nav.canGoForward,
                    title: nav.title || domainLabel(nav.url || tab.url),
                  });
                  // Don't overwrite the URL field while the user is typing in it —
                  // pages like Google fire navigation/title events continuously,
                  // which would wipe each keystroke and make the bar feel frozen.
                  if (nav.url && tab.id === activeTabId && !addressFocusedRef.current) {
                    setAddressBar(nav.url);
                  }
                  recordHistory(nav.url, nav.title || domainLabel(nav.url || tab.url));
                }}
                allowsBackForwardNavigationGestures
                javaScriptEnabled
                domStorageEnabled
                // target="_blank" / window.open links open in a new tab instead
                // of being silently dropped by the WebView.
                setSupportMultipleWindows
                onOpenWindow={(e: any) => {
                  const url = e?.nativeEvent?.targetUrl;
                  if (url) openTabWithUrl(url);
                }}
                startInLoadingState
                incognito={false}
                cacheEnabled
                // iOS forces every <video> into the native fullscreen player
                // unless inline playback is allowed — this makes dApps like
                // RouGee play video inline (reels/feed), honoring `playsinline`.
                allowsInlineMediaPlayback
                // Let muted, on-screen previews autoplay without a tap (IG-style).
                mediaPlaybackRequiresUserAction={false}
                renderLoading={() => (
                  <View style={styles.loading}>
                    <Ionicons name="globe-outline" size={32} color={colors.textTertiary} />
                  </View>
                )}
              />
            )}
          </View>
        );
      })}

      {ApprovalModal && (
        <ApprovalModal request={approval} onClose={() => setApproval(null)} />
      )}
    </View>

      {/* Web panel (right side, Opera GX-style) */}
      {isDesktop && activePanel && (
        <View style={styles.webPanel}>
          <View style={styles.webPanelHeader}>
            <Text style={styles.webPanelTitle} numberOfLines={1}>
              {activePanel.name}
            </Text>
            <TouchableOpacity
              onPress={() => panelWebRef.current?.reload?.()}
              hitSlop={8}
              style={styles.navBtn}
            >
              <Ionicons name="refresh" size={15} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setActivePanelId(null)} hitSlop={8} style={styles.navBtn}>
              <Ionicons name="close" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {WebView && (
            <WebView
              ref={(r: any) => {
                if (r) panelWebRef.current = r;
              }}
              source={{ uri: activePanel.url }}
              style={{ flex: 1, backgroundColor: colors.bg }}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
            />
          )}
        </View>
      )}

      {/* Panel strip (right edge) — collapsible */}
      {isDesktop && (
        panelStripCollapsed ? (
          <View style={styles.panelStripCollapsed}>
            <TouchableOpacity
              onPress={() => setPanelStripCollapsed(false)}
              style={styles.panelStripBtn}
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.panelStrip}>
            <TouchableOpacity
              onPress={() => {
                setPanelStripCollapsed(true);
                setActivePanelId(null);
              }}
              style={styles.panelStripBtn}
              hitSlop={8}
            >
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
            {webPanels.map((p) => {
              const on = p.id === activePanelId;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setActivePanelId(on ? null : p.id)}
                  onLongPress={() => removeWebPanel(p.id)}
                  style={[styles.panelStripBtn, on && styles.panelStripBtnActive]}
                >
                  <Ionicons name={p.icon} size={20} color={on ? colors.accent : colors.textSecondary} />
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity onPress={() => setShowAddPanel((s) => !s)} style={styles.panelStripBtn}>
              <Ionicons name="add" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )
      )}

      {/* Add-panel popover */}
      {showAddPanel && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={styles.menuBackdrop} onPress={() => setShowAddPanel(false)} />
          <View style={[styles.menu, styles.addPanelBox]}>
            <Text style={styles.dlPanelTitle}>{t('b_add_panel')}</Text>
            <TextInput
              style={styles.addPanelInput}
              value={newPanelUrl}
              onChangeText={setNewPanelUrl}
              onSubmitEditing={addWebPanel}
              placeholder={t('b_panel_url_ph')}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={addWebPanel} style={styles.addPanelBtn}>
              <Text style={styles.addPanelBtnText}>{t('b_add')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* First-run: RougeChain ecosystem vs empty slate */}
      {showFirstRun && (
        <View style={styles.firstRunOverlay}>
          <View style={styles.firstRunCard}>
            <Ionicons name="compass" size={40} color={colors.accent} />
            <Text style={styles.firstRunTitle}>{t('b_firstrun_title')}</Text>
            <Text style={styles.firstRunSub}>{t('b_firstrun_sub')}</Text>
            <TouchableOpacity style={styles.firstRunPrimary} onPress={() => chooseFirstRun(true)}>
              <Text style={styles.firstRunPrimaryText}>{t('b_firstrun_ecosystem')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.firstRunSecondary} onPress={() => chooseFirstRun(false)}>
              <Text style={styles.firstRunSecondaryText}>{t('b_firstrun_empty')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // URL bar
  urlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.chrome,
  },
  // Desktop tab strip
  tabStrip: {
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tabStripContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingTop: 6,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 200,
    minWidth: 120,
    paddingLeft: spacing.sm,
    paddingRight: 6,
    paddingVertical: 7,
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    backgroundColor: colors.chrome,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: colors.border,
  },
  tabChipActive: {
    backgroundColor: colors.input,
    borderColor: colors.borderLight,
  },
  tabChipText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  tabChipTextActive: {
    color: colors.text,
  },
  tabChipClose: {
    padding: 2,
    borderRadius: 4,
  },
  tabNewBtn: {
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Bookmarks bar (desktop)
  bookmarksBar: {
    backgroundColor: colors.chrome,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bookmarksBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  bmBarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    maxWidth: 160,
  },
  bmBarText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  // Omnibox suggestions — absolute overlay anchored under the top chrome so
  // focusing the address bar never reflows the page below.
  omnibox: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingVertical: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 90,
  },
  omniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  omniTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  omniUrl: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  // Downloads
  dlBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  dlBadgeText: { color: colors.bg, fontSize: 9, fontWeight: '800' },
  dlPanel: { minWidth: 300, maxWidth: 360, paddingHorizontal: 0 },
  dlPanelTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dlEmpty: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  dlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dlName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
  dlMeta: { color: colors.textTertiary, fontSize: fontSize.xs, marginTop: 1 },
  dlHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.md,
  },
  dlClear: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '600' },
  // Find in page
  findBar: {
    position: 'absolute',
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 95,
  },
  findInput: {
    width: 180,
    color: colors.text,
    fontSize: fontSize.sm,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
  },
  findCount: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    minWidth: 40,
    textAlign: 'right',
  },
  findBtn: { padding: 4 },
  // Web panels (Opera GX-style sidebar)
  rootRow: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  webPanel: {
    width: 380,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    backgroundColor: colors.bg,
  },
  webPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.chrome,
  },
  webPanelTitle: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  panelStrip: {
    width: 48,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: 4,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    backgroundColor: colors.chrome,
  },
  panelStripCollapsed: {
    width: 22,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    backgroundColor: colors.chrome,
  },
  panelStripBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelStripBtnActive: { backgroundColor: colors.accentDim },
  addPanelBox: { top: 60, right: 56, minWidth: 240, padding: spacing.sm },
  addPanelInput: {
    backgroundColor: colors.input,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    marginBottom: spacing.sm,
  },
  addPanelBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    alignItems: 'center',
    paddingVertical: 9,
  },
  addPanelBtnText: { color: colors.bg, fontWeight: '700', fontSize: fontSize.sm },
  // First-run choice
  firstRunOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    zIndex: 200,
  },
  firstRunCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    padding: spacing.xl,
    alignItems: 'center',
  },
  firstRunTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  firstRunSub: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  firstRunPrimary: {
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  firstRunPrimaryText: { color: colors.bg, fontWeight: '700', fontSize: fontSize.sm },
  firstRunSecondary: {
    width: '100%',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    alignItems: 'center',
    paddingVertical: 12,
  },
  firstRunSecondaryText: { color: colors.text, fontWeight: '600', fontSize: fontSize.sm },
  navBtn: {
    padding: spacing.xs,
  },
  addressContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    gap: 6,
    height: 36,
  },
  addressInput: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.sm,
    paddingVertical: 0,
  },
  tabCountBtn: {
    borderWidth: 1.5,
    borderColor: colors.textSecondary,
    borderRadius: 4,
    width: 24,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCountText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },

  // Dropdown menu
  menuOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  menu: {
    position: 'absolute',
    top: 52,
    right: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    paddingVertical: spacing.xs,
    minWidth: 190,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 101,
  },
  extPanel: {
    position: 'absolute',
    top: 52,
    right: spacing.sm,
    width: 380,
    maxWidth: '92%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 101,
  },
  extHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  extTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  extActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  extBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
  },
  extBtnText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  extRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  extName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  extMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 1 },
  extRemove: { padding: 6 },
  extEmpty: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  extHint: { color: colors.textTertiary, fontSize: 11, marginTop: spacing.sm, lineHeight: 15 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  menuText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },

  // Loading
  loading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Home
  home: {
    flex: 1,
    paddingTop: spacing.xxl,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  homeTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  homeSubtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingBottom: spacing.md,
  },
  bookmark: {
    alignItems: 'center',
    width: 90,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  bookmarkIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  bookmarkIconCustom: {
    backgroundColor: colors.purpleDim,
  },
  bookmarkDelete: {
    position: 'absolute',
    top: -6,
    right: -6,
  },
  bookmarkLabel: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: '500',
    textAlign: 'center',
  },
  noWallet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    backgroundColor: 'rgba(253,203,110,0.1)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  noWalletText: {
    color: colors.warning,
    fontSize: fontSize.xs,
    flex: 1,
  },

  // Recent (history)
  recentWrap: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  recentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  recentTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  recentClear: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  recentItemTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  recentItemUrl: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    marginTop: 1,
  },

  // Tab switcher
  tabSwitcherHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.chrome,
  },
  tabSwitcherTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  tabSwitcherAction: {
    padding: spacing.xs,
  },
  tabGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: spacing.sm,
    gap: spacing.sm,
  },
  tabCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tabCardActive: {
    borderColor: colors.accent,
  },
  tabCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: colors.chrome,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tabCardTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  tabCardBody: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  tabCardUrl: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    textAlign: 'center',
  },
});
