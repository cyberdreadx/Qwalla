import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';
import { getBlockedWallets, unblockWallet } from '@qwalla/core/wallet';
import { rc } from '@/lib/rougechain';
import { useT } from '@/lib/i18n';

export default function BlockedScreen() {
  const { t } = useT();
  const [keys, setKeys] = useState<string[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [blocked, wallets] = await Promise.all([
      getBlockedWallets(),
      rc.messenger.getWallets().catch(() => [] as unknown[]),
    ]);
    const dir = new Map<string, string>();
    for (const w of (Array.isArray(wallets) ? wallets : []) as Record<string, unknown>[]) {
      const name = String(w.displayName ?? w.display_name ?? '');
      if (!name) continue;
      for (const k of [w.id, w.publicKey, w.signingPublicKey, w.signing_public_key]) {
        if (k && typeof k === 'string') dir.set(k, name);
      }
    }
    setNames(dir);
    setKeys(blocked);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function unblock(k: string) {
    await unblockWallet(k);
    setKeys((prev) => prev.filter((x) => x !== k));
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t('mblk_title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : keys.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="shield-checkmark-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>{t('mblk_empty_title')}</Text>
          <Text style={styles.emptySub}>
            {t('mblk_empty_sub')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={keys}
          keyExtractor={(k) => k}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const name = names.get(item) || `${item.slice(0, 10)}…${item.slice(-6)}`;
            return (
              <View style={styles.row}>
                <View style={styles.avatar}>
                  <Ionicons name="person" size={18} color={colors.textTertiary} />
                </View>
                <Text style={styles.name} numberOfLines={1}>
                  {name}
                </Text>
                <Pressable onPress={() => unblock(item)} style={styles.unblock}>
                  <Text style={styles.unblockText}>{t('mblk_unblock')}</Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  back: { padding: 4 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  emptySub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
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
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  unblock: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  unblockText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
});
