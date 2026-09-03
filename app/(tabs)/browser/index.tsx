import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, spacing, radius, fontSize } from '@/constants/theme';
import { useWalletStore } from '@/stores/wallet';
import { setDappEventSink } from '@/lib/dapp-events';
import type { ApprovalRequest } from '@/lib/dapp-provider';

let WebView: any = null;
let getInjectedProviderScript: (() => string) | null = null;
let handleDappRequest: any = null;
let sendResponseToWebView: any = null;
let sendEventToWebView: any = null;
let ApprovalModal: any = null;
let getInjectedEthereumScript: (() => string) | null = null;
let handleEvmRequest: any = null;

if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').default;
  const provider = require('@/lib/dapp-provider');
  getInjectedProviderScript = provider.getInjectedProviderScript;
  handleDappRequest = provider.handleDappRequest;
  sendResponseToWebView = provider.sendResponseToWebView;
  sendEventToWebView = provider.sendEventToWebView;
  ApprovalModal = require('@/components/dapp/ApprovalModal').default;
  const evm = require('@/lib/evm-provider');
  getInjectedEthereumScript = evm.getInjectedEthereumScript;
  handleEvmRequest = evm.handleEvmRequest;
}

interface Bookmark {
  name: string;
  url: string;
  icon: string;
  isCustom?: boolean;
}

const DEFAULT_BOOKMARKS: Bookmark[] = [
  { name: 'qRougee', url: 'https://rougee.app', icon: 'musical-notes' },
  { name: 'antiReddit', url: 'https://antireddit.com', icon: 'chatbubbles' },
  { name: 'Explorer', url: 'https://rougechain.io/blockchain', icon: 'search' },
  { name: 'Swap', url: 'https://rougechain.io/swap', icon: 'swap-horizontal' },
  { name: 'Tokens', url: 'https://rougechain.io/tokens', icon: 'diamond' },
  { name: 'NFTs', url: 'https://rougechain.io/nfts', icon: 'image' },
  { name: 'Pools', url: 'https://rougechain.io/pools', icon: 'water' },
  { name: 'Bridge', url: 'https://rougechain.io/bridge', icon: 'git-compare' },
];

const BOOKMARKS_KEY = 'qwalla_browser_bookmarks';

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

function domainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 24);
  }
}

// ── Component ─────────────────────────────────────────────────────

export default function BrowserScreen() {
  const insets = useSafeAreaInsets();
  const wallet = useWalletStore((s) => s.wallet);
  const webViewRefs = useRef<Record<string, any>>({});
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);

  // Forward wallet/network events (accountsChanged, networkChanged,
  // disconnect) into every open dApp tab.
  useEffect(() => {
    if (Platform.OS === 'web' || !sendEventToWebView) return;
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

  // Bookmarks
  const [customBookmarks, setCustomBookmarks] = useState<Bookmark[]>([]);
  const [editingBookmarks, setEditingBookmarks] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(BOOKMARKS_KEY).then((raw) => {
      if (raw) {
        try { setCustomBookmarks(JSON.parse(raw)); } catch { /* ignore */ }
      }
    });
  }, []);

  const saveCustomBookmarks = useCallback((bm: Bookmark[]) => {
    setCustomBookmarks(bm);
    AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bm));
  }, []);

  const allBookmarks = [...DEFAULT_BOOKMARKS, ...customBookmarks.map((b) => ({ ...b, isCustom: true }))];

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const [addressBar, setAddressBar] = useState(activeTab.url);

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
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
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
      const t = tabs.find((tab) => tab.id === id);
      setAddressBar(t?.url || '');
      setShowTabSwitcher(false);
    },
    [tabs],
  );

  const newTab = useCallback(() => {
    const t = makeTab();
    setTabs((prev) => [...prev, t]);
    setActiveTabId(t.id);
    setAddressBar('');
    setShowTabSwitcher(false);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      delete webViewRefs.current[id];
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== id);
        if (remaining.length === 0) {
          const fresh = makeTab();
          setActiveTabId(fresh.id);
          setAddressBar('');
          return [fresh];
        }
        if (activeTabId === id) {
          const idx = prev.findIndex((t) => t.id === id);
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
    Alert.alert('Cache Cleared', 'WebView cache and cookies have been cleared for this tab.');
    setShowMenu(false);
  }, [activeTabId]);

  const clearAllData = useCallback(() => {
    Alert.alert(
      'Clear All Browser Data',
      'This will clear cache, cookies, and close all tabs. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            Object.values(webViewRefs.current).forEach((ref: any) => {
              ref?.clearCache?.(true);
              ref?.clearHistory?.();
            });
            webViewRefs.current = {};
            const fresh = makeTab();
            setTabs([fresh]);
            setActiveTabId(fresh.id);
            setAddressBar('');
            setShowMenu(false);
          },
        },
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

        const tab = tabs.find((t) => t.id === tabId);
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

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.webNotice}>
          The dApp browser is only available on mobile devices.
        </Text>
      </View>
    );
  }

  // ── Tab switcher overlay ──────────────────────────────────────

  if (showTabSwitcher) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.tabSwitcherHeader}>
          <Text style={styles.tabSwitcherTitle}>{tabs.length} Tab{tabs.length !== 1 ? 's' : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity onPress={newTab} style={styles.tabSwitcherAction}>
              <Ionicons name="add" size={22} color={colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowTabSwitcher(false)} style={styles.tabSwitcherAction}>
              <Text style={{ color: colors.accent, fontWeight: '600', fontSize: fontSize.sm }}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.tabGrid}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[
                styles.tabCard,
                t.id === activeTabId && styles.tabCardActive,
              ]}
              onPress={() => switchToTab(t.id)}
              activeOpacity={0.7}
            >
              <View style={styles.tabCardHeader}>
                <Ionicons name="globe-outline" size={12} color={colors.textTertiary} />
                <Text style={styles.tabCardTitle} numberOfLines={1}>
                  {t.url ? domainLabel(t.url) : 'New Tab'}
                </Text>
                <TouchableOpacity
                  onPress={() => closeTab(t.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
              <View style={styles.tabCardBody}>
                {t.url ? (
                  <Text style={styles.tabCardUrl} numberOfLines={2}>{t.title}</Text>
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
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
            onSubmitEditing={() => navigate(addressBar)}
            placeholder="Search or enter URL"
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

        {/* Tab count button */}
        <TouchableOpacity onPress={() => setShowTabSwitcher(true)} style={styles.tabCountBtn}>
          <Text style={styles.tabCountText}>{tabs.length}</Text>
        </TouchableOpacity>

        {/* Menu button */}
        <TouchableOpacity onPress={() => setShowMenu((s) => !s)} style={styles.navBtn}>
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Dropdown menu */}
      {showMenu && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={styles.menuBackdrop} onPress={() => setShowMenu(false)} />
          <View style={styles.menu}>
            <TouchableOpacity style={styles.menuItem} onPress={newTab}>
              <Ionicons name="add-circle-outline" size={18} color={colors.text} />
              <Text style={styles.menuText}>New Tab</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeTab(activeTabId);
                setShowMenu(false);
              }}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.text} />
              <Text style={styles.menuText}>Close Tab</Text>
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
                  <Text style={styles.menuText}>Remove Bookmark</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.menuItem} onPress={addBookmark}>
                  <Ionicons name="bookmark-outline" size={18} color={colors.text} />
                  <Text style={styles.menuText}>Bookmark Page</Text>
                </TouchableOpacity>
              )
            ) : null}
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={clearCache}>
              <Ionicons name="trash-outline" size={18} color={colors.text} />
              <Text style={styles.menuText}>Clear Tab Cache</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={clearAllData}>
              <Ionicons name="nuclear-outline" size={18} color={colors.error} />
              <Text style={[styles.menuText, { color: colors.error }]}>Clear All Data</Text>
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
            <View key={tab.id} style={styles.home}>
              <Text style={styles.homeTitle}>dApp Browser</Text>
              <Text style={styles.homeSubtitle}>
                Connect to RougeChain dApps directly from Qwalla
              </Text>

              {customBookmarks.length > 0 && (
                <TouchableOpacity
                  onPress={() => setEditingBookmarks((e) => !e)}
                  style={{ alignSelf: 'flex-end', marginBottom: spacing.sm }}
                >
                  <Text style={{ color: colors.accent, fontSize: fontSize.xs, fontWeight: '600' }}>
                    {editingBookmarks ? 'Done' : 'Edit'}
                  </Text>
                </TouchableOpacity>
              )}

              <FlatList
                data={allBookmarks}
                numColumns={3}
                keyExtractor={(item) => item.url}
                contentContainerStyle={styles.grid}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.bookmark}
                    onPress={() => navigate(item.url)}
                    onLongPress={item.isCustom ? () => {
                      Alert.alert(
                        'Remove Bookmark',
                        `Remove "${item.name}" from bookmarks?`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => removeBookmark(item.url) },
                        ],
                      );
                    } : undefined}
                  >
                    <View style={[styles.bookmarkIcon, item.isCustom && styles.bookmarkIconCustom]}>
                      <Ionicons name={item.icon as any} size={24} color={item.isCustom ? colors.purple : colors.accent} />
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
                )}
              />
              {!wallet && (
                <View style={styles.noWallet}>
                  <Ionicons name="alert-circle" size={18} color={colors.warning} />
                  <Text style={styles.noWalletText}>
                    Create or import a wallet to interact with dApps
                  </Text>
                </View>
              )}
            </View>
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
                }}
                allowsBackForwardNavigationGestures
                javaScriptEnabled
                domStorageEnabled
                startInLoadingState
                incognito={false}
                cacheEnabled
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
  );
}

// ── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  webNotice: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: 80,
    paddingHorizontal: spacing.lg,
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
    gap: spacing.md,
    paddingBottom: spacing.xl,
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
