import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Alert, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';
import { decryptMailV2, decryptMessage } from '@/lib/encryption';
import { fetchMailMessage } from '@/lib/mail-api';
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

export default function MailDetailScreen() {
  const { id, folder } = useLocalSearchParams<{ id: string; folder?: string }>();
  const wallet = useWalletStore((s) => s.wallet);
  const encPriv = useWalletStore((s) => s.encPrivateKey);
  const encPub = useWalletStore((s) => s.encPublicKey);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fromName, setFromName] = useState('');
  const [toName, setToName] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [fromWalletId, setFromWalletId] = useState('');
  const [toWalletIds, setToWalletIds] = useState<string[]>([]);
  const [attachmentData, setAttachmentData] = useState<MailAttachment | null>(null);
  const [loading, setLoading] = useState(true);

  const isSent = folder === 'sent';

  useEffect(() => {
    void (async () => {
      if (!wallet || !id || !encPriv || !encPub) return;
      setLoading(true);
      try {
        let raw: Record<string, unknown>;
        try {
          raw = await fetchMailMessage(wallet, String(id));
        } catch {
          raw = (await rc.mail.getMessage(wallet, String(id))) as Record<string, unknown>;
        }

        const msg = (raw.message ?? raw) as Record<string, unknown>;

        const fwid = String(msg.fromWalletId ?? msg.from_wallet_id ?? msg.from ?? '');
        const twids = ((msg.toWalletIds ?? msg.to_wallet_ids ?? [msg.to]) as string[]).filter(Boolean);
        setFromWalletId(fwid);
        setToWalletIds(twids);

        const ts = String(msg.createdAt ?? msg.created_at ?? '');
        setDateStr(formatFullDate(ts));

        const inlineName = String(msg.senderName ?? msg.sender_name ?? '');
        if (inlineName) {
          setFromName(inlineName);
        } else {
          void resolveDisplayName(fwid).then(setFromName);
        }
        if (twids.length > 0) {
          void resolveDisplayName(twids[0]).then(setToName);
        }

        const subEnc = String(msg.subjectEncrypted ?? msg.subject_encrypted ?? msg.encrypted_subject ?? msg.encryptedSubject ?? '');
        const bodyEnc = String(msg.bodyEncrypted ?? msg.body_encrypted ?? msg.encrypted_body ?? msg.encryptedBody ?? '');
        const fallback = String(msg.encrypted ?? '');

        if (subEnc) {
          try {
            setSubject(decryptMailV2(subEnc, encPriv, encPub));
          } catch {
            try {
              setSubject(decryptMessage(subEnc, encPriv, isSent));
            } catch {
              setSubject('[Unable to decrypt subject]');
            }
          }
        } else {
          setSubject(String(msg.subject ?? ''));
        }

        if (bodyEnc) {
          try {
            setBody(decryptMailV2(bodyEnc, encPriv, encPub));
          } catch {
            try {
              setBody(decryptMessage(bodyEnc, encPriv, isSent));
            } catch {
              setBody('[Unable to decrypt body]');
            }
          }
        } else if (fallback) {
          try {
            const dec = decryptMailV2(fallback, encPriv, encPub);
            try {
              const j = JSON.parse(dec) as { subject?: string; body?: string };
              if (j.subject && !subEnc) setSubject(j.subject);
              setBody(j.body ?? dec);
            } catch {
              setBody(dec);
            }
          } catch {
            try {
              const dec2 = decryptMessage(fallback, encPriv, isSent);
              setBody(dec2);
            } catch {
              setBody('[Unable to decrypt]');
            }
          }
        } else {
          setBody(String(msg.body ?? ''));
        }

        // Decrypt attachment if present
        const hasAttach = msg.hasAttachment || msg.has_attachment;
        const attachEnc = String(msg.attachmentEncrypted ?? msg.attachment_encrypted ?? '');
        if (hasAttach && attachEnc) {
          try {
            const attachPlain = decryptMailV2(attachEnc, encPriv, encPub);
            const parsed = JSON.parse(attachPlain) as MailAttachment;
            setAttachmentData(parsed);
          } catch {
            try {
              const attachPlain2 = decryptMessage(attachEnc, encPriv, isSent);
              const parsed2 = JSON.parse(attachPlain2) as MailAttachment;
              setAttachmentData(parsed2);
            } catch {
              /* could not decrypt attachment */
            }
          }
        }
      } catch (e) {
        Alert.alert('Mail', e instanceof Error ? e.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [wallet, id, encPriv, encPub, isSent]);

  useEffect(() => {
    if (id && wallet) void rc.mail.markRead(wallet, String(id));
  }, [id, wallet]);

  function onReply() {
    const replyTo = isSent ? toWalletIds[0] : fromWalletId;
    const replyName = isSent ? toName : fromName;
    router.push({
      pathname: '/(tabs)/mail/compose',
      params: {
        replyTo: replyName || replyTo || '',
        replySubject: subject.startsWith('Re: ') ? subject : `Re: ${subject}`,
      },
    });
  }

  function onForward() {
    router.push({
      pathname: '/(tabs)/mail/compose',
      params: {
        forwardSubject: subject.startsWith('Fwd: ') ? subject : `Fwd: ${subject}`,
        forwardBody: `\n\n--- Forwarded message ---\nFrom: ${fromName}\nDate: ${dateStr}\nSubject: ${subject}\n\n${body}`,
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

        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>From</Text>
            <Text style={styles.metaValue} numberOfLines={1}>{fromName || '…'}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>To</Text>
            <Text style={styles.metaValue} numberOfLines={1}>{toName || '…'}</Text>
          </View>
          {dateStr ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date</Text>
              <Text style={styles.metaValue}>{dateStr}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.encBadge}>
          <Ionicons name="lock-closed" size={12} color={colors.accent} />
          <Text style={styles.encLabel}>ML-KEM-768 + ML-DSA-65</Text>
        </View>

        <Text style={styles.body}>{body}</Text>

        {attachmentData && (
          <View style={styles.attachCard}>
            <View style={styles.attachHeader}>
              <Ionicons name="attach" size={16} color={colors.accent} />
              <Text style={styles.attachName} numberOfLines={1}>{attachmentData.name}</Text>
              <Text style={styles.attachSize}>{(attachmentData.size / 1024).toFixed(1)} KB</Text>
              {Platform.OS === 'web' ? (
                <Pressable
                  onPress={() => {
                    const link = document.createElement('a');
                    link.href = `data:${attachmentData.type};base64,${attachmentData.data}`;
                    link.download = attachmentData.name;
                    link.click();
                  }}
                  style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.7 }]}>
                  <Ionicons name="download-outline" size={14} color={colors.accent} />
                </Pressable>
              ) : (
                <Pressable
                  onPress={async () => {
                    try {
                      const fileUri = FileSystem.cacheDirectory + attachmentData.name;
                      await FileSystem.writeAsStringAsync(fileUri, attachmentData.data, {
                        encoding: FileSystem.EncodingType.Base64,
                      });
                      if (await Sharing.isAvailableAsync()) {
                        await Sharing.shareAsync(fileUri);
                      } else {
                        Alert.alert('Saved', `File saved to cache: ${attachmentData.name}`);
                      }
                    } catch {
                      Alert.alert('Error', 'Could not save attachment');
                    }
                  }}
                  style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.7 }]}>
                  <Ionicons name="download-outline" size={14} color={colors.accent} />
                </Pressable>
              )}
            </View>
            {attachmentData.type.startsWith('image/') && (
              <Image
                source={{ uri: `data:${attachmentData.type};base64,${attachmentData.data}` }}
                style={styles.attachImage}
                resizeMode="contain"
              />
            )}
          </View>
        )}

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
  subj: { color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: spacing.md },
  metaCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  metaLabel: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    width: 42,
    textTransform: 'uppercase',
  },
  metaValue: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
  },
  encBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: spacing.md,
  },
  encLabel: { color: colors.accent, fontSize: 11, fontWeight: '500' },
  body: { color: colors.textSecondary, fontSize: 16, lineHeight: 24 },
  attachCard: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
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
