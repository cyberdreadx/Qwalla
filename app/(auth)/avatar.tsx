import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { colors, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { base64Bytes, compressImageToLimit } from '@/lib/image-compress';
import { useWalletStore } from '@/stores/wallet';

/**
 * Onboarding step (after mail-name): add a profile photo, skippable. Mirrors the
 * Settings uploader — compresses to a square JPEG under ~256 KB and stores it via
 * setAvatar (which registers it to the directory so peers can see it).
 */
export default function AvatarOnboardingScreen() {
  const { t } = useT();
  const avatarUrl = useWalletStore((s) => s.avatarUrl);
  const setAvatar = useWalletStore((s) => s.setAvatar);
  const [busy, setBusy] = useState(false);

  function finish() {
    router.replace('/(tabs)/messenger');
  }

  async function pickPhoto() {
    if (busy) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setBusy(true);
    try {
      const LIMIT = 256 * 1024;
      let dataUri: string | null = null;
      const fitted = await compressImageToLimit(asset.uri, LIMIT, asset.width);
      if (fitted) {
        dataUri = `data:${fitted.mimeType};base64,${fitted.base64}`;
      } else if (asset.base64 && base64Bytes(asset.base64) <= LIMIT) {
        dataUri = `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}`;
      }
      if (dataUri) await setAvatar(dataUri);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.preview}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.img} />
          ) : (
            <Ionicons name="person" size={48} color={colors.textTertiary} />
          )}
        </View>
        <Text style={styles.title}>{t('av_title')}</Text>
        <Text style={styles.sub}>{t('av_subtitle')}</Text>

        <Button
          title={busy ? t('av_uploading') : avatarUrl ? t('av_change_photo') : t('av_upload_photo')}
          variant={avatarUrl ? 'secondary' : 'primary'}
          loading={busy}
          onPress={pickPhoto}
          style={styles.cta}
        />
        <Button
          title={avatarUrl ? t('av_continue') : t('av_skip')}
          variant={avatarUrl ? 'primary' : 'secondary'}
          onPress={finish}
          style={styles.skip}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  preview: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  img: { width: 96, height: 96 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  sub: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  cta: { marginTop: spacing.sm },
  skip: { marginTop: spacing.xs },
});
