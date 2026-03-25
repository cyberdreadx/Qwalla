import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { bytesToHex, hexToBytes } from '@rougechain/sdk';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ROUGECHAIN_API } from '@/constants/config';
import { colors, radius, spacing } from '@/constants/theme';
import { encryptMessage } from '@/lib/encryption';
import { lookupName } from '@/lib/names';
import { useWalletStore } from '@/stores/wallet';

export default function ComposeMailScreen() {
  const wallet = useWalletStore((s) => s.wallet);
  const encPub = useWalletStore((s) => s.encPublicKey);

  const [local, setLocal] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolvedHint, setResolvedHint] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setToast(null));
    }, 3500);
  }

  useEffect(() => {
    const name = local.trim();
    if (!name) { setResolvedHint(null); return; }
    const t = setTimeout(async () => {
      const r = await lookupName(name);
      setResolvedHint(r ? `Resolved: ${r.publicKey.slice(0, 16)}…` : 'Not found');
    }, 600);
    return () => clearTimeout(t);
  }, [local]);

  async function send() {
    if (!wallet || !encPub) return;
    const name = local.trim();
    if (!name || !subject.trim()) {
      showToast('Enter a recipient and subject', 'error');
      return;
    }
    setBusy(true);
    try {
      const resolved = await lookupName(name);
      if (!resolved?.publicKey || !resolved.encPublicKey) {
        showToast(`Could not resolve "${name}". Try their display name or @rouge.quant address.`, 'error');
        return;
      }

      const subjectEnc = encryptMessage(subject.trim(), resolved.encPublicKey, encPub);
      const bodyEnc = encryptMessage((body.trim() || '(empty)'), resolved.encPublicKey, encPub);

      const sigBytes = ml_dsa65.sign(
        new TextEncoder().encode(subjectEnc),
        hexToBytes(wallet.privateKey)
      );
      const signature = bytesToHex(sigBytes);

      const res = await fetch(`${ROUGECHAIN_API}/mail/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromWalletId: wallet.publicKey,
          toWalletIds: [resolved.publicKey],
          subjectEncrypted: subjectEnc,
          bodyEncrypted: bodyEnc,
          signature,
          hasAttachment: false,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        showToast(`Send failed: ${res.status} ${errText}`, 'error');
        return;
      }

      showToast('Encrypted mail sent!');
      setTimeout(() => router.replace('/(tabs)/mail'), 1200);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Send failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {toast && (
        <Animated.View
          style={[
            styles.toast,
            toast.type === 'error' ? styles.toastError : styles.toastSuccess,
            { opacity: toastOpacity },
          ]}>
          <Ionicons
            name={toast.type === 'error' ? 'close-circle' : 'checkmark-circle'}
            size={18}
            color="#fff"
          />
          <Text style={styles.toastText}>{toast.message}</Text>
        </Animated.View>
      )}
      <Pressable
        onPress={() => router.replace('/(tabs)/mail')}
        style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}>
        <Ionicons name="arrow-back" size={20} color={colors.text} />
        <Text style={styles.backLabel}>Mail</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Enter a @rouge.quant name or display name. The recipient will be resolved from the on-chain registry or wallet directory.
        </Text>
        <Field
          label="Recipient"
          value={local}
          onChangeText={setLocal}
          placeholder="comet@rouge.quant or Comet"
          autoCapitalize="none"
        />
        {resolvedHint && (
          <Text style={[styles.resolvedHint, resolvedHint === 'Not found' && { color: colors.error }]}>
            {resolvedHint}
          </Text>
        )}
        <Field label="Subject" value={subject} onChangeText={setSubject} />
        <Field label="Body" value={body} onChangeText={setBody} multiline style={styles.body} />
        <Button title="Send encrypted mail" loading={busy} onPress={send} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, position: 'relative' as const },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  pad: { padding: spacing.lg },
  hint: { color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 20, fontSize: 14 },
  body: { minHeight: 140, textAlignVertical: 'top' },
  resolvedHint: { color: colors.accent, fontSize: 12, marginTop: -8, marginBottom: spacing.sm },
  toast: {
    position: 'absolute',
    top: 8,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  toastSuccess: { backgroundColor: colors.success },
  toastError: { backgroundColor: colors.error },
  toastText: { color: '#fff', fontWeight: '600', fontSize: 14, flex: 1 },
});
