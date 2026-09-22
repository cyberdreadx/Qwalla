import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import WalletAppOnly from '@/components/WalletAppOnly';
import { WALLET_SUPPORTED } from '@/lib/secure-store';
import { colors, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { useWalletStore } from '@/stores/wallet';

export default function CreateWalletScreen() {
  const { t } = useT();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const createWallet = useWalletStore((s) => s.createWallet);
  const storedMnemonic = useWalletStore((s) => s.mnemonic);

  const [showPasswordStep, setShowPasswordStep] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isLocking, setIsLocking] = useState(false);

  async function onSubmit() {
    const displayName = name.trim() || t('cw_default_name');
    setBusy(true);
    try {
      await createWallet(displayName);
      setMnemonic(storedMnemonic ?? useWalletStore.getState().mnemonic);
    } catch (e) {
      Alert.alert(t('cw_err_create_title'), e instanceof Error ? e.message : t('cw_err_unknown'));
    } finally {
      setBusy(false);
    }
  }

  async function copyPhrase() {
    if (!mnemonic) return;
    await Clipboard.setStringAsync(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function proceed() {
    setShowPasswordStep(true);
  }

  function finishOnboarding() {
    // Offer an on-chain mail name as the last onboarding step (skippable) so the
    // encrypted-mail feature is discovered during setup, not forgotten.
    // Cast: the route exists but generated route types only refresh via the dev
    // server, so a fresh route isn't in the typed union yet.
    router.replace('/(auth)/mail-name' as Href);
  }

  async function saveBackup() {
    try {
      const { exportEncryptedBackup } = await import('@/lib/encrypted-backup');
      const state = useWalletStore.getState();
      if (state.wallet) {
        await exportEncryptedBackup(
          {
            publicKey: state.wallet.publicKey,
            privateKey: state.wallet.privateKey || '',
            encPublicKey: state.encPublicKey || undefined,
            encPrivateKey: state.encPrivateKey || undefined,
            mnemonic: state.mnemonic || undefined,
            displayName: state.displayName,
          },
          password,
        );
      }
    } catch {
      /* backup export is optional — the password is already saved */
    }
  }

  async function handleSetPassword() {
    if (password.length < 8) {
      setPasswordError(t('cw_err_pw_short'));
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError(t('cw_err_pw_mismatch'));
      return;
    }
    setPasswordError('');
    setIsLocking(true);
    try {
      await useWalletStore.getState().setPassword(password);
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : t('cw_err_set_pw'));
      setIsLocking(false);
      return;
    }
    setIsLocking(false);
    // Offer the encrypted backup instead of exporting it silently. An unexpected
    // share/download sheet mid-onboarding reads as if the app is leaking your
    // keys — so ask first. Users can also export anytime from Settings.
    const backupPrompt = t('cw_backup_prompt');
    // Alert.alert is a no-op on web/desktop (react-native-web), so use the
    // native confirm there — otherwise onboarding would dead-end after the
    // password step without ever navigating in.
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(backupPrompt)) {
        await saveBackup();
      }
      finishOnboarding();
      return;
    }
    Alert.alert(t('cw_backup_title'), backupPrompt, [
      { text: t('cw_backup_not_now'), style: 'cancel', onPress: finishOnboarding },
      {
        text: t('cw_backup_save'),
        onPress: async () => {
          await saveBackup();
          finishOnboarding();
        },
      },
    ]);
  }

  // Only render wallet creation where keys can be stored securely (native app
  // or Electron desktop). A plain browser gets the "get the app" screen.
  if (!WALLET_SUPPORTED) {
    return <WalletAppOnly action="create" />;
  }

  if (showPasswordStep) {
    return (
      <SafeAreaView style={styles.safe}>
        <KeyboardAwareScrollView
        contentContainerStyle={styles.pad}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={spacing.lg}>
          <View style={styles.heroCenter}>
            <Ionicons name="lock-closed" size={48} color={colors.accent} />
            <Text style={[styles.heroTitle, { marginTop: spacing.md }]}>{t('cw_set_pw_title')}</Text>
          </View>
          <Text style={styles.hint}>
            {t('cw_set_pw_hint')}
          </Text>

          <TextInput
            style={styles.passwordInput}
            placeholder={t('cw_pw_placeholder')}
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            value={password}
            onChangeText={(v) => { setPassword(v); setPasswordError(''); }}
          />
          <TextInput
            style={styles.passwordInput}
            placeholder={t('cw_pw_confirm_placeholder')}
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            value={confirmPassword}
            onChangeText={(v) => { setConfirmPassword(v); setPasswordError(''); }}
            onSubmitEditing={handleSetPassword}
          />

          {passwordError ? (
            <Text style={styles.errorText}>{passwordError}</Text>
          ) : null}

          <Button
            title={isLocking ? t('cw_pw_btn_setting') : t('cw_pw_btn_set')}
            loading={isLocking}
            onPress={handleSetPassword}
          />

          <Text style={styles.cryptoNote}>
            {t('cw_crypto_note')}
          </Text>
        </KeyboardAwareScrollView>
        {isLocking && (
          <View style={styles.loadingOverlay}>
            <Image source={require('@/assets/images/koala-mascot.png')} style={styles.loadingMascot} />
            <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: spacing.lg }} />
            <Text style={styles.loadingTitle}>{t('cw_loading_title')}</Text>
            <Text style={styles.loadingSub}>
              {t('cw_loading_sub')}
            </Text>
          </View>
        )}
      </SafeAreaView>
    );
  }

  if (mnemonic) {
    const words = mnemonic.split(' ');
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.pad}>
          <View style={styles.heroCenter}>
            <Image source={require('@/assets/images/koala-mascot.png')} style={styles.mascotLarge} />
            <Text style={styles.backupTitle}>{t('cw_recovery_title')}</Text>
            <Text style={styles.backupSub}>{t('cw_recovery_sub')}</Text>
          </View>
          <Text style={styles.backupHint}>
            {t('cw_recovery_hint_1')}{words.length}{t('cw_recovery_hint_2')}
          </Text>

          <View style={styles.wordGrid}>
            {words.map((word, i) => (
              <View key={i} style={styles.wordCell}>
                <Text style={styles.wordNum}>{i + 1}</Text>
                <Text style={styles.wordText}>{word}</Text>
              </View>
            ))}
          </View>

          <Pressable
            onPress={copyPhrase}
            style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.7 }]}>
            <Ionicons
              name={copied ? 'checkmark-circle' : 'copy-outline'}
              size={18}
              color={copied ? colors.success : colors.accent}
            />
            <Text style={[styles.copyLabel, copied && { color: colors.success }]}>
              {copied ? t('cw_copied') : t('cw_copy')}
            </Text>
          </Pressable>

          <View style={styles.warningBox}>
            <Ionicons name="warning" size={18} color={colors.warning} />
            <Text style={styles.warningText}>
              {t('cw_warning')}
            </Text>
          </View>

          <Button title={t('cw_saved_btn')} onPress={proceed} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.pad}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={spacing.lg}>
        <View style={styles.heroCenter}>
          <Image source={require('@/assets/images/koala-mascot.png')} style={styles.mascotLarge} />
          <Text style={styles.heroTitle}>{t('cw_title')}</Text>
        </View>
        <Text style={styles.hint}>
          {t('cw_intro')}
        </Text>
        <Field
          label={t('cw_name_label')}
          value={name}
          onChangeText={setName}
          placeholder={t('cw_name_placeholder')}
        />
        <Button title={t('cw_create_btn')} loading={busy} onPress={onSubmit} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: spacing.lg },
  mascotLarge: { width: 120, height: 120, borderRadius: 60, marginBottom: spacing.md },
  heroCenter: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroTitle: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  hint: { color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20, fontSize: 14 },
  backupSub: { color: colors.textSecondary, fontSize: 13, marginTop: 4, textAlign: 'center' },
  backupTitle: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  backupHint: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  wordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  wordCell: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    width: '30%',
    flexGrow: 1,
  },
  wordNum: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    width: 20,
    fontVariant: ['tabular-nums'],
  },
  wordText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  copyLabel: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: 'rgba(253, 203, 110, 0.08)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(253, 203, 110, 0.2)',
  },
  warningText: {
    flex: 1,
    color: colors.warning,
    fontSize: 13,
    lineHeight: 19,
  },
  passwordInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  skipBtn: {
    alignItems: 'center' as const,
    paddingVertical: spacing.md,
  },
  skipText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  cryptoNote: {
    color: colors.textTertiary,
    fontSize: 11,
    textAlign: 'center' as const,
    lineHeight: 16,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  loadingMascot: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  loadingTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.lg,
    letterSpacing: -0.3,
  },
  loadingSub: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 340,
  },
});
