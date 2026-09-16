import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { MAIL_DOMAIN } from '@/constants/config';
import { colors, radius, spacing } from '@/constants/theme';
import { registerName } from '@/lib/names';
import { useWalletStore } from '@/stores/wallet';

/**
 * Onboarding step (after a new wallet is created): claim a memorable on-chain
 * mail name so the encrypted-mail feature is discovered during setup rather than
 * forgotten. Fully skippable — the same registration lives in Settings → Mail name.
 */
export default function MailNameScreen() {
  const wallet = useWalletStore((s) => s.wallet);
  const encPub = useWalletStore((s) => s.encPublicKey);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState<string | null>(null);

  // Local part only: lowercase, strip anything after '@', keep url-safe chars.
  const clean = name.trim().toLowerCase().replace(/@.*/, '').replace(/[^a-z0-9_.-]/g, '');

  function finish() {
    router.replace('/(tabs)/messenger');
  }

  async function claim() {
    if (!wallet || !encPub || !clean || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await registerName(wallet, {
        name: clean,
        publicKey: wallet.publicKey,
        encPublicKey: encPub,
      });
      if (!r.success) {
        setError(r.error ?? 'That name is taken or invalid — try another.');
        return;
      }
      setClaimed(`${clean}@${MAIL_DOMAIN}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not register the name.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="at" size={30} color={colors.accent} />
        </View>
        <Text style={styles.title}>Claim your mail name</Text>
        <Text style={styles.sub}>
          Get a memorable on-chain address for encrypted mail, so people can reach you by name
          instead of a long key. You can always do this later in Settings.
        </Text>

        {claimed ? (
          <View style={styles.claimedCard}>
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
            <Text style={styles.claimedText}>{claimed} is yours!</Text>
            <Button title="Continue" onPress={finish} style={styles.cta} />
          </View>
        ) : (
          <>
            <Field
              label="Choose a name"
              value={name}
              onChangeText={(t) => {
                setName(t);
                setError('');
              }}
              placeholder="yourname"
              autoCapitalize="none"
            />
            {clean ? (
              <Text style={styles.preview}>
                {clean}
                <Text style={styles.previewDomain}>@{MAIL_DOMAIN}</Text>
              </Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              title="Claim name"
              loading={busy}
              disabled={!clean || busy}
              onPress={claim}
              style={styles.cta}
            />
            <Button title="Skip for now" variant="secondary" onPress={finish} style={styles.skip} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  sub: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  preview: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: -spacing.xs },
  previewDomain: { color: colors.accent },
  error: { color: colors.error, fontSize: 13 },
  cta: { marginTop: spacing.sm },
  skip: { marginTop: spacing.xs },
  claimedCard: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  claimedText: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
