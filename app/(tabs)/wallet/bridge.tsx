import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { colors, radius, spacing } from '@/constants/theme';

const BRIDGE_URL = 'https://rougechain.io/bridge';

/**
 * The bridge lives on the web (rougechain.io/bridge), which runs inside Qwalla's
 * in-app browser and connects to the wallet via the injected provider — so it
 * handles the deposit/withdraw contract calls correctly. Rather than reimplement
 * that natively (and risk mis-encoding a deposit), this screen just launches it.
 */
function openBridge() {
  router.push({ pathname: '/(tabs)/browser', params: { url: BRIDGE_URL } });
}

const ROWS: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }[] = [
  { icon: 'arrow-down', title: 'Deposit', sub: 'Send ETH / USDC / XRGE from Base → auto-minted on RougeChain' },
  { icon: 'arrow-up', title: 'Withdraw', sub: 'Send qETH / qUSDC / XRGE from RougeChain back to Base' },
];

export default function BridgeScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="git-compare" size={26} color={colors.accent} />
          </View>
          <Text style={styles.title}>Bridge</Text>
          <Text style={styles.subtitle}>Move assets between Base and RougeChain</Text>
        </View>

        <Card style={styles.card}>
          {ROWS.map((r) => (
            <View key={r.title} style={styles.row}>
              <View style={styles.rowIcon}>
                <Ionicons name={r.icon} size={16} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{r.title}</Text>
                <Text style={styles.rowSub}>{r.sub}</Text>
              </View>
            </View>
          ))}
        </Card>

        <Button title="Open Bridge" onPress={openBridge} />

        <Pressable onPress={openBridge} style={styles.linkRow}>
          <Ionicons name="globe-outline" size={13} color={colors.textTertiary} />
          <Text style={styles.linkText}>Opens rougechain.io/bridge in the Qwalla browser</Text>
        </Pressable>

        <View style={styles.noteRow}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.textTertiary} />
          <Text style={styles.noteText}>
            Tap “Connect Base Wallet” on the bridge to connect this wallet, then deposit or withdraw.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  hero: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xl },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 4, textAlign: 'center' },
  card: { marginBottom: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.textTertiary, fontSize: 12, marginTop: 2, lineHeight: 16 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: spacing.md,
  },
  linkText: { color: colors.textTertiary, fontSize: 12 },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteText: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 },
});
