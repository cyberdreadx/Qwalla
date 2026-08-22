import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { colors, radius, spacing } from '@/constants/theme';
import { getBlockedWallets } from '@/lib/blocked-users';
import { rc } from '@/lib/rougechain';
import { rougeWs } from '@/lib/ws';
import { useNotificationStore } from '@/stores/notifications';
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
};

type WalletEntry = Record<string, unknown>;

export default function MessengerListScreen() {
  const wallet = useWalletStore((s) => s.wallet);
  const encPub = useWalletStore((s) => s.encPublicKey);
  const myAvatarUrl = useWalletStore((s) => s.avatarUrl);
  const clearUnreadChats = useNotificationStore((s) => s.clearUnreadChats);
  const [items, setItems] = useState<Convo[]>([]);
  const [walletDir, setWalletDir] = useState<Map<string, string>>(new Map());
  const [avatarDir, setAvatarDir] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!wallet || !encPub) return;
    setLoading(true);
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

      const dir = new Map<string, string>();
      const wArr = (Array.isArray(wallets) ? wallets : []) as WalletEntry[];
      for (const w of wArr) {
        const name = String(w.displayName ?? w.display_name ?? '');
        if (!name) continue;
        const keys = [w.id, w.publicKey, w.signingPublicKey, w.signing_public_key, w.encryptionPublicKey, w.encryption_public_key];
        for (const k of keys) {
          if (k && typeof k === 'string') dir.set(k, name);
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
      const lookups = [...peerKeys].slice(0, 20).map(async (pk) => {
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
      setAvatarDir(avDir);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [wallet, encPub]);

  useFocusEffect(
    useCallback(() => {
      clearUnreadChats();
      void load();
    }, [load])
  );

  // Live-refresh the conversation list when any new message arrives.
  useEffect(() => {
    rougeWs.connect();
    const unsub = rougeWs.subscribe((event) => {
      if (event.type === 'new_message') void load();
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

  function openChat(c: Convo) {
    const id = convoId(c);
    if (!id) return;
    const peer = peerKeyFromConvo(c);
    router.push({
      pathname: '/(tabs)/messenger/[id]',
      params: { id, peer },
    });
  }

  if (!wallet) return null;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
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
            <Text style={styles.headerSub}>Chats</Text>
          </View>
        </View>
        <Pressable
          onPress={() => router.push('/(tabs)/messenger/new')}
          style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.7 }]}>
          <Ionicons name="create-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      {items.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          subtitle="Start a quantum-safe chat"
          mood="wave"
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => convoId(c)}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={load}
          renderItem={({ item }) => {
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

            let title: string;
            const isGroup = others.length > 1;
            if (others.length > 0) {
              const names = others.map((p) => resolveName(p) || '?');
              title = isGroup ? names.join(', ') : names[0];
            } else if (partIds.length > 0) {
              const otherIds = partIds.filter((pid) => pid !== wallet?.publicKey);
              const names = otherIds.map((pid) => walletDir.get(pid) || pid.slice(0, 8) + '…');
              title = names.join(', ') || `Chat ${convoId(item).slice(0, 8)}…`;
            } else {
              title = `Chat ${convoId(item).slice(0, 8)}…`;
            }
            const peerPk = peerKeyFromConvo(item);
            const peerImg = peerPk ? avatarDir.get(peerPk) : undefined;

            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
                onPress={() => openChat(item)}>
                {peerImg ? (
                  <Image source={{ uri: peerImg }} style={styles.avatarImg} />
                ) : (
                  <View style={styles.avatar}>
                    <Ionicons name={isGroup ? 'people' : 'person'} size={18} color={colors.textTertiary} />
                  </View>
                )}
                <View style={styles.rowContent}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={styles.rowPreview} numberOfLines={1}>
                    {last || 'Open to read messages'}
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
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
  rowTitle: { color: colors.text, fontWeight: '600', fontSize: 15 },
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
});
