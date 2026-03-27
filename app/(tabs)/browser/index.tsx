import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, radius, fontSize } from '@/constants/theme';
import { useWalletStore } from '@/stores/wallet';
import type { ApprovalRequest } from '@/lib/dapp-provider';

let WebView: any = null;
let getInjectedProviderScript: (() => string) | null = null;
let handleDappRequest: any = null;
let sendResponseToWebView: any = null;
let ApprovalModal: any = null;

if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').default;
  const provider = require('@/lib/dapp-provider');
  getInjectedProviderScript = provider.getInjectedProviderScript;
  handleDappRequest = provider.handleDappRequest;
  sendResponseToWebView = provider.sendResponseToWebView;
  ApprovalModal = require('@/components/dapp/ApprovalModal').default;
}

interface Bookmark {
  name: string;
  url: string;
  icon: string;
}

const BOOKMARKS: Bookmark[] = [
  { name: 'qRougee', url: 'https://testnet.rougechain.io/qrougee', icon: 'musical-notes' },
  { name: 'Explorer', url: 'https://testnet.rougechain.io', icon: 'search' },
  { name: 'Swap', url: 'https://testnet.rougechain.io/swap', icon: 'swap-horizontal' },
  { name: 'Tokens', url: 'https://testnet.rougechain.io/tokens', icon: 'diamond' },
  { name: 'NFTs', url: 'https://testnet.rougechain.io/nft', icon: 'image' },
  { name: 'Pools', url: 'https://testnet.rougechain.io/pools', icon: 'water' },
];

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

export default function BrowserScreen() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<any>(null);
  const wallet = useWalletStore((s) => s.wallet);
  const [url, setUrl] = useState('');
  const [addressBar, setAddressBar] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);

  const navigate = useCallback((target: string) => {
    const normalised = normaliseUrl(target);
    if (!normalised) return;
    setUrl(normalised);
    setAddressBar(normalised);
  }, []);

  const onMessage = useCallback(
    (event: any) => {
      if (!handleDappRequest) return;
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data?.source !== 'rougechain-provider') return;

        const origin = url ? new URL(url).origin : 'unknown';
        handleDappRequest(
          { id: data.id, method: data.method, params: data.params, origin },
          webViewRef,
          (req: ApprovalRequest) => setApproval(req),
        );
      } catch {
        /* ignore non-provider messages */
      }
    },
    [url],
  );

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.webNotice}>
          The dApp browser is only available on mobile devices.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* URL bar */}
      <View style={styles.urlBar}>
        <TouchableOpacity
          disabled={!canGoBack}
          onPress={() => webViewRef.current?.goBack()}
          style={styles.navBtn}>
          <Ionicons
            name="chevron-back"
            size={20}
            color={canGoBack ? colors.text : colors.textTertiary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!canGoForward}
          onPress={() => webViewRef.current?.goForward()}
          style={styles.navBtn}>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={canGoForward ? colors.text : colors.textTertiary}
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
          onPress={() => webViewRef.current?.reload()}
          style={styles.navBtn}>
          <Ionicons name="refresh" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      {url ? (
        <View style={{ flex: 1 }}>
          {WebView && (
            <WebView
              ref={webViewRef}
              source={{ uri: url }}
              style={{ flex: 1, backgroundColor: colors.bg }}
              injectedJavaScriptBeforeContentLoaded={
                getInjectedProviderScript ? getInjectedProviderScript() : ''
              }
              onMessage={onMessage}
              onNavigationStateChange={(nav: any) => {
                setCanGoBack(nav.canGoBack);
                setCanGoForward(nav.canGoForward);
                setPageTitle(nav.title || '');
                if (nav.url) setAddressBar(nav.url);
              }}
              allowsBackForwardNavigationGestures
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
              renderLoading={() => (
                <View style={styles.loading}>
                  <Ionicons name="globe-outline" size={32} color={colors.textTertiary} />
                </View>
              )}
            />
          )}
        </View>
      ) : (
        <View style={styles.home}>
          <Text style={styles.homeTitle}>dApp Browser</Text>
          <Text style={styles.homeSubtitle}>
            Connect to RougeChain dApps directly from Qwalla
          </Text>

          <FlatList
            data={BOOKMARKS}
            numColumns={3}
            keyExtractor={(item) => item.url}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.bookmark} onPress={() => navigate(item.url)}>
                <View style={styles.bookmarkIcon}>
                  <Ionicons name={item.icon as any} size={24} color={colors.accent} />
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
      )}

      {ApprovalModal && (
        <ApprovalModal request={approval} onClose={() => setApproval(null)} />
      )}
    </View>
  );
}

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
  loading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
});
