import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { getBiometricLabel, isBiometricAvailable } from '@/lib/biometric';
import { colors, radius, spacing } from '@/constants/theme';
import { useWalletStore } from '@/stores/wallet';

export default function LockScreen() {
  const displayName = useWalletStore((s) => s.displayName);
  const unlock = useWalletStore((s) => s.unlock);
  const logout = useWalletStore((s) => s.logout);
  const biometricEnabled = useWalletStore((s) => s.biometricEnabled);
  const unlockWithBiometrics = useWalletStore((s) => s.unlockWithBiometrics);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [bioLabel, setBioLabel] = useState('');
  const [bioBusy, setBioBusy] = useState(false);
  const bioAttempted = useRef(false);

  async function tryBiometric() {
    if (bioBusy) return;
    setBioBusy(true);
    setError('');
    try {
      const ok = await unlockWithBiometrics();
      if (!ok) setError('');
    } finally {
      setBioBusy(false);
    }
  }

  // Offer biometric unlock when it's enabled + available, and auto-prompt once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!biometricEnabled || !(await isBiometricAvailable())) return;
      const label = await getBiometricLabel();
      if (cancelled) return;
      setBioLabel(label);
      if (!bioAttempted.current) {
        bioAttempted.current = true;
        void tryBiometric();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricEnabled]);

  async function handleUnlock() {
    if (!password) return;
    setUnlocking(true);
    setError('');
    try {
      const ok = await unlock(password);
      if (!ok) {
        setError('Wrong password');
        setPassword('');
      }
    } catch {
      setError('Unlock failed');
    }
    setUnlocking(false);
  }

  // The password can't be recovered (it's never stored — it only derives the
  // decryption key). The only way back in is to remove the wallet from this
  // device and restore it from the recovery phrase. Wipe it, then routing falls
  // through to the welcome/import flow (isLocked → false, wallet → null).
  function handleForgotPassword() {
    Alert.alert(
      'Forgot password?',
      "Your password can't be recovered. To get back in, remove this wallet from the device and restore it with your recovery phrase.\n\nWithout that phrase, the wallet and its funds cannot be recovered.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore with phrase',
          style: 'destructive',
          onPress: async () => {
            setResetting(true);
            try {
              await logout();
            } catch {
              setResetting(false);
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Image
          source={require('@/assets/images/koala-mascot.png')}
          style={styles.logo}
        />

        <Ionicons name="lock-closed" size={28} color={colors.accent} style={{ marginBottom: 8 }} />
        <Text style={styles.title}>Wallet Locked</Text>
        {displayName ? (
          <Text style={styles.subtitle}>{displayName}</Text>
        ) : null}

        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="Enter password"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={(t) => { setPassword(t); setError(''); }}
            onSubmitEditing={handleUnlock}
            autoFocus
            returnKeyType="go"
          />
          <Pressable
            onPress={() => setShowPassword(!showPassword)}
            style={styles.eyeBtn}>
            <Ionicons
              name={showPassword ? 'eye-off' : 'eye'}
              size={20}
              color={colors.textTertiary}
            />
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={handleUnlock}
          disabled={!password || unlocking}
          style={({ pressed }) => [
            styles.unlockBtn,
            (!password || unlocking) && styles.unlockBtnDisabled,
            pressed && { opacity: 0.85 },
          ]}>
          {unlocking ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="shield-checkmark" size={18} color="#fff" />
          )}
          <Text style={styles.unlockText}>
            {unlocking ? 'Unlocking…' : 'Unlock'}
          </Text>
        </Pressable>

        {biometricEnabled && bioLabel ? (
          <Pressable
            onPress={tryBiometric}
            disabled={bioBusy || unlocking}
            style={({ pressed }) => [styles.bioBtn, pressed && { opacity: 0.7 }]}>
            {bioBusy ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons
                name={bioLabel.includes('Face') ? 'scan-outline' : 'finger-print'}
                size={20}
                color={colors.accent}
              />
            )}
            <Text style={styles.bioBtnText}>Unlock with {bioLabel}</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={handleForgotPassword}
          disabled={unlocking || resetting}
          hitSlop={8}
          style={({ pressed }) => [styles.forgotBtn, pressed && { opacity: 0.6 }]}>
          {resetting ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Text style={styles.forgotText}>Forgot password?</Text>
          )}
        </Pressable>

        <Text style={styles.hint}>
          ML-KEM-768 + AES-256-GCM encrypted{'\n'}Keys never leave your device
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  inputWrapper: {
    width: '100%',
    maxWidth: 320,
    marginTop: spacing.lg,
    position: 'relative',
  },
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
  eyeBtn: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  error: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  unlockBtn: {
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
  unlockBtnDisabled: {
    opacity: 0.5,
  },
  unlockText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  bioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 320,
    marginTop: spacing.md,
    paddingVertical: 13,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bioBtnText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  forgotBtn: {
    marginTop: spacing.lg,
    minHeight: 20,
    justifyContent: 'center',
  },
  forgotText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  hint: {
    color: colors.textTertiary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.xl,
    lineHeight: 17,
  },
});
