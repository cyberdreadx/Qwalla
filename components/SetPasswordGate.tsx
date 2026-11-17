import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { useWalletStore } from '@/stores/wallet';

/**
 * Mandatory "secure your wallet" gate for a persisted PASSWORDLESS wallet
 * (legacy install, or onboarding interrupted before the password step). Shown as
 * an OVERLAY on the mounted app (like LockScreen) — it never touches the
 * navigator, and `setPassword` only encrypts the already-in-memory accounts, so
 * there is NO wallet wipe and NO recovery-phrase re-entry. Gated by
 * `needsPasswordSetup`, which is set only by hydrate's legacy branch, so it can
 * never fire mid-onboarding or for a password-protected wallet.
 */
export default function SetPasswordGate() {
  const { t } = useT();
  const setPassword = useWalletStore((s) => s.setPassword);
  const logout = useWalletStore((s) => s.logout);

  const [password, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (password.length < 8) {
      setError(t('cw_err_pw_short'));
      return;
    }
    if (password !== confirm) {
      setError(t('cw_err_pw_mismatch'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      // Encrypts the in-memory accounts under the password and overwrites the
      // plaintext record with the v3 encrypted blob. hasPassword -> true clears
      // needsPasswordSetup, unmounting this overlay. The wallet is never cleared.
      await setPassword(password);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('cw_err_set_pw'));
      setBusy(false);
    }
  }

  // Escape hatch (explicit + destructive): remove the wallet and start over from
  // the recovery phrase. This is the ONLY path that needs the seed — never forced.
  function removeWallet() {
    Alert.alert(t('setpw_remove_title'), t('setpw_remove_body'), [
      { text: t('lock_cancel'), style: 'cancel' },
      { text: t('setpw_remove_confirm'), style: 'destructive', onPress: () => void logout() },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.container} behavior="padding">
        <Image source={require('@/assets/images/koala-mascot.png')} style={styles.logo} />
        <Ionicons name="shield-checkmark" size={28} color={colors.accent} style={{ marginBottom: 8 }} />
        <Text style={styles.title}>{t('cw_set_pw_title')}</Text>
        <Text style={styles.subtitle}>{t('setpw_intro')}</Text>

        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder={t('cw_pw_placeholder')}
            placeholderTextColor={colors.textTertiary}
            secureTextEntry={!show}
            value={password}
            onChangeText={(v) => { setPw(v); setError(''); }}
          />
          <Pressable onPress={() => setShow(!show)} style={styles.eyeBtn}>
            <Ionicons name={show ? 'eye-off' : 'eye'} size={20} color={colors.textTertiary} />
          </Pressable>
        </View>
        <View style={[styles.inputWrapper, { marginTop: spacing.sm }]}>
          <TextInput
            style={styles.input}
            placeholder={t('cw_pw_confirm_placeholder')}
            placeholderTextColor={colors.textTertiary}
            secureTextEntry={!show}
            value={confirm}
            onChangeText={(v) => { setConfirm(v); setError(''); }}
            onSubmitEditing={submit}
            returnKeyType="go"
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={submit}
          disabled={busy}
          style={({ pressed }) => [styles.btn, busy && styles.btnDisabled, pressed && { opacity: 0.85 }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="lock-closed" size={18} color="#fff" />
          )}
          <Text style={styles.btnText}>{busy ? t('cw_pw_btn_setting') : t('cw_pw_btn_set')}</Text>
        </Pressable>

        <Pressable onPress={removeWallet} hitSlop={8} disabled={busy} style={styles.removeBtn}>
          <Text style={styles.removeText}>{t('setpw_remove_link')}</Text>
        </Pressable>

        <Text style={styles.hint}>{t('cw_crypto_note')}</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  logo: { width: 72, height: 72, borderRadius: 36, marginBottom: spacing.lg },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 340,
  },
  inputWrapper: { width: '100%', maxWidth: 320, marginTop: spacing.md, position: 'relative' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'web' ? 14 : 12,
    paddingRight: 48,
    color: colors.text,
    fontSize: 15,
  },
  eyeBtn: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
  error: { color: colors.error, fontSize: 13, fontWeight: '600', marginTop: spacing.sm },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 320,
    marginTop: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  removeBtn: { marginTop: spacing.lg, minHeight: 20, justifyContent: 'center' },
  removeText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  hint: { color: colors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: spacing.xl, lineHeight: 17, maxWidth: 340 },
});
