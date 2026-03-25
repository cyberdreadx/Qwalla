import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { colors, radius, spacing } from '@/constants/theme';
import { useWalletStore } from '@/stores/wallet';

type Mode = 'mnemonic' | 'keys';

export default function ImportWalletScreen() {
  const [mode, setMode] = useState<Mode>('mnemonic');
  const [phrase, setPhrase] = useState('');
  const [pub, setPub] = useState('');
  const [priv, setPriv] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const importWallet = useWalletStore((s) => s.importWallet);
  const importFromMnemonic = useWalletStore((s) => s.importFromMnemonic);

  async function onSubmit() {
    setBusy(true);
    try {
      if (mode === 'mnemonic') {
        await importFromMnemonic(phrase.trim(), name.trim() || 'Recovered');
      } else {
        await importWallet(pub.trim(), priv.trim(), name.trim() || 'Imported');
      }
      router.replace('/(tabs)/messenger');
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <View style={styles.heroCenter}>
          <Image source={require('@/assets/images/koala-mascot.png')} style={styles.mascotLarge} />
          <Text style={styles.heroTitle}>Import Wallet</Text>
        </View>
        {/* Mode toggle */}
        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeTab, mode === 'mnemonic' && styles.modeTabActive]}
            onPress={() => setMode('mnemonic')}>
            <Ionicons
              name="key-outline"
              size={16}
              color={mode === 'mnemonic' ? colors.accent : colors.textTertiary}
            />
            <Text style={[styles.modeLabel, mode === 'mnemonic' && styles.modeLabelActive]}>
              Recovery phrase
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeTab, mode === 'keys' && styles.modeTabActive]}
            onPress={() => setMode('keys')}>
            <Ionicons
              name="code-slash"
              size={16}
              color={mode === 'keys' ? colors.accent : colors.textTertiary}
            />
            <Text style={[styles.modeLabel, mode === 'keys' && styles.modeLabelActive]}>
              Raw keys
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
        ) : (
          <>
            <Text style={styles.hint}>
              Paste your hex-encoded public and private keys from a RougeChain backup.
            </Text>
            <Field label="Public key (hex)" value={pub} onChangeText={setPub} autoCapitalize="none" />
            <Field
              label="Private key (hex)"
              value={priv}
              onChangeText={setPriv}
              autoCapitalize="none"
              secureTextEntry
            />
          </>
        )}

        <Field label="Display name" value={name} onChangeText={setName} placeholder="Optional" />
        <Button title="Restore wallet" loading={busy} onPress={onSubmit} />
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
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  modeTabActive: { backgroundColor: colors.chrome },
  modeLabel: { color: colors.textTertiary, fontWeight: '600', fontSize: 13 },
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
});
