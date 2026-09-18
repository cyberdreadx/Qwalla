import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WalletAvatar } from '@/components/WalletAvatar';
import { colors, radius, spacing } from '@/constants/theme';
import { decryptMailV2, decryptMessage } from '@/lib/encryption';
import { fetchMailMessage } from '@/lib/mail-api';
import { fetchThread, normalizeRow, type MailRow } from '@/lib/mail-thread';
import { reverseLookupName } from '@/lib/names';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';

function formatFullDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

async function resolveDisplayName(walletId: string): Promise<string> {
  if (!walletId) return '(unknown)';
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
  return walletId.slice(0, 20) + '…';
}

interface MailAttachment {
  name: string;
  type: string;
  data: string;
  size: number;
}

/** One decrypted message in the conversation. */
interface ThreadMessage {
  id: string;
  fromWalletId: string;
  toWalletIds: string[];
  fromName: string;
  isMine: boolean;
  dateStr: string;
  body: string;
  attachment: MailAttachment | null;
}

export default function MailDetailScreen() {
  const { id, folder } = useLocalSearchParams<{ id: string; folder?: string }>();
  const wallet = useWalletStore((s) => s.wallet);
  const encPriv = useWalletStore((s) => s.encPrivateKey);
  const encPub = useWalletStore((s) => s.encPublicKey);

  const [subject, setSubject] = useState('');
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      if (!wallet || !id || !encPriv || !encPub) return;
      setLoading(true);
      try {
        // Reconstruct the whole back-and-forth. Falls back to the single opened
        // message if the thread can't be assembled (e.g. opened straight from a
        // deep link before folders are cached).
        let rows: MailRow[] = await fetchThread(wallet, String(id));
        if (rows.length === 0) {
          let raw: Record<string, unknown>;
          try {
            raw = await fetchMailMessage(wallet, String(id));
          } catch {
            raw = (await rc.mail.getMessage(wallet, String(id))) as Record<string, unknown>;
          }
          rows = [normalizeRow(raw)];
        }

        const me = wallet.publicKey;

        const decodeField = (enc: string, mine: boolean): string => {
          if (!enc) return '';
          try {
            return decryptMailV2(enc, encPriv, encPub);
          } catch {
            try {
              return decryptMessage(enc, encPriv, mine);
            } catch {
              return '[Unable to decrypt]';
            }
          }
        };

        const decoded: ThreadMessage[] = rows.map((r) => {
          const isMine = r.fromWalletId === me;
          let attachment: MailAttachment | null = null;
          if (r.hasAttachment && r.attachmentEncrypted) {
            try {
              attachment = JSON.parse(decodeField(r.attachmentEncrypted, isMine)) as MailAttachment;
            } catch { /* leave null */ }
          }
          // Prefer the encrypted body; fall back to a legacy single-blob payload
          // (which may be JSON {subject,body}), then to a plaintext body.
          let body = '';
          if (r.bodyEncrypted) {
            body = decodeField(r.bodyEncrypted, isMine);
          } else if (r.encrypted) {
            const dec = decodeField(r.encrypted, isMine);
            try {
              const j = JSON.parse(dec) as { body?: string };
              body = j.body ?? dec;
            } catch {
              body = dec;
            }
          } else {
            body = r.body;
          }
          return {
            id: r.id,
            fromWalletId: r.fromWalletId,
            toWalletIds: r.toWalletIds,
            fromName: r.senderName || '',
            isMine,
            dateStr: formatFullDate(r.createdAt),
            body,
            attachment,
          };
        });

        // Thread subject comes from the root (first) message.
        const rootRow = rows[0];
        const subj = rootRow.subjectEncrypted
          ? decodeField(rootRow.subjectEncrypted, rootRow.fromWalletId === me)
          : rootRow.subject;
        setSubject(subj || '(no subject)');
        setMessages(decoded);
        // Collapse everything except the newest message by default.
        setExpanded(new Set(decoded.length ? [decoded[decoded.length - 1].id] : []));

        // Resolve sender names for any message that didn't ship one inline.
        decoded.forEach((m, idx) => {
          if (m.fromName) return;
          const label = m.isMine ? 'You' : null;
          if (label) {
            setMessages((prev) => prev.map((x, i) => (i === idx ? { ...x, fromName: label } : x)));
            return;
          }
          void resolveDisplayName(m.fromWalletId).then((name) =>
            setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, fromName: name } : x))),
          );
        });

        // Mark every unread message in the thread as read.
        for (const r of rows) {
          if (!r.isRead) void rc.mail.markRead(wallet, r.id).catch(() => {});
        }
      } catch (e) {
        Alert.alert('Mail', e instanceof Error ? e.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [wallet, id, encPriv, encPub]);

  function toggle(msgId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }

  /** Reply threads under the latest message so the conversation stays linked. */
  function onReply() {
    const latest = messages[messages.length - 1];
    if (!latest) return;
    // Answer whoever we were last talking to (the other party of the newest message).
    const peerId = latest.isMine ? latest.toWalletIds[0] : latest.fromWalletId;
    const peerName = latest.isMine ? '' : latest.fromName;
    router.push({
      pathname: '/(tabs)/mail/compose',
      params: {
        replyTo: peerName || peerId || '',
        replyToId: latest.id,
        replySubject: subject.startsWith('Re: ') ? subject : `Re: ${subject}`,
      },
    });
  }

  function onForward() {
    const latest = messages[messages.length - 1];
    if (!latest) return;
    router.push({
      pathname: '/(tabs)/mail/compose',
      params: {
        forwardSubject: subject.startsWith('Fwd: ') ? subject : `Fwd: ${subject}`,
        forwardBody: `\n\n--- Forwarded message ---\nFrom: ${latest.fromName}\nDate: ${latest.dateStr}\nSubject: ${subject}\n\n${latest.body}`,
      },
    });
  }

  async function toTrash() {
    if (!id || !wallet) return;
    try {
      const r = await rc.mail.move(wallet, String(id), 'trash');
      if (r.success) {
        router.replace('/(tabs)/mail');
      } else {
        if (Platform.OS === 'web') window.alert(r.error ?? 'Move failed');
        else Alert.alert('Move failed', r.error ?? '');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }

  async function saveAttachment(attachment: MailAttachment) {
    if (Platform.OS === 'web') {
      const link = document.createElement('a');
      link.href = `data:${attachment.type};base64,${attachment.data}`;
      link.download = attachment.name;
      link.click();
      return;
    }
    try {
      const fileUri = FileSystem.cacheDirectory + attachment.name;
      await FileSystem.writeAsStringAsync(fileUri, attachment.data, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(fileUri);
      else Alert.alert('Saved', `File saved to cache: ${attachment.name}`);
    } catch {
      Alert.alert('Error', 'Could not save attachment');
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.decrypting}>Decrypting…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Pressable
        onPress={() => router.replace('/(tabs)/mail')}
        style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}>
        <Ionicons name="arrow-back" size={20} color={colors.text} />
        <Text style={styles.backLabel}>Mail</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.pad}>
        <Text style={styles.subj}>{subject || '(no subject)'}</Text>
        {messages.length > 1 && (
          <Text style={styles.count}>{messages.length} messages</Text>
        )}

        <View style={styles.encBadge}>
          <Ionicons name="lock-closed" size={12} color={colors.accent} />
          <Text style={styles.encLabel}>ML-KEM-768 + ML-DSA-65</Text>
        </View>

        {messages.map((m, idx) => {
          const isOpen = expanded.has(m.id);
          const isLast = idx === messages.length - 1;
          return (
            <View key={m.id} style={[styles.msgCard, isLast && styles.msgCardLast]}>
              <Pressable
                onPress={() => toggle(m.id)}
                style={({ pressed }) => [styles.msgHeader, pressed && { opacity: 0.7 }]}>
                <WalletAvatar id={m.fromWalletId} name={m.fromName || m.fromWalletId} size={34} />
                <View style={styles.msgHeaderText}>
                  <View style={styles.msgHeaderTop}>
                    <Text style={styles.msgFrom} numberOfLines={1}>
                      {m.isMine ? 'You' : (m.fromName || '…')}
                    </Text>
                    <Text style={styles.msgDate}>{m.dateStr}</Text>
                  </View>
                  {isOpen ? (
                    <Text style={styles.msgTo} numberOfLines={1}>
                      {m.isMine ? 'to recipient' : 'to you'}
                    </Text>
                  ) : (
                    <Text style={styles.msgSnippet} numberOfLines={1}>
                      {m.body}
                    </Text>
                  )}
                </View>
                <Ionicons
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textTertiary}
                />
              </Pressable>

              {isOpen && (
                <View style={styles.msgBodyWrap}>
                  <Text style={styles.body}>{m.body}</Text>
                  {m.attachment && (
                    <View style={styles.attachCard}>
                      <View style={styles.attachHeader}>
                        <Ionicons name="attach" size={16} color={colors.accent} />
                        <Text style={styles.attachName} numberOfLines={1}>{m.attachment.name}</Text>
                        <Text style={styles.attachSize}>{(m.attachment.size / 1024).toFixed(1)} KB</Text>
                        <Pressable
                          onPress={() => m.attachment && saveAttachment(m.attachment)}
                          style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.7 }]}>
                          <Ionicons name="download-outline" size={14} color={colors.accent} />
                        </Pressable>
                      </View>
                      {m.attachment.type.startsWith('image/') && (
                        <Image
                          source={{ uri: `data:${m.attachment.type};base64,${m.attachment.data}` }}
                          style={styles.attachImage}
                          resizeMode="contain"
                        />
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })}

        <View style={styles.actionRow}>
          <Pressable
            onPress={onReply}
            style={({ pressed }) => [styles.actionBtn, styles.replyBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="return-up-back" size={18} color={colors.accent} />
            <Text style={styles.replyText}>Reply</Text>
          </Pressable>

          <Pressable
            onPress={onForward}
            style={({ pressed }) => [styles.actionBtn, styles.fwdBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="arrow-redo" size={18} color={colors.text} />
            <Text style={styles.fwdText}>Forward</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={toTrash}
          style={({ pressed }) => [styles.trashBtn, pressed && { opacity: 0.8 }]}>
          <Ionicons name="trash-outline" size={18} color={colors.error} />
          <Text style={styles.trashText}>Move to trash</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  decrypting: { color: colors.textSecondary, fontSize: 14 },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  pad: { padding: spacing.lg, paddingBottom: 40 },
  subj: { color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: 2 },
  count: { color: colors.textTertiary, fontSize: 12, marginBottom: spacing.md },
  encBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: spacing.md,
  },
  encLabel: { color: colors.accent, fontSize: 11, fontWeight: '500' },
  msgCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  msgCardLast: {
    borderColor: 'rgba(0, 206, 182, 0.25)',
  },
  msgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  msgHeaderText: { flex: 1 },
  msgHeaderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  msgFrom: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  msgDate: { color: colors.textTertiary, fontSize: 11 },
  msgTo: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  msgSnippet: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  msgBodyWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  body: { color: colors.textSecondary, fontSize: 16, lineHeight: 24 },
  attachCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  attachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  attachName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  attachSize: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  downloadBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachImage: {
    width: '100%',
    height: 200,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  replyBtn: {
    backgroundColor: 'rgba(0, 206, 182, 0.08)',
    borderColor: 'rgba(0, 206, 182, 0.25)',
  },
  replyText: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  fwdBtn: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  fwdText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  trashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 107, 107, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.2)',
  },
  trashText: { color: colors.error, fontWeight: '600', fontSize: 14 },
});
