import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import * as ImagePicker from 'expo-image-picker';
import { compressTokenLogoToDataUri } from '@/lib/image-compress';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { colors, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';

export default function CreateTokenScreen() {
  const { t } = useT();
  const headerHeight = useHeaderHeight();
  const wallet = useWalletStore((s) => s.wallet);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [supply, setSupply] = useState('');
  const [image, setImage] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(
        () => setToast(null)
      );
    }, 3500);
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showToast(t('wtoken_err_photo_access'), 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    // The node caps an inline logo at 32 KiB of data-URI text, so shrink the
    // picked photo (often 100 KB+) to a small square JPEG first. The preview
    // shows the actual image that goes on-chain.
    const dataUri = await compressTokenLogoToDataUri(asset.uri);
    if (!dataUri) {
      showToast(t('wtoken_err_compress'), 'error');
      return;
    }
    setImage(dataUri);
    setImagePreview(dataUri);
  }

  function clearImage() {
    setImage('');
    setImagePreview(null);
  }

  async function onCreate() {
    if (!wallet) return;
    const sym = symbol.trim().toUpperCase();
    const nm = name.trim();
    const amt = Number(supply.trim());
    if (!sym || !nm || !Number.isFinite(amt) || amt <= 0) {
      showToast(t('wtoken_err_fill_fields'), 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await rc.createToken(wallet, {
        name: nm,
        symbol: sym,
        totalSupply: amt,
        image: image.trim() || undefined,
      });
      if (!r.success) {
        showToast(r.error ?? t('wtoken_err_creation_failed'), 'error');
        return;
      }
      showToast(`${sym} ${t('wtoken_created_suffix')}`);
      setTimeout(() => router.back(), 1500);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('wtoken_err_failed'), 'error');
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Text style={styles.heading}>{t('wtoken_create_token')}</Text>
          <Text style={styles.hint}>
            {t('wtoken_hint')}
          </Text>

          <Card style={styles.card}>
            <Field label={t('wtoken_label_name')} value={name} onChangeText={setName} placeholder={t('wtoken_ph_name')} />
            <Field
              label={t('wtoken_label_symbol')}
              value={symbol}
              onChangeText={(v) => setSymbol(v.toUpperCase())}
              placeholder="MTK"
              autoCapitalize="characters"
            />
            <Field
              label={t('wtoken_label_supply')}
              value={supply}
              onChangeText={setSupply}
              placeholder="1000000"
              keyboardType="number-pad"
            />
            <Text style={styles.fieldLabel}>{t('wtoken_label_logo')}</Text>
            {imagePreview ? (
              <View style={styles.imagePreviewRow}>
                <Image source={{ uri: imagePreview }} style={styles.imageThumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.imageFileName} numberOfLines={1}>{t('wtoken_image_uploaded')}</Text>
                  <Text style={styles.imageHint}>{t('wtoken_image_onchain')}</Text>
                </View>
                <Pressable onPress={clearImage} style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}>
                  <Ionicons name="close-circle" size={22} color={colors.error} />
                </Pressable>
              </View>
            ) : image && image.startsWith('http') ? (
              <View style={styles.imagePreviewRow}>
                <Image source={{ uri: image }} style={styles.imageThumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.imageFileName} numberOfLines={1}>{image}</Text>
                </View>
                <Pressable onPress={clearImage} style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}>
                  <Ionicons name="close-circle" size={22} color={colors.error} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.imagePickerRow}>
                <Pressable
                  onPress={pickImage}
                  style={({ pressed }) => [styles.uploadBtn, pressed && { opacity: 0.7 }]}>
                  <Ionicons name="cloud-upload-outline" size={18} color={colors.accent} />
                  <Text style={styles.uploadText}>{t('wtoken_upload_image')}</Text>
                </Pressable>
                <Text style={styles.orText}>{t('wtoken_or')}</Text>
                <Field
                  label=""
                  value={image}
                  onChangeText={setImage}
                  placeholder={t('wtoken_ph_url')}
                  autoCapitalize="none"
                  style={styles.urlInput}
                />
              </View>
            )}
          </Card>

          <View style={styles.feeNote}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textTertiary} />
            <Text style={styles.feeText}>{t('wtoken_fee_note')}</Text>
          </View>

          <Button
            title={busy ? t('wtoken_creating') : t('wtoken_create_token')}
            loading={busy}
            onPress={onCreate}
            disabled={!name.trim() || !symbol.trim() || !supply.trim()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, position: 'relative' as const },
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { color: colors.text, fontSize: 24, fontWeight: '800', marginBottom: spacing.xs },
  hint: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  card: { marginBottom: spacing.md },
  fieldLabel: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  imagePickerRow: {
    marginBottom: spacing.sm,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: 'rgba(0, 206, 182, 0.08)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(0, 206, 182, 0.2)',
    borderStyle: 'dashed' as const,
    marginBottom: spacing.xs,
  },
  uploadText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  orText: {
    color: colors.textTertiary,
    fontSize: 11,
    textAlign: 'center' as const,
    marginVertical: 4,
  },
  urlInput: {
    marginBottom: 0,
  },
  imagePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: 'rgba(0, 206, 182, 0.06)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(0, 206, 182, 0.15)',
    marginBottom: spacing.sm,
  },
  imageThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  imageFileName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  imageHint: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 2,
  },
  removeBtn: {
    padding: 4,
  },
  feeNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.lg,
  },
  feeText: { color: colors.textTertiary, fontSize: 12 },
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
