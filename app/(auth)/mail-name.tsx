import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { MAIL_DOMAIN } from '@/constants/config';
import { colors, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { registerName } from '@/lib/names';
import { useWalletStore } from '@/stores/wallet';

/**
 * Onboarding step (after a new wallet is created): claim a memorable on-chain
 * mail name so the encrypted-mail feature is discovered during setup rather than
 * forgotten. Fully skippable — the same registration lives in Settings → Mail name.
 */
export default function MailNameScreen() {
  const { t } = useT();
  const wallet = useWalletStore((s) => s.wallet);
  const encPub = useWalletStore((s) => s.encPublicKey);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState<string | null>(null);

  // Local part only: lowercase, strip anything after '@', keep url-safe chars.
  const clean = name.trim().toLowerCase().replace(/@.*/, '').replace(/[^a-z0-9_.-]/g, '');

  function finish() {
    // Continue onboarding to the (skippable) profile-photo step. Cast: fresh
    // route not yet in the generated typed-route union (regenerates on dev server).
    router.replace('/(auth)/avatar' as Href);
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
        setError(r.error ?? t('mn_error_taken'));
        return;
      }
      setClaimed(`${clean}@${MAIL_DOMAIN}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('mn_error_register'));
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
        <Text style={styles.title}>{t('mn_title')}</Text>
        <Text style={styles.sub}>{t('mn_sub')}</Text>

        {claimed ? (
          <View style={styles.claimedCard}>
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
            <Text style={styles.claimedText}>{claimed} {t('mn_is_yours')}</Text>
            <Button title={t('mn_continue')} onPress={finish} style={styles.cta} />
          </View>
        ) : (
          <>
            <Field
              label={t('mn_field_label')}
              value={name}
              onChangeText={(v) => {
                setName(v);
                setError('');
              }}
              placeholder={t('mn_field_placeholder')}
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
              title={t('mn_claim_button')}
              loading={busy}
              disabled={!clean || busy}
              onPress={claim}
              style={styles.cta}
            />
            <Button title={t('mn_skip')} variant="secondary" onPress={finish} style={styles.skip} />
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
