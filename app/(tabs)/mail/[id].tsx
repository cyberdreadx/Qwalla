import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';
import { decryptMessage } from '@/lib/encryption';
import { fetchMailMessage } from '@/lib/mail-api';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';

export default function MailDetailScreen() {
  const { id, folder } = useLocalSearchParams<{ id: string; folder?: string }>();
  const wallet = useWalletStore((s) => s.wallet);
  const encPriv = useWalletStore((s) => s.encPrivateKey);
  const encPub = useWalletStore((s) => s.encPublicKey);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [senderName, setSenderName] = useState('');
  const [loading, setLoading] = useState(true);

  const isSender = folder === 'sent';

  useEffect(() => {
    void (async () => {
      if (!wallet || !id || !encPriv || !encPub) return;
      setLoading(true);
      try {
        let raw: Record<string, unknown>;
        try {
          raw = await fetchMailMessage(String(id), wallet.publicKey);
        } catch {
          raw = (await rc.mail.getMessage(String(id))) as Record<string, unknown>;
        }

        const msg = (raw.message ?? raw) as Record<string, unknown>;

        const name = String(msg.senderName ?? msg.sender_name ?? '');
        if (name) setSenderName(name);

        const subEnc = String(msg.subjectEncrypted ?? msg.subject_encrypted ?? msg.encrypted_subject ?? msg.encryptedSubject ?? '');
        const bodyEnc = String(msg.bodyEncrypted ?? msg.body_encrypted ?? msg.encrypted_body ?? msg.encryptedBody ?? '');
        const fallback = String(msg.encrypted ?? '');

        if (subEnc) {
          try {
            setSubject(decryptMessage(subEnc, encPriv, isSender));
          } catch {
            setSubject('[Unable to decrypt subject]');
          }
        } else {
          setSubject(String(msg.subject ?? ''));
        }

        if (bodyEnc) {
          try {
            setBody(decryptMessage(bodyEnc, encPriv, isSender));
          } catch {
            setBody('[Unable to decrypt body]');
          }
        } else if (fallback) {
          try {
            const parsed = decryptMessage(fallback, encPriv, isSender);
            try {
              const j = JSON.parse(parsed) as { subject?: string; body?: string };
              if (j.subject && !subEnc) setSubject(j.subject);
              setBody(j.body ?? parsed);
            } catch {
              setBody(parsed);
            }
          } catch {
            setBody('[Unable to decrypt]');
          }
        } else {
          setBody(String(msg.body ?? ''));
        }
      } catch (e) {
        Alert.alert('Mail', e instanceof Error ? e.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [wallet, id, encPriv, encPub, isSender]);

  async function toTrash() {
    if (!id || !wallet) return;
    try {
      const r = await rc.mail.move(String(id), 'trash');
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

  useEffect(() => {
    if (id) void rc.mail.markRead(String(id));
  }, [id]);

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
        {senderName ? (
          <Text style={styles.senderLabel}>From: {senderName}</Text>
        ) : null}
        <Text style={styles.subj}>{subject || '(no subject)'}</Text>

        <View style={styles.encBadge}>
          <Ionicons name="lock-closed" size={12} color={colors.accent} />
          <Text style={styles.encLabel}>ML-KEM-768 + ML-DSA-65</Text>
        </View>

        <Text style={styles.body}>{body}</Text>

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
  pad: { padding: spacing.lg },
  senderLabel: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.xs },
  subj: { color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: spacing.sm },
  encBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: spacing.md,
  },
  encLabel: { color: colors.accent, fontSize: 11, fontWeight: '500' },
  body: { color: colors.textSecondary, fontSize: 16, lineHeight: 24 },
  trashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 107, 107, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.2)',
  },
  trashText: { color: colors.error, fontWeight: '600', fontSize: 14 },
});
