import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { colors, spacing } from '@/constants/theme';

/**
 * Shown on web in place of the create/import wallet forms. The wallet is
 * native-only (WALLET_SUPPORTED) — browser storage can't safely hold private
 * keys — so we never render a seed-phrase input on the web. That avoids both a
 * dead-end flow (import always fails on web) and the far worse habit of users
 * typing their recovery phrase into a webpage.
 */
export default function WalletAppOnly({ action }: { action: 'create' | 'import' }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Image source={require('@/assets/images/koala-mascot.png')} style={styles.mascot} />
        <Ionicons
          name="phone-portrait-outline"
          size={26}
          color={colors.accent}
          style={{ marginTop: spacing.md }}
        />
        <Text style={styles.title}>Get the Qwalla app</Text>
        <Text style={styles.sub}>
          For your security, wallets live only on your device — never in a browser.
          {action === 'import' ? ' Never type your recovery phrase into a website.' : ''} Download
          the Qwalla app for iOS or Android to {action === 'import' ? 'restore' : 'create'} your
          wallet.
        </Text>
        <Link href="/" asChild>
          <Button title="Back to qwalla.io" style={styles.btn} />
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  mascot: { width: 96, height: 96, borderRadius: 48 },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  sub: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 360,
    marginBottom: spacing.xl,
  },
  btn: { width: '100%', maxWidth: 320 },
});
