import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { colors, radius, spacing } from '@/constants/theme';
import { useWalletStore } from '@/stores/wallet';

export default function CreateWalletScreen() {
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
    const displayName = name.trim() || 'Qwalla user';
    setBusy(true);
    try {
      await createWallet(displayName);
      setMnemonic(storedMnemonic ?? useWalletStore.getState().mnemonic);
    } catch (e) {
      Alert.alert('Could not create wallet', e instanceof Error ? e.message : 'Unknown error');
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

  async function handleSetPassword() {
    if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('Passwords don\'t match');
      return;
    }
    setPasswordError('');
    setIsLocking(true);
    try {
      await useWalletStore.getState().setPassword(password);
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
        /* backup export is optional — password is already saved */
      }
      router.replace('/(tabs)/messenger');
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to set password');
    }
    setIsLocking(false);
  }

  function skipPassword() {
    router.replace('/(tabs)/messenger');
  }

  if (showPasswordStep) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
          <View style={styles.heroCenter}>
            <Ionicons name="lock-closed" size={48} color={colors.accent} />
            <Text style={[styles.heroTitle, { marginTop: spacing.md }]}>Set a Password</Text>
          </View>
          <Text style={styles.hint}>
            Create a password to lock and protect your wallet. Your wallet will auto-lock when
            the app goes to the background.
          </Text>

          <TextInput
            style={styles.passwordInput}
            placeholder="Create password (min 6 characters)"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            value={password}
            onChangeText={(t) => { setPassword(t); setPasswordError(''); }}
          />
          <TextInput
            style={styles.passwordInput}
            placeholder="Confirm password"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            value={confirmPassword}
            onChangeText={(t) => { setConfirmPassword(t); setPasswordError(''); }}
            onSubmitEditing={handleSetPassword}
          />

          {passwordError ? (
            <Text style={styles.errorText}>{passwordError}</Text>
          ) : null}

          <Button
            title={isLocking ? 'Setting up...' : 'Set Password'}
            loading={isLocking}
            onPress={handleSetPassword}
          />

          <Pressable onPress={skipPassword} style={styles.skipBtn}>
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>

          <Text style={styles.cryptoNote}>
            Your password is hashed with SHA-256 and stored securely on your device.
            It never leaves your device.
          </Text>
        </ScrollView>
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
            <Text style={styles.backupTitle}>Recovery phrase</Text>
            <Text style={styles.backupSub}>Keep these words safe!</Text>
          </View>
          <Text style={styles.backupHint}>
            Write these {words.length} words down and store them somewhere safe. This is the only way
            to recover your wallet. Never share them with anyone.
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
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </Text>
          </Pressable>

          <View style={styles.warningBox}>
            <Ionicons name="warning" size={18} color={colors.warning} />
            <Text style={styles.warningText}>
              If you lose this phrase, your wallet cannot be recovered. Qwalla does not store it on
              any server.
            </Text>
          </View>

          <Button title="I've saved my recovery phrase" onPress={proceed} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <View style={styles.heroCenter}>
          <Image source={require('@/assets/images/koala-mascot.png')} style={styles.mascotLarge} />
          <Text style={styles.heroTitle}>Create Wallet</Text>
        </View>
        <Text style={styles.hint}>
          We generate a quantum-safe ML-DSA-65 keypair from a BIP-39 mnemonic, stored in your
          device's secure vault. You'll get a 12-word recovery phrase to back up.
        </Text>
        <Field
          label="Display name (for messenger)"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Koala Queen"
        />
        <Button title="Create wallet" loading={busy} onPress={onSubmit} />
      </ScrollView>
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
});
