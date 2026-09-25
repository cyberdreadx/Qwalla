import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatView } from './[id]';
import { EmptyState } from '@/components/EmptyState';
import { colors, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { getBlockedWallets, blockWallet } from '@qwalla/core/wallet';
import {
  getAcceptedChats,
  acceptChat,
  migrateExistingChats,
} from '@/lib/message-requests';
import { readCache, writeCache } from '@/lib/message-cache';
import { rc } from '@/lib/rougechain';
import { rougeWs } from '@/lib/ws';
import { useNotificationStore } from '@/stores/notifications';
import { useMutedConversations } from '@/stores/muted-conversations';
import { useTrashedConversations } from '@/stores/trashed-conversations';
import { useWalletStore } from '@/stores/wallet';

type Participant = {
  id?: string;
  publicKey?: string;
  signing_public_key?: string;
  signingPublicKey?: string;
  encryptionPublicKey?: string;
  encryption_public_key?: string;
  displayName?: string;
  display_name?: string;
};

type Convo = {
  conversationId?: string;
  conversation_id?: string;
  id?: string;
  lastMessage?: string;
  last_message?: string;
  unreadCount?: number;
  unread_count?: number;
  participants?: Participant[];
  participantIds?: string[];
  participant_ids?: string[];
  name?: string;
  group_name?: string;
  groupName?: string;
  isGroup?: boolean;
  is_group?: boolean;
};

type WalletEntry = Record<string, unknown>;

// Encrypted-at-rest snapshot of the conversation list for an instant open.
// Maps are stored as entry arrays.
type ListCache = {
  items: Convo[];
  dir: [string, string][];
  avatarDir: [string, string][];
};

/**
 * Swipe a conversation row left past a threshold to delete it (→ Trash). Built
 * on core PanResponder + Animated (no react-native-gesture-handler, which isn't
 * installed and would need a native rebuild) so it ships over OTA. The horizontal
 * guard lets the FlatList keep scrolling vertically.
 */
function SwipeRow({ label, onDelete, children }: { label: string; onDelete: () => void; children: ReactNode }) {
  const tx = useRef(new Animated.Value(0)).current;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 14,
      onPanResponderMove: (_e, g) => {
        if (g.dx < 0) tx.setValue(Math.max(g.dx, -110));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -75) {
          Animated.timing(tx, { toValue: -600, duration: 180, useNativeDriver: true }).start(onDelete);
        } else {
          Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        }
      },
    }),
  ).current;
  return (
    <View style={swipeStyles.wrap}>
      <View style={swipeStyles.bg}>
        <Ionicons name="trash" size={18} color="#fff" />
        <Text style={swipeStyles.bgText}>{label}</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX: tx }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

export default function MessengerListScreen() {
  const { t } = useT();
  const wallet = useWalletStore((s) => s.wallet);
  const encPub = useWalletStore((s) => s.encPublicKey);
  const myAvatarUrl = useWalletStore((s) => s.avatarUrl);
  const clearUnreadChats = useNotificationStore((s) => s.clearUnreadChats);
  const mutedMap = useMutedConversations((s) => s.muted);
  const trashedMap = useTrashedConversations((s) => s.trashed);
  const restoreConvo = useTrashedConversations((s) => s.restore);
  const trashConvo = useTrashedConversations((s) => s.trash);
  const [items, setItems] = useState<Convo[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'primary' | 'requests' | 'trash'>('primary');
  const [walletDir, setWalletDir] = useState<Map<string, string>>(new Map());
  const [avatarDir, setAvatarDir] = useState<Map<string, string>>(new Map());
  const avatarDirRef = useRef<Map<string, string>>(new Map());
  avatarDirRef.current = avatarDir;
  const [loading, setLoading] = useState(true);
  const { width } = useWindowDimensions();
  // On wide web, show a Signal-style master–detail: list on the left, the open
  // conversation inline on the right (selected instead of navigated).
  const desktop = Platform.OS === 'web' && width >= 760;
  const [selected, setSelected] = useState<{ id: string; peer?: string } | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!wallet || !encPub) return;
    // Silent refreshes (tab focus, live new-message events) update the list in
    // the background without flashing the full-screen spinner — only the very
    // first load (no data yet) shows it.
    if (!silent) setLoading(true);
    try {
      const [list, wallets, blockedList] = await Promise.all([
        rc.messenger.getConversations(wallet),
        rc.messenger.getWallets(),
        getBlockedWallets(),
      ]);
      const blocked = new Set(blockedList);
      const allConvos = Array.isArray(list) ? (list as Convo[]) : [];
      // Hide 1:1 conversations whose only other member is blocked. Group chats
      // stay visible — blocking one member doesn't remove you from the group.
      const visible = allConvos.filter((c) => {
        const others = new Set<string>();
        for (const p of c.participants ?? []) {
          const pk = p.publicKey ?? p.signingPublicKey ?? p.signing_public_key ?? p.id ?? '';
          if (pk && pk !== wallet.publicKey) others.add(pk);
        }
        for (const pid of c.participantIds ?? c.participant_ids ?? []) {
          if (pid && pid !== wallet.publicKey) others.add(pid);
        }
        if (others.size === 1) {
          const [only] = [...others];
          if (blocked.has(only)) return false;
        }
        return true;
      });
      setItems(visible);

      // Message requests: grandfather existing chats on first run, then load the
      // accepted set so only new incoming 1:1s show up as requests.
      await migrateExistingChats(visible.map((c) => convoId(c)));
      setAccepted(new Set(await getAcceptedChats()));

      const dir = new Map<string, string>();
      const dirAvatar = new Map<string, string>();
      const wArr = (Array.isArray(wallets) ? wallets : []) as WalletEntry[];
      for (const w of wArr) {
        const name = String(w.displayName ?? w.display_name ?? '');
        const avatar = String(w.avatarUrl ?? w.avatar_url ?? w.avatar ?? '');
        const keys = [w.id, w.publicKey, w.signingPublicKey, w.signing_public_key, w.encryptionPublicKey, w.encryption_public_key];
        for (const k of keys) {
          if (k && typeof k === 'string') {
            if (name) dir.set(k, name);
            if (avatar) dirAvatar.set(k, avatar);
          }
        }
      }
      setWalletDir(dir);

      const convos = Array.isArray(list) ? (list as Convo[]) : [];
      const peerKeys = new Set<string>();
      const myPk = wallet.publicKey;
      for (const c of convos) {
        const parts = c.participants ?? [];
        for (const p of parts) {
          const pk = p.publicKey ?? p.signingPublicKey ?? p.signing_public_key ?? p.id ?? '';
          if (pk && pk !== myPk) peerKeys.add(pk);
        }
        for (const pid of (c.participantIds ?? c.participant_ids ?? [])) {
          if (pid && pid !== myPk) peerKeys.add(pid);
        }
      }

      const avDir = new Map<string, string>();
      // Prefer a directory (profile) avatar; only fall back to an NFT lookup for
      // peers who haven't set one — which also saves those network calls.
      const needNft: string[] = [];
      for (const pk of peerKeys) {
        const a = dirAvatar.get(pk);
        if (a) avDir.set(pk, a);
        else needNft.push(pk);
      }
      const lookups = needNft.slice(0, 20).map(async (pk) => {
        try {
          const nfts = await rc.nft.getByOwner(pk);
          const arr = Array.isArray(nfts) ? (nfts as Record<string, unknown>[]) : [];
          if (arr.length > 0) {
            const img = (arr[0].image ?? arr[0].metadataUri ?? arr[0].metadata_uri) as string | undefined;
            if (img) avDir.set(pk, img);
          }
        } catch { /* optional */ }
      });
      await Promise.allSettled(lookups);
      // Sticky-merge so a slow/partial directory fetch (avatars are returned
      // inline, some ~100 KB) never blanks an avatar we already showed.
      const mergedAv = new Map<string, string>(avatarDirRef.current);
      for (const [k, v] of avDir) if (v) mergedAv.set(k, v);
      avatarDirRef.current = mergedAv;
      setAvatarDir(mergedAv);
      // Persist the merged snapshot for an instant next open.
      void writeCache(wallet.publicKey, 'list', {
        items: visible,
        dir: [...dir],
        avatarDir: [...mergedAv],
      } satisfies ListCache);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [wallet, encPub]);

  // Instant open: paint the cached conversation list before the network load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!wallet) return;
      const cache = await readCache<ListCache>(wallet.publicKey, 'list');
      if (cancelled || !cache) return;
      setItems((prev) => (prev.length ? prev : cache.items));
      setWalletDir((prev) => (prev.size ? prev : new Map(cache.dir)));
      setAvatarDir((prev) => (prev.size ? prev : new Map(cache.avatarDir)));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  useFocusEffect(
    useCallback(() => {
      clearUnreadChats();
      void load(true); // silent — the cached list is already on screen
    }, [load])
  );

  // Live-refresh the conversation list when any new message arrives.
  useEffect(() => {
    rougeWs.connect();
    const unsub = rougeWs.subscribe((event) => {
      if (event.type === 'new_message') void load(true); // background refresh
    });
    return unsub;
  }, [load]);

  function convoId(c: Convo) {
    return String(c.conversationId ?? c.conversation_id ?? c.id ?? '');
  }

  function peerKeyFromConvo(c: Convo): string {
    const myPk = wallet?.publicKey ?? '';
    const parts = c.participants ?? [];
    for (const p of parts) {
      const pk = p.publicKey ?? p.signingPublicKey ?? p.signing_public_key ?? p.id ?? '';
      if (pk && pk !== myPk) return pk;
    }
    const partIds = c.participantIds ?? c.participant_ids ?? [];
    for (const pid of partIds) {
      if (pid && pid !== myPk) return pid;
    }
    return '';
  }

  function isGroupConvo(c: Convo): boolean {
    const myPk = wallet?.publicKey ?? '';
    const others = new Set<string>();
    for (const p of c.participants ?? []) {
      const pk = p.publicKey ?? p.signingPublicKey ?? p.signing_public_key ?? p.id ?? '';
      if (pk && pk !== myPk) others.add(pk);
    }
    for (const pid of c.participantIds ?? c.participant_ids ?? []) {
      if (pid && pid !== myPk) others.add(pid);
    }
    return others.size > 1 || Boolean(c.isGroup ?? c.is_group);
  }

  // A request = a 1:1 you didn't start and haven't accepted. Groups are never gated.
  function isRequestConvo(c: Convo): boolean {
    if (isGroupConvo(c)) return false;
    return !accepted.has(convoId(c));
  }

  async function acceptRequest(c: Convo) {
    const id = convoId(c);
    await acceptChat(id);
    setAccepted((prev) => new Set(prev).add(id));
    setTab('primary');
  }

  async function rejectRequest(c: Convo) {
    const peer = peerKeyFromConvo(c);
    if (peer) await blockWallet(peer);
    await load();
  }

  function openChat(c: Convo) {
    const id = convoId(c);
    if (!id) return;
    const peer = peerKeyFromConvo(c);
    if (desktop) {
      // Master–detail: open inline in the right pane instead of navigating.
      setSelected({ id, peer });
      return;
    }
    router.push({
      pathname: '/(tabs)/messenger/[id]',
      params: { id, peer },
    });
  }

  if (!wallet) return null;

  // Only take over the screen with a spinner on the very first load. Once we
  // have data (from cache or a prior load), focus/live refreshes happen quietly
  // underneath so tapping Chats doesn't flash a full-page reload.
  if (loading && items.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const isTrashedConvo = (c: Convo) => trashedMap[convoId(c)] === true;
  const active = items.filter((c) => !isTrashedConvo(c));
  const trashedItems = items.filter(isTrashedConvo);
  const requests = active.filter(isRequestConvo);
  const primary = active.filter((c) => !isRequestConvo(c));
  const shown = tab === 'requests' ? requests : tab === 'trash' ? trashedItems : primary;
  const showTrashTab = trashedItems.length > 0 || tab === 'trash';
  const showTabs = requests.length > 0 || showTrashTab || tab !== 'primary';
  const tabDefs: ('primary' | 'requests' | 'trash')[] = [
    'primary',
    'requests',
    ...(showTrashTab ? (['trash'] as const) : []),
  ];

  const renderRequestRow = (item: Convo) => {
    const peerPk = peerKeyFromConvo(item);
    const name = walletDir.get(peerPk) || (peerPk ? peerPk.slice(0, 10) + '…' : t('mi_unknown'));
    const peerImg = peerPk ? avatarDir.get(peerPk) : undefined;
    return (
      <View style={styles.row}>
        {peerImg ? (
          <Image source={{ uri: peerImg }} style={styles.avatarImg} />
        ) : (
          <View style={styles.avatar}>
            <Ionicons name="person" size={18} color={colors.textTertiary} />
          </View>
        )}
        <View style={styles.rowContent}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.rowPreview} numberOfLines={1}>
            {t('mi_wants_to_message')}
          </Text>
        </View>
        <View style={styles.reqBtns}>
          <Pressable onPress={() => rejectRequest(item)} style={styles.reqDelete}>
            <Text style={styles.reqDeleteText}>{t('mi_delete')}</Text>
          </Pressable>
          <Pressable onPress={() => acceptRequest(item)} style={styles.reqAccept}>
            <Text style={styles.reqAcceptText}>{t('mi_accept')}</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  async function deleteForever(item: Convo) {
    if (!wallet) return;
    const id = convoId(item);
    const ok =
      Platform.OS === 'web'
        ? window.confirm(t('mi_delete_forever_confirm'))
        : await new Promise<boolean>((resolve) =>
            Alert.alert(t('mi_delete_forever'), t('mi_delete_forever_confirm'), [
              { text: t('mid_cancel'), style: 'cancel', onPress: () => resolve(false) },
              { text: t('mi_delete_forever'), style: 'destructive', onPress: () => resolve(true) },
            ]),
          );
    if (!ok) return;
    // This is the real, on-chain delete — only reachable from Trash.
    try {
      await rc.messenger.deleteConversation(wallet, id);
    } catch {
      /* best effort */
    }
    await restoreConvo(id); // drop it from the local trash set too
    void load(true);
  }

  const renderTrashRow = (item: Convo) => {
    const peerPk = peerKeyFromConvo(item);
    const groupName = (item.name ?? item.group_name) as string | undefined;
    const name = groupName || walletDir.get(peerPk) || (peerPk ? peerPk.slice(0, 10) + '…' : t('mi_unknown'));
    const peerImg = peerPk ? avatarDir.get(peerPk) : undefined;
    return (
      <View style={styles.row}>
        {peerImg ? (
          <Image source={{ uri: peerImg }} style={styles.avatarImg} />
        ) : (
          <View style={styles.avatar}>
            <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
          </View>
        )}
        <View style={styles.rowContent}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.rowPreview} numberOfLines={1}>
            {t('mi_in_trash')}
          </Text>
        </View>
        <View style={styles.reqBtns}>
          <Pressable onPress={() => void restoreConvo(convoId(item))} style={styles.reqAccept}>
            <Text style={styles.reqAcceptText}>{t('mi_restore')}</Text>
          </Pressable>
          <Pressable onPress={() => void deleteForever(item)} style={styles.reqDelete}>
            <Text style={styles.reqDeleteText}>{t('mi_delete_forever')}</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const listContent = (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          {myAvatarUrl ? (
            <Image source={{ uri: myAvatarUrl }} style={styles.mascot} />
          ) : (
            <Image source={require('@/assets/images/koala-mascot.png')} style={styles.mascot} />
          )}
          <View>
            <Text style={styles.headerTitle}>QWALLA</Text>
            <Text style={styles.headerSub}>{t('mi_chats')}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable
            onPress={() => router.push('/(tabs)/messenger/blocked')}
            style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.7 }]}
            hitSlop={6}>
            <Ionicons name="ban-outline" size={20} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/(tabs)/messenger/new')}
            style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.7 }]}>
            <Ionicons name="create-outline" size={22} color={colors.accent} />
          </Pressable>
        </View>
      </View>

      {showTabs && (
        <View style={styles.tabs}>
          {tabDefs.map((v) => (
            <Pressable key={v} onPress={() => setTab(v)} style={styles.tabBtn}>
              <Text style={[styles.tabText, tab === v && styles.tabTextActive]}>
                {v === 'primary'
                  ? t('mi_primary')
                  : v === 'requests'
                    ? `${t('mi_requests')}${requests.length > 0 ? ` (${requests.length})` : ''}`
                    : `${t('mi_trash')}${trashedItems.length > 0 ? ` (${trashedItems.length})` : ''}`}
              </Text>
              {tab === v && <View style={styles.tabUnderline} />}
            </Pressable>
          ))}
        </View>
      )}

      {shown.length === 0 ? (
        tab === 'trash' ? (
          <View style={styles.reqEmpty}>
            <Ionicons name="trash-outline" size={40} color={colors.textTertiary} />
            <Text style={styles.reqEmptyText}>{t('mi_trash_empty')}</Text>
            <Text style={styles.reqEmptySub}>{t('mi_trash_empty_sub')}</Text>
          </View>
        ) : tab === 'requests' ? (
          <View style={styles.reqEmpty}>
            <Ionicons name="shield-checkmark-outline" size={40} color={colors.textTertiary} />
            <Text style={styles.reqEmptyText}>{t('mi_no_requests')}</Text>
            <Text style={styles.reqEmptySub}>
              {t('mi_no_requests_sub')}
            </Text>
          </View>
        ) : (
          <EmptyState
            title={t('mi_no_conversations')}
            subtitle={t('mi_start_quantum_chat')}
            mood="wave"
          />
        )
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(c) => convoId(c)}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={load}
          renderItem={({ item }) => {
            if (tab === 'requests') return renderRequestRow(item);
            if (tab === 'trash') return renderTrashRow(item);
            const unread = item.unreadCount ?? item.unread_count ?? 0;
            const last = item.lastMessage ?? item.last_message ?? '';
            const parts = item.participants ?? [];
            const partIds = item.participantIds ?? item.participant_ids ?? [];

            const others = parts.filter((p) => {
              const pk = p.publicKey ?? p.signingPublicKey ?? p.signing_public_key ?? p.id;
              return pk && pk !== wallet?.publicKey;
            });

            const resolveName = (p: Participant): string => {
              if (p.displayName) return p.displayName;
              if (p.display_name) return p.display_name;
              const keys = [p.publicKey, p.signingPublicKey, p.signing_public_key, p.id, p.encryptionPublicKey, p.encryption_public_key];
              for (const k of keys) {
                if (k) {
                  const name = walletDir.get(k);
                  if (name) return name;
                }
              }
              return '';
            };

            const storedName = String(item.name ?? item.group_name ?? item.groupName ?? '').trim();
            const otherCount = others.length || partIds.filter((pid) => pid !== wallet?.publicKey).length;
            const isGroup = otherCount > 1 || Boolean(item.isGroup ?? item.is_group);

            let title: string;
            if (isGroup && storedName) {
              // Prefer an explicit group name when the node stores one.
              title = storedName;
            } else if (others.length > 0) {
              const names = others.map((p) => resolveName(p) || '?');
              title = others.length > 1 ? names.join(', ') : names[0];
            } else if (partIds.length > 0) {
              const otherIds = partIds.filter((pid) => pid !== wallet?.publicKey);
              const names = otherIds.map((pid) => walletDir.get(pid) || pid.slice(0, 8) + '…');
              title = names.join(', ') || t('mi_chat_fallback').replace('{id}', convoId(item).slice(0, 8));
            } else {
              title = t('mi_chat_fallback').replace('{id}', convoId(item).slice(0, 8));
            }
            const peerPk = peerKeyFromConvo(item);
            const peerImg = peerPk ? avatarDir.get(peerPk) : undefined;

            const isSelected = desktop && selected?.id === convoId(item);
            return (
              <SwipeRow label={t('mi_delete')} onDelete={() => void trashConvo(convoId(item))}>
                <Pressable
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: colors.bg },
                    (pressed || isSelected) && { backgroundColor: colors.surface },
                  ]}
                  onPress={() => openChat(item)}>
                  {peerImg ? (
                    <Image source={{ uri: peerImg }} style={styles.avatarImg} />
                  ) : (
                    <View style={styles.avatar}>
                      <Ionicons name={isGroup ? 'people' : 'person'} size={18} color={colors.textTertiary} />
                    </View>
                  )}
                  <View style={styles.rowContent}>
                    <View style={styles.rowTitleLine}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {title}
                      </Text>
                      {mutedMap[convoId(item)] === true && (
                        <Ionicons name="notifications-off" size={13} color={colors.textTertiary} />
                      )}
                    </View>
                    <Text style={styles.rowPreview} numberOfLines={1}>
                      {last || t('mi_open_to_read')}
                    </Text>
                  </View>
                  {unread > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{unread}</Text>
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  )}
                </Pressable>
              </SwipeRow>
            );
          }}
        />
      )}
    </SafeAreaView>
  );

  if (desktop) {
    return (
      <View style={styles.masterDetail}>
        <View style={styles.listPane}>{listContent}</View>
        <View style={styles.detailPane}>
          {selected ? (
            <ChatView
              conversationId={selected.id}
              peer={selected.peer}
              onClose={() => setSelected(null)}
            />
          ) : (
            <View style={styles.detailEmpty}>
              <Ionicons name="chatbubbles-outline" size={48} color={colors.textTertiary} />
              <Text style={styles.detailEmptyText}>{t('mi_select_conversation')}</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  return listContent;
}

const swipeStyles = StyleSheet.create({
  wrap: { position: 'relative' },
  bg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 110,
    backgroundColor: colors.error,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bgText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  masterDetail: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  listPane: {
    width: 340,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
  detailPane: { flex: 1, backgroundColor: colors.bg },
  detailEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  detailEmptyText: { color: colors.textTertiary, fontSize: 14 },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mascot: { width: 32, height: 32, borderRadius: 16 },
  headerTitle: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  newBtn: { padding: spacing.sm },
  list: { paddingHorizontal: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowContent: { flex: 1 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { color: colors.text, fontWeight: '600', fontSize: 15, flexShrink: 1 },
  rowPreview: { color: colors.textSecondary, marginTop: 3, fontSize: 13 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: colors.bg, fontSize: 11, fontWeight: '700' },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: colors.text },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    height: 2,
    width: 56,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  reqBtns: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  reqDelete: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  reqDeleteText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  reqAccept: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  reqAcceptText: { color: colors.bg, fontSize: 12, fontWeight: '700' },
  reqEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: spacing.xl,
  },
  reqEmptyText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  reqEmptySub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
});
