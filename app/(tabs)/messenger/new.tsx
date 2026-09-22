import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';
import { WalletAvatar } from '@/components/WalletAvatar';
import { rc } from '@/lib/rougechain';
import { acceptChat } from '@/lib/message-requests';
import { useWalletStore } from '@/stores/wallet';
import { nativePubkeyToAddress } from '@/lib/address';
import { useT } from '@/lib/i18n';

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
  const { t } = useT();
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
              map[pk] = nativePubkeyToAddress(pk);
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
      Alert.alert(t('mnew_invalid_contact'));
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
        // You started this chat — auto-accept so it lands in Primary, not Requests.
        await acceptChat(cid);
        router.replace({
          pathname: '/(tabs)/messenger/[id]',
          params: { id: cid, peer: peerPk },
        });
        return;
      }

      if (!result.success) {
        Alert.alert(t('mnew_could_not_create_title'), result.error ?? t('mnew_unknown'));
        return;
      }

      router.back();
    } catch (e) {
      Alert.alert(t('mnew_error_title'), e instanceof Error ? e.message : t('mnew_failed'));
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
        <Text style={styles.groupLabel}>{t('mnew_new_group_chat')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </Pressable>
      <Text style={styles.hint}>
        {t('mnew_choose_1on1')}
      </Text>
      <FlatList
        data={filtered}
        keyExtractor={(c) => getPk(c) || Math.random().toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>{t('mnew_no_wallets')}</Text>
        }
        renderItem={({ item }) => {
          const pk = getPk(item);
          const addr = addrMap[pk];
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }, busy && { opacity: 0.5 }]}
              onPress={() => startWith(item)}
              disabled={busy}>
              <WalletAvatar
                id={pk}
                name={String(item.displayName || item.display_name || '')}
                size={38}
              />
              <View style={styles.rowInfo}>
                <Text style={styles.name}>
                  {item.displayName || item.display_name || t('mnew_anonymous')}
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
