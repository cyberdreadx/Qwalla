import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';
import { useWalletStore } from '@/stores/wallet';

export default function LockScreen() {
  const displayName = useWalletStore((s) => s.displayName);
  const unlock = useWalletStore((s) => s.unlock);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

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
  hint: {
    color: colors.textTertiary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.xl,
    lineHeight: 17,
  },
});
