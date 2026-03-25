import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
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
import { fetchMailInbox, fetchMailSent, fetchMailTrash } from '@/lib/mail-api';
import { useNotificationStore } from '@/stores/notifications';
import { useWalletStore } from '@/stores/wallet';

type Folder = 'inbox' | 'sent' | 'trash';

type MailRow = {
  id: string;
  fromWalletId: string;
  toWalletIds: string[];
  senderName: string;
  subject: string;
  createdAt: string;
  isRead: boolean;
  folder: string;
};

const folderTabs: { key: Folder; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'inbox', icon: 'mail' },
  { key: 'sent', icon: 'send' },
  { key: 'trash', icon: 'trash' },
];

function normalizeRow(raw: Record<string, unknown>): MailRow {
  const msg = (raw.message ?? raw) as Record<string, unknown>;
  const label = (raw.label ?? {}) as Record<string, unknown>;

  return {
    id: String(msg.id ?? raw.id ?? ''),
    fromWalletId: String(msg.fromWalletId ?? msg.from_wallet_id ?? msg.from ?? ''),
    toWalletIds: (msg.toWalletIds ?? msg.to_wallet_ids ?? [msg.to]) as string[],
    senderName: String(msg.senderName ?? msg.sender_name ?? ''),
    subject: String(msg.subject ?? ''),
    createdAt: String(msg.createdAt ?? msg.created_at ?? ''),
    isRead: Boolean(label.isRead ?? label.is_read ?? raw.read ?? true),
    folder: String(label.folder ?? ''),
  };
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function MailHomeScreen() {
  const wallet = useWalletStore((s) => s.wallet);
  const clearUnreadMail = useNotificationStore((s) => s.clearUnreadMail);
  const [tab, setTab] = useState<Folder>('inbox');
  const [rows, setRows] = useState<MailRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      let data: Record<string, unknown>[] = [];
      if (tab === 'inbox') data = await fetchMailInbox(wallet.publicKey);
      else if (tab === 'sent') data = await fetchMailSent(wallet.publicKey);
      else data = await fetchMailTrash(wallet.publicKey);
      setRows(data.map(normalizeRow));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [wallet, tab]);

  useFocusEffect(
    useCallback(() => {
      clearUnreadMail();
      void load();
    }, [load])
  );

  if (!wallet) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image source={require('@/assets/images/koala-mascot.png')} style={styles.mascot} />
          <View>
            <Text style={styles.headerTitle}>QWALLA</Text>
            <Text style={styles.headerSub}>Mail</Text>
          </View>
        </View>
        <Pressable
          onPress={() => router.push('/(tabs)/mail/compose')}
          style={({ pressed }) => [styles.composeBtn, pressed && { opacity: 0.7 }]}>
          <Ionicons name="create-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {folderTabs.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setTab(f.key)}
            style={[styles.tab, tab === f.key && styles.tabActive]}>
            <Ionicons
              name={f.icon}
              size={16}
              color={tab === f.key ? colors.accent : colors.textTertiary}
            />
            <Text style={[styles.tabLabel, tab === f.key && styles.tabLabelActive]}>
              {f.key}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : rows.length === 0 ? (
        <EmptyState title="No mail" subtitle="Send encrypted mail with ML-KEM." mood="sleep" />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id || String(Math.random())}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={load}
          renderItem={({ item }) => {
            const isSent = tab === 'sent';
            const peerLabel = isSent
              ? (item.toWalletIds[0]?.slice(0, 12) + '…' || '…')
              : (item.senderName || item.fromWalletId.slice(0, 12) + '…');
            const dateStr = formatDate(item.createdAt);

            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/mail/[id]',
                    params: { id: item.id, folder: tab },
                  })
                }>
                <View style={styles.mailIcon}>
                  <Ionicons
                    name={!item.isRead ? 'mail-unread' : 'mail-open-outline'}
                    size={18}
                    color={!item.isRead ? colors.accent : colors.textTertiary}
                  />
                </View>
                <View style={styles.rowContent}>
                  <View style={styles.rowTopLine}>
                    <Text style={[styles.rowSender, !item.isRead && styles.rowUnread]} numberOfLines={1}>
                      {isSent ? `To: ${peerLabel}` : peerLabel}
                    </Text>
                    {dateStr ? <Text style={styles.rowDate}>{dateStr}</Text> : null}
                  </View>
                  <Text style={styles.rowSubject} numberOfLines={1}>
                    {item.subject || '(encrypted)'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  composeBtn: { padding: spacing.sm },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 3,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: radius.sm,
  },
  tabActive: { backgroundColor: colors.chrome },
  tabLabel: { color: colors.textTertiary, fontWeight: '600', fontSize: 12, textTransform: 'capitalize' },
  tabLabelActive: { color: colors.accent },
  list: { paddingHorizontal: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mailIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowContent: { flex: 1 },
  rowTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowSender: { color: colors.text, fontSize: 14, fontWeight: '500', flex: 1 },
  rowUnread: { fontWeight: '700' },
  rowDate: { color: colors.textTertiary, fontSize: 11, marginLeft: 8 },
  rowSubject: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
});
