import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { colors, radius, spacing } from '@/constants/theme';
import { encryptMailV2 } from '@/lib/encryption';
import { lookupName } from '@/lib/names';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';
import { signRequest } from '@rougechain/sdk';

interface MailAttachment {
  name: string;
  type: string;
  data: string;
  size: number;
}

export default function ComposeMailScreen() {
  const wallet = useWalletStore((s) => s.wallet);
  const encPub = useWalletStore((s) => s.encPublicKey);
  const params = useLocalSearchParams<{
    replyTo?: string;
    replySubject?: string;
    forwardSubject?: string;
    forwardBody?: string;
  }>();

  const [local, setLocal] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [attachment, setAttachment] = useState<MailAttachment | null>(null);
  const [resolvedHint, setResolvedHint] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefilled = useRef(false);

  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
    if (params.replyTo) setLocal(params.replyTo);
    if (params.replySubject) setSubject(params.replySubject);
    if (params.forwardSubject) setSubject(params.forwardSubject);
    if (params.forwardBody) setBody(params.forwardBody);
  }, [params]);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setToast(null));
    }, 3500);
  }

  async function pickAttachment() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showToast('Allow access to your photos to attach files.', 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      showToast('Could not read the file.', 'error');
      return;
    }
    const sizeBytes = Math.ceil(asset.base64.length * 0.75);
    if (sizeBytes > 2 * 1024 * 1024) {
      showToast('Attachment too large (max 2 MB)', 'error');
      return;
    }
    const fileName = asset.uri.split('/').pop() || 'image';
    setAttachment({
      name: fileName,
      type: asset.mimeType || 'image/jpeg',
      data: asset.base64,
      size: sizeBytes,
    });
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
        showToast(`Could not resolve "${name}". Try their display name or @qwalla.mail address.`, 'error');
        return;
      }

      const subjectEnc = encryptMailV2(subject.trim(), [resolved.encPublicKey], encPub);
      const bodyEnc = encryptMailV2((body.trim() || '(empty)'), [resolved.encPublicKey], encPub);

      let attachmentEnc: string | undefined;
      if (attachment) {
        const attachPayload = JSON.stringify({
          name: attachment.name,
          type: attachment.type,
          data: attachment.data,
          size: attachment.size,
        });
        attachmentEnc = encryptMailV2(attachPayload, [resolved.encPublicKey], encPub);
      }

      // Signed by hand instead of rc.mail.send: the SDK hardcodes
      // hasAttachment:false and drops the attachment field entirely.
      const signed = signRequest(wallet, {
        fromWalletId: wallet.publicKey,
        toWalletIds: [resolved.publicKey],
        subjectEncrypted: subjectEnc,
        bodyEncrypted: bodyEnc,
        hasAttachment: !!attachmentEnc,
        ...(attachmentEnc ? { attachmentEncrypted: attachmentEnc } : {}),
      });
      const result = await rc.submitTx('/v2/mail/send', signed);

      if (!result.success) {
        showToast(result.error ?? 'Send failed', 'error');
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

  const isReply = !!params.replyTo;
  const isForward = !!params.forwardSubject;

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
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.replace('/(tabs)/mail')}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
          <Text style={styles.backLabel}>Mail</Text>
        </Pressable>
        {(isReply || isForward) && (
          <View style={styles.modeBadge}>
            <Ionicons
              name={isReply ? 'return-up-back' : 'arrow-redo'}
              size={14}
              color={colors.accent}
            />
            <Text style={styles.modeBadgeText}>{isReply ? 'Reply' : 'Forward'}</Text>
          </View>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Enter a @qwalla.mail or @rouge.quant name. The recipient will be resolved from the on-chain registry.
        </Text>
        <Field
          label="To"
          value={local}
          onChangeText={setLocal}
          placeholder="comet@qwalla.mail or Comet"
          autoCapitalize="none"
        />
        {resolvedHint && (
          <Text style={[styles.resolvedHint, resolvedHint === 'Not found' && { color: colors.error }]}>
            {resolvedHint}
          </Text>
        )}
        <Field label="Subject" value={subject} onChangeText={setSubject} />
        <Field label="Body" value={body} onChangeText={setBody} multiline style={styles.bodyField} />

        {/* Attachment */}
        <View style={styles.attachSection}>
          <Pressable
            onPress={pickAttachment}
            style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.7 }]}>
            <Ionicons name="attach" size={16} color={colors.accent} />
            <Text style={styles.attachBtnText}>Attach file</Text>
          </Pressable>
          <Text style={styles.attachHint}>Max 2 MB · encrypted with ML-KEM</Text>
        </View>

        {attachment && (
          <View style={styles.attachPreview}>
            {attachment.type.startsWith('image/') ? (
              <Image
                source={{ uri: `data:${attachment.type};base64,${attachment.data}` }}
                style={styles.attachThumb}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.attachThumb, styles.attachFilePlaceholder]}>
                <Ionicons name="document-outline" size={20} color={colors.accent} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.attachName} numberOfLines={1}>{attachment.name}</Text>
              <Text style={styles.attachSize}>{(attachment.size / 1024).toFixed(1)} KB</Text>
            </View>
            <Pressable
              onPress={() => setAttachment(null)}
              style={({ pressed }) => [styles.attachRemove, pressed && { opacity: 0.7 }]}>
              <Ionicons name="close-circle" size={20} color={colors.error} />
            </Pressable>
          </View>
        )}

        <Button title="Send encrypted mail" loading={busy} onPress={send} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, position: 'relative' as const },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.md,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 206, 182, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  modeBadgeText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  pad: { padding: spacing.lg },
  hint: { color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 20, fontSize: 14 },
  bodyField: { minHeight: 140, textAlignVertical: 'top' },
  resolvedHint: { color: colors.accent, fontSize: 12, marginTop: -8, marginBottom: spacing.sm },
  attachSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.accentDim,
    borderRadius: radius.sm,
  },
  attachBtnText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  attachHint: {
    color: colors.textTertiary,
    fontSize: 11,
    flex: 1,
  },
  attachPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.accentDim,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent + '33',
  },
  attachThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
  },
  attachFilePlaceholder: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  attachSize: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 1,
  },
  attachRemove: {
    padding: 4,
  },
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
