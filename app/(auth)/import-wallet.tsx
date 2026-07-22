import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { colors, radius, spacing } from '@/constants/theme';
import { decryptBackup } from '@/lib/encrypted-backup';
import { useWalletStore } from '@/stores/wallet';

type Mode = 'mnemonic' | 'keys' | 'backup';

export default function ImportWalletScreen() {
  const [mode, setMode] = useState<Mode>('mnemonic');
  const [phrase, setPhrase] = useState('');
  const [pub, setPub] = useState('');
  const [priv, setPriv] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const [backupJson, setBackupJson] = useState('');
  const [backupFileName, setBackupFileName] = useState<string | null>(null);
  const [backupPassword, setBackupPassword] = useState('');

  const [showPasswordStep, setShowPasswordStep] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isLocking, setIsLocking] = useState(false);

  const importWallet = useWalletStore((s) => s.importWallet);
  const importFromBackup = useWalletStore((s) => s.importFromBackup);
  const importFromMnemonic = useWalletStore((s) => s.importFromMnemonic);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const webFileRef = useRef<HTMLInputElement | null>(null);

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

  async function pickBackupFile() {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pqcbackup,.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        setBackupFileName(file.name);
        const text = await file.text();
        setBackupJson(text);
      };
      input.click();
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setBackupFileName(asset.name);

      const content = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      setBackupJson(content);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not read file', 'error');
    }
  }

  async function onSubmit() {
    setBusy(true);
    try {
      if (mode === 'backup') {
        if (!backupJson.trim()) {
          showToast('Select a .pqcbackup file first', 'error');
          setBusy(false);
          return;
        }
        if (!backupPassword.trim()) {
          showToast('Enter the backup password', 'error');
          setBusy(false);
          return;
        }

        const payload = await decryptBackup(backupJson, backupPassword.trim());
        await importFromBackup({
          ...payload,
          displayName: payload.displayName || name.trim() || 'Restored',
        });
        showToast('Wallet restored from backup!');
        setTimeout(() => router.replace('/(tabs)/messenger'), 1200);
        return;
      }

      if (mode === 'mnemonic') {
        await importFromMnemonic(phrase.trim(), name.trim() || 'Recovered');
      } else {
        await importWallet(pub.trim(), priv.trim(), name.trim() || 'Imported');
      }
      setShowPasswordStep(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (Platform.OS === 'web') showToast(`Import failed: ${msg}`, 'error');
      else Alert.alert('Import failed', msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPassword() {
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('Passwords don\'t match');
      return;
    }
    setPasswordError('');
    setIsLocking(true);
    try {
      await useWalletStore.getState().setPassword(newPassword);
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
            newPassword,
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
            style={pwdStyles.passwordInput}
            placeholder="Create password (min 6 characters)"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            value={newPassword}
            onChangeText={(t) => { setNewPassword(t); setPasswordError(''); }}
          />
          <TextInput
            style={pwdStyles.passwordInput}
            placeholder="Confirm password"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            value={confirmNewPassword}
            onChangeText={(t) => { setConfirmNewPassword(t); setPasswordError(''); }}
            onSubmitEditing={handleSetPassword}
          />

          {passwordError ? (
            <Text style={pwdStyles.errorText}>{passwordError}</Text>
          ) : null}

          <Button
            title={isLocking ? 'Setting up...' : 'Set Password'}
            loading={isLocking}
            onPress={handleSetPassword}
          />

          <Pressable onPress={() => router.replace('/(tabs)/messenger')} style={pwdStyles.skipBtn}>
            <Text style={pwdStyles.skipText}>Skip for now</Text>
          </Pressable>

          <Text style={pwdStyles.cryptoNote}>
            Your password is hashed with SHA-256 and stored securely on your device.
            It never leaves your device.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
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

      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <View style={styles.heroCenter}>
          <Image source={require('@/assets/images/koala-mascot.png')} style={styles.mascotLarge} />
          <Text style={styles.heroTitle}>Import Wallet</Text>
        </View>

        {/* Mode toggle — 3 tabs */}
        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeTab, mode === 'mnemonic' && styles.modeTabActive]}
            onPress={() => setMode('mnemonic')}>
            <Ionicons
              name="key-outline"
              size={14}
              color={mode === 'mnemonic' ? colors.accent : colors.textTertiary}
            />
            <Text style={[styles.modeLabel, mode === 'mnemonic' && styles.modeLabelActive]}>
              Phrase
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeTab, mode === 'keys' && styles.modeTabActive]}
            onPress={() => setMode('keys')}>
            <Ionicons
              name="code-slash"
              size={14}
              color={mode === 'keys' ? colors.accent : colors.textTertiary}
            />
            <Text style={[styles.modeLabel, mode === 'keys' && styles.modeLabelActive]}>
              Keys
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeTab, mode === 'backup' && styles.modeTabActive]}
            onPress={() => setMode('backup')}>
            <Ionicons
              name="document-lock-outline"
              size={14}
              color={mode === 'backup' ? colors.accent : colors.textTertiary}
            />
            <Text style={[styles.modeLabel, mode === 'backup' && styles.modeLabelActive]}>
              Backup
            </Text>
          </Pressable>
        </View>

        {mode === 'mnemonic' ? (
          <>
            <Text style={styles.hint}>
              Enter your 12 or 24 word recovery phrase to restore your wallet.
            </Text>
            <TextInput
              style={styles.phraseInput}
              placeholder="word1 word2 word3 ..."
              placeholderTextColor={colors.textTertiary}
              value={phrase}
              onChangeText={setPhrase}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />
          </>
        ) : mode === 'keys' ? (
          <>
            <Text style={styles.hint}>
              Paste your hex-encoded public and private keys from a RougeChain backup.
            </Text>
            <Field
              label="Public key (hex)"
              value={pub}
              onChangeText={setPub}
              autoCapitalize="none"
            />
            <Field
              label="Private key (hex)"
              value={priv}
              onChangeText={setPriv}
              autoCapitalize="none"
              secureTextEntry
            />
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              Import a .pqcbackup file exported from Qwalla or the RougeChain browser extension.
              Enter the password you used when creating the backup.
            </Text>

            <Pressable
              onPress={pickBackupFile}
              style={({ pressed }) => [styles.filePicker, pressed && { opacity: 0.8 }]}>
              <View style={styles.fileIconWrap}>
                <Ionicons
                  name={backupFileName ? 'document-text' : 'cloud-upload-outline'}
                  size={24}
                  color={backupFileName ? colors.accent : colors.textTertiary}
                />
              </View>
              <View style={styles.fileInfo}>
                <Text
                  style={[styles.fileLabel, backupFileName && { color: colors.text }]}
                  numberOfLines={1}>
                  {backupFileName ?? 'Select .pqcbackup file'}
                </Text>
                <Text style={styles.fileHint}>
                  {backupFileName ? 'Tap to change' : '.pqcbackup or .json'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>

            <Field
              label="Backup password"
              value={backupPassword}
              onChangeText={setBackupPassword}
              placeholder="Enter decryption password"
              secureTextEntry
            />

            <View style={styles.encBadge}>
              <Ionicons name="lock-closed" size={12} color={colors.accent} />
              <Text style={styles.encLabel}>
                PBKDF2 (600k rounds) + AES-256-GCM
              </Text>
            </View>
          </>
        )}

        {mode !== 'backup' && (
          <Field
            label="Display name"
            value={name}
            onChangeText={setName}
            placeholder="Optional"
          />
        )}

        <Button
          title={
            busy
              ? 'Restoring…'
              : mode === 'backup'
                ? 'Decrypt & Restore'
                : 'Restore wallet'
          }
          loading={busy}
          onPress={onSubmit}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, position: 'relative' as const },
  pad: { padding: spacing.lg },
  mascotLarge: { width: 120, height: 120, borderRadius: 60, marginBottom: spacing.md },
  heroCenter: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroTitle: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  hint: {
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 20,
    fontSize: 14,
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.lg,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  modeTabActive: { backgroundColor: colors.chrome },
  modeLabel: { color: colors.textTertiary, fontWeight: '600', fontSize: 12 },
  modeLabelActive: { color: colors.accent },
  phraseInput: {
    backgroundColor: colors.input,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    lineHeight: 24,
    padding: spacing.md,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  filePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  fileIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(31,224,197,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: { flex: 1 },
  fileLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  fileHint: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  encBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.lg,
    paddingVertical: 6,
  },
  encLabel: { color: colors.accent, fontSize: 11, fontWeight: '500' },
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

const pwdStyles = StyleSheet.create({
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
    textAlign: 'center' as const,
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
