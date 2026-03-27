import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { decryptMailV2 } from '@/lib/encryption';
import { fetchMailInbox, fetchMailSent, fetchMailTrash } from '@/lib/mail-api';
import { reverseLookupName } from '@/lib/names';
import { rc } from '@/lib/rougechain';
import { useNotificationStore } from '@/stores/notifications';
import { useWalletStore } from '@/stores/wallet';

type Folder = 'inbox' | 'sent' | 'trash';

type MailRow = {
  id: string;
  fromWalletId: string;
  toWalletIds: string[];
  senderName: string;
  subject: string;
  subjectEncrypted: string;
  createdAt: string;
  isRead: boolean;
  folder: string;
  replyToId?: string;
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
    subjectEncrypted: String(msg.subjectEncrypted ?? msg.subject_encrypted ?? msg.encrypted_subject ?? msg.encryptedSubject ?? ''),
    createdAt: String(msg.createdAt ?? msg.created_at ?? ''),
    isRead: Boolean(label.isRead ?? label.is_read ?? raw.read ?? true),
    folder: String(label.folder ?? ''),
    replyToId: (msg.replyToId ?? msg.reply_to_id ?? undefined) as string | undefined,
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

type ThreadGroup = {
  rootId: string;
  subject: string;
  subjectEncrypted: string;
  latestRow: MailRow;
  messages: MailRow[];
  participants: string[];
  hasUnread: boolean;
  latestDate: string;
};

function findRootId(row: MailRow, byId: Map<string, MailRow>): string {
  let rootId = row.id;
  let cur = row;
  while (cur.replyToId && byId.has(cur.replyToId)) {
    rootId = cur.replyToId;
    cur = byId.get(cur.replyToId)!;
  }
  return rootId;
}

function groupByThread(rows: MailRow[]): ThreadGroup[] {
  const byId = new Map<string, MailRow>();
  for (const r of rows) byId.set(r.id, r);

  const groups = new Map<string, MailRow[]>();
  for (const r of rows) {
    const rootId = findRootId(r, byId);
    const arr = groups.get(rootId) || [];
    arr.push(r);
    groups.set(rootId, arr);
  }

  const result: ThreadGroup[] = [];
  for (const [rootId, msgs] of groups) {
    msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const latest = msgs[msgs.length - 1];
    const root = byId.get(rootId);
    const subject = root?.subject || latest.subject || '';
    const subjectEncrypted = root?.subjectEncrypted || latest.subjectEncrypted || '';
    const participantSet = new Set<string>();
    for (const m of msgs) {
      const name = m.senderName || m.fromWalletId;
      if (name) participantSet.add(name);
    }
    result.push({
      rootId,
      subject,
      subjectEncrypted,
      latestRow: latest,
      messages: msgs,
      participants: [...participantSet],
      hasUnread: msgs.some(m => !m.isRead),
      latestDate: latest.createdAt,
    });
  }

  result.sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());
  return result;
}

async function resolveDisplayName(walletId: string): Promise<string | null> {
  if (!walletId) return null;
  try {
    const mailName = await reverseLookupName(walletId);
    if (mailName) return `${mailName}@qwalla.mail`;
  } catch { /* ignore */ }
  try {
    const wallets = await rc.messenger.getWallets();
    const list = (Array.isArray(wallets) ? wallets : []) as Record<string, unknown>[];
    const match = list.find((w) => {
      const keys = [
        w.id, w.publicKey, w.signingPublicKey, w.signing_public_key,
        w.encryptionPublicKey, w.encryption_public_key,
      ];
      return keys.some((k) => typeof k === 'string' && k === walletId);
    });
    if (match) {
      const dn = String(match.displayName ?? match.display_name ?? '');
      if (dn) return dn;
    }
  } catch { /* ignore */ }
  return null;
}

export default function MailHomeScreen() {
  const wallet = useWalletStore((s) => s.wallet);
  const encPriv = useWalletStore((s) => s.encPrivateKey);
  const encPub = useWalletStore((s) => s.encPublicKey);
  const clearUnreadMail = useNotificationStore((s) => s.clearUnreadMail);
  const [tab, setTab] = useState<Folder>('inbox');
  const [rows, setRows] = useState<MailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameCache, setNameCache] = useState<Record<string, string>>({});
  const [subjectCache, setSubjectCache] = useState<Record<string, string>>({});
  const nameCacheRef = useRef(nameCache);
  nameCacheRef.current = nameCache;
  const subjectCacheRef = useRef(subjectCache);
  subjectCacheRef.current = subjectCache;

  const load = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    setSubjectCache({});
    try {
      let data: Record<string, unknown>[] = [];
      if (tab === 'inbox') data = await fetchMailInbox(wallet);
      else if (tab === 'sent') data = await fetchMailSent(wallet);
      else data = await fetchMailTrash(wallet);
      setRows(data.map(normalizeRow));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [wallet, tab]);

  useEffect(() => {
    const walletIds = new Set<string>();
    for (const r of rows) {
      if (tab === 'sent') {
        for (const to of r.toWalletIds) {
          if (to && !nameCacheRef.current[to]) walletIds.add(to);
        }
      } else {
        if (r.fromWalletId && !r.senderName && !nameCacheRef.current[r.fromWalletId])
          walletIds.add(r.fromWalletId);
      }
    }
    if (walletIds.size === 0) return;
    for (const wid of walletIds) {
      void resolveDisplayName(wid).then((name) => {
        if (name) setNameCache((prev) => ({ ...prev, [wid]: name }));
      });
    }
  }, [rows, tab]);

  useEffect(() => {
    if (!encPriv || !encPub) return;
    for (const r of rows) {
      if (r.subjectEncrypted && !r.subject && !subjectCacheRef.current[r.id]) {
        try {
          const dec = decryptMailV2(r.subjectEncrypted, encPriv, encPub);
          if (dec && !dec.startsWith('[Unable')) {
            setSubjectCache((prev) => ({ ...prev, [r.id]: dec }));
          }
        } catch { /* ignore */ }
      }
    }
  }, [rows, encPriv, encPub]);

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

      {(() => {
        const threads = groupByThread(rows);
        const isSent = tab === 'sent';

        if (loading) {
          return (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          );
        }
        if (threads.length === 0) {
          return <EmptyState title="No mail" subtitle="Send encrypted mail with ML-KEM." mood="sleep" />;
        }
        return (
          <FlatList
            data={threads}
            keyExtractor={(t) => t.rootId}
            contentContainerStyle={styles.list}
            refreshing={loading}
            onRefresh={load}
            renderItem={({ item: thread }) => {
              const latest = thread.latestRow;
              const participantLabels = thread.participants.map(p => {
                if (nameCache[p]) return nameCache[p];
                if (p.length > 20) return p.slice(0, 12) + '…';
                return p;
              });
              let peerLabel: string;
              if (isSent) {
                const toId = latest.toWalletIds[0] ?? '';
                peerLabel = nameCache[toId] || (toId ? toId.slice(0, 12) + '…' : '…');
              } else {
                peerLabel = participantLabels.join(', ') || '…';
              }
              const dateStr = formatDate(thread.latestDate);
              const subjectDisplay = thread.subject || subjectCache[thread.rootId] || subjectCache[latest.id] || '(encrypted)';

              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/mail/[id]',
                      params: { id: latest.id, folder: tab },
                    })
                  }>
                  <View style={styles.mailIcon}>
                    <Ionicons
                      name={thread.hasUnread ? 'mail-unread' : 'mail-open-outline'}
                      size={18}
                      color={thread.hasUnread ? colors.accent : colors.textTertiary}
                    />
                  </View>
                  <View style={styles.rowContent}>
                    <View style={styles.rowTopLine}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 4 }}>
                        <Text style={[styles.rowSender, thread.hasUnread && styles.rowUnread]} numberOfLines={1}>
                          {isSent ? `To: ${peerLabel}` : peerLabel}
                        </Text>
                        {thread.messages.length > 1 && (
                          <Text style={styles.threadCount}>({thread.messages.length})</Text>
                        )}
                      </View>
                      {dateStr ? <Text style={styles.rowDate}>{dateStr}</Text> : null}
                    </View>
                    <Text style={styles.rowSubject} numberOfLines={1}>
                      {subjectDisplay}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </Pressable>
              );
            }}
          />
        );
      })()}
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
  threadCount: { color: colors.textTertiary, fontSize: 11, fontWeight: '500' },
});
