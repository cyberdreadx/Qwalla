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
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, spacing, radius, fontSize } from '@/constants/theme';
import { useWalletStore } from '@/stores/wallet';
import { setDappEventSink } from '@/lib/dapp-events';
import { isBundledBookmarkListed } from '@/lib/compliance';
import type { ApprovalRequest } from '@/lib/dapp-provider';
import { loadBrowserState, saveBrowserState } from '@/lib/browser-tabs';
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

const BOOKMARKS_KEY = 'qwalla_browser_bookmarks';

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
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

let nextTabId = 1;
function makeTab(url = ''): BrowserTab {
  return {
    id: `tab_${nextTabId++}`,
    url,
    title: url ? new URL(url).hostname : 'New Tab',
    canGoBack: false,
    canGoForward: false,
  };
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

type BrowserBridge = {
  onDownload?: (cb: (d: DownloadEntry) => void) => () => void;
  openDownload?: (p: string) => void;
  showDownload?: (p: string) => void;
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

// ── Component ─────────────────────────────────────────────────────

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

  // Tab state
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [makeTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  const [showTabSwitcher, setShowTabSwitcher] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const bridge = browserBridge();

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

  // Web panels (Opera GX-style sidebar of pinned sites)
  const [webPanels, setWebPanels] = useState<WebPanel[]>(DEFAULT_PANELS);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
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

  // Bookmarks
  const [customBookmarks, setCustomBookmarks] = useState<Bookmark[]>([]);
  const [editingBookmarks, setEditingBookmarks] = useState(false);

  // Visit history ("Recent" on the home)
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const lastRecorded = useRef<string>('');

  useEffect(() => {
    AsyncStorage.getItem(BOOKMARKS_KEY).then((raw) => {
      if (raw) {
        try { setCustomBookmarks(JSON.parse(raw)); } catch { /* ignore */ }
      }
    });
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

  const saveCustomBookmarks = useCallback((bm: Bookmark[]) => {
    setCustomBookmarks(bm);
    AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bm));
  }, []);

  const allBookmarks = [...DEFAULT_BOOKMARKS, ...customBookmarks.map((b) => ({ ...b, isCustom: true }))];

  const activeTab = tabs.find((v) => v.id === activeTabId) || tabs[0];
  const [addressBar, setAddressBar] = useState(activeTab.url);
  const [addressFocused, setAddressFocused] = useState(false);

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
      tabs: tabs.map((v) => ({ url: v.url, title: v.title })),
      activeIndex: idx,
    });
  }, [tabs, activeTabId, tabsHydrated]);

  const isCurrentPageBookmarked = activeTab.url
    ? allBookmarks.some((b) => b.url === activeTab.url)
    : false;

  const addBookmark = useCallback(() => {
    if (!activeTab.url) return;
    const exists = [...DEFAULT_BOOKMARKS, ...customBookmarks].some((b) => b.url === activeTab.url);
    if (exists) return;
    const bm: Bookmark = {
      name: activeTab.title || domainLabel(activeTab.url),
      url: activeTab.url,
      icon: 'bookmark',
      isCustom: true,
    };
    saveCustomBookmarks([...customBookmarks, bm]);
    setShowMenu(false);
  }, [activeTab, customBookmarks, saveCustomBookmarks]);

  const removeBookmark = useCallback((url: string) => {
    saveCustomBookmarks(customBookmarks.filter((b) => b.url !== url));
  }, [customBookmarks, saveCustomBookmarks]);

  // ── Helpers ───────────────────────────────────────────────────

  const updateTab = useCallback((id: string, patch: Partial<BrowserTab>) => {
    setTabs((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }, []);

  const navigate = useCallback(
    (target: string) => {
      const normalised = normaliseUrl(target);
      if (!normalised) return;
      updateTab(activeTabId, { url: normalised, title: domainLabel(normalised) });
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
      setAddressBar(v?.url || '');
      setShowTabSwitcher(false);
    },
    [tabs],
  );

  const newTab = useCallback(() => {
    const v = makeTab();
    setTabs((prev) => [...prev, v]);
    setActiveTabId(v.id);
    setAddressBar('');
    setShowTabSwitcher(false);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
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
          setAddressBar(next.url);
        }
        return remaining;
      });
    },
    [activeTabId],
  );

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
        const origin = tab?.url ? new URL(tab.url).origin : 'unknown';
        const ref = webViewRefs.current[tabId];
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
                  onPress={() => closeTab(v.id)}
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
      {/* Desktop horizontal tab strip */}
      {isDesktop && (
        <View style={styles.tabStrip}>
          <ScrollView
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
                  <Ionicons
                    name="globe-outline"
                    size={13}
                    color={isActive ? colors.text : colors.textTertiary}
                  />
                  <Text
                    style={[styles.tabChipText, isActive && styles.tabChipTextActive]}
                    numberOfLines={1}
                  >
                    {tab.url ? domainLabel(tab.url) : t('b_new_tab')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => closeTab(tab.id)}
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
            style={styles.addressInput}
            value={addressBar}
            onChangeText={setAddressBar}
            onSubmitEditing={() => { navigate(addressBar); setAddressFocused(false); }}
            onFocus={() => setAddressFocused(true)}
            onBlur={() => setTimeout(() => setAddressFocused(false), 150)}
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

      {/* Downloads panel */}
      {showDownloads && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={styles.menuBackdrop} onPress={() => setShowDownloads(false)} />
          <View style={[styles.menu, styles.dlPanel]}>
            <Text style={styles.dlPanelTitle}>{t('b_downloads')}</Text>
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
                    {done && (
                      <TouchableOpacity onPress={() => bridge?.openDownload?.(d.path)} hitSlop={8}>
                        <Ionicons name="open-outline" size={16} color={colors.accent} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </View>
        </View>
      )}

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
            if (!seen.has(it.url)) {
              seen.add(it.url);
              deduped.push(it);
            }
          }
          const capped = deduped.slice(0, 6);
          const q = addressBar.trim();
          if (!q && capped.length === 0) return null;
          return (
            <View style={styles.omnibox}>
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

      {/* Dropdown menu */}
      {showMenu && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={styles.menuBackdrop} onPress={() => setShowMenu(false)} />
          <View style={styles.menu}>
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
                    removeBookmark(activeTab.url);
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

                {customBookmarks.length > 0 && (
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
                      onLongPress={item.isCustom ? () => {
                        Alert.alert(
                          t('b_remove_bookmark'),
                          t('b_remove_bookmark_msg').replace('{name}', item.name),
                          [
                            { text: t('b_cancel'), style: 'cancel' },
                            { text: t('b_remove'), style: 'destructive', onPress: () => removeBookmark(item.url) },
                          ],
                        );
                      } : undefined}
                    >
                      <View style={[styles.bookmarkIcon, item.isCustom && styles.bookmarkIconCustom]}>
                        <BookmarkIcon
                          url={item.url}
                          icon={item.icon}
                          isCustom={item.isCustom}
                          logo={item.logo}
                          noFavicon={item.noFavicon}
                        />
                        {editingBookmarks && item.isCustom && (
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

        return (
          <View
            key={tab.id}
            style={[{ flex: 1 }, !isActive && { height: 0, overflow: 'hidden', position: 'absolute', opacity: 0 }]}
            pointerEvents={isActive ? 'auto' : 'none'}
          >
            {WebView && (
              <WebView
                ref={(r: any) => {
                  if (r) webViewRefs.current[tab.id] = r;
                }}
                source={{ uri: tab.url }}
                style={{ flex: 1, backgroundColor: colors.bg }}
                injectedJavaScriptBeforeContentLoaded={
                  (getInjectedProviderScript ? getInjectedProviderScript() : '') +
                  (getInjectedEthereumScript ? getInjectedEthereumScript() : '')
                }
                onMessage={(e: any) => onMessage(tab.id, e)}
                onNavigationStateChange={(nav: any) => {
                  updateTab(tab.id, {
                    canGoBack: nav.canGoBack,
                    canGoForward: nav.canGoForward,
                    title: nav.title || domainLabel(nav.url || tab.url),
                  });
                  if (nav.url && tab.id === activeTabId) {
                    setAddressBar(nav.url);
                  }
                  recordHistory(nav.url, nav.title || domainLabel(nav.url || tab.url));
                }}
                allowsBackForwardNavigationGestures
                javaScriptEnabled
                domStorageEnabled
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

      {/* Panel strip (right edge) */}
      {isDesktop && (
        <View style={styles.panelStrip}>
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
  // Omnibox suggestions
  omnibox: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
    zIndex: 50,
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
