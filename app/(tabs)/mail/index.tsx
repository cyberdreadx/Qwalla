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
import { groupByThread, normalizeRow, type MailRow } from '@/lib/mail-thread';
import { readCache, writeCache } from '@/lib/message-cache';
import { reverseLookupName } from '@/lib/names';
import { WalletAvatar } from '@/components/WalletAvatar';
import { rc } from '@/lib/rougechain';
import { useNotificationStore } from '@/stores/notifications';
import { useWalletStore } from '@/stores/wallet';
import { useT } from '@/lib/i18n';

type Folder = 'inbox' | 'sent' | 'trash';

// Encrypted-at-rest snapshot of a mail folder for instant open (subjects are
// sensitive, so this rides the same encrypted cache as messages).
type MailCache = {
  rows: MailRow[];
  names: Record<string, string>;
  subjects: Record<string, string>;
};

const folderTabs: { key: Folder; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'inbox', icon: 'mail' },
  { key: 'sent', icon: 'send' },
  { key: 'trash', icon: 'trash' },
];

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
  const { t } = useT();
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
    try {
      let data: Record<string, unknown>[] = [];
      if (tab === 'inbox') data = await fetchMailInbox(wallet);
      else if (tab === 'sent') data = await fetchMailSent(wallet);
      else data = await fetchMailTrash(wallet);
      setRows(data.map(normalizeRow));
    } catch {
      /* keep whatever's shown (cached) on a failed refresh */
    } finally {
      setLoading(false);
    }
  }, [wallet, tab]);

  // Cache-first: paint the last-known folder instantly, then load() refreshes.
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    void (async () => {
      const c = await readCache<MailCache>(wallet.publicKey, `mail_${tab}`);
      if (cancelled) return;
      if (c) {
        setRows(c.rows ?? []);
        if (c.names) setNameCache((p) => ({ ...c.names, ...p }));
        if (c.subjects) setSubjectCache((p) => ({ ...c.subjects, ...p }));
        setLoading(false);
      } else {
        setLoading(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, tab]);

  // Persist the folder snapshot (rows + resolved names/subjects) once loaded.
  useEffect(() => {
    if (loading || !wallet) return;
    void writeCache(wallet.publicKey, `mail_${tab}`, {
      rows,
      names: nameCache,
      subjects: subjectCache,
    } satisfies MailCache);
  }, [loading, wallet, tab, rows, nameCache, subjectCache]);

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
            <Text style={styles.headerSub}>{t('mail_header_sub')}</Text>
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
              {t('mail_tab_' + f.key)}
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
          return <EmptyState title={t('mail_empty_title')} subtitle={t('mail_empty_sub')} mood="sleep" />;
        }
        return (
          <FlatList
            data={threads}
            keyExtractor={(v) => v.rootId}
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
              const subjectDisplay = thread.subject || subjectCache[thread.rootId] || subjectCache[latest.id] || t('mail_encrypted');
              const peerId = isSent ? (latest.toWalletIds[0] ?? '') : (latest.fromWalletId ?? '');

              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/mail/[id]',
                      params: { id: latest.id, folder: tab },
                    })
                  }>
                  <View style={styles.mailAvatarWrap}>
                    <WalletAvatar id={peerId} name={peerLabel} size={38} />
                    {thread.hasUnread && <View style={styles.unreadDot} />}
                  </View>
                  <View style={styles.rowContent}>
                    <View style={styles.rowTopLine}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 4 }}>
                        <Text style={[styles.rowSender, thread.hasUnread && styles.rowUnread]} numberOfLines={1}>
                          {isSent ? t('mail_to_prefix').replace('{name}', peerLabel) : peerLabel}
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
  mailAvatarWrap: { position: 'relative' },
  unreadDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  rowContent: { flex: 1 },
  rowTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowSender: { color: colors.text, fontSize: 14, fontWeight: '500', flex: 1 },
  rowUnread: { fontWeight: '700' },
  rowDate: { color: colors.textTertiary, fontSize: 11, marginLeft: 8 },
  rowSubject: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  threadCount: { color: colors.textTertiary, fontSize: 11, fontWeight: '500' },
});
