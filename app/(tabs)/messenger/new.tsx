import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';
import { pubkeyToAddress } from '@rougechain/sdk';

type RegWallet = {
  publicKey?: string;
  signingPublicKey?: string;
  signing_public_key?: string;
  encryptionPublicKey?: string;
  encryption_public_key?: string;
  encPublicKey?: string;
  displayName?: string;
  display_name?: string;
};

function getPk(w: RegWallet): string {
  return w.publicKey ?? w.signingPublicKey ?? w.signing_public_key ?? '';
}

export default function NewChatScreen() {
  const wallet = useWalletStore((s) => s.wallet);
  const [contacts, setContacts] = useState<RegWallet[]>([]);
  const [addrMap, setAddrMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const w = await rc.messenger.getWallets();
        const list = (Array.isArray(w) ? w : []) as RegWallet[];
        setContacts(list);

        const map: Record<string, string> = {};
        await Promise.all(
          list.map(async (c) => {
            const pk = getPk(c);
            if (!pk) return;
            try {
              map[pk] = await pubkeyToAddress(pk);
            } catch { /* skip */ }
          })
        );
        setAddrMap(map);
      } catch {
        setContacts([]);
      }
    })();
  }, []);

  async function startWith(peer: RegWallet) {
    if (!wallet || busy) return;
    const peerPk = getPk(peer);
    if (!peerPk || peerPk === wallet.publicKey) {
      Alert.alert('Invalid contact');
      return;
    }
    setBusy(true);
    try {
      const result = await rc.messenger.createConversation(wallet, [wallet.publicKey, peerPk]);
      const raw = result.data as Record<string, unknown> | undefined;
      const convo = (raw?.conversation ?? raw) as Record<string, unknown> | undefined;
      const cid =
        (convo?.id as string) ??
        (convo?.conversation_id as string) ??
        (convo?.conversationId as string) ??
        (raw?.conversation_id as string) ??
        (raw?.conversationId as string) ??
        (raw?.id as string) ??
        '';

      if (cid) {
        router.replace({
          pathname: '/(tabs)/messenger/[id]',
          params: { id: cid, peer: peerPk },
        });
        return;
      }

      if (!result.success) {
        Alert.alert('Could not create chat', result.error ?? 'Unknown');
        return;
      }

      router.back();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const filtered = contacts.filter((c) => getPk(c) !== wallet?.publicKey);

  return (
    <SafeAreaView style={styles.safe}>
      <Pressable
        style={({ pressed }) => [styles.groupBtn, pressed && { opacity: 0.7 }]}
        onPress={() => router.push('/(tabs)/messenger/new-group')}>
        <View style={styles.groupIcon}>
          <Ionicons name="people" size={20} color={colors.accent} />
        </View>
        <Text style={styles.groupLabel}>New group chat</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </Pressable>
      <Text style={styles.hint}>
        Or choose someone for a 1-on-1 chat:
      </Text>
      <FlatList
        data={filtered}
        keyExtractor={(c) => getPk(c) || Math.random().toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>No other wallets on the directory yet.</Text>
        }
        renderItem={({ item }) => {
          const pk = getPk(item);
          const addr = addrMap[pk];
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }, busy && { opacity: 0.5 }]}
              onPress={() => startWith(item)}
              disabled={busy}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={16} color={colors.textTertiary} />
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.name}>
                  {item.displayName || item.display_name || 'Anonymous'}
                </Text>
                <Text style={styles.addr} numberOfLines={1}>
                  {addr ? `${addr.slice(0, 14)}…${addr.slice(-6)}` : `${pk.slice(0, 16)}…`}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  hint: { color: colors.textSecondary, padding: spacing.md, lineHeight: 20, fontSize: 14 },
  list: { paddingHorizontal: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowInfo: { flex: 1 },
  name: { color: colors.text, fontWeight: '600', fontSize: 15 },
  addr: { color: colors.accent, fontSize: 12, marginTop: 2, fontFamily: 'SpaceMono', opacity: 0.7 },
  empty: { color: colors.textSecondary, padding: spacing.lg, textAlign: 'center' },
  groupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  groupIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupLabel: { flex: 1, color: colors.text, fontWeight: '600', fontSize: 15 },
});
